import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

interface AuthStore {
  token: string
  refreshToken: string
  expireTime: number
  userID: string
  loginTime: string
  // 页面 getAuth 需要的业务 token
  walletToken: string
  secretKey: string
  kbitToken: string
  chatToken: string
}

const defaults: AuthStore = {
  token: '',
  refreshToken: '',
  expireTime: 0,
  userID: '',
  loginTime: '',
  walletToken: '',
  secretKey: '',
  kbitToken: '',
  chatToken: ''
}

// 页面 ~/utils/bridge 的 AuthTokenPayload 形状（token = walletToken）
export interface AuthTokenPayload {
  token: string
  secretKey: string
  kbitToken: string
  chatToken: string
}

function getStorePath(): string {
  const dir = join(app.getPath('userData'), 'auth')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return join(dir, 'auth.json')
}

function loadStore(): AuthStore {
  try {
    const path = getStorePath()
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf-8'))
    }
  } catch (e) {
    console.error('[Auth] 读取存储失败:', e)
  }
  return { ...defaults }
}

function saveStore(data: AuthStore): void {
  try {
    writeFileSync(getStorePath(), JSON.stringify(data, null, 2), 'utf-8')
  } catch (e) {
    console.error('[Auth] 写入存储失败:', e)
  }
}

export function saveToken(data: {
  token: string
  refreshToken: string
  expireTime: number
  userID: string
  walletToken?: string
  secretKey?: string
  kbitToken?: string
  chatToken?: string
}) {
  const store = loadStore()
  store.token = data.token
  store.refreshToken = data.refreshToken
  store.expireTime = data.expireTime
  store.userID = data.userID
  store.loginTime = new Date().toISOString()
  store.walletToken = data.walletToken ?? ''
  store.secretKey = data.secretKey ?? ''
  store.kbitToken = data.kbitToken ?? ''
  // chatToken 缺失时退化为登录 token（来自 chat.qqlink.io）
  store.chatToken = data.chatToken ?? data.token ?? ''
  saveStore(store)
}

// 返回页面 getAuth 期望的 token 负载
export function getAuthTokens(): AuthTokenPayload {
  const store = loadStore()
  return {
    token: store.walletToken, // token 字段 = walletToken
    secretKey: store.secretKey,
    kbitToken: store.kbitToken,
    chatToken: store.chatToken
  }
}

export function getToken(): string {
  return loadStore().token
}

export function getRefreshToken(): string {
  return loadStore().refreshToken
}

export function getUserID(): string {
  return loadStore().userID
}

export function isTokenValid(): boolean {
  const store = loadStore()
  return !!store.token && Date.now() / 1000 < store.expireTime
}

export function clearToken() {
  saveStore({ ...defaults })
}

export function getAuthInfo(): AuthStore {
  return loadStore()
}
