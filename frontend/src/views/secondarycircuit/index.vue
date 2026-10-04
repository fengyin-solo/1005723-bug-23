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
            <button class="link" type="button" @click="openDetail(row)">回路明细</button>
            <button
              v-for="action in availableActions(String(row.status))"
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
          <td :colspan="columns.length + 2" class="empty-state">暂无二次回路检查数据，可先登记回路检查记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条二次回路检查记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="selected" class="detail-mask" @click.self="closeDetail"></div>
    <aside v-if="selected" class="detail-panel">
      <header class="detail-head">
        <h3>回路明细 · {{ selected['检查编号'] }}</h3>
        <button class="btn ghost" type="button" @click="closeDetail">返回检查列表</button>
      </header>
      <p class="detail-status">当前状态：<strong>{{ selected.status }}</strong></p>

      <dl class="detail-grid">
        <div v-for="field in readonlyFields" :key="field" class="detail-item">
          <dt>{{ field }}</dt>
          <dd>{{ selected[field] || '—' }}</dd>
        </div>
      </dl>

      <div class="detail-edit">
        <label class="filter-item">
          <span>端子排编号</span>
          <input v-model="detailForm['端子排编号']" placeholder="登记端子排编号" />
        </label>
        <label class="filter-item">
          <span>绝缘电阻（MΩ）</span>
          <input v-model="detailForm['绝缘电阻']" placeholder="登记绝缘电阻，沿用回路列表口径" />
        </label>
        <button class="btn primary" type="button" @click="saveDetail">保存明细</button>
      </div>
      <p v-if="detailMessage" class="detail-note" :class="{ 'error-text': !detailSaved }">{{ detailMessage }}</p>

      <div class="detail-actions">
        <button
          v-for="action in availableActions(String(selected.status))"
          :key="action"
          class="btn"
          type="button"
          @click="runAction(action, selected)"
        >
          {{ action }}
        </button>
      </div>
      <p class="detail-tip">状态只沿 待检查 → 检查中 → 检查合格 / 需整改 推进；需整改后须重新提交检查才能再判合格。</p>
    </aside>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  updateCircuitFields,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('secondarycircuit')
const columns = ['检查编号', '所属间隔', '回路类别', '端子排编号', '绝缘电阻', '检查人', '检查日期', '回路状态']
const actions = ['提交检查', '判定合格', '提出整改']
const statuses = ['待检查', '检查中', '检查合格', '需整改']
const stats = [{ label: '待检查回路', value: 0 }, { label: '检查合格回路', value: 0 }, { label: '需整改回路', value: 0 }]
// 明细里只有这两项可登记，其余字段沿用既有回路数据只读展示。
const editableFields = ['端子排编号', '绝缘电阻']
const readonlyFields = columns.filter((field) => !editableFields.includes(field))

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const selectedId = ref<number | null>(null)
const detailForm = reactive<{ '端子排编号': string; '绝缘电阻': string }>({
  '端子排编号': '',
  '绝缘电阻': '',
})
const detailMessage = ref('')
const detailSaved = ref(false)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 明细始终从列表同一份数据里取，保存后立即重载，退回列表看到的就是最新端子排编号与绝缘电阻。
const selected = computed<EntryRow | null>(() =>
  selectedId.value === null
    ? null
    : rows.value.find((row) => Number(row.id) === selectedId.value) ?? null,
)

// 只放出当前状态允许的动作：越级/回退的动作在界面上也不出现，强行调用同样会被服务层拒收。
function availableActions(status: string): string[] {
  return actions.filter((action) =>
    (meta.actionAllowedFrom?.[action] ?? []).includes(status),
  )
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

function openDetail(row: EntryRow) {
  selectedId.value = Number(row.id)
  detailForm['端子排编号'] = String(row['端子排编号'] ?? '')
  detailForm['绝缘电阻'] = String(row['绝缘电阻'] ?? '')
  detailMessage.value = ''
}

function closeDetail() {
  selectedId.value = null
  detailMessage.value = ''
}

function saveDetail() {
  if (selectedId.value === null) {
    return
  }
  const result = updateCircuitFields(selectedId.value, { ...detailForm })
  detailSaved.value = result.ok
  detailMessage.value = result.message
  if (result.ok) {
    reload()
  }
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  detailMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    if (selectedId.value === Number(row.id)) {
      detailSaved.value = false
      detailMessage.value = result.message
    }
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
    // 明细面板打开时，用刷新后的同一条记录回填表单，保证两处绝缘电阻一致。
    if (selectedId.value !== null) {
      const latest = payload.items.find((row) => Number(row.id) === selectedId.value)
      if (latest) {
        detailForm['端子排编号'] = String(latest['端子排编号'] ?? '')
        detailForm['绝缘电阻'] = String(latest['绝缘电阻'] ?? '')
      }
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '二次回路检查列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.detail-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.35);
  z-index: 10;
}
.detail-panel {
  position: fixed;
  top: 0;
  right: 0;
  width: 420px;
  max-width: 92vw;
  height: 100vh;
  overflow-y: auto;
  background: #fff;
  border-left: 1px solid var(--border);
  padding: 16px 18px;
  z-index: 11;
  box-shadow: -8px 0 24px rgba(15, 23, 42, 0.12);
}
.detail-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.detail-head h3 { margin: 0; font-size: 16px; }
.detail-status { font-size: 13px; color: var(--muted); }
.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 14px;
  margin: 8px 0 14px;
}
.detail-item dt { font-size: 12px; color: var(--muted); }
.detail-item dd { margin: 2px 0 0; font-size: 13px; word-break: break-all; }
.detail-edit {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
.detail-note { font-size: 12px; color: #157347; margin: 8px 0 0; }
.detail-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.detail-tip { font-size: 12px; color: var(--muted); margin-top: 12px; }
</style>
