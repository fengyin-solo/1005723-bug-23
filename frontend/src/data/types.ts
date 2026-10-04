/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  /**
   * 状态机：动作 -> 允许从哪些状态执行。配置后只允许「按序推进」，
   * 越级与回退一律拒收；不配置的模块沿用原来的自由流转。
   */
  actionSources?: Record<string, string[]>
  /** 终态：进入这些状态后视为已闭环，不再计入待处理。 */
  terminalStatuses?: string[]
  /** 命中该动作后，把对应记录登记到关联模块的待重算清单。 */
  recalcTriggerAction?: string
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 判定合格后落到定值整定的待重算条目。 */
export type RecalcEntry = {
  circuitId: number
  检查编号: string
  所属间隔: string
  回路类别: string
  绝缘电阻: string
  登记时间: string
  [field: string]: string | number
}
