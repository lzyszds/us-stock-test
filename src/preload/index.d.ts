import { ElectronAPI } from '@electron-toolkit/preload'

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

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
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
      onWsStatus: (callback: (data: WsStatus) => void) => () => void
      // WebView DevTools
      toggleWebviewDevTools: () => void
      isWebviewDevToolsOpened: () => Promise<boolean>
    }
  }

  interface HTMLWebViewElement extends HTMLElement {
    src: string
    allowpopups: string
    preload: string
    useragent: string
    partition: string
    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void
    getWebContents(): Electron.WebContents
    loadURL(url: string): void
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: HTMLWebViewElement
    }
  }
}
