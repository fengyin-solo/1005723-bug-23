import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  listRecalc,
  listRows,
  resetRows,
  saveRecalc,
  saveRows,
} from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  RecalcEntry,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

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

export function getEntry(key: string, id: number): EntryRow | undefined {
  return listRows(key).find((row) => Number(row.id) === id)
}

function isPending(meta: ModuleMeta, status: string): boolean {
  const terminals = meta.terminalStatuses ?? [meta.statuses[meta.statuses.length - 1]]
  return !terminals.includes(status)
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

  // 状态机：配置了 actionSources 的模块只允许按序推进，越级与回退一律拒收。
  const allowed = meta.actionSources?.[action]
  if (allowed && !allowed.includes(current)) {
    return {
      ok: false,
      message:
        current === target
          ? `${meta.entity}已经是「${target}」，重复提交不生效`
          : `「${current}」状态不能执行「${action}」，请按 ${meta.statuses.join('、')} 顺序推进`,
    }
  } else if (!meta.actionSources && current === target) {
    // 未配置状态机的模块保留原来的重复操作提示。
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }

  // 原地更新同一条记录，按 id 落位，绝不新增行，避免列表出现重条。
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: isPending(meta, target),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)

  // 判定合格的结论落到定值整定的待重算清单；同一段回路（按 id）只登记一次。
  if (meta.recalcTriggerAction === action) {
    enqueueRecalc(updated)
  }

  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

/** 更新回路明细字段（端子排编号、绝缘电阻等），列表与详情读的是同一条数据。 */
export function updateEntry(key: string, id: number, patch: Record<string, string>): ActionResult {
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的记录` }
  }
  const updated: EntryRow = { ...rows[index], ...patch }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: '回路明细已保存' }
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
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
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

// —— 定值整定：二次回路检查合格后的待重算清单 ——

function enqueueRecalc(row: EntryRow): void {
  const entries = listRecalc()
  if (entries.some((item) => item.circuitId === Number(row.id))) {
    return
  }
  const entry: RecalcEntry = {
    circuitId: Number(row.id),
    检查编号: String(row['检查编号'] ?? ''),
    所属间隔: String(row['所属间隔'] ?? ''),
    回路类别: String(row['回路类别'] ?? ''),
    绝缘电阻: String(row['绝缘电阻'] ?? ''),
    登记时间: new Date().toISOString(),
  }
  saveRecalc([entry, ...entries])
}

export function listRecalcEntries(): RecalcEntry[] {
  return listRecalc()
}

export function completeRecalc(circuitId: number): ActionResult {
  const entries = listRecalc()
  const next = entries.filter((item) => item.circuitId !== circuitId)
  if (next.length === entries.length) {
    return { ok: false, message: '该回路不在待重算清单里' }
  }
  saveRecalc(next)
  return { ok: true, message: '该回路已完成定值重算，移出待重算清单' }
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) =>
        isPending(meta, String(row.status)),
      ).length,
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
