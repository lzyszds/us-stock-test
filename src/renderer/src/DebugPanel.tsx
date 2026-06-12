// 调试面板：参考 qqlink-v3 里的 QuoteDebugFloat / PrivateDebugFloat，
// 把右侧 Stream_Log 升级成"信息密度更高 + 实时统计 + 行情表"的三 Tab 视图。
//
// 数据来源：父组件 App.tsx 通过 props 透传消息流 + 实时统计 + 已知行情表。
// 高频推送下不直接 setState 每条消息，而是 App 那边用 ref + 500ms tick 节流。
import { useMemo, useRef, useState, useEffect } from 'react'
import {
  Activity,
  ArrowDownToLine,
  ListTree,
  LineChart,
  Pause,
  Play,
  Trash2,
  Copy,
  Search,
  Wifi,
  WifiOff,
  Zap,
  CheckCircle2,
  XCircle,
  Database,
  Wallet,
  Briefcase,
  ClipboardList,
  ReceiptText,
  TrendingUp,
  TrendingDown,
  X
} from 'lucide-react'
import JsonTree from './JsonTree'

export interface TickerRow {
  symbol: string
  lastPrice: number
  change: number
  changePercent: number
  bidPrice: number
  bidSize: number
  askPrice: number
  askSize: number
  prevClose: number
  open: number
  high: number
  low: number
  ts: number
  /** 相对上一帧涨跌方向，用于闪色 */
  trend: 'up' | 'down' | ''
  /** 上一次刷新的本地时间 */
  updatedAt: number
  /** 收到的推送次数 */
  hits: number
}

export interface WsStats {
  /** 收到的公共消息总数（不被 LOG_LIMIT 截断） */
  publicCount: number
  /** 收到的私有消息总数 */
  privateCount: number
  /** event=subscribe/unsubscribe code===0 的 ack 数 */
  ackOk: number
  /** event 的失败 ack 数 */
  ackErr: number
  /** 行情推送的"数据条数"(action 包里 data[].length 累加) */
  pushItems: number
  /** action 报文条数 */
  pushMsgs: number
  /** 上一次收到任何消息的时间戳 */
  lastMsgAt: number
  /** 相邻两条消息的间隔 ms */
  lastMsgGapMs: number
  /** 本次会话最小间隔 ms */
  minMsgGapMs: number
  /** 上一批 batch 的大小 */
  lastBatchSize: number
  /** 见到过的最大 batch 大小 */
  maxBatchSize: number
}

export const emptyStats = (): WsStats => ({
  publicCount: 0,
  privateCount: 0,
  ackOk: 0,
  ackErr: 0,
  pushItems: 0,
  pushMsgs: 0,
  lastMsgAt: 0,
  lastMsgGapMs: 0,
  minMsgGapMs: 0,
  lastBatchSize: 0,
  maxBatchSize: 0
})

export type LogMsg = {
  source: 'kbPublicMessage' | 'kbPrivateMessage'
  data: unknown
}

/** 私有 WS 数据快照:KeepBit 私有频道 account / positions / orders / fill */
export interface PrivateData {
  /** 资金账户最新快照 */
  account: Record<string, unknown> | null
  /** 持仓列表(按 symbol/instId/posId 去重) */
  positions: Record<string, unknown>[]
  /** 委托列表(按 orderId 去重,最多 100 条) */
  orders: Record<string, unknown>[]
  /** 成交流水(append,最多 50 条) */
  fills: Record<string, unknown>[]
  /** 各 channel 收到的推送计数与最近时间 */
  channels: Record<string, { hits: number; lastAt: number }>
}

export const emptyPrivateData = (): PrivateData => ({
  account: null,
  positions: [],
  orders: [],
  fills: [],
  channels: {}
})

type TabKey = 'overview' | 'tickers' | 'private' | 'logs'

interface Props {
  wsConnected: boolean
  mockRunning: boolean
  messages: LogMsg[]
  logLimit: number
  setLogLimit: (v: number) => void
  stats: WsStats
  tickers: Record<string, TickerRow>
  privateData: PrivateData
  /** 用来强制刷新"距上次推送 xx ms"等实时指标 */
  nowTick: number
  logEnabled: boolean
  setLogEnabled: (v: boolean) => void
  autoScroll: boolean
  setAutoScroll: (v: boolean) => void
  expandDepth: number
  setExpandDepth: (v: number) => void
  onClearLog: () => void
  onResetStats: () => void
}

// ====== 小工具 ======
const fmtNum = (v: number, digits = 2): string => {
  if (!Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  })
}
const fmtTime = (t: number): string => {
  if (!t) return '—'
  const d = new Date(t)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(
    d.getMilliseconds()
  ).padStart(3, '0')}`
}
const sinceText = (last: number, now: number): string => {
  if (!last) return '从未'
  const gap = now - last
  if (gap < 1000) return `${gap}ms`
  return `${(gap / 1000).toFixed(1)}s`
}

// ====== 子组件：状态卡片 ======
function StatCard({
  label,
  value,
  hint,
  tone = 'default'
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  tone?: 'default' | 'good' | 'warn' | 'bad' | 'info'
}): React.JSX.Element {
  const toneCls =
    tone === 'good'
      ? 'text-emerald-500 dark:text-emerald-400'
      : tone === 'warn'
        ? 'text-amber-500 dark:text-amber-400'
        : tone === 'bad'
          ? 'text-rose-500 dark:text-rose-400'
          : tone === 'info'
            ? 'text-sky-500 dark:text-sky-400'
            : 'text-slate-800 dark:text-slate-100'
  return (
    <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
      <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{label}</div>
      <div className={`text-base font-black tabular-nums leading-tight mt-0.5 ${toneCls}`}>
        {value}
      </div>
      {hint && <div className="text-[9px] text-slate-400 mt-0.5 tabular-nums">{hint}</div>}
    </div>
  )
}

export default function DebugPanel({
  wsConnected,
  mockRunning,
  messages,
  logLimit,
  setLogLimit,
  stats,
  tickers,
  privateData,
  nowTick,
  logEnabled,
  setLogEnabled,
  autoScroll,
  setAutoScroll,
  expandDepth,
  setExpandDepth,
  onClearLog,
  onResetStats
}: Props): React.JSX.Element {
  const [tab, setTab] = useState<TabKey>('overview')
  const [filterSource, setFilterSource] = useState<'all' | 'public' | 'private'>('all')
  const [filterKind, setFilterKind] = useState<'all' | 'push' | 'ack' | 'other'>('all')
  const [keyword, setKeyword] = useState('')
  const [tickerSort, setTickerSort] = useState<'symbol' | 'pct' | 'hits' | 'time'>('time')
  const [selectedTicker, setSelectedTicker] = useState<{ symbol: string; x: number; y: number } | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!autoScroll || tab !== 'logs') return
    const el = scrollRef.current
    if (!el) return
    // Auto-scroll to bottom whenever messages change if autoScroll is enabled
    // Use requestAnimationFrame to ensure the DOM has updated
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  }, [messages, autoScroll, tab])

  // 分类一条消息：push(行情) / ack(订阅回执) / other
  const classify = (raw: unknown): 'push' | 'ack' | 'other' => {
    if (!raw || typeof raw !== 'object') return 'other'
    const o = raw as Record<string, unknown>
    if ('action' in o) return 'push'
    if ('event' in o) return 'ack'
    return 'other'
  }

  const filteredMessages = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return messages.filter((m) => {
      if (filterSource === 'public' && m.source !== 'kbPublicMessage') return false
      if (filterSource === 'private' && m.source !== 'kbPrivateMessage') return false
      const kind = classify(m.data)
      if (filterKind !== 'all' && filterKind !== kind) return false
      if (kw) {
        try {
          if (!JSON.stringify(m.data).toLowerCase().includes(kw)) return false
        } catch {
          return false
        }
      }
      return true
    })
  }, [messages, filterSource, filterKind, keyword])

  const tickerList = useMemo(() => {
    const arr = Object.values(tickers)
    const sortFn: Record<typeof tickerSort, (a: TickerRow, b: TickerRow) => number> = {
      symbol: (a, b) => a.symbol.localeCompare(b.symbol),
      pct: (a, b) => (b.changePercent || 0) - (a.changePercent || 0),
      hits: (a, b) => b.hits - a.hits,
      time: (a, b) => b.updatedAt - a.updatedAt
    }
    return arr.sort(sortFn[tickerSort])
  }, [tickers, tickerSort])

  const copyAll = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // 忽略
    }
  }

  // 推送速率：用最近一次 gap 反推
  const pushPerSec = stats.lastMsgGapMs > 0 ? (1000 / stats.lastMsgGapMs).toFixed(1) : '—'

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-slate-900">
      {/* 顶部 Tab 切换 */}
      <div className="px-4 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {(
            [
              { k: 'overview', label: '概览', icon: Activity },
              { k: 'tickers', label: '行情', icon: LineChart },
              { k: 'private', label: '私有', icon: Wallet },
              { k: 'logs', label: '日志', icon: ListTree }
            ] as { k: TabKey; label: string; icon: typeof Activity }[]
          ).map((t) => {
            const Icon = t.icon
            const active = tab === t.k
            return (
              <button
                key={t.k}
                onClick={() => setTab(t.k)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-bold transition-all ${
                  active
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
                {t.k === 'tickers' && Object.keys(tickers).length > 0 && (
                  <span
                    className={`px-1 rounded ${active ? 'bg-white/20' : 'bg-slate-200 dark:bg-slate-700'} text-[9px] tabular-nums`}
                  >
                    {Object.keys(tickers).length}
                  </span>
                )}
                {t.k === 'logs' && messages.length > 0 && (
                  <span
                    className={`px-1 rounded ${active ? 'bg-white/20' : 'bg-slate-200 dark:bg-slate-700'} text-[9px] tabular-nums`}
                  >
                    {messages.length}
                  </span>
                )}
                {t.k === 'private' &&
                  (privateData.positions.length > 0 || privateData.orders.length > 0) && (
                    <span
                      className={`px-1 rounded ${active ? 'bg-white/20' : 'bg-slate-200 dark:bg-slate-700'} text-[9px] tabular-nums`}
                    >
                      {privateData.positions.length + privateData.orders.length}
                    </span>
                  )}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setLogEnabled(!logEnabled)}
            title={logEnabled ? '暂停监听' : '恢复监听'}
            className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
              logEnabled
                ? 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                : 'text-amber-500 bg-amber-50 dark:bg-amber-900/20'
            }`}
          >
            {logEnabled ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            <span className="text-[9px] font-bold">{logEnabled ? '监听中' : '已暂停'}</span>
          </button>
        </div>
      </div>

      {/* ==================== 概览 ==================== */}
      {tab === 'overview' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
          <div className="grid grid-cols-3 gap-2">
            <StatCard
              label="WS 链路"
              tone={wsConnected ? 'good' : 'bad'}
              value={
                <span className="flex items-center gap-1.5">
                  {wsConnected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
                  {wsConnected ? '在线' : '离线'}
                </span>
              }
              hint={mockRunning ? '行情模拟中' : '真实推送'}
            />
            <StatCard
              label="公共消息"
              tone="info"
              value={stats.publicCount}
              hint={`推送报文 ${stats.pushMsgs} · 数据 ${stats.pushItems}`}
            />
            <StatCard
              label="私有消息"
              tone="info"
              value={stats.privateCount}
              hint={`回执 成功 ${stats.ackOk} · 失败 ${stats.ackErr}`}
            />

            <StatCard
              label="批次间隔"
              tone={stats.lastMsgGapMs && stats.lastMsgGapMs < 100 ? 'bad' : 'good'}
              value={stats.lastMsgGapMs ? `${stats.lastMsgGapMs}ms` : '—'}
              hint={`最快 ${stats.minMsgGapMs || '—'}ms`}
            />
            <StatCard
              label="距上条"
              tone={!stats.lastMsgAt ? 'bad' : nowTick - stats.lastMsgAt > 5000 ? 'warn' : 'good'}
              value={sinceText(stats.lastMsgAt, nowTick)}
              hint={fmtTime(stats.lastMsgAt)}
            />
            <StatCard
              label="估算推送频率"
              tone="info"
              value={`${pushPerSec}/秒`}
              hint={`最大批次 ${stats.maxBatchSize || '—'}`}
            />
          </div>

          {/* ACK 列 */}
          <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold tracking-widest text-slate-400">
                订阅回执
              </span>
              <button
                onClick={onResetStats}
                className="text-[9px] font-bold text-slate-400 hover:text-rose-500 transition-colors"
              >
                重置计数
              </button>
            </div>
            <div className="flex items-center gap-4 text-[11px]">
              <span className="flex items-center gap-1 text-emerald-500">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <b className="tabular-nums">{stats.ackOk}</b>
                <span className="text-slate-400">成功</span>
              </span>
              <span className="flex items-center gap-1 text-rose-500">
                <XCircle className="w-3.5 h-3.5" />
                <b className="tabular-nums">{stats.ackErr}</b>
                <span className="text-slate-400">失败</span>
              </span>
              <span className="flex items-center gap-1 text-purple-500">
                <Zap className="w-3.5 h-3.5" />
                <b className="tabular-nums">{stats.pushItems}</b>
                <span className="text-slate-400">推送条目</span>
              </span>
            </div>
          </div>

          {/* 提示 */}
          <div className="text-[10px] text-slate-400 leading-relaxed px-1">
            <p>
              · <b>批次间隔</b> 是相邻两条 WS 报文的真实到达间隔，反映服务端节流。
            </p>
            <p>
              · <b>距上条</b> 长时间不变（&gt;5s）通常说明链路卡了，或者休市。
            </p>
            <p>
              · 日志面板被 <code>logLimit={logLimit}</code> 截断，但统计数字不丢。
            </p>
          </div>
        </div>
      )}

      {/* ==================== 行情 ==================== */}
      {tab === 'tickers' && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
            <span className="text-[10px] text-slate-400 mr-auto">
              共 <b className="text-slate-600 dark:text-slate-200">{tickerList.length}</b> 只标的
            </span>
            {(
              [
                { k: 'time', label: '最新更新' },
                { k: 'symbol', label: '代码' },
                { k: 'pct', label: '涨跌幅' },
                { k: 'hits', label: '推送数' }
              ] as { k: typeof tickerSort; label: string }[]
            ).map((s) => (
              <button
                key={s.k}
                onClick={() => setTickerSort(s.k)}
                className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                  tickerSort === s.k
                    ? 'bg-blue-500 text-white'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {tickerList.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center opacity-20 select-none">
                <LineChart className="w-12 h-12 mb-3" />
                <span className="text-[10px] font-black tracking-widest">暂无行情数据</span>
              </div>
            ) : (
              <table className="w-full text-[10px] font-mono tabular-nums">
                <thead className="sticky top-0 bg-white dark:bg-slate-900 text-slate-400 text-[9px] tracking-widest">
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <th className="text-left px-3 py-1.5">代码</th>
                    <th className="text-right px-2 py-1.5">最新价</th>
                    <th className="text-right px-2 py-1.5">涨跌幅</th>
                    <th className="text-right px-2 py-1.5">买盘</th>
                    <th className="text-right px-2 py-1.5">卖盘</th>
                    <th className="text-right px-2 py-1.5">推送数</th>
                    <th className="text-right px-3 py-1.5">更新时间</th>
                  </tr>
                </thead>
                <tbody>
                  {tickerList.map((t) => {
                    const up = t.changePercent >= 0
                    const fresh = nowTick - t.updatedAt < 600
                    return (
                      <tr
                        key={t.symbol}
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedTicker({ symbol: t.symbol, x: e.clientX, y: e.clientY })
                        }}
                        className={`border-b border-slate-50 dark:border-slate-800/60 transition-colors cursor-pointer hover:bg-blue-50/60 dark:hover:bg-blue-900/20 ${
                          fresh
                            ? t.trend === 'up'
                              ? 'bg-emerald-50/60 dark:bg-emerald-900/10'
                              : t.trend === 'down'
                                ? 'bg-rose-50/60 dark:bg-rose-900/10'
                                : ''
                            : ''
                        }`}
                      >
                        <td className="px-3 py-1 font-bold text-sky-600 dark:text-sky-300">
                          {t.symbol}
                        </td>
                        <td className="px-2 py-1 text-right text-slate-700 dark:text-slate-200">
                          {fmtNum(t.lastPrice)}
                        </td>
                        <td
                          className={`px-2 py-1 text-right font-bold ${
                            up ? 'text-emerald-500' : 'text-rose-500'
                          }`}
                        >
                          {up ? '+' : ''}
                          {fmtNum(t.changePercent)}%
                        </td>
                        <td className="px-2 py-1 text-right text-slate-500">
                          {fmtNum(t.bidPrice)}
                          <span className="text-[8px] text-slate-400 ml-1">x{t.bidSize}</span>
                        </td>
                        <td className="px-2 py-1 text-right text-slate-500">
                          {fmtNum(t.askPrice)}
                          <span className="text-[8px] text-slate-400 ml-1">x{t.askSize}</span>
                        </td>
                        <td className="px-2 py-1 text-right text-purple-500">{t.hits}</td>
                        <td className="px-3 py-1 text-right text-slate-400 text-[9px]">
                          {fmtTime(t.updatedAt)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ==================== 行情详情弹卡 ==================== */}
      {selectedTicker && tickers[selectedTicker.symbol] && (
        <TickerDetailCard
          row={tickers[selectedTicker.symbol]}
          pos={selectedTicker}
          nowTick={nowTick}
          onClose={() => setSelectedTicker(null)}
        />
      )}

      {/* ==================== 私有(账户/持仓/委托/成交) ==================== */}
      {tab === 'private' && <PrivateView data={privateData} nowTick={nowTick} />}

      {/* ==================== 日志 ==================== */}
      {tab === 'logs' && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* 过滤栏 */}
          <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 flex-1 min-w-[120px]">
              <Search className="w-3 h-3 text-slate-400" />
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="过滤 JSON 文本..."
                className="bg-transparent outline-none text-[10px] flex-1 placeholder:text-slate-400 text-slate-700 dark:text-slate-200"
              />
              {keyword && (
                <button
                  onClick={() => setKeyword('')}
                  className="text-slate-400 hover:text-rose-500 text-[10px]"
                >
                  ×
                </button>
              )}
            </div>
            <div className="flex items-center gap-1">
              {(
                [
                  { k: 'all', label: '全部' },
                  { k: 'public', label: '公共' },
                  { k: 'private', label: '私有' }
                ] as { k: typeof filterSource; label: string }[]
              ).map((s) => (
                <button
                  key={s.k}
                  onClick={() => setFilterSource(s.k)}
                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                    filterSource === s.k
                      ? 'bg-blue-500 text-white'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              {(
                [
                  { k: 'all', label: '所有类型' },
                  { k: 'push', label: '行情' },
                  { k: 'ack', label: '回执' },
                  { k: 'other', label: '其他' }
                ] as { k: typeof filterKind; label: string }[]
              ).map((s) => (
                <button
                  key={s.k}
                  onClick={() => setFilterKind(s.k)}
                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                    filterKind === s.k
                      ? 'bg-purple-500 text-white'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* 控制栏 */}
          <div className="px-4 py-1.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[9px] font-bold text-slate-400 tabular-nums">
              <span>{filteredMessages.length} / {messages.length} · 上限</span>
              <input
                type="number"
                key={logLimit}
                defaultValue={logLimit}
                onBlur={(e) => {
                  const val = parseInt(e.target.value, 10)
                  if (!isNaN(val) && val > 0 && val !== logLimit) setLogLimit(val)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur()
                  }
                }}
                className="w-16 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5 text-slate-600 dark:text-slate-300 outline-none hover:border-blue-400 focus:border-blue-500 font-mono"
              />
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                {[0, 1, 2, 3].map((d) => (
                  <button
                    key={d}
                    onClick={() => setExpandDepth(d)}
                    title={d === 0 ? '折叠' : `展开 ${d} 层`}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
                      expandDepth === d
                        ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <ListTree className="w-3 h-3" />
                    <span className="text-[9px] font-bold">{d === 0 ? '折叠' : d}</span>
                  </button>
                ))}
              </div>
              <div className="w-px h-3 bg-slate-200 dark:bg-slate-700" />
              <button
                onClick={() => setAutoScroll(!autoScroll)}
                className={`flex items-center gap-1 px-1.5 py-0.5 transition-colors rounded ${
                  autoScroll
                    ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <ArrowDownToLine className={`w-3 h-3 ${autoScroll ? 'animate-bounce' : ''}`} />
                <span className="text-[9px] font-bold">滚动</span>
              </button>
              <button
                onClick={() =>
                  copyAll(
                    filteredMessages
                      .map((m) => `[${m.source}] ${JSON.stringify(m.data)}`)
                      .join('\n')
                  )
                }
                className="flex items-center gap-1 px-1.5 py-0.5 text-slate-400 hover:text-emerald-500 transition-colors rounded hover:bg-emerald-50 dark:hover:bg-emerald-900/10"
              >
                <Copy className="w-3 h-3" />
                <span className="text-[9px] font-bold">复制</span>
              </button>
              <button
                onClick={onClearLog}
                className="flex items-center gap-1 px-1.5 py-0.5 text-slate-400 hover:text-red-500 transition-colors rounded hover:bg-red-50 dark:hover:bg-red-900/10"
              >
                <Trash2 className="w-3 h-3" />
                <span className="text-[9px] font-bold">清空</span>
              </button>
            </div>
          </div>

          {/* 日志列表 */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-1.5 custom-scrollbar">
            {filteredMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center opacity-10 select-none">
                <Database className="w-12 h-12 mb-3" />
                <span className="text-[10px] font-black tracking-widest">暂无数据流</span>
              </div>
            ) : (
              filteredMessages.map((msg, i) => {
                const kind = classify(msg.data)
                const kindCls =
                  kind === 'push'
                    ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                    : kind === 'ack'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                      : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                return (
                  <div
                    key={i}
                    className="relative group px-2 py-1 bg-slate-50 dark:bg-slate-800/30 rounded border border-slate-100 dark:border-slate-800"
                  >
                    <button
                      onClick={() => copyAll(JSON.stringify(msg.data, null, 2))}
                      className="absolute top-1.5 right-2 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/10"
                      title="复制此条日志"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <JsonTree
                      key={expandDepth}
                      data={msg.data}
                      defaultExpandDepth={expandDepth}
                      prefix={
                        <>
                          <span
                            className={`mr-1 px-1 rounded text-[9px] font-bold ${
                              msg.source === 'kbPrivateMessage'
                                ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                                : 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
                            }`}
                          >
                            {msg.source === 'kbPrivateMessage' ? '私有' : '公共'}
                          </span>
                          <span className={`mr-1.5 px-1 rounded text-[9px] font-bold ${kindCls}`}>
                            {kind === 'push' ? '行情' : kind === 'ack' ? '回执' : '其他'}
                          </span>
                        </>
                      }
                    />
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ====== 私有数据视图(资金/持仓/委托/成交) ======
// KeepBit 私有 WS 推送的字段命名我们不知道得很死,所以做容错读取:
// 同时尝试 cnSnake / camelCase / 大写 多种形态,缺失就显示 "—"。
const pick = (obj: Record<string, unknown> | null | undefined, ...keys: string[]): unknown => {
  if (!obj) return undefined
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k]
  }
  return undefined
}
const fmtMaybe = (v: unknown, digits = 2): string => {
  if (v === undefined || v === null || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  return n.toLocaleString('en-US', { maximumFractionDigits: digits })
}
const fmtMaybeTime = (v: unknown): string => {
  if (v === undefined || v === null || v === '') return '—'
  const n = Number(v)
  if (Number.isFinite(n)) return fmtTime(n)
  return String(v)
}

function PrivateView({
  data,
  nowTick
}: {
  data: PrivateData
  nowTick: number
}): React.JSX.Element {
  const channelKeys = Object.keys(data.channels)
  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
      {/* 频道命中统计 */}
      <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
        <div className="text-[9px] font-bold tracking-widest text-slate-400 mb-1">
          私有频道接收统计
        </div>
        {channelKeys.length === 0 ? (
          <div className="text-[10px] text-slate-400">暂未收到任何私有推送</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {channelKeys.map((k) => (
              <span
                key={k}
                className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[10px] tabular-nums"
              >
                <span className="text-sky-500 font-bold mr-1">{k}</span>
                <span className="text-slate-500">×{data.channels[k].hits}</span>
                <span className="text-slate-400 ml-1.5">
                  {sinceText(data.channels[k].lastAt, nowTick)}前
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 资金账户 */}
      <section>
        <h3 className="flex items-center gap-1.5 text-[10px] font-black tracking-widest text-slate-500 dark:text-slate-300 mb-1">
          <Wallet className="w-3.5 h-3.5 text-emerald-500" />
          资金账户
        </h3>
        {!data.account ? (
          <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 text-[10px] text-slate-400">
            暂无资金推送
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <KvCard
              label="账户类型"
              value={fmtMaybe(pick(data.account, 'accountType', 'AccountType'))}
            />
            <KvCard
              label="币种"
              value={fmtMaybe(pick(data.account, 'currency', 'Currency'))}
            />
            <KvCard
              label="总资产"
              value={fmtMaybe(pick(data.account, 'totalAsset', 'TotalAsset', 'totalEquity'))}
            />
            <KvCard
              label="账户净值"
              value={fmtMaybe(pick(data.account, 'equity', 'Equity', 'netAssets'))}
            />
            <KvCard
              label="现金"
              value={fmtMaybe(pick(data.account, 'cash', 'Cash'))}
            />
            <KvCard
              label="可用资金"
              value={fmtMaybe(pick(data.account, 'available', 'Available'))}
            />
            <KvCard
              label="冻结资金"
              value={fmtMaybe(pick(data.account, 'frozen', 'Frozen', 'frozenCash'))}
            />
            <KvCard
              label="购买力"
              value={fmtMaybe(pick(data.account, 'buyingPower', 'BuyingPower', 'buying_power'))}
            />
            <KvCard
              label="持仓市值"
              value={fmtMaybe(pick(data.account, 'marketValue', 'MarketValue', 'positionMarketValue'))}
            />
            <KvCard
              label="维持保证金"
              value={fmtMaybe(pick(data.account, 'maintenanceMargin', 'MaintenanceMargin'))}
            />
            <KvCard
              label="剩余流动性"
              value={fmtMaybe(pick(data.account, 'excessLiquidity', 'ExcessLiquidity'))}
            />
            <KvCard
              label="总费用"
              value={fmtMaybe(pick(data.account, 'totalFee', 'TotalFee'))}
            />
            <KvCard
              label="已实现盈亏"
              value={fmtMaybe(pick(data.account, 'realizedPnl', 'RealizedPnl', 'rpl'))}
              tone="pnl"
            />
            <KvCard
              label="未实现盈亏"
              value={fmtMaybe(pick(data.account, 'unrealizedPnl', 'UnrealizedPnl', 'upl'))}
              tone="pnl"
            />
          </div>
        )}
      </section>

      {/* 持仓 */}
      <section>
        <h3 className="flex items-center gap-1.5 text-[10px] font-black tracking-widest text-slate-500 dark:text-slate-300 mb-1">
          <Briefcase className="w-3.5 h-3.5 text-blue-500" />
          持仓 · {data.positions.length}
        </h3>
        {data.positions.length === 0 ? (
          <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 text-[10px] text-slate-400">
            暂无持仓
          </div>
        ) : (
          <div className="rounded-lg border border-slate-100 dark:border-slate-800 overflow-hidden">
            <table className="w-full text-[10px] font-mono tabular-nums">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-400 text-[9px] tracking-widest">
                <tr>
                  <th className="text-left px-2 py-1">代码</th>
                  <th className="text-right px-2 py-1">数量</th>
                  <th className="text-right px-2 py-1">可用</th>
                  <th className="text-right px-2 py-1">成本价</th>
                  <th className="text-right px-2 py-1">现价</th>
                  <th className="text-right px-2 py-1">盈亏</th>
                </tr>
              </thead>
              <tbody>
                {data.positions.map((p, i) => {
                  const pnl = Number(
                    pick(p, 'unrealizedPnl', 'UnrealizedPnl', 'upl', 'profit') ?? NaN
                  )
                  return (
                    <tr
                      key={String(pick(p, 'symbol', 'instId', 'posId') ?? i)}
                      className="border-t border-slate-100 dark:border-slate-800"
                    >
                      <td className="px-2 py-1 font-bold text-sky-600 dark:text-sky-300">
                        {String(pick(p, 'symbol', 'instId') ?? '—')}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {fmtMaybe(pick(p, 'quantity', 'Quantity', 'qty', 'pos'), 0)}
                      </td>
                      <td className="px-2 py-1 text-right text-slate-500">
                        {fmtMaybe(pick(p, 'available', 'Available', 'availQty'), 0)}
                      </td>
                      <td className="px-2 py-1 text-right text-slate-500">
                        {fmtMaybe(pick(p, 'avgPrice', 'AvgPrice', 'costPrice', 'avgCost'))}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {fmtMaybe(pick(p, 'marketPrice', 'MarketPrice', 'last', 'lastPrice'))}
                      </td>
                      <td
                        className={`px-2 py-1 text-right font-bold ${
                          !Number.isFinite(pnl)
                            ? 'text-slate-400'
                            : pnl >= 0
                              ? 'text-emerald-500'
                              : 'text-rose-500'
                        }`}
                      >
                        {Number.isFinite(pnl) ? (pnl >= 0 ? '+' : '') + fmtMaybe(pnl) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 委托 */}
      <section>
        <h3 className="flex items-center gap-1.5 text-[10px] font-black tracking-widest text-slate-500 dark:text-slate-300 mb-1">
          <ClipboardList className="w-3.5 h-3.5 text-purple-500" />
          委托 · {data.orders.length}
        </h3>
        {data.orders.length === 0 ? (
          <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 text-[10px] text-slate-400">
            暂无委托
          </div>
        ) : (
          <div className="rounded-lg border border-slate-100 dark:border-slate-800 overflow-hidden max-h-72 overflow-y-auto">
            <table className="w-full text-[10px] font-mono tabular-nums">
              <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/60 text-slate-400 text-[9px] tracking-widest">
                <tr>
                  <th className="text-left px-2 py-1">代码</th>
                  <th className="text-left px-2 py-1">方向</th>
                  <th className="text-right px-2 py-1">委托价</th>
                  <th className="text-right px-2 py-1">数量</th>
                  <th className="text-right px-2 py-1">已成</th>
                  <th className="text-left px-2 py-1">状态</th>
                  <th className="text-right px-2 py-1">时间</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((o, i) => {
                  const side = String(pick(o, 'side', 'Side', 'direction') ?? '').toLowerCase()
                  const status = String(pick(o, 'status', 'Status', 'state') ?? '—')
                  return (
                    <tr
                      key={String(pick(o, 'orderId', 'ordId', 'clOrdId') ?? i)}
                      className="border-t border-slate-100 dark:border-slate-800"
                    >
                      <td className="px-2 py-1 font-bold text-sky-600 dark:text-sky-300">
                        {String(pick(o, 'symbol', 'instId') ?? '—')}
                      </td>
                      <td
                        className={`px-2 py-1 font-bold ${
                          side.includes('buy') || side === '1'
                            ? 'text-emerald-500'
                            : side.includes('sell') || side === '2'
                              ? 'text-rose-500'
                              : 'text-slate-400'
                        }`}
                      >
                        {side.includes('buy') || side === '1'
                          ? '买入'
                          : side.includes('sell') || side === '2'
                            ? '卖出'
                            : side || '—'}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {fmtMaybe(pick(o, 'price', 'Price', 'px'))}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {fmtMaybe(pick(o, 'quantity', 'Quantity', 'qty', 'size'), 0)}
                      </td>
                      <td className="px-2 py-1 text-right text-amber-500">
                        {fmtMaybe(pick(o, 'filledQty', 'FilledQty', 'fillQty', 'accFillQty'), 0)}
                      </td>
                      <td className="px-2 py-1 text-slate-500">{status}</td>
                      <td className="px-2 py-1 text-right text-slate-400 text-[9px]">
                        {fmtMaybeTime(
                          pick(o, 'updateTime', 'updateTs', 'createTime', 'ts', 'time')
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 成交 */}
      <section>
        <h3 className="flex items-center gap-1.5 text-[10px] font-black tracking-widest text-slate-500 dark:text-slate-300 mb-1">
          <ReceiptText className="w-3.5 h-3.5 text-amber-500" />
          成交 · {data.fills.length}
        </h3>
        {data.fills.length === 0 ? (
          <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 text-[10px] text-slate-400">
            暂无成交记录
          </div>
        ) : (
          <div className="rounded-lg border border-slate-100 dark:border-slate-800 overflow-hidden max-h-72 overflow-y-auto">
            <table className="w-full text-[10px] font-mono tabular-nums">
              <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/60 text-slate-400 text-[9px] tracking-widest">
                <tr>
                  <th className="text-left px-2 py-1">代码</th>
                  <th className="text-left px-2 py-1">方向</th>
                  <th className="text-right px-2 py-1">成交价</th>
                  <th className="text-right px-2 py-1">数量</th>
                  <th className="text-right px-2 py-1">手续费</th>
                  <th className="text-right px-2 py-1">时间</th>
                </tr>
              </thead>
              <tbody>
                {data.fills.map((f, i) => {
                  const side = String(pick(f, 'side', 'Side') ?? '').toLowerCase()
                  return (
                    <tr
                      key={String(pick(f, 'fillId', 'tradeId', 'execId') ?? i)}
                      className="border-t border-slate-100 dark:border-slate-800"
                    >
                      <td className="px-2 py-1 font-bold text-sky-600 dark:text-sky-300">
                        {String(pick(f, 'symbol', 'instId') ?? '—')}
                      </td>
                      <td
                        className={`px-2 py-1 font-bold ${
                          side.includes('buy') || side === '1'
                            ? 'text-emerald-500'
                            : side.includes('sell') || side === '2'
                              ? 'text-rose-500'
                              : 'text-slate-400'
                        }`}
                      >
                        {side.includes('buy') || side === '1'
                          ? '买入'
                          : side.includes('sell') || side === '2'
                            ? '卖出'
                            : side || '—'}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {fmtMaybe(pick(f, 'fillPrice', 'FillPrice', 'price', 'px'))}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {fmtMaybe(pick(f, 'fillQty', 'FillQty', 'qty', 'size'), 0)}
                      </td>
                      <td className="px-2 py-1 text-right text-slate-500">
                        {fmtMaybe(pick(f, 'fee', 'Fee', 'commission'))}
                      </td>
                      <td className="px-2 py-1 text-right text-slate-400 text-[9px]">
                        {fmtMaybeTime(pick(f, 'fillTime', 'tradeTime', 'ts', 'time'))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function KvCard({
  label,
  value,
  tone
}: {
  label: string
  value: string
  tone?: 'pnl'
}): React.JSX.Element {
  let cls = 'text-slate-800 dark:text-slate-100'
  if (tone === 'pnl') {
    const n = Number(value.replace(/,/g, ''))
    if (Number.isFinite(n)) cls = n >= 0 ? 'text-emerald-500' : 'text-rose-500'
  }
  return (
    <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
      <div className="text-[9px] font-bold tracking-widest text-slate-400">{label}</div>
      <div className={`text-sm font-black tabular-nums leading-tight mt-0.5 ${cls}`}>{value}</div>
    </div>
  )
}

// ====== 行情详情弹卡 ======
// 点击行情列表里的某只票时弹出,展示该 symbol 当前所有字段,价格按推送实时刷新。
// 价格颜色随 trend up/down 闪烁,头部根据涨跌呈现绿/红渐变背景。
function TickerDetailCard({
  row,
  pos,
  nowTick,
  onClose
}: {
  row: TickerRow
  pos: { x: number; y: number }
  nowTick: number
  onClose: () => void
}): React.JSX.Element {
  const up = row.changePercent >= 0
  const fresh = nowTick - row.updatedAt < 600

  const CARD_W = 320
  const CARD_H = 340
  let left = pos.x + 16
  let top = pos.y + 16
  if (left + CARD_W > window.innerWidth) left = Math.max(10, window.innerWidth - CARD_W - 10)
  if (top + CARD_H > window.innerHeight) top = Math.max(10, window.innerHeight - CARD_H - 10)

  return (
    <>
      <div className="fixed inset-0 z-[49]" onClick={onClose} />
      <div
        className="fixed z-50 rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in zoom-in-95 fade-in duration-150"
        style={{ width: CARD_W, left, top }}
      >
        {/* 顶部渐变区:大代码 + 大价格 + 大涨跌 */}
        <div
          className={`relative px-4 pt-3 pb-4 ${
            up
              ? "bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent"
              : "bg-gradient-to-br from-rose-500/15 via-rose-500/5 to-transparent"
          }`}
        >
          <button
            onClick={onClose}
            className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="关闭"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          <div className="flex items-center gap-1.5">
            <span className="text-lg font-black tracking-tight text-slate-800 dark:text-white">
              {row.symbol}
            </span>
            <span className="text-[9px] font-bold tracking-widest text-slate-400">实时行情</span>
            {fresh && (
              <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-500">
                LIVE
              </span>
            )}
          </div>
          <div className="mt-1.5 flex items-end gap-2">
            <span
              className={`text-3xl font-black tabular-nums leading-none transition-colors ${
                fresh && row.trend === "up"
                  ? "text-emerald-500"
                  : fresh && row.trend === "down"
                    ? "text-rose-500"
                    : "text-slate-800 dark:text-white"
              }`}
            >
              {fmtNum(row.lastPrice)}
            </span>
            <span
              className={`mb-0.5 flex items-center gap-0.5 text-xs font-black tabular-nums ${
                up ? "text-emerald-500" : "text-rose-500"
              }`}
            >
              {up ? (
                <TrendingUp className="w-3.5 h-3.5" />
              ) : (
                <TrendingDown className="w-3.5 h-3.5" />
              )}
              <span>
                {up ? "+" : ""}
                {fmtNum(row.change)}
              </span>
              <span className="opacity-80">
                ({up ? "+" : ""}
                {fmtNum(row.changePercent)}%)
              </span>
            </span>
          </div>
        </div>

        {/* 盘口:买一/卖一 */}
        <div className="px-4 py-2 grid grid-cols-2 gap-2 border-t border-slate-100 dark:border-slate-800">
          <DetailCell
            label="买盘"
            color="emerald"
            value={fmtNum(row.bidPrice)}
            sub={`数量 ${fmtNum(row.bidSize, 0)}`}
          />
          <DetailCell
            label="卖盘"
            color="rose"
            value={fmtNum(row.askPrice)}
            sub={`数量 ${fmtNum(row.askSize, 0)}`}
          />
        </div>

        {/* 关键指标 */}
        <div className="px-4 py-2 grid grid-cols-4 gap-2 border-t border-slate-100 dark:border-slate-800">
          <MiniStat label="昨收" value={fmtNum(row.prevClose)} />
          <MiniStat label="开盘" value={fmtNum(row.open)} />
          <MiniStat label="最高" value={fmtNum(row.high)} tone="up" />
          <MiniStat label="最低" value={fmtNum(row.low)} tone="down" />
        </div>

        {/* 推送元信息 */}
        <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 grid grid-cols-3 gap-2 text-[9px]">
          <div>
            <div className="text-slate-400 font-bold tracking-widest mb-0.5">推送次数</div>
            <div className="text-purple-500 font-black tabular-nums">{row.hits}</div>
          </div>
          <div>
            <div className="text-slate-400 font-bold tracking-widest mb-0.5">数据时间</div>
            <div className="text-slate-700 dark:text-slate-200 font-mono tabular-nums">
              {row.ts ? fmtTime(row.ts) : "—"}
            </div>
          </div>
          <div>
            <div className="text-slate-400 font-bold tracking-widest mb-0.5">本地更新</div>
            <div className="text-slate-700 dark:text-slate-200 font-mono tabular-nums">
              {fmtTime(row.updatedAt)}
            </div>
          </div>
        </div>

        {/* 距上次更新 */}
        <div className="px-4 py-1.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[9px]">
          <span className="text-slate-400">距上次更新</span>
          <span
            className={`tabular-nums font-bold ${
              nowTick - row.updatedAt < 1000
                ? "text-emerald-500"
                : nowTick - row.updatedAt > 5000
                  ? "text-rose-500"
                  : "text-amber-500"
            }`}
          >
            {sinceText(row.updatedAt, nowTick)}
          </span>
        </div>
      </div>
    </>
  )
}

function DetailCell({
  label,
  value,
  sub,
  color
}: {
  label: string
  value: string
  sub: string
  color: "emerald" | "rose"
}): React.JSX.Element {
  const ring =
    color === "emerald"
      ? "border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/40 dark:bg-emerald-900/10"
      : "border-rose-200 dark:border-rose-900/40 bg-rose-50/40 dark:bg-rose-900/10";
  const txt = color === "emerald" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
  return (
    <div className={`px-3 py-2 rounded-lg border ${ring}`}>
      <div className={`text-[9px] font-bold tracking-widest ${txt}`}>{label}</div>
      <div className="text-base font-black tabular-nums leading-tight mt-0.5 text-slate-800 dark:text-white">
        {value}
      </div>
      <div className="text-[9px] text-slate-400 tabular-nums">{sub}</div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone
}: {
  label: string
  value: string
  tone?: "up" | "down"
}): React.JSX.Element {
  const cls =
    tone === "up"
      ? "text-emerald-500"
      : tone === "down"
        ? "text-rose-500"
        : "text-slate-700 dark:text-slate-200";
  return (
    <div>
      <div className="text-[9px] font-bold tracking-widest text-slate-400">{label}</div>
      <div className={`text-[12px] font-black tabular-nums mt-0.5 ${cls}`}>{value}</div>
    </div>
  );
}

