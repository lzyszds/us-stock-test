// 应用配置类型（与 main/config.ts、preload 保持一致）
export interface AppConfig {
  webviewUrl: string
  wsUrl: string
  wsPrivateUrl: string
  wsApiKey: string

  apiBaseUrl: string
  throttle: {
    enabled: boolean
    intervalMs: number
  }
  mock: {
    intervalMs: number
    batchSize: number
  }
}
