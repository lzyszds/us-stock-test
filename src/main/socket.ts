// ==================== KeepBit 公共 WebSocket 协议 ====================
// 接口: wss://wss.keepbit.com/v2/ws/public
// 公共频道无需登录/签名：connect → subscribe → 每 30s ping → 解析 action 推送。
// 注意：公共连接绝对不要发送 login（会返回 30014）。

// 心跳：纯文本 'ping' / 'pong'（非 JSON），建议每 30 秒一次
export const PING_CMD = 'ping'
export const HEARTBEAT_INTERVAL = 30000

// 订阅项三要素
export interface SubItem {
  instType: string // 固定 'US-STOCKS'
  channel: string // 'ticker' | 'trade'
  instId: string // 股票代码，大写，如 'AAPL'
}

// 构造订阅 / 退订命令
export function buildSubscribeCmd(
  items: SubItem[],
  op: 'subscribe' | 'unsubscribe' = 'subscribe'
): string {
  return JSON.stringify({
    op,
    args: items.map((it) => ({
      instType: it.instType,
      channel: it.channel,
      instId: it.instId
    }))
  })
}

// 美股默认订阅（公共频道没有 default 通配，必须按具体 instId 订阅）
export const usStockSubsDefault: SubItem[] = [
  { instType: 'US-STOCKS', channel: 'ticker', instId: 'AAPL' },
  { instType: 'US-STOCKS', channel: 'trade', instId: 'AAPL' }
]

// 判断是否为心跳消息（pong/ping），不转发业务
export function isHeartbeatMessage(message: string): boolean {
  const t = message.trim()
  return t === 'pong' || t === 'ping'
}

// 已解析消息的类别（用于决策树：pong → event → action）
export type ParsedKind = 'event' | 'action' | 'unknown'

export function classifyMessage(parsed: unknown): ParsedKind {
  if (parsed && typeof parsed === 'object') {
    if ('event' in parsed) return 'event' // 控制回执 / 错误
    if ('action' in parsed) return 'action' // 行情推送
  }
  return 'unknown'
}
