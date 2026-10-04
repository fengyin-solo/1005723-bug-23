import { SEED_ROWS } from './seed'
import type { EntryRow, RecalcItem } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'substation-protection:entries'
// 跨模块清单（二次回路合格 -> 定值整定待重算）单独存放，不和业务表混在一起。
const RECALC_STORAGE_KEY = 'substation-protection:recalc'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

function readRecalc(): RecalcItem[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return recalcCache ?? []
  }
  const raw = window.localStorage.getItem(RECALC_STORAGE_KEY)
  if (!raw) {
    return []
  }
  try {
    return JSON.parse(raw) as RecalcItem[]
  } catch {
    return []
  }
}

let recalcCache: RecalcItem[] | null = null

export function listRecalc(): RecalcItem[] {
  if (recalcCache === null) {
    recalcCache = readRecalc()
  }
  return recalcCache
}

export function saveRecalc(items: RecalcItem[]): void {
  recalcCache = items
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(RECALC_STORAGE_KEY, JSON.stringify(items))
  }
}
