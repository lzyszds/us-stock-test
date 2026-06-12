// ==================== WS 行情模拟器 ====================
// 用途：美股闭市 / 无真实行情时，模拟服务端推送的 ticker 消息来测试。
// 消息格式与 KeepBit 公共频道一致：{ action, arg, data: [...] }
//
// 用法（在 index.ts 里）：
//   import { startMockWs } from './mockWs'
//   const stop = startMockWs((parsed) => {
//     // 复用真实 on('message') 里的逻辑
//     tickerUpdateDataMap.set(parsed.arg.instId, parsed)
//     sendToRenderer('ws:message', parsed)
//     forwardToWebView(parsed)
//   })
//   // 需要停止时：stop()

export interface TickerData {
  symbol: string
  bidPrice: string
  bidSize: string
  askPrice: string
  askSize: string
  lastPrice: string
  ts: string
  prevClose: string
  change: string
  changePercent: string
  open: string
  high: string
  low: string
}

export interface TickerMessage {
  action: 'update' | 'snapshot'
  arg: { instType: string; channel: string; instId: string }
  data: TickerData[]
}

// 单只股票的内部状态（用于让价格连续随机游走，而不是每次都乱跳）
interface SymbolState {
  symbol: string
  prevClose: number
  last: number
  open: number
  high: number
  low: number
}

// 订阅项：模拟器要模拟的标的（来自 webview 实际下发的订阅）
export interface SubInst {
  instType: string
  channel: string
  instId: string
}

export interface MockOptions {
  // 动态返回「当前订阅的标的列表」。每个 tick 都会调用，订阅/退订实时生效。
  getSubscriptions: () => SubInst[]
  // 每个 tick 的间隔（毫秒），默认 500ms
  intervalMs?: number
  // 每个 tick 推送多少条消息，默认 120（即每 500ms 发 120+ 条）
  batchSize?: number
}

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min
}

function fmt(n: number, decimals = 2): string {
  return n.toFixed(decimals)
}

function buildMessage(state: SymbolState, instType: string, channel: string): TickerMessage {
  // 价格做一个小幅随机游走（±0.25%）
  const drift = state.last * rand(-0.0025, 0.0025)
  state.last = Math.max(0.01, state.last + drift)
  state.high = Math.max(state.high, state.last)
  state.low = Math.min(state.low, state.last)

  const spread = state.last * 0.0002 // 买卖价差约 0.02%
  const bidPrice = state.last - spread
  const askPrice = state.last + spread
  const change = state.last - state.prevClose
  const changePercent = (change / state.prevClose) * 100

  return {
    action: 'update',
    arg: { instType, channel, instId: state.symbol },
    data: [
      {
        symbol: state.symbol,
        bidPrice: fmt(bidPrice),
        bidSize: String(Math.round(rand(100, 20000) / 100) * 100),
        askPrice: fmt(askPrice),
        askSize: String(Math.round(rand(100, 20000) / 100) * 100),
        lastPrice: fmt(state.last),
        ts: String(Date.now()),
        prevClose: fmt(state.prevClose),
        change: fmt(change),
        changePercent: fmt(changePercent, 5),
        open: fmt(state.open),
        high: fmt(state.high),
        low: fmt(state.low)
      }
    ]
  }
}

/**
 * 启动模拟推送。模拟的标的完全跟随 options.getSubscriptions()：
 * 订阅了哪些 instId 就模拟哪些，退订后自动停止该标的。无订阅则不推送。
 * @param onMessage 每条模拟消息的回调（结构等同真实 parsed 消息）
 * @param options   模拟参数
 * @returns 停止函数，调用后停止推送
 */
export function startMockWs(
  onMessage: (msg: TickerMessage) => void,
  options: MockOptions
): () => void {
  const { getSubscriptions, intervalMs = 500, batchSize = 120 } = options

  // 每个 instId 一份价格状态，首次见到时随机生成基准价（无真实价格可用）
  const states = new Map<string, SymbolState>()

  function ensureState(instId: string): SymbolState {
    let s = states.get(instId)
    if (!s) {
      const prevClose = rand(50, 500)
      const open = prevClose * rand(0.99, 1.01)
      s = { symbol: instId, prevClose, last: open, open, high: open, low: open }
      states.set(instId, s)
    }
    return s
  }

  console.log(`[MockWS] 启动：每 ${intervalMs}ms 推 ${batchSize} 条，跟随订阅动态模拟`)

  const timer = setInterval(() => {
    // 只模拟 ticker 频道的订阅
    const subs = getSubscriptions().filter((s) => s.channel === 'ticker')
    if (subs.length === 0) return // 无订阅 / 已全部退订：不推送

    // 清理已退订标的的状态
    const active = new Set(subs.map((s) => s.instId))
    for (const id of states.keys()) {
      if (!active.has(id)) states.delete(id)
    }

    // 每个 tick 连发一批，在已订阅标的间随机分配，模拟乱序到达
    for (let i = 0; i < batchSize; i++) {
      const sub = subs[Math.floor(Math.random() * subs.length)]
      const state = ensureState(sub.instId)
      onMessage(buildMessage(state, sub.instType, sub.channel))
    }
  }, intervalMs)

  return () => {
    clearInterval(timer)
    console.log('[MockWS] 已停止模拟推送')
  }
}
