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
  // 状态机白名单：只允许从登记的状态发起对应动作；未登记的模块沿用原先的宽松流转。
  actionAllowedFrom?: Record<string, string[]>
  // 判定到目标状态后，需要把结论推送给其他模块的清单（如二次回路合格 -> 定值整定待重算）。
  linkedRecalcOn?: string[]
  metrics: string[]
}

// 判定合格后落到「定值整定 - 待重算清单」的一条待办。
export type RecalcItem = {
  id: number
  sourceKey: string
  sourceId: number
  refNo: string
  bay: string
  category: string
  createdAt: string
  handled: boolean
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
