<template>
  <section class="page" data-module="secondarycircuit">
    <header class="page-head">
      <div>
        <h2>二次回路检查管理</h2>
        <p class="page-desc">维护回路检查记录，围绕检查编号、所属间隔、回路类别、端子排编号做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记回路检查记录</button>
        <button class="btn" type="button" @click="exportRows">导出二次回路检查清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
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

    <div class="circuit-layout">
      <table class="data-table circuit-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="String(row.id)"
            :class="{ 'row-selected': Number(row.id) === selectedId }"
            @click="selectRow(row)"
          >
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions" @click.stop>
              <button
                v-for="action in availableActions(row)"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
              <span v-if="!availableActions(row).length" class="muted-text">—</span>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无二次回路检查数据，可先登记回路检查记录</td>
          </tr>
        </tbody>
      </table>

      <aside class="circuit-detail">
        <h3 class="detail-title">回路明细</h3>
        <p v-if="!selectedRow" class="muted-text">在左侧列表选择一条回路，端子排编号、绝缘电阻与列表同源展示。</p>
        <template v-else>
          <div class="detail-grid">
            <span class="detail-label">检查编号</span>
            <span>{{ fieldText('检查编号') }}</span>
            <span class="detail-label">所属间隔</span>
            <span>{{ fieldText('所属间隔') }}</span>
            <span class="detail-label">回路类别</span>
            <span>{{ fieldText('回路类别') }}</span>
            <span class="detail-label">检查人</span>
            <span>{{ fieldText('检查人') }}</span>
            <span class="detail-label">检查日期</span>
            <span>{{ fieldText('检查日期') }}</span>
            <span class="detail-label">当前状态</span>
            <span>{{ selectedRow.status }}</span>
          </div>

          <label class="detail-edit">
            <span>端子排编号</span>
            <input v-model="detailDraft['端子排编号']" placeholder="填写端子排编号" />
          </label>
          <label class="detail-edit">
            <span>绝缘电阻（MΩ）</span>
            <input v-model="detailDraft['绝缘电阻']" placeholder="填写绝缘电阻，沿用既有回路口径" />
          </label>

          <div class="detail-actions">
            <button class="btn primary" type="button" @click="saveDetail">保存明细</button>
            <button
              v-for="action in availableActions(selectedRow)"
              :key="action"
              class="btn"
              type="button"
              @click="runAction(action, selectedRow)"
            >
              {{ action }}
            </button>
          </div>
          <p v-if="!availableActions(selectedRow).length" class="muted-text">
            {{ selectedRow.status === '检查合格' ? '检查合格为终态，不能再回到待检查或重复判定。' : '该状态暂无可执行动作。' }}
          </p>
        </template>
      </aside>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条二次回路检查记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'

import {
  downloadEntries,
  getEntry,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  updateEntry,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('secondarycircuit')
const columns = ["检查编号", "所属间隔", "回路类别", "端子排编号", "绝缘电阻", "检查人", "检查日期", "回路状态"]
const statuses = ["待检查", "检查中", "检查合格", "需整改"]
// 每个状态只放行它该有的动作：越级、回退的入口不出现，服务层也会再拒收一次。
const ACTIONS_BY_STATUS: Record<string, string[]> = {
  "待检查": ["提交检查"],
  "检查中": ["判定合格", "提出整改"],
  "检查合格": [],
  "需整改": ["重新提交检查"],
}
const EDITABLE_FIELDS = ["端子排编号", "绝缘电阻"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const selectedId = ref<number | null>(null)
const detailDraft = reactive<Record<string, string>>({ "端子排编号": "", "绝缘电阻": "" })

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const statCards = computed(() => [
  { label: "待检查回路", value: countOf("待检查") },
  { label: "检查中回路", value: countOf("检查中") },
  { label: "检查合格回路", value: countOf("检查合格") },
  { label: "需整改回路", value: countOf("需整改") },
])

function countOf(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

const selectedRow = computed(() =>
  selectedId.value === null
    ? undefined
    : rows.value.find((row) => Number(row.id) === selectedId.value),
)

function availableActions(row: EntryRow): string[] {
  return ACTIONS_BY_STATUS[String(row.status)] ?? []
}

function fieldText(field: string): string {
  if (!selectedRow.value) {
    return ''
  }
  return String(selectedRow.value[field] ?? '—')
}

// 明细面板始终以列表当前行（同一存储记录）为准同步草稿，两处绝缘电阻保持一致。
watch(
  selectedRow,
  (row) => {
    for (const field of EDITABLE_FIELDS) {
      detailDraft[field] = row ? String(row[field] ?? '') : ''
    }
  },
  { immediate: true },
)

function selectRow(row: EntryRow) {
  selectedId.value = Number(row.id)
  errorMessage.value = ''
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '回路检查记录登记入口尚未接入审批流'
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

function saveDetail() {
  if (selectedId.value === null) {
    return
  }
  errorMessage.value = ''
  const patch: Record<string, string> = {}
  for (const field of EDITABLE_FIELDS) {
    patch[field] = detailDraft[field].trim()
  }
  const result = updateEntry(meta.key, selectedId.value, patch)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    // 选中行可能被筛选条件滤掉，明细面板回退到未选择态。
    if (selectedId.value !== null && !getEntry(meta.key, selectedId.value)) {
      selectedId.value = null
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '二次回路检查列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.circuit-layout {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}
.circuit-table {
  flex: 2;
}
.circuit-table tbody tr {
  cursor: pointer;
}
.row-selected {
  background: #eef4ff;
}
.circuit-detail {
  flex: 1;
  min-width: 280px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
}
.detail-title {
  margin: 0 0 10px;
  font-size: 15px;
}
.detail-grid {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 6px 10px;
  font-size: 13px;
  margin-bottom: 12px;
}
.detail-label {
  color: var(--muted);
}
.detail-edit {
  display: block;
  margin-bottom: 10px;
  font-size: 12px;
  color: var(--muted);
}
.detail-edit input {
  display: block;
  width: 100%;
  margin-top: 4px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
  color: #1f2937;
}
.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.muted-text {
  color: var(--muted);
  font-size: 12px;
}
</style>
