// ==================== KeepBit 私有 WebSocket 协议 ====================
// 接口: wss://{host}/v2/ws/private
// 私有频道需要登录：connect → login(HMAC) → subscribe → 每 30s ping → 接收推送。

import WebSocket from 'ws'
import { createHmac } from 'crypto'
import { appendFileSync } from 'fs'

function debugLog(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try {
    appendFileSync('/tmp/ws-private-debug.log', line)
  } catch {
    /* ignore */
  }
  console.log(msg)
}

export const PING_CMD = 'ping'
export const HEARTBEAT_INTERVAL = 30000

export interface PrivateWsLoginArgs {
  apiKey: string
  secretKey: string
  passphrase: string // 用户 JWT Access Token
  clientType: string // ios / android / web
}

export interface PrivateSubItem {
  instType: string // US-STOCKS / USDT-FUTURES / SPOT / SMIX
  channel: string // orders / fill / positions / account
  instId: string // default 或具体标的
  extHours?: boolean // 美股盘前盘后行情
}

export type PrivateWsCallback = (data: unknown) => void

function buildSign(timestamp: string, secretKey: string): string {
  const prehash = timestamp + 'GET' + '/user/verify'
  // 默认按 Flutter 写法:secretKey 字面值当 UTF-8 bytes 做 HMAC key
  const signRaw = createHmac('sha256', secretKey).update(prehash).digest('base64')
  // 备用编码,方便诊断:小写化、hex 解码成 16 字节
  const signLower = createHmac('sha256', secretKey.toLowerCase()).update(prehash).digest('base64')
  let signHexDecoded = '(skip)'
  try {
    signHexDecoded = createHmac('sha256', Buffer.from(secretKey, 'hex')).update(prehash).digest('base64')
  } catch {
    /* secretKey 不是 hex 也无所谓 */
  }
  debugLog(
    `[WS-Private] sign 三态对照 | prehash="${prehash}" | secretLen=${secretKey.length}\n` +
      `  ① 字面值(uppercase utf8): ${signRaw}\n` +
      `  ② 小写化(utf8):          ${signLower}\n` +
      `  ③ hex 解码成 16 字节:     ${signHexDecoded}`
  )
  return signRaw
}

function buildLoginCmd(args: PrivateWsLoginArgs): string {
  const timestamp = Date.now().toString()
  const sign = buildSign(timestamp, args.secretKey)
  // 字段顺序对齐 Flutter 客户端,避免服务端有不规范的字段顺序校验
  const cmd = {
    op: 'login',
    args: [
      {
        apiKey: args.apiKey,
        timestamp,
        passphrase: args.passphrase,
        clientType: args.clientType,
        sign
      }
    ]
  }
  debugLog(
    '[WS-Private] login 命令: ' +
      JSON.stringify({
        ...cmd,
        args: cmd.args.map((a) => ({
          ...a,
          passphrase: a.passphrase,
          sign: a.sign
        }))
      })
  )

  return JSON.stringify(cmd)
}

function buildSubscribeCmd(items: PrivateSubItem[]): string {
  return JSON.stringify({
    op: 'subscribe',
    args: items
  })
}

function isHeartbeat(msg: string): boolean {
  const t = msg.trim()
  return t === 'pong' || t === 'ping'
}

export class PrivateWsClient {
  private ws: WebSocket | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private pendingSubs: PrivateSubItem[] = []
  private loggedIn = false
  private url = ''

  // 外部回调
  private onData: PrivateWsCallback = () => {}
  private onStatus: (status: {
    connected: boolean
    loggedIn: boolean
    url: string
    error?: string
  }) => void = () => {}

  constructor(private loginArgs: PrivateWsLoginArgs) {}

  setOnData(cb: PrivateWsCallback): void {
    this.onData = cb
  }

  setOnStatus(cb: typeof this.onStatus): void {
    this.onStatus = cb
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  get isLoggedIn(): boolean {
    return this.loggedIn
  }

  connect(url: string, subscriptions?: PrivateSubItem[]): void {
    this.url = url
    this.loggedIn = false
    if (subscriptions) {
      this.pendingSubs = [...subscriptions]
    }

    if (this.ws) {
      this.ws.terminate()
    }

    this.ws = new WebSocket(url, { rejectUnauthorized: false })

    this.ws.on('open', () => {
      debugLog(`[WS-Private] 已连接到 ${url}，发送 login`)
      debugLog(
        `[WS-Private] 登录参数: ${JSON.stringify({
          apiKey: this.loginArgs.apiKey,
          passphrase: this.loginArgs.passphrase,
          clientType: this.loginArgs.clientType
        })}`
      )
      this.emitStatus()
      this.ws!.send(buildLoginCmd(this.loginArgs))
    })

    this.ws.on('message', (raw: WebSocket.Data) => {
      const text = raw.toString()
      if (isHeartbeat(text)) return

      try {
        const parsed = JSON.parse(text)
        this.handleMessage(parsed)
      } catch (e) {
        debugLog(`[WS-Private] 解析消息失败: ${e}`)
      }
    })

    this.ws.on('close', () => {
      this.loggedIn = false
      this.stopHeartbeat()
      debugLog('[WS-Private] 连接已关闭')
      this.emitStatus()
    })

    this.ws.on('error', (err: Error) => {
      this.loggedIn = false
      this.stopHeartbeat()
      debugLog(`[WS-Private] 连接错误: ${err.message}`)
      this.onStatus({ connected: false, loggedIn: false, url: this.url, error: err.message })
    })
  }

  disconnect(): void {
    this.stopHeartbeat()
    this.loggedIn = false
    if (this.ws) {
      this.ws.terminate()
      this.ws = null
    }
    this.emitStatus()
  }

  send(data: unknown): void {
    const text = typeof data === 'string' ? data : JSON.stringify(data)
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(text)
    } else {
      debugLog(`[WS-Private] 未就绪，丢弃: ${text}`)
    }
  }

  subscribe(items: PrivateSubItem[]): void {
    if (this.loggedIn && this.connected) {
      this.ws!.send(buildSubscribeCmd(items))
    } else {
      this.pendingSubs.push(...items)
    }
  }

  private handleMessage(parsed: Record<string, unknown>): void {
    // 控制回执（login / subscribe / error）
    if ('event' in parsed) {
      const event = parsed.event as string
      const code = parsed.code as string

      if (event === 'login') {
        if (code === '0') {
          debugLog('[WS-Private] 登录成功')
          this.loggedIn = true
          this.emitStatus()
          this.startHeartbeat()
          this.flushPendingSubs()
        } else {
          debugLog(`[WS-Private] 登录失败: code=${code} msg=${parsed.msg}`)
          debugLog(`[WS-Private] loginArgs: ${JSON.stringify(this.loginArgs)}`)
          // 把失败信息(含 loginArgs)推到渲染进程日志面板,方便排查
          this.onData({
            event: 'login-fail',
            code,
            msg: parsed.msg,
            loginArgs: this.loginArgs,
            sign: buildSign(this.loginArgs.clientType, this.loginArgs.secretKey) // 额外暴露 sign 以验证登录命令构造是否正确
          })
          this.emitStatus()
        }
        return
      }

      if (event === 'subscribe' || event === 'unsubscribe') {
        debugLog(`[WS-Private] ${event} ACK: ${JSON.stringify(parsed.arg)}`)
        this.onData(parsed)
        return
      }

      if (event === 'error') {
        debugLog(`[WS-Private] 错误: code=${code} msg=${parsed.msg}`)
        debugLog(`[WS-Private] 错误: ${JSON.stringify(this.loginArgs)}`)
        this.onData({
          ...parsed,
          loginArgs: this.loginArgs,
          sign: buildSign(this.loginArgs.clientType, this.loginArgs.secretKey) // 额外暴露 sign 以验证登录命令构造是否正确
        })
        return
      }
    }

    // 业务数据推送（action: snapshot / update）
    if ('action' in parsed) {
      this.onData(parsed)
      return
    }

    debugLog(`[WS-Private] 未知消息: ${JSON.stringify(parsed)}`)
  }

  private flushPendingSubs(): void {
    if (this.pendingSubs.length === 0) return
    const items = this.pendingSubs.splice(0)
    this.ws!.send(buildSubscribeCmd(items))
    debugLog(`[WS-Private] 补发缓存订阅: ${items.length} 个`)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.connected) {
        this.ws!.send(PING_CMD)
      }
    }, HEARTBEAT_INTERVAL)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private emitStatus(): void {
    this.onStatus({
      connected: this.connected,
      loggedIn: this.loggedIn,
      url: this.url
    })
  }
}
