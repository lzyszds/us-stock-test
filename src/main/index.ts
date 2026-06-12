import { app, shell, BrowserWindow, ipcMain, webContents } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { login as loginApi } from './api'
import { saveToken, getToken, isTokenValid, clearToken, getAuthInfo, getAuthTokens } from './auth'
import WebSocket from 'ws'
import { isHeartbeatMessage, PING_CMD, HEARTBEAT_INTERVAL } from './socket'
import { PrivateWsClient, type PrivateSubItem } from './socketPrivate'
import { startMockWs } from './mockWs'
import { loadConfig, saveConfig, type AppConfig } from './config'
import { writeFileSync, appendFileSync } from 'fs'
import { join as pathJoin } from 'path'

function debugLog(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try {
    appendFileSync('/tmp/ws-private-debug.log', line)
  } catch { /* ignore */ }
  console.log(msg)
}

let mainWindow: BrowserWindow | null = null

// ==================== WebSocket 客户端 ====================
// KeepBit 公共行情 WS（wss://wss.keepbit.com/v2/ws/public）：无需登录，
// 连接后直接 subscribe，并每 30s 发送 ping 心跳。
let wsClient: WebSocket | null = null
let wsUrl = ''
let wsConnected = false
let heartbeatTimer: NodeJS.Timeout | null = null
// 连接未就绪前 webview 发来的订阅，先缓存，open 后补发
const pendingSends: string[] = []

// ==================== 订阅登记（驱动 mock 模拟哪些标的） ====================
// 解析 webview 下发的订阅/退订命令，维护当前订阅集合。
// 命令格式：{ op: 'subscribe' | 'unsubscribe', args: [{ instType, channel, instId }] }
type SubInst = { instType: string; channel: string; instId: string }
const subscriptions = new Map<string, SubInst>() // key: `${channel}:${instId}`

function trackSubscription(text: string): void {
  try {
    const cmd = JSON.parse(text)
    if (!cmd || !Array.isArray(cmd.args)) return
    if (cmd.op !== 'subscribe' && cmd.op !== 'unsubscribe') return
    for (const a of cmd.args as SubInst[]) {
      if (!a?.instId || !a?.channel) continue
      const key = `${a.channel}:${a.instId}`
      if (cmd.op === 'subscribe') {
        subscriptions.set(key, { instType: a.instType, channel: a.channel, instId: a.instId })
        console.log('[Sub] 订阅:', key)
      } else {
        subscriptions.delete(key)
        console.log('[Sub] 退订:', key)
      }
    }
  } catch {
    // 非 JSON（如 ping）忽略
  }
}

function wsSendRaw(data: unknown): void {
  const text = typeof data === 'string' ? data : JSON.stringify(data)
  trackSubscription(text)
  if (wsClient && wsClient.readyState === WebSocket.OPEN) {
    wsClient.send(text)
  } else {
    pendingSends.push(text)
    console.log(`[WS] 未就绪，缓存待发:`, text)
  }
}

function flushPendingSends(): void {
  if (!wsClient || wsClient.readyState !== WebSocket.OPEN) return
  while (pendingSends.length) {
    const text = pendingSends.shift()!
    wsClient.send(text)
    console.log(`[WS] 补发缓存订阅:`, text)
  }
}

function startHeartbeat(): void {
  stopHeartbeat()
  // 每 30 秒发送一次纯文本 'ping' 心跳
  heartbeatTimer = setInterval(() => {
    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
      wsClient.send(PING_CMD)
    }
  }, HEARTBEAT_INTERVAL)
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

const tickerUpdateDataMap = new Map()

// ==================== 节流：合并高频行情后定时推给渲染进程 ====================
// 开启后，每条消息只写入 buffer（同 instId 覆盖取最新），由定时器每 intervalMs
// 把整批一次性推给渲染进程，把 N 次 IPC 压成 1 次。WebView 仍逐条实时转发。
type Parsed = { arg: { instId: string } }
const throttleBuffer = new Map<string, Parsed>()
let throttleTimer: NodeJS.Timeout | null = null

function startThrottle(): void {
  stopThrottle()
  const cfg = loadConfig().throttle
  if (!cfg.enabled) return
  throttleTimer = setInterval(() => {
    if (throttleBuffer.size === 0) return
    const batch = Array.from(throttleBuffer.values())
    throttleBuffer.clear()
    sendToRenderer('ws:batch', batch)
  }, cfg.intervalMs)
}

function stopThrottle(): void {
  if (throttleTimer) {
    clearInterval(throttleTimer)
    throttleTimer = null
  }
  throttleBuffer.clear()
}

// 处理一条已解析的行情消息（真实 WS 与 mock 模拟器共用）
function handleParsed(parsed: Parsed): void {
  tickerUpdateDataMap.set(parsed.arg.instId, parsed)
  // WebView 是业务真实消费方，始终逐条实时转发
  forwardToWebView(parsed)
  // 渲染进程（调试面板）：节流开启则进 buffer，否则立即推
  if (loadConfig().throttle.enabled) {
    throttleBuffer.set(parsed.arg.instId, parsed)
  } else {
    sendToRenderer('ws:message', parsed)
  }
}

function connectWebSocket(url: string): void {
  wsUrl = url
  if (wsClient) {
    wsClient.terminate()
  }

  // 测试环境证书链不完整（unable to verify the first certificate），
  // 对 wss 关闭证书校验。生产环境若证书正常可去掉此项。
  wsClient = new WebSocket(url, {
    rejectUnauthorized: false
  })

  wsClient.on('open', () => {
    wsConnected = true
    console.log(`[WS] 已连接到 ${url}`)
    sendToRenderer('ws:status', { connected: true, url })
    // 不再自动订阅：订阅由 webview 页面通过 WebViewJSBridge 主动下发
    flushPendingSends()
    startHeartbeat()
  })

  wsClient.on('message', (data: WebSocket.Data) => {
    const raw = data.toString()
    // 过滤心跳消息（ping/pong），不转发
    if (isHeartbeatMessage(raw)) return

    try {
      const parsed = JSON.parse(raw)
      console.log(`[WS] 收到消息:`, parsed)
      handleParsed(parsed)
    } catch (e) {
      console.error(`[WS] 解析消息失败:`, e)
    }
  })

  wsClient.on('close', () => {
    wsConnected = false
    stopHeartbeat()
    console.log(`[WS] 连接已关闭`)
    sendToRenderer('ws:status', { connected: false, url })
  })

  wsClient.on('error', (err: Error) => {
    wsConnected = false
    stopHeartbeat()
    console.error(`[WS] 连接错误:`, err.message)
    sendToRenderer('ws:status', { connected: false, url, error: err.message })
  })
}

// 向渲染进程发送数据
function sendToRenderer(channel: string, data: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}

// 向 WebView 转发 WS 数据（webview 的 preload 通过 ipcRenderer.on('ws-data') 接收）
function forwardToWebView(data: unknown): void {
  for (const wc of webContents.getAllWebContents()) {
    // 跳过主窗口的 webContents，只发给 webview
    if (wc !== mainWindow?.webContents && !wc.isDestroyed()) {
      wc.send('ws-data', data)
    }
  }
}

// ==================== 私有 WebSocket 客户端 ====================
// KeepBit 私有 WS（wss://{host}/v2/ws/private）：需要登录认证（HMAC 签名 + JWT），
// 用于接收订单、成交、持仓、账户等私有数据推送。
// webview 第三方页面通过 callHandler('startWs') 触发。
let privateWsClient: PrivateWsClient | null = null

function connectPrivateWs(subscriptions?: PrivateSubItem[]): void {
  const cfg = loadConfig()
  const auth = getAuthInfo()

  debugLog('[WS-Private] connectPrivateWs 被调用')
  debugLog(`[WS-Private] wsPrivateUrl: ${cfg.wsPrivateUrl}`)
  debugLog(`[WS-Private] wsApiKey: ${cfg.wsApiKey}`)
  debugLog(`[WS-Private] kbitToken: ${auth.kbitToken ? auth.kbitToken.slice(0, 20) + '...' : '(空)'}`)
  debugLog(`[WS-Private] secretKey: ${auth.secretKey ? auth.secretKey.slice(0, 8) + '...' : '(空)'}`)
  debugLog(`[WS-Private] subscriptions: ${JSON.stringify(subscriptions)}`)

  if (!auth.kbitToken) {
    console.error('[WS-Private] 无法连接：缺少 kbitToken，请先登录')
    return
  }

  if (!auth.secretKey) {
    console.error('[WS-Private] 无法连接：缺少签名密钥 secretKey，请先登录')
    return
  }

  if (privateWsClient) {
    privateWsClient.disconnect()
  }

  privateWsClient = new PrivateWsClient({
    apiKey: cfg.wsApiKey,
    secretKey: auth.secretKey,
    passphrase: auth.kbitToken,
    clientType: 'ios'
  })

  privateWsClient.setOnData((data) => {
    debugLog(`[WS-Private] 推送: ${JSON.stringify(data)}`)
    forwardPrivateToWebView(data)
    sendToRenderer('ws-private:message', data)
  })

  privateWsClient.setOnStatus((status) => {
    debugLog(`[WS-Private] 状态: ${JSON.stringify(status)}`)
    sendToRenderer('ws-private:status', status)
  })

  privateWsClient.connect(cfg.wsPrivateUrl, subscriptions)
}

function forwardPrivateToWebView(data: unknown): void {
  for (const wc of webContents.getAllWebContents()) {
    if (wc !== mainWindow?.webContents && !wc.isDestroyed()) {
      wc.send('ws-private-data', data)
    }
  }
}

// ==================== 创建窗口 ====================

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ==================== IPC 处理：登录相关 ====================

ipcMain.handle(
  'auth:login',
  async (
    _event,
    params: { areaCode?: string; phoneNumber?: string; email?: string; password: string }
  ) => {
    try {
      const result = await loginApi(params)

      if (result.errCode === 0 && result.data) {
        saveToken({
          token: result.data.token,
          refreshToken: result.data.refreshToken,
          expireTime: result.data.expireTime,
          userID: result.data.userID,
          walletToken: result.data.walletToken,
          secretKey: result.data.secretKey,
          kbitToken: result.data.kbitToken,
          chatToken: result.data.chatToken
        })
        console.log(`[Auth] 登录成功, userID: ${result.data.userID}`)
        return { success: true, data: result.data }
      } else {
        console.error(`[Auth] 登录失败: ${result.errMsg}`)
        return { success: false, errMsg: result.errMsg, errCode: result.errCode }
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : '登录请求失败'
      console.error(`[Auth] 登录异常:`, errMsg)
      return { success: false, errMsg }
    }
  }
)

ipcMain.handle('auth:getToken', () => {
  return getToken()
})

ipcMain.handle('auth:isLoggedIn', () => {
  return isTokenValid()
})

ipcMain.handle('auth:getInfo', () => {
  return getAuthInfo()
})

// 页面 getAuth 用：返回 { token(=walletToken), secretKey, kbitToken, chatToken }
ipcMain.handle('auth:getTokens', () => {
  return getAuthTokens()
})

ipcMain.on('auth:logout', () => {
  clearToken()
  console.log(`[Auth] 已退出登录`)
})

// ==================== IPC 处理：WebSocket 相关 ====================

// 连接 WebSocket
ipcMain.on('ws:connect', (_event, url: string) => {
  connectWebSocket(url)
})

// 断开 WebSocket
ipcMain.on('ws:disconnect', () => {
  if (wsClient) {
    stopHeartbeat()
    wsClient.terminate()
    wsClient = null
    wsConnected = false
    sendToRenderer('ws:status', { connected: false, url: wsUrl })
  }
})

// 通过 WebSocket 发送数据（来自主窗口或 webview 的 preload）
ipcMain.on('ws:send', (_event, data: unknown) => {
  wsSendRaw(data)
})

// ==================== IPC 处理：私有 WebSocket ====================

ipcMain.on('ws-private:connect', (_event, subscriptions?: PrivateSubItem[]) => {
  connectPrivateWs(subscriptions)
})

ipcMain.on('ws-private:disconnect', () => {
  if (privateWsClient) {
    privateWsClient.disconnect()
    privateWsClient = null
  }
})

ipcMain.on('ws-private:send', (_event, data: unknown) => {
  if (privateWsClient) {
    privateWsClient.send(data)
  }
})

ipcMain.on('ws-private:subscribe', (_event, items: PrivateSubItem[]) => {
  if (privateWsClient) {
    privateWsClient.subscribe(items)
  }
})

ipcMain.handle('ws-private:getStatus', () => {
  return {
    connected: privateWsClient?.connected ?? false,
    loggedIn: privateWsClient?.isLoggedIn ?? false
  }
})

// ==================== IPC 处理：Mock 行情模拟 ====================
// 美股闭市 / WS 不推数据时，由前端开关驱动模拟推送，走和真实 WS 完全相同的处理链路。
let stopMock: (() => void) | null = null

function launchMock(): () => void {
  const m = loadConfig().mock // 仅 intervalMs / batchSize 来自配置
  return startMockWs(handleParsed, {
    intervalMs: m.intervalMs,
    batchSize: m.batchSize,
    // 模拟的标的完全跟随 webview 当前订阅
    getSubscriptions: () => Array.from(subscriptions.values())
  })
}

ipcMain.on('mock:start', () => {
  if (stopMock) return // 已在运行，避免重复
  stopMock = launchMock()
  sendToRenderer('mock:status', { running: true })
})

ipcMain.on('mock:stop', () => {
  if (stopMock) {
    stopMock()
    stopMock = null
  }
  sendToRenderer('mock:status', { running: false })
})

ipcMain.handle('mock:isRunning', () => stopMock !== null)

// ==================== IPC 处理：应用配置 ====================
ipcMain.handle('config:get', () => loadConfig())

ipcMain.handle('config:set', (_event, patch: Partial<AppConfig>) => {
  const next = saveConfig(patch)
  // 节流参数可能变了，重启节流定时器
  startThrottle()
  // mock 正在运行且其参数变了，重启使新参数生效
  if (stopMock) {
    stopMock()
    stopMock = launchMock()
  }
  sendToRenderer('config:changed', next)
  return next
})

// 获取 WebSocket 状态
ipcMain.handle('ws:getStatus', () => {
  return {
    connected: wsConnected,
    url: wsUrl
  }
})

// 提供 webview preload 脚本的 file:// 路径，供 <webview preload> 使用
ipcMain.handle('webview:getPreloadPath', () => {
  return `file://${join(__dirname, '../preload/webview.js')}`
})

// ==================== IPC 处理：WebView DevTools ====================

// 打开/关闭 WebView 的 DevTools
ipcMain.on('webview:toggleDevTools', () => {
  for (const wc of webContents.getAllWebContents()) {
    if (wc !== mainWindow?.webContents && !wc.isDestroyed()) {
      if (wc.isDevToolsOpened()) {
        wc.closeDevTools()
      } else {
        wc.openDevTools({ mode: 'detach' })
      }
    }
  }
})

// 检查 WebView DevTools 是否打开
ipcMain.handle('webview:isDevToolsOpened', () => {
  for (const wc of webContents.getAllWebContents()) {
    if (wc !== mainWindow?.webContents && !wc.isDestroyed()) {
      return wc.isDevToolsOpened()
    }
  }
  return false
})

// ==================== 应用生命周期 ====================

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()
  startThrottle() // 启动节流定时器（按配置）

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (wsClient) wsClient.terminate()
  if (privateWsClient) privateWsClient.disconnect()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
