import { createHash } from 'crypto'
import { HttpsProxyAgent } from 'https-proxy-agent'
import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios'
import { v4 as uuidv4 } from 'uuid'
import { machineIdSync } from 'node-machine-id'
import { app } from 'electron'
import { loadConfig } from './config'

// ==================== 代理配置 ====================
// 按当前 config 动态获取 agent；改了设置无需重启。
let cachedAgentKey = ''
let cachedAgent: HttpsProxyAgent<string> | undefined
function getProxyAgent(): HttpsProxyAgent<string> | undefined {
  const { proxy } = loadConfig()
  if (!proxy?.enabled || !proxy.url) {
    cachedAgentKey = ''
    cachedAgent = undefined
    return undefined
  }
  if (cachedAgentKey !== proxy.url) {
    cachedAgentKey = proxy.url
    cachedAgent = new HttpsProxyAgent(proxy.url)
  }
  return cachedAgent
}

// ==================== 设备信息 ====================
let cachedMachineId = ''

function getMachineId(): string {
  if (!cachedMachineId) {
    try {
      cachedMachineId = machineIdSync()
    } catch {
      cachedMachineId = 'unknown-device-id'
    }
  }
  return cachedMachineId
}

function getDeviceInfo() {
  return {
    deviceId: getMachineId(),
    deviceName: 'Electron Desktop'
  }
}

// ==================== 创建 Axios 实例（不走 token 鉴权） ====================

const requestSkipToken: AxiosInstance = axios.create({
  // baseURL 在请求拦截器里按配置动态注入（支持运行时改服务器地址）
  timeout: 15000,
  proxy: false // 禁用 axios 内置 proxy，使用自定义 agent
})

// 请求拦截器：注入公共 headers
requestSkipToken.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  // 服务器地址按配置动态读取
  config.baseURL = loadConfig().apiBaseUrl
  config.headers = config.headers ?? {}
  config.headers['operationID'] = uuidv4()
  const platform = 2
  config.headers['Version'] = `${platform}-${app.getVersion()}`
  config.headers['Terminal-Version'] = app.getVersion()
  config.headers['AppType'] = 'QQLink'
  config.headers['DeviceId'] = getMachineId()
  config.headers['Accept-Language'] = 'zh-CN'
  const agent = getProxyAgent()
  config.httpsAgent = agent
  config.httpAgent = agent
  return config
})

// 响应拦截器
requestSkipToken.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('[API] 请求失败:', error?.response?.data || error.message)
    return Promise.reject(error)
  }
)

// ==================== 登录接口 ====================
interface LoginParams {
  areaCode?: string
  phoneNumber?: string
  email?: string
  password: string
  verificationCode?: string
}

interface LoginResult {
  errCode: number
  errMsg: string
  errDlt: string
  data: {
    token: string
    refreshToken: string
    expireTime: number
    userID: string
    // 钱包 / 业务相关 token（页面 getAuth 需要）
    walletToken?: string
    secretKey?: string
    kbitToken?: string
    chatToken?: string
    [key: string]: unknown
  }
}

function getAreaCode(areaCode?: string): string {
  if (!areaCode) return '+86'
  return areaCode.startsWith('+') ? areaCode : `+${areaCode}`
}

export async function login(params: LoginParams): Promise<LoginResult> {
  const deviceInfo = getDeviceInfo()
  const platform = 2

  const { data } = await requestSkipToken.post<LoginResult>('/account/login', {
    ...params,
    password: createHash('md5').update(params.password).digest('hex'),
    platform,
    areaCode: getAreaCode(params.areaCode),
    version: app.getVersion(),
    deviceID: deviceInfo.deviceId,
    deviceType: encodeURIComponent(deviceInfo.deviceName)
  })

  return data
}

export { requestSkipToken, getMachineId }
export type { LoginParams, LoginResult }
