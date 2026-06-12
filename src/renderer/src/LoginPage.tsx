import { useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
import SettingsDialog from './SettingsDialog'
import textIcon from './assets/text-icon.png'

interface LoginPageProps {
  onLoginSuccess: (data: { token: string; userID: string }) => void
}

function LoginPage({ onLoginSuccess }: LoginPageProps): React.JSX.Element {
  const [account, setAccount] = useState('lzyszds@qq.com')
  const [password, setPassword] = useState('Aa395878870')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [apiBaseUrl, setApiBaseUrl] = useState('')

  // 登录前也能读到当前服务器地址（用于底部展示）
  useEffect(() => {
    window.electronBridge?.getConfig().then((c) => setApiBaseUrl(c.apiBaseUrl))
  }, [])

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError('')

    if (!account.trim()) {
      setError('请输入邮箱')
      return
    }
    if (!password.trim()) {
      setError('请输入密码')
      return
    }

    setLoading(true)

    try {
      const bridge = window.electronBridge
      if (!bridge) {
        setError('electronBridge 未初始化')
        setLoading(false)
        return
      }

      const params: Record<string, string> = {
        password: password
      }

      params.email = account

      const result = await bridge.login(params as Parameters<typeof bridge.login>[0])

      if (result.success && result.data) {
        onLoginSuccess({
          token: result.data.token,
          userID: result.data.userID
        })
      } else {
        setError(result.errMsg || `登录失败 (errCode: ${result.errCode})`)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '登录请求异常'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 transition-colors duration-300 px-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden relative">
        {/* 设置入口（登录前即可配置服务器地址等） */}
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          title="设置"
          className="absolute top-4 right-4 z-10 p-2 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
        >
          <Settings className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="p-8 pb-4 text-center">
          <div className="inline-flex overflow-hidden">
            <img src={textIcon} alt="Logo" className="w-58 h-58 rounded-full object-cover select-none dark:invert-75" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">欢迎回来 美股调试器</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">请登录您的 QQLink 账号</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-8 space-y-5">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              电子邮箱
            </label>
            <input
              type="email"
              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="请输入邮箱地址"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              账户密码
            </label>
            <input
              type="password"
              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 rounded-lg text-red-600 dark:text-red-400 text-xs font-medium text-center animate-shake">
              ⚠️ {error}
            </div>
          )}

          <button
            type="submit"
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-lg shadow-blue-500/30 transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
            disabled={loading}
          >
            {loading && (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            )}
            {loading ? '正在登录...' : '立 即 登 录'}
          </button>
        </form>

        {/* Footer */}
        <div className="px-8 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex justify-center">
          <span className="text-[10px] font-mono text-slate-400 tracking-widest truncate max-w-full">
            Server: {apiBaseUrl || '未配置'}
          </span>
        </div>
      </div>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={(cfg) => setApiBaseUrl(cfg.apiBaseUrl)}
      />
    </div>
  )
}

export default LoginPage
