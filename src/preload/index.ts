import { contextBridge, ipcRenderer } from 'electron'

// 登录参数类型
interface LoginParams {
  areaCode?: string
  phoneNumber?: string
  email?: string
  password: string
}

// 登录结果类型
interface LoginResult {
  success: boolean
  data?: {
    token: string
    refreshToken: string
    expireTime: number
    userID: string
  }
  errMsg?: string
  errCode?: number
}

// 认证信息类型
interface AuthInfo {
  token: string
  refreshToken: string
  expireTime: number
  userID: string
  loginTime: string
}

// WS 状态类型
interface WsStatus {
  connected: boolean
  url: string
  error?: string
}

// 应用配置类型（与 main/config.ts 保持一致）
export interface AppConfig {
  webviewUrl: string
  wsUrl: string
  wsPrivateUrl: string
  wsApiKey: string

  apiBaseUrl: string
  throttle: { enabled: boolean; intervalMs: number }
  mock: { intervalMs: number; batchSize: number }
}

// 通过 contextBridge 暴露安全的 API
contextBridge.exposeInMainWorld('electronBridge', {
  // ==================== 认证相关 ====================
  login: (params: LoginParams): Promise<LoginResult> => {
    return ipcRenderer.invoke('auth:login', params)
  },
  getToken: (): Promise<string> => {
    return ipcRenderer.invoke('auth:getToken')
  },
  isLoggedIn: (): Promise<boolean> => {
    return ipcRenderer.invoke('auth:isLoggedIn')
  },
  getAuthInfo: (): Promise<AuthInfo> => {
    return ipcRenderer.invoke('auth:getInfo')
  },
  logout: () => {
    ipcRenderer.send('auth:logout')
  },

  // ==================== WebSocket 相关 ====================
  wsConnect: (url: string) => {
    ipcRenderer.send('ws:connect', url)
  },
  wsDisconnect: () => {
    ipcRenderer.send('ws:disconnect')
  },
  wsSend: (data: unknown) => {
    ipcRenderer.send('ws:send', data)
  },
  wsGetStatus: (): Promise<{ connected: boolean; url: string }> => {
    return ipcRenderer.invoke('ws:getStatus')
  },
  onWsMessage: (callback: (data: unknown) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => callback(data)
    ipcRenderer.on('ws:message', handler)
    return () => ipcRenderer.removeListener('ws:message', handler)
  },
  onWsBatch: (callback: (data: unknown[]) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown[]): void => callback(data)
    ipcRenderer.on('ws:batch', handler)
    return () => ipcRenderer.removeListener('ws:batch', handler)
  },
  onWsStatus: (callback: (data: WsStatus) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: WsStatus): void => callback(data)
    ipcRenderer.on('ws:status', handler)
    return () => ipcRenderer.removeListener('ws:status', handler)
  },

  // ==================== 私有 WebSocket 相关 ====================
  wsPrivateConnect: (subscriptions?: unknown[]) => {
    ipcRenderer.send('ws-private:connect', subscriptions)
  },
  wsPrivateDisconnect: () => {
    ipcRenderer.send('ws-private:disconnect')
  },
  wsPrivateSend: (data: unknown) => {
    ipcRenderer.send('ws-private:send', data)
  },
  wsPrivateGetStatus: (): Promise<{ connected: boolean; loggedIn: boolean }> => {
    return ipcRenderer.invoke('ws-private:getStatus')
  },
  onWsPrivateMessage: (callback: (data: unknown) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => callback(data)
    ipcRenderer.on('ws-private:message', handler)
    return () => ipcRenderer.removeListener('ws-private:message', handler)
  },
  onWsPrivateStatus: (callback: (data: { connected: boolean; loggedIn: boolean; url: string; error?: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { connected: boolean; loggedIn: boolean; url: string; error?: string }): void => callback(data)
    ipcRenderer.on('ws-private:status', handler)
    return () => ipcRenderer.removeListener('ws-private:status', handler)
  },

  // ==================== 应用配置 ====================
  getConfig: (): Promise<AppConfig> => {
    return ipcRenderer.invoke('config:get')
  },
  setConfig: (patch: Partial<AppConfig>): Promise<AppConfig> => {
    return ipcRenderer.invoke('config:set', patch)
  },
  onConfigChanged: (callback: (cfg: AppConfig) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, cfg: AppConfig): void => callback(cfg)
    ipcRenderer.on('config:changed', handler)
    return () => ipcRenderer.removeListener('config:changed', handler)
  },

  // ==================== Mock 行情模拟 ====================
  mockStart: () => {
    ipcRenderer.send('mock:start')
  },
  mockStop: () => {
    ipcRenderer.send('mock:stop')
  },
  mockIsRunning: (): Promise<boolean> => {
    return ipcRenderer.invoke('mock:isRunning')
  },
  onMockStatus: (callback: (data: { running: boolean }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { running: boolean }): void =>
      callback(data)
    ipcRenderer.on('mock:status', handler)
    return () => ipcRenderer.removeListener('mock:status', handler)
  },

  // ==================== WebView DevTools ====================
  toggleWebviewDevTools: () => {
    ipcRenderer.send('webview:toggleDevTools')
  },
  isWebviewDevToolsOpened: (): Promise<boolean> => {
    return ipcRenderer.invoke('webview:isDevToolsOpened')
  },

  // webview preload 脚本路径（供 <webview preload> 使用）
  getWebviewPreloadPath: (): Promise<string> => {
    return ipcRenderer.invoke('webview:getPreloadPath')
  }
})

// 类型声明
export interface ElectronBridge {
  electronBridge: {
    // 认证
    login: (params: LoginParams) => Promise<LoginResult>
    getToken: () => Promise<string>
    isLoggedIn: () => Promise<boolean>
    getAuthInfo: () => Promise<AuthInfo>
    logout: () => void
    // WebSocket
    wsConnect: (url: string) => void
    wsDisconnect: () => void
    wsSend: (data: unknown) => void
    wsGetStatus: () => Promise<{ connected: boolean; url: string }>
    onWsMessage: (callback: (data: unknown) => void) => () => void
    onWsBatch: (callback: (data: unknown[]) => void) => () => void
    onWsStatus: (callback: (data: WsStatus) => void) => () => void
    // 应用配置
    getConfig: () => Promise<AppConfig>
    setConfig: (patch: Partial<AppConfig>) => Promise<AppConfig>
    onConfigChanged: (callback: (cfg: AppConfig) => void) => () => void
    // Mock 行情模拟
    mockStart: () => void
    mockStop: () => void
    mockIsRunning: () => Promise<boolean>
    onMockStatus: (callback: (data: { running: boolean }) => void) => () => void
    // WebView DevTools
    toggleWebviewDevTools: () => void
    isWebviewDevToolsOpened: () => Promise<boolean>
    getWebviewPreloadPath: () => Promise<string>
  }
}
