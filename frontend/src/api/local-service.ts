import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  listRecalc,
  listRows,
  resetRows,
  saveRecalc,
  saveRows,
} from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult, RecalcItem } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 二次回路明细口径：列表、详情、导出三处都从同一份字段取值，避免各拿一份对不上。
const CIRCUIT_REF_FIELDS = { refNo: '检查编号', bay: '所属间隔', category: '回路类别' }
const CIRCUIT_DETAIL_EDITABLE = ['端子排编号', '绝缘电阻']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // 状态机白名单：登记了 allowedFrom 的模块（二次回路）只能逐级单向推进，越级/回退一律拒收。
  const allowedFrom = meta.actionAllowedFrom?.[action]
  if (allowedFrom && !allowedFrom.includes(current)) {
    return {
      ok: false,
      message: `${meta.entity}当前为「${current}」，不能从该状态执行「${action}」（需处于「${allowedFrom.join('、')}」）`,
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  // 判定合格的结论落到定值整定待重算清单；同一段回路重复判合格只入清单一次。
  if (meta.linkedRecalcOn?.includes(target)) {
    enqueueRecalc(meta, updated)
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 把一条合格回路登记进定值整定待重算清单；同一回路已存在未处理项时不重复登记。
function enqueueRecalc(meta: ModuleMeta, row: EntryRow): void {
  const items = listRecalc()
  const already = items.some(
    (item) => item.sourceKey === meta.key && item.sourceId === Number(row.id) && !item.handled,
  )
  if (already) {
    return
  }
  const nextId = items.reduce((max, item) => Math.max(max, item.id), 0) + 1
  const item: RecalcItem = {
    id: nextId,
    sourceKey: meta.key,
    sourceId: Number(row.id),
    refNo: String(row[CIRCUIT_REF_FIELDS.refNo] ?? ''),
    bay: String(row[CIRCUIT_REF_FIELDS.bay] ?? ''),
    category: String(row[CIRCUIT_REF_FIELDS.category] ?? ''),
    createdAt: formatNow(),
    handled: false,
  }
  saveRecalc([...items, item])
}

export function listPendingRecalc(): RecalcItem[] {
  return listRecalc().filter((item) => !item.handled)
}

export function resolveRecalc(id: number): ActionResult {
  const items = listRecalc()
  const index = items.findIndex((item) => item.id === id)
  if (index < 0) {
    return { ok: false, message: `待重算清单中没有编号为 ${id} 的条目` }
  }
  if (items[index].handled) {
    return { ok: false, message: '该待重算条目已处理，不用重复操作' }
  }
  const next = [...items]
  next[index] = { ...items[index], handled: true }
  saveRecalc(next)
  return { ok: true, message: '待重算条目已处理' }
}

// 回路明细里登记端子排编号与绝缘电阻：直接改同一份列表数据，详情面板与列表、导出始终一致。
export function updateCircuitFields(
  id: number,
  patch: { '端子排编号'?: string; '绝缘电阻'?: string },
): ActionResult {
  const meta = moduleMeta('secondarycircuit')
  const rows = listRows(meta.key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const updated: EntryRow = { ...rows[index] }
  for (const field of CIRCUIT_DETAIL_EDITABLE) {
    const value = patch[field as keyof typeof patch]
    if (value !== undefined) {
      updated[field] = value
    }
  }
  const next = [...rows]
  next[index] = updated
  saveRows(meta.key, next)
  return { ok: true, message: '回路明细已保存' }
}

function formatNow(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    // 导出和列表读同一份数据，保证需整改条目、状态与页面一致，不会出现册子对不上。
    const cells = [row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status]
    lines.push(cells.map((cell) => csvCell(String(cell))).join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
