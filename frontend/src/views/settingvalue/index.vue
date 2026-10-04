<template>
  <section class="page" data-module="settingvalue">
    <header class="page-head">
      <div>
        <h2>定值整定管理</h2>
        <p class="page-desc">维护定值单，围绕定值单号、所属装置、定值项目、整定值做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记定值单</button>
        <button class="btn" type="button" @click="exportRows">导出定值整定清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无定值整定数据，可先登记定值单</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条定值整定记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <section class="recalc-block">
      <header class="recalc-head">
        <h3>待重算清单</h3>
        <span class="recalc-count">来自二次回路检查合格结论 · 待处理 {{ recalcRows.length }} 条</span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>回路检查编号</th>
            <th>所属间隔</th>
            <th>回路类别</th>
            <th>结论到达时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in recalcRows" :key="item.id">
            <td>{{ item.refNo || '—' }}</td>
            <td>{{ item.bay || '—' }}</td>
            <td>{{ item.category || '—' }}</td>
            <td>{{ item.createdAt }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="handleRecalc(item.id)">完成重算</button>
            </td>
          </tr>
          <tr v-if="!recalcRows.length">
            <td colspan="5" class="empty-state">暂无因回路检查合格触发的待重算条目</td>
          </tr>
        </tbody>
      </table>
      <p v-if="recalcMessage" class="recalc-msg" :class="{ 'error-text': !recalcOk }">{{ recalcMessage }}</p>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  listPendingRecalc,
  moduleMeta,
  resolveRecalc,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, RecalcItem } from '@/data/types'

const meta = moduleMeta('settingvalue')
const columns = ["定值单号", "所属装置", "定值项目", "整定值", "计算依据", "整定人", "审核人", "定值状态"]
const actions = ["提交整定", "审核定值", "作废定值"]
const statuses = ["待整定", "整定中", "已审核", "已作废"]
const stats = [{"label": "待整定定值单", "value": 0}, {"label": "整定中定值单", "value": 0}, {"label": "已作废定值单", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '定值单登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

const recalcRows = ref<RecalcItem[]>([])
const recalcMessage = ref('')
const recalcOk = ref(false)

function loadRecalc() {
  recalcRows.value = listPendingRecalc()
}

function handleRecalc(id: number) {
  recalcMessage.value = ''
  const result = resolveRecalc(id)
  recalcOk.value = result.ok
  recalcMessage.value = result.message
  if (result.ok) {
    loadRecalc()
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '定值整定列表读取失败'
  }
}

onMounted(() => {
  reload()
  loadRecalc()
})
</script>

<style scoped>
.recalc-block {
  margin-top: 20px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
}
.recalc-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 8px;
}
.recalc-head h3 { margin: 0; font-size: 15px; }
.recalc-count { font-size: 12px; color: var(--muted); }
.recalc-msg { margin: 8px 0 0; font-size: 12px; color: #157347; }
</style>
