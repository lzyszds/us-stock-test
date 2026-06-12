import { useEffect, useState } from 'react'
import type { AppConfig } from './types'

interface Props {
  open: boolean
  onClose: () => void
  onSaved?: (cfg: AppConfig) => void
}

function SettingsDialog({ open, onClose, onSaved }: Props): React.JSX.Element | null {
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    window.electronBridge?.getConfig().then(setCfg)
  }, [open])

  if (!open || !cfg) return null

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    const saved = await window.electronBridge?.setConfig(cfg)
    setSaving(false)
    if (saved) onSaved?.(saved)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span className="text-blue-500">⚙️</span> 应用设置
          </h2>
          <button
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* 地址配置 */}
          <section className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400">
              服务地址
            </h3>
            <div className="grid gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  WebView URL
                </label>
                <input
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm font-mono"
                  value={cfg.webviewUrl}
                  onChange={(e) => setCfg({ ...cfg, webviewUrl: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  WebSocket URL
                </label>
                <input
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm font-mono"
                  value={cfg.wsUrl}
                  onChange={(e) => setCfg({ ...cfg, wsUrl: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  私有 WebSocket URL
                </label>
                <input
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm font-mono"
                  value={cfg.wsPrivateUrl}
                  onChange={(e) => setCfg({ ...cfg, wsPrivateUrl: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  API Key
                </label>
                <input
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm font-mono"
                  value={cfg.wsApiKey}
                  onChange={(e) => setCfg({ ...cfg, wsApiKey: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  服务器地址 (API)
                </label>
                <input
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm font-mono"
                  value={cfg.apiBaseUrl}
                  onChange={(e) => setCfg({ ...cfg, apiBaseUrl: e.target.value })}
                />
              </div>
            </div>
          </section>

          {/* 节流配置 */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400">
                推送节流
              </h3>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={cfg.throttle.enabled}
                  onChange={(e) =>
                    setCfg({ ...cfg, throttle: { ...cfg.throttle, enabled: e.target.checked } })
                  }
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
              </label>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
                节流间隔 (ms)
              </label>
              <input
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                type="number"
                min={50}
                value={cfg.throttle.intervalMs}
                onChange={(e) =>
                  setCfg({
                    ...cfg,
                    throttle: { ...cfg.throttle, intervalMs: Number(e.target.value) }
                  })
                }
              />
              <p className="text-[10px] text-slate-400 italic">
                开启后，消息将合并并在指定间隔内推送一次，减少渲染负担。
              </p>
            </div>
          </section>

          {/* Mock 配置 */}
          <section className="space-y-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800">
            <h3 className="text-xs font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
              行情模拟配置
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  推送间隔 (ms)
                </label>
                <input
                  className="w-full px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm"
                  type="number"
                  min={50}
                  value={cfg.mock.intervalMs}
                  onChange={(e) =>
                    setCfg({ ...cfg, mock: { ...cfg.mock, intervalMs: Number(e.target.value) } })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  单次条数
                </label>
                <input
                  className="w-full px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm"
                  type="number"
                  min={1}
                  value={cfg.mock.batchSize}
                  onChange={(e) =>
                    setCfg({ ...cfg, mock: { ...cfg.mock, batchSize: Number(e.target.value) } })
                  }
                />
              </div>
            </div>
            <p className="text-[10px] text-slate-400 italic">
              模拟标的自动跟随页面实际下发的订阅：订阅哪些就模拟哪些，退订后自动停止。
            </p>
          </section>
        </div>

        <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3 bg-slate-50 dark:bg-slate-900/50">
          <button
            className="px-6 py-2 text-sm font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="px-8 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-lg shadow-blue-500/20 transition-all flex items-center gap-2 disabled:opacity-70"
            onClick={handleSave}
            disabled={saving}
          >
            {saving && (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            )}
            {saving ? '正在保存...' : '保 存'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsDialog
