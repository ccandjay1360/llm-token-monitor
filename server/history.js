// 历史数据存储：每次 refresh 后记录各中转站的标量快照
// 用于前端绘制 Token 使用趋势线
//
// 存储格式（按日聚合，避免文件无限增长）：
//   {
//     [date]: {
//       [providerId]: { todayTokens, todayCost, balance, ts }
//     }
//   }
//
// 历史保留 90 天，超出自动清理

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDailyDateRange } from './usage-date.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.TOKEN_MONITOR_DATA_DIR
  ? path.resolve(process.env.TOKEN_MONITOR_DATA_DIR)
  : __dirname
fs.mkdirSync(DATA_DIR, { recursive: true })
const HISTORY_PATH = path.join(DATA_DIR, 'history.json')
const MAX_DAYS = 90
const TIMEZONE = 'Asia/Shanghai'

function dateKey(date) {
  return getDailyDateRange(date, TIMEZONE).startDate
}

function loadHistory() {
  if (!fs.existsSync(HISTORY_PATH)) return {}
  try {
    return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2))
}

// 写入一次快照：在 refresh 完成后调用
// providers: refresh() 返回的 providers 数组
export function recordSnapshot(providers) {
  if (!Array.isArray(providers)) return
  const history = loadHistory()
  const today = dateKey(new Date())

  if (!history[today]) history[today] = {}

  const ts = Date.now()
  for (const p of providers) {
    if (!p?.id || !p?.data) continue
    // 同一天多次刷新：保留最新的一次
    history[today][p.id] = {
      todayTokens: p.data.todayTokens || 0,
      todayCost: p.data.todayCost || 0,
      balance: p.data.balance || p.data.quota || 0,
      cacheHitRate: p.data.cacheHitRate || 0,
      name: p.name,
      type: p.type,
      ts,
    }
  }

  // 清理超过 MAX_DAYS 的旧数据
  const cutoff = new Date(Date.now() - MAX_DAYS * 24 * 60 * 60 * 1000)
  const cutoffStr = dateKey(cutoff)
  for (const date of Object.keys(history)) {
    if (date < cutoffStr) delete history[date]
  }

  saveHistory(history)
}

// 查询历史趋势
// 返回：[{ date, providers: { [id]: snapshot } }]
// 默认返回最近 30 天
export function getHistory(days = 30) {
  const history = loadHistory()
  const result = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
    const key = dateKey(d)
    result.push({
      date: key,
      providers: history[key] || {},
    })
  }
  return result
}
