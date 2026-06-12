// ==================== 应用配置 ====================
// 所有可调参数集中在这里，持久化到 userData/app-config.json。
// 前端通过 config:get / config:set 读写，设置弹窗驱动。

import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

export interface AppConfig {
  // WebView 加载的页面地址
  webviewUrl: string
  // 公共 WebSocket 地址
  wsUrl: string
  // 私有 WebSocket 地址
  wsPrivateUrl: string
  // 私有 WS 接入方标识（由 KeepBit 分配，如 kbappSys）
  wsApiKey: string
  // 业务接口服务器地址（HTTP API baseURL）
  apiBaseUrl: string
  // 节流：把高频行情合并后定时推给渲染进程（解决 IPC 太频繁卡顿）
  throttle: {
    enabled: boolean
    intervalMs: number // 多久 flush 一次
  }
  // Mock 模拟行情（模拟的标的跟随实际订阅，这里只配速率）
  mock: {
    intervalMs: number // 每个 tick 间隔
    batchSize: number // 每个 tick 推多少条
  }
}

// 默认配置
export const DEFAULT_CONFIG: AppConfig = {
  webviewUrl: 'https://test.qqlink.info/zh-hans/financial/usStocks?safeArea=50&vconsole=yes',
  wsUrl: 'wss://ws.keepbit.com/v2/ws/public',
  wsPrivateUrl: 'wss://ws.keepbit.com/v2/ws/private',
  wsApiKey: 'kbappSys',
  apiBaseUrl: 'https://chat.qqlink.io/chat',
  throttle: {
    enabled: true,
    intervalMs: 500
  },
  mock: {
    intervalMs: 500,
    batchSize: 120
  }
}

let configPath = ''
let cached: AppConfig | null = null

function getPath(): string {
  if (!configPath) {
    configPath = join(app.getPath('userData'), 'app-config.json')
  }
  return configPath
}

// 深合并，保证新增字段有默认值
function merge(base: AppConfig, patch: Partial<AppConfig>): AppConfig {
  return {
    webviewUrl: patch.webviewUrl ?? base.webviewUrl,
    wsUrl: patch.wsUrl ?? base.wsUrl,
    wsPrivateUrl: patch.wsPrivateUrl ?? base.wsPrivateUrl,
    wsApiKey: patch.wsApiKey ?? base.wsApiKey,
    apiBaseUrl: patch.apiBaseUrl ?? base.apiBaseUrl,
    throttle: { ...base.throttle, ...patch.throttle },
    mock: { ...base.mock, ...patch.mock }
  }
}

export function loadConfig(): AppConfig {
  if (cached) return cached
  try {
    if (existsSync(getPath())) {
      const raw = JSON.parse(readFileSync(getPath(), 'utf-8'))
      cached = merge(DEFAULT_CONFIG, raw)
    } else {
      cached = { ...DEFAULT_CONFIG }
    }
  } catch (e) {
    console.error('[Config] 读取失败，使用默认配置:', e)
    cached = { ...DEFAULT_CONFIG }
  }
  return cached
}

export function saveConfig(patch: Partial<AppConfig>): AppConfig {
  cached = merge(loadConfig(), patch)
  try {
    writeFileSync(getPath(), JSON.stringify(cached, null, 2), 'utf-8')
  } catch (e) {
    console.error('[Config] 保存失败:', e)
  }
  return cached
}
