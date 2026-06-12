import { contextBridge, ipcRenderer } from 'electron'

// ==================== WebView 原生桥冒充 ====================
// 注入到远端页面（test.qqlink.info），冒充原生宿主的 window.WebViewJSBridge。
// 页面的 ~/utils/bridge 通过它收发：
//   - isWebView()        => 判断 window.WebViewJSBridge 是否存在（注入后即为真）
//   - callHandler(name, payload)        页面 -> 原生
//   - registerHandler(name, handler)    原生 -> 页面（原生主动推送时回调）
//   - unregisterHandler(name)
//
// 我们在这里把对应通道接到 Electron：
//   - 'usStockPublic'  订阅/退订 -> 转发到主进程 WS（ws:send）
//   - 'kbPublicMessage' 行情/ACK 推送 -> 由主进程 WS 经 'ws-data' 回调页面 handler
//   - 'proxy'          雪球行情 REST -> 主进程 http:proxy 同源反代

type BridgeHandler = (
  data: unknown,
  success: (d?: unknown) => void,
  fail: (d?: unknown) => void
) => void

interface Payload {
  data?: unknown
  success?: (d?: unknown) => void
  fail?: (d?: unknown) => void
}

const handlers = new Map<string, BridgeHandler>()

const noop = (): void => {}

const WebViewJSBridge = {
  registerHandler(name: string, handler: BridgeHandler): void {
    console.log('[WebViewJSBridge] registerHandler:', name)
    handlers.set(name, handler)
  },

  unregisterHandler(name: string): void {
    console.log('[WebViewJSBridge] unregisterHandler:', name)
    handlers.delete(name)
  },

  callHandler(name: string, payload?: Payload): unknown {
    // 0) 启动私有 WS：payload.data 可含订阅列表 { subscriptions: [...] }
    if (name === 'startWs') {
      console.log('[WebViewJSBridge] startWs called, payload:', JSON.stringify(payload?.data))
      const req = payload?.data as { subscriptions?: unknown[] } | undefined
      ipcRenderer.send('ws-private:connect', req?.subscriptions)
      payload?.success?.()
      return undefined
    }

    // 0.1) 私有频道订阅 / 退订：payload.data = { op, args }
    if (name === 'kbPrivate') {
      ipcRenderer.send('ws-private:send', payload?.data)
      return undefined
    }

    // 0.2) 断开私有 WS
    if (name === 'stopWs') {
      ipcRenderer.send('ws-private:disconnect')
      payload?.success?.()
      return undefined
    }

    // 1) 行情订阅 / 退订：payload.data = { op, args }
    if (name === 'usStockPublic') {
      ipcRenderer.send('ws:send', payload?.data)
      return undefined
    }

    // 2) 雪球 REST 代理：payload.data = { url, method, params }
    //    必须在 webview 页面上下文里用相对地址 fetch（同源 + 带 cookie），
    //    和页面在浏览器里 $fetch('/xueqiu-api/...') 行为一致；走主进程会丢会话导致 400。
    if (name === 'proxy') {
      const req = payload?.data as {
        url: string
        method?: string
        params?: Record<string, unknown>
      }
      const proxyUrl = (req.url || '')
        .replace('https://stock.xueqiu.com', '/xueqiu-api')
        .replace('https://api.xueqiu.com', '/api.xueqiu')
      const method = (req.method || 'GET').toUpperCase()

      const qs = new URLSearchParams()
      if (req.params) {
        for (const [k, v] of Object.entries(req.params)) {
          if (v !== undefined && v !== null) qs.append(k, String(v))
        }
      }

      let finalUrl = proxyUrl
      const opts: RequestInit = { method, credentials: 'include' }
      if (method === 'GET' || method === 'HEAD') {
        if ([...qs].length) finalUrl += (proxyUrl.includes('?') ? '&' : '?') + qs.toString()
      } else if ([...qs].length) {
        opts.body = qs.toString()
        opts.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
      }

      const p = fetch(finalUrl, opts).then((r) => r.json())
      p.then((d) => payload?.success?.(d)).catch((e) => payload?.fail?.(String(e)))
      return p
    }

    // 3) 获取登录态：返回 { token(=walletToken), secretKey, kbitToken, chatToken }
    if (name === 'getAuth') {
      const p = ipcRenderer.invoke('auth:getTokens')
      p.then((d) => payload?.success?.(d)).catch((e) => payload?.fail?.(String(e)))
      return p
    }

    // 4) 其它暂未实现的通道：打日志，方便后续按需补
    console.warn('[WebViewJSBridge] 未实现的 callHandler:', name, payload)
    return undefined
  }
}

contextBridge.exposeInMainWorld('WebViewJSBridge', WebViewJSBridge)

// 原生 -> 页面：主进程 WS 收到消息后通过 'ws-data' 下发，
// 这里转交给页面注册在 'kbPublicMessage' 上的 handler。
ipcRenderer.on('ws-data', (_e, msg) => {
  const handler = handlers.get('kbPublicMessage')
  if (handler) {
    handler(msg, noop, noop)
  }
})

// 私有 WS 推送：主进程私有 WS 收到消息后通过 'ws-private-data' 下发，
// 转交给页面注册在 'kbPrivateMessage' 上的 handler。
ipcRenderer.on('ws-private-data', (_e, msg) => {
  const handler = handlers.get('kbPrivateMessage')
  if (handler) {
    handler(msg, noop, noop)
  }
})
