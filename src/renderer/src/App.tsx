import { useEffect, useState, useRef } from 'react'
import {
  Settings,
  User,
  RefreshCw,
  Play,
  Square,
  LogOut,
  Trash2,
  Sun,
  Moon,
  Wifi,
  WifiOff,
  Terminal,
  Database,
  Link,
  ArrowDownToLine,
  Bug,
  Pause,
  ChevronDown,
  ChevronsDown
} from 'lucide-react'
import LoginPage from './LoginPage'
import SettingsDialog from './SettingsDialog'
import JsonTree from './JsonTree'
import type { AppConfig } from './types'

// 扩展 window 类型
declare global {
  interface Window {
    electronBridge: {
      login: (params: {
        areaCode?: string
        phoneNumber?: string
        email?: string
        password: string
      }) => Promise<{
        success: boolean
        data?: { token: string; refreshToken: string; expireTime: number; userID: string }
        errMsg?: string
        errCode?: number
      }>
      getToken: () => Promise<string>
      isLoggedIn: () => Promise<boolean>
      getAuthInfo: () => Promise<{
        token: string
        refreshToken: string
        expireTime: number
        userID: string
        loginTime: string
      }>
      logout: () => void
      wsConnect: (url: string) => void
      wsDisconnect: () => void
      wsSend: (data: unknown) => void
      wsGetStatus: () => Promise<{ connected: boolean; url: string }>
      onWsMessage: (callback: (data: unknown) => void) => () => void
      onWsBatch: (callback: (data: unknown[]) => void) => () => void
      onWsPrivateMessage: (callback: (data: unknown) => void) => () => void
      onWsStatus: (
        callback: (data: { connected: boolean; url: string; error?: string }) => void
      ) => () => void
      getConfig: () => Promise<AppConfig>
      setConfig: (patch: Partial<AppConfig>) => Promise<AppConfig>
      onConfigChanged: (callback: (cfg: AppConfig) => void) => () => void
      mockStart: () => void
      mockStop: () => void
      mockIsRunning: () => Promise<boolean>
      onMockStatus: (callback: (data: { running: boolean }) => void) => () => void
      toggleWebviewDevTools: () => void
      isWebviewDevToolsOpened: () => Promise<boolean>
      getWebviewPreloadPath: () => Promise<string>
    }
  }
}

type PageState = 'checking' | 'login' | 'main'

function App(): React.JSX.Element {
  const [pageState, setPageState] = useState<PageState>('checking')
  const [userID, setUserID] = useState('')
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [wsConnected, setWsConnected] = useState(false)
  const [wsUrl, setWsUrl] = useState('')
  const [mockRunning, setMockRunning] = useState(false)
  const [devToolsOpened, setDevToolsOpened] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [wsMessages, setWsMessages] = useState<
    { source: 'kbPublicMessage' | 'kbPrivateMessage'; data: unknown }[]
  >([])
  const [msgCount, setMsgCount] = useState(0)
  const [webviewPreload, setWebviewPreload] = useState<string>('')
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('theme') as 'light' | 'dark') || 'dark'
  })
  const [autoScroll, setAutoScroll] = useState(false)
  const [logEnabled, setLogEnabled] = useState(true)
  const [expandDepth, setExpandDepth] = useState(0)
  const logEnabledRef = useRef(true)
  useEffect(() => {
    logEnabledRef.current = logEnabled
  }, [logEnabled])

  const LOG_LIMIT = 300

  const webviewRef = useRef<HTMLWebViewElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!autoScroll) return
    const el = scrollContainerRef.current
    if (!el) return
    // 仅当用户已经在底部(<=40px 容差)时才跟随,否则不动,避免把正在看的位置顶走
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    if (atBottom) el.scrollTop = el.scrollHeight
  }, [wsMessages, autoScroll])

  useEffect(() => {
    const root = window.document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggleTheme = (): void => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))

  useEffect(() => {
    window.electronBridge?.getConfig().then(setConfig)
    window.electronBridge
      ?.getWebviewPreloadPath()
      .then(setWebviewPreload)
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (pageState !== 'main') return
    const webview = webviewRef.current as unknown as Electron.WebviewTag | null
    if (!webview) return

    const handler = (e: Electron.IpcMessageEvent): void => {
      if (e.channel === 'webview:ws-send') {
        const payload = e.args?.[0]
        window.electronBridge?.wsSend(payload)
      }
    }
    const handleDomReady = (): void => {
      const cssRules = `
        body, p, span, div, h1, h2, h3, h4, h5, h6, a {
          font-size: 10px !important; 
        }
      `
      webview.insertCSS(cssRules).catch(console.error)
    }
    webview.addEventListener('dom-ready', handleDomReady)
    webview.addEventListener('ipc-message', handler)
    return () => {
      webview.removeEventListener('ipc-message', handler)
      webview.removeEventListener('dom-ready', handleDomReady)
    }
  }, [pageState, webviewPreload])

  useEffect(() => {
    const checkAuth = async (): Promise<void> => {
      const bridge = window.electronBridge
      if (!bridge) {
        setPageState('login')
        return
      }
      try {
        const loggedIn = await bridge.isLoggedIn()
        if (loggedIn) {
          const info = await bridge.getAuthInfo()
          setUserID(info.userID)
          setPageState('main')
        } else {
          setPageState('login')
        }
      } catch {
        setPageState('login')
      }
    }
    checkAuth()
  }, [])

  useEffect(() => {
    const bridge = window.electronBridge
    if (!bridge) return

    const unsubStatus = bridge.onWsStatus((status) => {
      setWsConnected(status.connected)
      setWsUrl(status.url)
    })
    const unsubMessage = bridge.onWsMessage((data) => {
      if (!logEnabledRef.current) return
      setWsMessages((prev) =>
        [...prev, { source: 'kbPublicMessage' as const, data }].slice(-LOG_LIMIT)
      )
      setMsgCount((c) => c + 1)
    })
    const unsubBatch = bridge.onWsBatch((batch) => {
      if (!logEnabledRef.current) return
      setWsMessages((prev) =>
        [
          ...prev,
          ...batch.map((d) => ({ source: 'kbPublicMessage' as const, data: d }))
        ].slice(-LOG_LIMIT)
      )
      setMsgCount((c) => c + batch.length)
    })
    const unsubPrivate = bridge.onWsPrivateMessage?.((data) => {
      if (!logEnabledRef.current) return
      setWsMessages((prev) =>
        [...prev, { source: 'kbPrivateMessage' as const, data }].slice(-LOG_LIMIT)
      )
      setMsgCount((c) => c + 1)
    })
    const unsubMock = bridge.onMockStatus((status) => setMockRunning(status.running))
    const unsubCfg = bridge.onConfigChanged((cfg) => setConfig(cfg))

    return () => {
      unsubStatus()
      unsubMessage()
      unsubBatch()
      unsubPrivate?.()
      unsubMock()
      unsubCfg()
    }
  }, [])

  const autoConnectedRef = useRef(false)
  useEffect(() => {
    if (pageState !== 'main' || !config) return
    if (autoConnectedRef.current) return
    autoConnectedRef.current = true
    window.electronBridge?.wsConnect(config.wsUrl)
  }, [pageState, config])

  const handleLoginSuccess = (data: { token: string; userID: string }): void => {
    setUserID(data.userID)
    setPageState('main')
  }

  const handleLogout = (): void => {
    window.electronBridge?.wsDisconnect()
    window.electronBridge?.logout()
    setUserID('')
    setPageState('login')
  }

  const handleReconnect = (): void => {
    if (!config) return
    setWsMessages([])
    setMsgCount(0)
    window.electronBridge?.wsConnect(config.wsUrl)
  }

  const handleToggleMock = (): void => {
    if (mockRunning) window.electronBridge?.mockStop()
    else window.electronBridge?.mockStart()
  }

  const handleToggleDevTools = (): void => {
    window.electronBridge?.toggleWebviewDevTools()
    setTimeout(async () => {
      const opened = await window.electronBridge?.isWebviewDevToolsOpened()
      setDevToolsOpened(opened ?? false)
    }, 500)
  }

  const handleSettingsSaved = (saved: AppConfig): void => {
    setConfig(saved)
    if (saved.wsUrl !== wsUrl) {
      window.electronBridge?.wsConnect(saved.wsUrl)
    }
  }

  if (pageState === 'checking') {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 dark:bg-slate-950 transition-colors duration-300">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (pageState === 'login') {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />
  }

  return (
    <div className="flex h-screen w-screen p-4 overflow-hidden bg-slate-50 dark:bg-slate-950 transition-colors duration-300">
      <main className="h-full mx-5 bg-transparent flex items-center justify-center relative rounded-xl overflow-hidden">
        <div className="h-full aspect-9/19.5 shadow-2xl rounded-xl border border-gray-200 relative shrink-0">
          {webviewPreload && config ? (
            <webview
              {...({
                ref: webviewRef,
                src: config.webviewUrl,
                className: 'w-full h-full rounded-xl! overflow-hidden!',
                allowpopups: 'true',
                preload: webviewPreload,
                webpreferences: 'sandbox=no,contextIsolation=yes'
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any)}
            />
          ) : (
            <div className="w-full h-full bg-slate-900 flex items-center justify-center">
              <Database className="text-white opacity-20 w-16 h-16 animate-pulse" />
            </div>
          )}

          <div className="absolute bottom-6 left-6 pointer-events-none z-20">
            <div className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 flex items-center gap-2 shadow-lg">
              {wsConnected ? (
                <Wifi className="w-3.5 h-3.5 text-emerald-400 drop-shadow-[0_0_5px_rgba(52,211,153,0.5)]" />
              ) : (
                <WifiOff className="w-3.5 h-3.5 text-rose-400" />
              )}
              <span
                className={`text-[9px] font-bold tracking-widest uppercase ${wsConnected ? 'text-emerald-400' : 'text-rose-400'}`}
              >
                {wsConnected ? 'ws在线' : 'ws离线'}
              </span>
            </div>
          </div>
        </div>
      </main>

      <aside className="flex-1 h-full flex flex-col rounded-xl overflow-hidden bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 relative z-10">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-lg">
                <Terminal className="w-5 h-5" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-black tracking-tight dark:text-white uppercase">
                  QQLink
                </span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}
                  />
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                    Core V1.0
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleTheme}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-all text-slate-500 dark:text-slate-400 hover:text-blue-500"
                title={theme === 'light' ? '切换暗色' : '切换亮色'}
              >
                {theme === 'light' ? (
                  <Moon className="w-4.5 h-4.5" />
                ) : (
                  <Sun className="w-4.5 h-4.5" />
                )}
              </button>
              <button
                onClick={() => setSettingsOpen(true)}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-all text-slate-500 dark:text-slate-400 hover:text-blue-500"
                title="设置"
              >
                <Settings className="w-4.5 h-4.5" />
              </button>
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 group transition-all hover:border-blue-500/30">
                <User className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-500 transition-colors" />
                <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300 truncate ml-3 max-w-[180px]">
                  {userID || 'AUTH_PENDING'}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex gap-2">
              <button
                onClick={handleReconnect}
                className="py-2.5 px-3 flex items-center justify-center gap-2 bg-slate-50 dark:bg-slate-800 hover:bg-blue-600 hover:text-white rounded-lg border border-slate-100 dark:border-slate-800 transition-all shadow-sm group"
              >
                <RefreshCw className="w-3.5 h-3.5 group-hover:rotate-180 transition-transform duration-500" />
                <span className="text-[10px] font-bold">重新连接</span>
              </button>
              <button
                onClick={handleToggleMock}
                className={`py-2.5 px-3 flex items-center justify-center gap-2 rounded-lg border transition-all shadow-sm ${
                  mockRunning
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : 'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-800 hover:bg-indigo-500 hover:text-white'
                }`}
              >
                {mockRunning ? (
                  <Square className="w-3.5 h-3.5 fill-current" />
                ) : (
                  <Play className="w-3.5 h-3.5 fill-current" />
                )}
                <span className="text-[10px] font-bold">
                  {mockRunning ? '停止模拟' : '行情模拟'}
                </span>
              </button>
              <button
                onClick={handleToggleDevTools}
                className={`py-2.5 px-3 flex items-center justify-center gap-2 rounded-lg border transition-all shadow-sm ${
                  devToolsOpened
                    ? 'bg-amber-500 border-amber-500 text-white'
                    : 'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-800 hover:bg-amber-500 hover:text-white'
                }`}
              >
                <Bug className="w-3.5 h-3.5" />
                <span className="text-[10px] font-bold">
                  {devToolsOpened ? '关闭调试' : '调试'}
                </span>
              </button>
              <button
                onClick={handleLogout}
                className="px-3 py-2.5 flex items-center justify-center gap-2 text-red-500 bg-red-50 dark:bg-red-900/10 hover:bg-red-500 hover:text-white rounded-lg border border-red-100 dark:border-red-900/20 transition-all shadow-sm"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="text-[10px] font-bold">退出</span>
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-slate-900">
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Stream_Log
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 px-2 py-0.5 rounded-full font-bold tabular-nums">
                {wsMessages.length}/{LOG_LIMIT}
              </span>
              {[0, 1, 2].map((d) => (
                <button
                  key={d}
                  onClick={() => setExpandDepth(d)}
                  title={d === 0 ? '折叠' : `展开 ${d} 层`}
                  className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
                    expandDepth === d
                      ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {d === 0 ? (
                    <ChevronDown className="w-3.5 h-3.5 -rotate-90" />
                  ) : d === 1 ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronsDown className="w-3.5 h-3.5" />
                  )}
                  <span className="text-[9px] font-bold">{d}</span>
                </button>
              ))}
              <button
                onClick={() => setLogEnabled((v) => !v)}
                title={logEnabled ? '暂停监听日志' : '恢复监听日志'}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors ${
                  logEnabled
                    ? 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                    : 'text-amber-500 bg-amber-50 dark:bg-amber-900/20'
                }`}
              >
                {logEnabled ? (
                  <Pause className="w-3.5 h-3.5" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                <span className="text-[9px] font-bold">{logEnabled ? '监听中' : '已暂停'}</span>
              </button>
              <button
                onClick={() => setAutoScroll(!autoScroll)}
                className={`flex items-center gap-1.5 px-2 py-1 transition-colors rounded-md ${
                  autoScroll
                    ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <ArrowDownToLine className={`w-3.5 h-3.5 ${autoScroll ? 'animate-bounce' : ''}`} />
                <span className="text-[9px] font-bold">滚动</span>
              </button>
              <button
                onClick={() => setWsMessages([])}
                className="flex items-center gap-1.5 px-2 py-1 text-slate-400 hover:text-red-500 transition-colors rounded-md hover:bg-red-50 dark:hover:bg-red-900/10"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="text-[9px] font-bold">清空</span>
              </button>
            </div>
          </div>

          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar"
          >
            {wsMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center opacity-10 select-none grayscale">
                <Database className="w-12 h-12 mb-4" />
                <span className="text-[10px] font-black tracking-widest">NO_DATA_STREAM</span>
              </div>
            ) : (
              wsMessages.map((msg, i) => (
                <div
                  key={i}
                  className="px-2 py-1 bg-slate-50 dark:bg-slate-800/30 rounded border border-slate-100 dark:border-slate-800 animate-in fade-in slide-in-from-bottom-1 duration-200"
                >
                  <JsonTree
                    key={expandDepth}
                    data={msg.data}
                    defaultExpandDepth={expandDepth}
                    prefix={
                      <span
                        className={`mr-1.5 px-1 rounded text-[10px] font-bold ${
                          msg.source === 'kbPrivateMessage'
                            ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                            : 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
                        }`}
                      >
                        [{msg.source}]
                      </span>
                    }
                  />
                </div>
              ))
            )}
          </div>
        </div>

        <div className="p-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2 text-[9px] font-mono text-slate-400">
            <Link className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{wsUrl || config?.wsUrl}</span>
          </div>
        </div>
      </aside>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={handleSettingsSaved}
      />
    </div>
  )
}

export default App
