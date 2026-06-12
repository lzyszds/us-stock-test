import { useEffect, useState, useRef } from 'react'
import {
  Settings,
  User,
  RefreshCw,
  Play,
  Square,
  LogOut,
  Sun,
  Moon,
  Database,
  Link,
  Bug
} from 'lucide-react'
import LoginPage from './LoginPage'
import SettingsDialog from './SettingsDialog'
import DebugPanel, {
  emptyStats,
  emptyPrivateData,
  type LogMsg,
  type TickerRow,
  type WsStats,
  type PrivateData
} from './DebugPanel'
import type { AppConfig } from './types'
import appIcon from '../../../resources/icon.png'

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
  const [wsMessages, setWsMessages] = useState<LogMsg[]>([])
  const [webviewPreload, setWebviewPreload] = useState<string>('')
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('theme') as 'light' | 'dark') || 'light'
  })
  const [autoScroll, setAutoScroll] = useState(false)
  const [logEnabled, setLogEnabled] = useState(true)
  const [expandDepth, setExpandDepth] = useState(0)
  const logEnabledRef = useRef(true)
  useEffect(() => {
    logEnabledRef.current = logEnabled
  }, [logEnabled])

  const [logLimit, setLogLimit] = useState(300)

  // ---- 统计 & 行情快照 ----
  // 高频推送下不能每条 setState,用 ref 累积、500ms 节流刷到 state 触发渲染。
  const statsRef = useRef<WsStats>(emptyStats())
  const tickersRef = useRef<Record<string, TickerRow>>({})
  const privateRef = useRef<PrivateData>(emptyPrivateData())
  const [stats, setStats] = useState<WsStats>(emptyStats())
  const [tickers, setTickers] = useState<Record<string, TickerRow>>({})
  const [privateData, setPrivateData] = useState<PrivateData>(emptyPrivateData())
  const [nowTick, setNowTick] = useState<number>(Date.now())

  useEffect(() => {
    const id = window.setInterval(() => {
      setStats({ ...statsRef.current })
      setTickers({ ...tickersRef.current })
      setPrivateData({
        account: privateRef.current.account,
        positions: [...privateRef.current.positions],
        orders: [...privateRef.current.orders],
        fills: [...privateRef.current.fills],
        channels: { ...privateRef.current.channels }
      })
      setNowTick(Date.now())
    }, 500)
    return () => window.clearInterval(id)
  }, [])

  const resetStats = (): void => {
    statsRef.current = emptyStats()
    tickersRef.current = {}
    privateRef.current = emptyPrivateData()
    setStats(emptyStats())
    setTickers({})
    setPrivateData(emptyPrivateData())
  }

  // 私有推送数据归一化:按 channel 路由到不同集合
  const ingestPrivatePush = (
    channel: string,
    action: string,
    items: Record<string, unknown>[],
    now: number
  ): void => {
    const p = privateRef.current
    p.channels[channel] = {
      hits: (p.channels[channel]?.hits ?? 0) + items.length,
      lastAt: now
    }
    const dedupe = (
      list: Record<string, unknown>[],
      next: Record<string, unknown>,
      keys: string[]
    ): Record<string, unknown>[] => {
      const key = keys.map((k) => next[k]).find((v) => v !== undefined && v !== null)
      if (key === undefined) return [next, ...list]
      const filtered = list.filter(
        (x) => keys.map((k) => x[k]).find((v) => v !== undefined && v !== null) !== key
      )
      return [next, ...filtered]
    }
    if (channel === 'account') {
      // 资金账户:覆盖
      if (items[0]) p.account = items[0]
    } else if (channel === 'positions') {
      for (const it of items) {
        p.positions =
          action === 'snapshot' && items.length > 1 && it === items[0]
            ? [it]
            : dedupe(p.positions, it, ['symbol', 'instId', 'posId'])
      }
      if (action === 'snapshot') p.positions = items
    } else if (channel === 'orders') {
      for (const it of items) {
        p.orders = dedupe(p.orders, it, ['orderId', 'ordId', 'clOrdId', 'clientOrderId'])
      }
      p.orders = p.orders.slice(0, 100)
      if (action === 'snapshot') p.orders = items.slice(0, 100)
    } else if (channel === 'fill' || channel === 'fills') {
      p.fills = [...items, ...p.fills].slice(0, 50)
    }
  }

  // 把"一次 WS 事件"的时间戳/收消息计数 bump 一次。
  // 区分单发(每条一次)和批量(一整批共一次),避免批内每条都算成"0ms 间隔"。
  const bumpEventStats = (source: LogMsg['source']): void => {
    const now = Date.now()
    const s = statsRef.current
    if (s.lastMsgAt) {
      const gap = now - s.lastMsgAt
      s.lastMsgGapMs = gap
      s.minMsgGapMs = s.minMsgGapMs ? Math.min(s.minMsgGapMs, gap) : gap
    }
    s.lastMsgAt = now
    if (source === 'kbPublicMessage') s.publicCount += 1
    else s.privateCount += 1
  }

  // 一条原始消息进来时统一处理:解析行情/回执/私有数据。**不更新时间戳**。
  const ingest = (source: LogMsg['source'], data: unknown): void => {
    const now = Date.now()
    const s = statsRef.current

    if (data && typeof data === 'object') {
      const o = data as Record<string, unknown>
      if ('event' in o) {
        const ok = o.code === '0' || o.code === 0
        if (ok) s.ackOk += 1
        else s.ackErr += 1
      } else if ('action' in o && Array.isArray((o as { data?: unknown[] }).data)) {
        s.pushMsgs += 1
        const arr = (o as { data: Record<string, unknown>[] }).data
        s.pushItems += arr.length
        const arg = (o.arg as Record<string, unknown>) || {}
        const channel = String(arg.channel || '')
        const action = String((o as { action?: unknown }).action || '')

        // 私有推送:按 channel 入库,不进 tickers
        if (source === 'kbPrivateMessage' && channel && channel !== 'ticker') {
          ingestPrivatePush(channel, action, arr, now)
          return
        }

        for (const item of arr) {
          const sym = (item.symbol as string) || ''
          if (!sym) continue
          const prev = tickersRef.current[sym]
          const lastPrice = Number(item.lastPrice)
          let trend: TickerRow['trend'] = ''
          if (prev && Number.isFinite(prev.lastPrice) && Number.isFinite(lastPrice)) {
            if (lastPrice > prev.lastPrice) trend = 'up'
            else if (lastPrice < prev.lastPrice) trend = 'down'
            else trend = prev.trend
          }
          tickersRef.current[sym] = {
            symbol: sym,
            lastPrice,
            change: Number(item.change),
            changePercent: Number(item.changePercent),
            bidPrice: Number(item.bidPrice),
            bidSize: Number(item.bidSize),
            askPrice: Number(item.askPrice),
            askSize: Number(item.askSize),
            prevClose: Number(item.prevClose),
            open: Number(item.open),
            high: Number(item.high),
            low: Number(item.low),
            ts: Number(item.ts),
            trend,
            updatedAt: now,
            hits: (prev?.hits ?? 0) + 1
          }
        }
      }
    }
  }

  const webviewRef = useRef<HTMLWebViewElement>(null)

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
      // 单条到达 = 一次 WS 事件
      bumpEventStats('kbPublicMessage')
      statsRef.current.lastBatchSize = 1
      ingest('kbPublicMessage', data)
      if (!logEnabledRef.current) return
      setWsMessages((prev) =>
        [...prev, { source: 'kbPublicMessage' as const, data }].slice(-logLimit)
      )
    })
    const unsubBatch = bridge.onWsBatch((batch) => {
      // 整批 = 一次 WS 事件,只在批边界计一次时间间隔;批内每条只解析、不再 bump 时间
      bumpEventStats('kbPublicMessage')
      const s = statsRef.current
      s.lastBatchSize = batch.length
      if (batch.length > s.maxBatchSize) s.maxBatchSize = batch.length
      for (const d of batch) ingest('kbPublicMessage', d)
      if (!logEnabledRef.current) return
      setWsMessages((prev) =>
        [...prev, ...batch.map((d) => ({ source: 'kbPublicMessage' as const, data: d }))].slice(
          -logLimit
        )
      )
    })
    const unsubPrivate = bridge.onWsPrivateMessage?.((data) => {
      bumpEventStats('kbPrivateMessage')
      ingest('kbPrivateMessage', data)
      if (!logEnabledRef.current) return
      setWsMessages((prev) =>
        [...prev, { source: 'kbPrivateMessage' as const, data }].slice(-logLimit)
      )
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
        </div>
      </main>

      <aside className="flex-1 h-full flex flex-col rounded-xl overflow-hidden bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 relative z-10">
        <header className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
          {/* 品牌 */}
          <div className="flex items-center gap-2.5 mr-1">
            <img
              src={appIcon}
              alt="app"
              className="w-8 h-8 rounded-lg object-contain ring-1 ring-slate-200 dark:ring-slate-700"
            />
            <div className="flex flex-col leading-tight">
              <span className="text-[13px] font-black tracking-tight text-slate-800 dark:text-white">
                QQLink
              </span>
              <span
                className={`inline-flex items-center gap-1 text-[9px] font-semibold ${
                  wsConnected ? 'text-emerald-500' : 'text-rose-500'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    wsConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
                  }`}
                />
                {wsConnected ? 'WS 在线' : 'WS 离线'}
              </span>
            </div>
          </div>

          {/* 主操作按钮组(分段控件风) */}
          <div className="flex items-center rounded-lg bg-slate-100/80 dark:bg-slate-800/60 p-0.5 ml-1">
            <HeaderBtn
              onClick={handleReconnect}
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              label="重连"
              title="重新连接 WS"
            />
            <HeaderBtn
              onClick={handleToggleMock}
              active={mockRunning}
              activeClass="bg-indigo-500 text-white shadow-sm"
              icon={
                mockRunning ? (
                  <Square className="w-3.5 h-3.5 fill-current" />
                ) : (
                  <Play className="w-3.5 h-3.5 fill-current" />
                )
              }
              label={mockRunning ? '停止' : '模拟'}
              title={mockRunning ? '停止行情模拟' : '启动行情模拟'}
            />
            <HeaderBtn
              onClick={handleToggleDevTools}
              active={devToolsOpened}
              activeClass="bg-amber-500 text-white shadow-sm"
              icon={<Bug className="w-3.5 h-3.5" />}
              label="调试"
              title={devToolsOpened ? '关闭 WebView 调试' : '打开 WebView 调试'}
            />
          </div>

          <div className="flex-1" />

          {/* 用户 */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60">
            <span className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center">
              <User className="w-3 h-3" />
            </span>
            <span
              className="text-[11px] font-mono text-slate-600 dark:text-slate-300 truncate max-w-[120px]"
              title={userID || '未登录'}
            >
              {userID || '未登录'}
            </span>
          </div>

          {/* 图标动作 */}
          <div className="flex items-center">
            <IconBtn
              onClick={toggleTheme}
              title={theme === 'light' ? '切换暗色' : '切换亮色'}
              icon={
                theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />
              }
            />
            <IconBtn
              onClick={() => setSettingsOpen(true)}
              title="设置"
              icon={<Settings className="w-4 h-4" />}
            />
            <IconBtn
              onClick={handleLogout}
              title="退出登录"
              danger
              icon={<LogOut className="w-4 h-4" />}
            />
          </div>
        </header>

        <DebugPanel
          wsConnected={wsConnected}
          mockRunning={mockRunning}
          messages={wsMessages}
          logLimit={logLimit}
          setLogLimit={setLogLimit}
          stats={stats}
          tickers={tickers}
          privateData={privateData}
          nowTick={nowTick}
          logEnabled={logEnabled}
          setLogEnabled={setLogEnabled}
          autoScroll={autoScroll}
          setAutoScroll={setAutoScroll}
          expandDepth={expandDepth}
          setExpandDepth={setExpandDepth}
          onClearLog={() => setWsMessages([])}
          onResetStats={resetStats}
        />

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

// 顶栏分段按钮(成组在一个 pill 容器里)
function HeaderBtn({
  onClick,
  icon,
  label,
  title,
  active,
  activeClass
}: {
  onClick: () => void
  icon: React.ReactNode
  label: string
  title?: string
  active?: boolean
  activeClass?: string
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-bold transition-all ${
        active
          ? activeClass ?? 'bg-blue-500 text-white shadow-sm'
          : 'text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700/80 hover:shadow-sm'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

// 顶栏纯图标按钮
function IconBtn({
  onClick,
  icon,
  title,
  danger
}: {
  onClick: () => void
  icon: React.ReactNode
  title?: string
  danger?: boolean
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-2 rounded-lg transition-colors ${
        danger
          ? 'text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20'
          : 'text-slate-500 dark:text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-800'
      }`}
    >
      {icon}
    </button>
  )
}

export default App
