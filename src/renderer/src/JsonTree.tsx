import { useState } from 'react'
import { ChevronRight } from 'lucide-react'

type JsonValue = unknown

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isContainer = (v: unknown): boolean => Array.isArray(v) || isObj(v)

function primitiveColor(value: JsonValue): string {
  if (value === null || value === undefined) return 'text-slate-400 dark:text-slate-500'
  switch (typeof value) {
    case 'string':
      return 'text-emerald-600 dark:text-emerald-400'
    case 'number':
      return 'text-amber-600 dark:text-amber-400'
    case 'boolean':
      return 'text-purple-600 dark:text-purple-400'
    default:
      return ''
  }
}

function primitiveText(value: JsonValue): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return `"${value}"`
  return String(value)
}

function containerPlaceholder(value: JsonValue): string {
  if (Array.isArray(value)) return `Array(${value.length})`
  return '{…}'
}

function OneLinePreview({ value }: { value: JsonValue }): React.JSX.Element {
  if (!isContainer(value)) {
    return <span className={primitiveColor(value)}>{primitiveText(value)}</span>
  }
  const isArr = Array.isArray(value)
  const entries: [string, JsonValue][] = isArr
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>)

  return (
    <span className="text-slate-500 dark:text-slate-400">
      {isArr ? '[' : '{'}
      {entries.map(([k, v], i) => (
        <span key={k}>
          {i > 0 && ', '}
          {!isArr && <span className="text-slate-600 dark:text-slate-300">{k}: </span>}
          {isContainer(v) ? (
            <span>{containerPlaceholder(v)}</span>
          ) : (
            <span className={primitiveColor(v)}>{primitiveText(v)}</span>
          )}
        </span>
      ))}
      {isArr ? ']' : '}'}
    </span>
  )
}

interface NodeProps {
  name?: string
  value: JsonValue
  depth?: number
  defaultExpandDepth?: number
  prefix?: React.ReactNode
}

function Node({
  name,
  value,
  depth = 0,
  defaultExpandDepth = 0,
  prefix
}: NodeProps): React.JSX.Element {
  const expandable = isContainer(value)
  const [open, setOpen] = useState(depth < defaultExpandDepth)

  const keyLabel = name !== undefined && (
    <>
      <span className="text-sky-700 dark:text-sky-300">{name}</span>
      <span className="text-slate-400">: </span>
    </>
  )

  if (!expandable) {
    return (
      <div className="leading-relaxed whitespace-pre-wrap break-all flex items-start gap-1">
        <span className="w-3 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          {prefix}
          {keyLabel}
          <span className={primitiveColor(value)}>{primitiveText(value)}</span>
        </div>
      </div>
    )
  }

  const isArr = Array.isArray(value)
  const entries: [string, JsonValue][] = isArr
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>)

  return (
    <div>
      <div
        className="flex items-start gap-1 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/50 rounded select-none leading-relaxed"
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight
          className={`w-3 h-3 mt-[3px] flex-shrink-0 text-slate-400 transition-transform ${
            open ? 'rotate-90' : ''
          }`}
        />
        <div className="min-w-0 flex-1 whitespace-pre-wrap break-all">
          {prefix}
          {keyLabel}
          {open ? (
            <span className="text-slate-400">{isArr ? '[' : '{'}</span>
          ) : (
            <OneLinePreview value={value} />
          )}
        </div>
      </div>
      {open && (
        <div className="pl-4">
          {entries.map(([k, v]) => (
            <Node
              key={k}
              name={k}
              value={v}
              depth={depth + 1}
              defaultExpandDepth={defaultExpandDepth}
            />
          ))}
          <div className="text-slate-400 leading-relaxed pl-3">{isArr ? ']' : '}'}</div>
        </div>
      )}
    </div>
  )
}

export default function JsonTree({
  data,
  prefix,
  defaultExpandDepth = 0
}: {
  data: JsonValue
  prefix?: React.ReactNode
  defaultExpandDepth?: number
}): React.JSX.Element {
  return (
    <div className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
      <Node value={data} prefix={prefix} defaultExpandDepth={defaultExpandDepth} />
    </div>
  )
}
