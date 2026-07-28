// 中转站 Token 消耗聚合代理
// 启动：node server/index.js
// 默认监听 3002，提供 /api/* 接口供前端调用

import express from 'express'
import cors from 'cors'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig, fetchProvider, loginProvider, providerHasAuth } from './providers.js'
import { autoDetectSelectors, hasAuthState, probeSelectors, pickSelector } from './browser.js'
import { readCache, readLastCache, writeCache } from './store.js'
import { recordSnapshot, getHistory } from './history.js'
import {
  mergeRefreshedProviders,
  preserveFailedProviderData,
  resolveRefreshTargets,
} from './refresh-cache.js'
import { calculateWeightedCacheHitRate } from './cache-metrics.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.TOKEN_MONITOR_DATA_DIR
  ? path.resolve(process.env.TOKEN_MONITOR_DATA_DIR)
  : __dirname
fs.mkdirSync(DATA_DIR, { recursive: true })
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')
let refreshInFlight = null

const app = express()
app.use(cors({
  origin(origin, callback) {
    const isLocalOrigin = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(origin || '')
    if (!origin || origin === 'null' || isLocalOrigin) return callback(null, true)
    return callback(new Error('CORS origin not allowed'))
  },
}))
app.use(express.json())

// ===== 触发刷新：并行拉取所有启用的中转站 =====
async function refresh(requestedProviderId = '') {
  const cfg = loadConfig(CONFIG_PATH)
  const enabled = (cfg.providers || []).filter((p) => p.enabled !== false)
  const targets = resolveRefreshTargets(enabled, requestedProviderId)

  const results = await Promise.all(
    targets.map(async (p) => {
      const res = await fetchProvider(p)
      return {
        id: p.id,
        name: p.name,
        type: p.type,
        baseUrl: p.baseUrl,
        ...res,
        stale: false,
        ...(res.ok ? { lastSuccessfulFetch: res.fetchedAt } : {}),
      }
    })
  )

  // 若完全没有配置，回退到 mock
  if (results.length === 0) {
    const mockCfg = [
      { id: 'mock-east', name: '示例站点A（华东）', type: 'mock', baseUrl: '' },
      { id: 'mock-west', name: '示例站点B（美西）', type: 'mock', baseUrl: '' },
      { id: 'mock-backup', name: '示例站点C（备用）', type: 'mock', baseUrl: '' },
    ]
    const mockResults = await Promise.all(
      mockCfg.map(async (p) => ({ id: p.id, name: p.name, type: p.type, baseUrl: '', ...(await fetchProvider(p)) }))
    )
    return { providers: mockResults, isMock: true, fetchedAt: Date.now() }
  }

  return { providers: results, isMock: false, fetchedAt: Date.now() }
}

async function refreshAndStore(requestedProviderId = '') {
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    const refreshed = await refresh(requestedProviderId)
    const previous = readLastCache()
    const safeProviders = preserveFailedProviderData(refreshed.providers, previous?.providers)
    const cache = requestedProviderId
      ? { ...refreshed, providers: mergeRefreshedProviders(previous?.providers, safeProviders) }
      : { ...refreshed, providers: safeProviders }

    writeCache(cache)
    try { recordSnapshot(cache.providers) } catch (error) { console.error('[history] record failed:', error.message) }
    return cache
  })().finally(() => {
    refreshInFlight = null
  })

  return refreshInFlight
}

function startRefreshScheduler() {
  const configuredSeconds = Number(loadConfig(CONFIG_PATH).refreshIntervalSec) || 300
  const intervalMs = Math.max(configuredSeconds, 25) * 1000
  const timer = setInterval(() => {
    refreshAndStore().catch((error) => console.error('[refresh] scheduled refresh failed:', error.message))
  }, intervalMs)
  timer.unref?.()
  console.log(`[refresh] background interval: ${intervalMs / 1000}s`)
}

// ===== 聚合统计：跨中转站汇总 =====
// 同时支持 OneAPI（有 logs）和 browser（有 models 数组）两种数据源
function aggregate(cacheData, requestedProviderId = '') {
  const availableProviders = cacheData?.providers || []
  const selectedProvider = availableProviders.find((p) => p.id === requestedProviderId)
  const providers = selectedProvider ? [selectedProvider] : availableProviders
  const allLogs = providers.flatMap((p) =>
    (p.data?.logs || []).map((l) => ({ ...l, providerId: p.id, providerName: p.name }))
  )

  const totalPrompt = allLogs.reduce((s, l) => s + l.promptTokens, 0)
  const totalCompletion = allLogs.reduce((s, l) => s + l.completionTokens, 0)
  const totalQuota = allLogs.reduce((s, l) => s + l.quota, 0)
  const cachedCount = allLogs.filter((l) => l.cacheHit).length
  const totalQuotaRemaining = providers.reduce((s, p) => s + (p.data?.quota || 0), 0)
  const totalUsedQuota = providers.reduce((s, p) => s + (p.data?.usedQuota || 0), 0)

  // browser 类型的模型表合计（modelTable 解析得到的 models 数组）
  // modelTable 反映的是 dashboard 当前展示的数据（多数为今日数据），
  // 用于补齐 summary 的 totals，避免 browser 站点顶部 KPI 卡全为 0
  const browserModelStats = providers.reduce(
    (acc, p) => {
      const models = p.data?.models || []
      for (const m of models) {
        acc.calls += m.calls || 0
        acc.promptTokens += m.promptTokens || 0
        acc.completionTokens += m.completionTokens || 0
        acc.quota += m.quota || 0
      }
      return acc
    },
    { calls: 0, promptTokens: 0, completionTokens: 0, quota: 0 }
  )

  // browser 类型的标量聚合：今日 Token / 今日消费 / 缓存命中率
  // 注意：今日字段直接取页面抓到的值，不要用 modelTable 合计回退
  // modelTable 通常反映"累计"或"当前展示的时段"，不一定是今日数据
  const todayTokens = providers.reduce((s, p) => s + (p.data?.todayTokens || 0), 0)
  const todayCost = providers.reduce((s, p) => s + (p.data?.todayCost || 0), 0)
  // 缓存命中率：browser 类型有 cacheHitRate 字段（0-100），其他类型从 logs 算
  const browserProviders = providers.filter((p) => p.type === 'browser' && p.data?.cacheHitRate != null)
  let cacheHitRate = 0
  const weightedCacheHitRate = calculateWeightedCacheHitRate(browserProviders.map((provider) => provider.data))
  if (weightedCacheHitRate != null) {
    cacheHitRate = weightedCacheHitRate
  } else if (browserProviders.length > 0) {
    // 缺少缓存 Token 明细的站点，兼容旧缓存时使用简单平均。
    cacheHitRate = browserProviders.reduce((s, p) => s + (p.data.cacheHitRate || 0), 0) / browserProviders.length
  } else if (allLogs.length > 0) {
    // 日志型：命中次数 / 总次数
    cacheHitRate = (cachedCount / allLogs.length) * 100
  }

  // 模型分布：合并两个来源
  // 1. OneAPI：从 logs 聚合
  // 2. browser：直接读 data.models 数组
  const modelMap = new Map()
  for (const l of allLogs) {
    const cur = modelMap.get(l.model) || { model: l.model, calls: 0, promptTokens: 0, completionTokens: 0, quota: 0 }
    cur.calls += 1
    cur.promptTokens += l.promptTokens
    cur.completionTokens += l.completionTokens
    cur.quota += l.quota
    modelMap.set(l.model, cur)
  }
  // 合并 browser 抓取的 models 数组（来自 modelTable 解析）
  for (const p of providers) {
    const models = p.data?.models || []
    for (const m of models) {
      if (!m.model) continue
      const cur = modelMap.get(m.model) || { model: m.model, calls: 0, promptTokens: 0, completionTokens: 0, quota: 0 }
      cur.calls += m.calls || 0
      cur.promptTokens += m.promptTokens || 0
      cur.completionTokens += m.completionTokens || 0
      cur.quota += m.quota || 0
      modelMap.set(m.model, cur)
    }
  }

  // 时间趋势：按日聚合最近 14 天（browser 类型无逐条 log，趋势为 0）
  const dayMap = new Map()
  const now = new Date()
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    dayMap.set(key, { date: key, promptTokens: 0, completionTokens: 0, quota: 0, calls: 0 })
  }
  for (const l of allLogs) {
    const key = new Date(l.time).toISOString().slice(0, 10)
    if (dayMap.has(key)) {
      const cur = dayMap.get(key)
      cur.promptTokens += l.promptTokens
      cur.completionTokens += l.completionTokens
      cur.quota += l.quota
      cur.calls += 1
    }
  }

  // 各中转站健康度
  const providerHealth = providers.map((p) => {
    const logs = p.data?.logs || []
    const latencies = logs.map((l) => l.latencyMs).filter(Boolean)
    const avgLatency = latencies.length ? latencies.reduce((s, x) => s + x, 0) / latencies.length : null
    return {
      id: p.id,
      name: p.name,
      type: p.type,
      ok: p.ok,
      error: p.error,
      stale: !!p.stale,
      lastSuccessfulFetch: p.lastSuccessfulFetch || p.fetchedAt,
      isMock: !!p.data?._mock,
      isBrowser: p.type === 'browser',
      browserRaw: p.data?._browserRaw,
      // 余额、已用等字段（OneAPI 与 browser 都会填充）
      quota: p.data?.quota || 0,
      usedQuota: p.data?.usedQuota || 0,
      // browser 新字段
      balance: p.data?.balance || 0,
      todayTokens: p.data?.todayTokens || 0,
      todayCost: p.data?.todayCost || 0,
      cacheHitRate: p.data?.cacheHitRate || 0,
      cacheInputTokens: p.data?.cacheInputTokens || 0,
      cacheCreationTokens: p.data?.cacheCreationTokens || 0,
      cacheReadTokens: p.data?.cacheReadTokens || 0,
      modelCount: (p.data?.models || []).length,
      calls: logs.length,
      avgLatencyMs: avgLatency,
      lastFetch: p.fetchedAt,
    }
  })

  return {
    scope: {
      providerId: selectedProvider?.id || 'all',
      providerName: selectedProvider?.name || '全部中转站',
    },
    availableProviders: availableProviders.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      ok: p.ok,
    })),
    summary: {
      // 总调用：OneAPI logs 条数 + browser 模型表 calls 合计
      totalCalls: allLogs.length + browserModelStats.calls,
      // Token 总数：OneAPI logs 合计 + browser 模型表 token 合计
      totalPromptTokens: totalPrompt + browserModelStats.promptTokens,
      totalCompletionTokens: totalCompletion + browserModelStats.completionTokens,
      totalTokens: totalPrompt + totalCompletion + browserModelStats.promptTokens + browserModelStats.completionTokens,
      // 总成本：OneAPI logs quota 合计 + browser 模型表 quota 合计
      totalQuota: totalQuota + browserModelStats.quota,
      totalQuotaRemaining,
      totalUsedQuota,
      // 跨中转站汇总的"今日"指标（browser 类型贡献，OneAPI 无此字段时为 0）
      todayTokens,
      todayCost,
      cacheHitRate,
      cacheHitRateMode: weightedCacheHitRate != null ? 'weighted' : 'average',
      hasStaleProviders: providers.some((provider) => provider.stale),
      lastSuccessfulFetch: providers.reduce(
        (latest, provider) => Math.max(latest, Number(provider.lastSuccessfulFetch || provider.fetchedAt) || 0),
        0,
      ),
      providerCount: providers.length,
      isMock: cacheData?.isMock,
      fetchedAt: cacheData?.fetchedAt,
    },
    modelBreakdown: Array.from(modelMap.values()).sort((a, b) => b.quota - a.quota),
    dailyTrend: Array.from(dayMap.values()),
    providers: providerHealth,
    recentLogs: allLogs
      .sort((a, b) => b.time - a.time)
      .slice(0, 50)
      .map((l) => ({
        time: l.time,
        model: l.model,
        providerName: l.providerName,
        promptTokens: l.promptTokens,
        completionTokens: l.completionTokens,
        quota: l.quota,
        cacheHit: l.cacheHit,
        latencyMs: l.latencyMs,
      })),
  }
}

// ===== 路由 =====
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }))

app.get('/api/stats', async (req, res) => {
  let cache = readCache()
  if (!cache) {
    cache = await refreshAndStore()
  }
  res.json(aggregate(cache, req.query.providerId))
})

app.post('/api/refresh', async (req, res) => {
  try {
    const providerId = String(req.query.providerId || '')
    const cache = await refreshAndStore(providerId)
    res.json({ ok: true, fetchedAt: cache.fetchedAt, isMock: cache.isMock })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// 历史趋势：返回最近 N 天的每日快照（默认 30 天）
// 用于 Dashboard 上的 Token 使用趋势线图
app.get('/api/history', (req, res) => {
  const days = Math.min(parseInt(req.query.days, 10) || 30, 90)
  res.json({ days, history: getHistory(days) })
})

app.get('/api/config', (_req, res) => {
  const cfg = loadConfig(CONFIG_PATH)
  // 脱敏：不返回 token 原文
  const safe = {
    refreshIntervalSec: cfg.refreshIntervalSec,
    providers: (cfg.providers || []).map((p) => {
      const base = {
        id: p.id,
        name: p.name,
        type: p.type,
        baseUrl: p.baseUrl,
        enabled: p.enabled !== false,
        hasToken: !!p.apiToken,
      }
      if (p.type === 'browser') {
        base.loginUrl = p.loginUrl || ''
        base.loginWaitUrl = p.loginWaitUrl || ''
        base.dataUrl = p.dataUrl || ''
        base.selectors = p.selectors || {}
        base.hasAuth = providerHasAuth(p)
      }
      return base
    }),
  }
  res.json(safe)
})

app.put('/api/config', (req, res) => {
  const next = req.body
  // 简单字段校验
  if (!next || !Array.isArray(next.providers)) {
    return res.status(400).json({ ok: false, error: 'invalid payload' })
  }
  // 合并保留已有 token（前端不回传 token 明文）
  const old = loadConfig(CONFIG_PATH)
  const merged = {
    refreshIntervalSec: next.refreshIntervalSec || 300,
    providers: next.providers.map((p) => {
      const prev = old.providers?.find((o) => o.id === p.id)
      return { ...p, apiToken: p.apiToken || prev?.apiToken || '' }
    }),
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2))
  res.json({ ok: true })
})

// ===== 浏览器抓取专用接口 =====
// 触发登录：打开有头浏览器，用户手动登录后保存登录态
// 支持两种调用方式：
//   1. body 传入完整 provider 配置（推荐，未保存也能用）
//   2. 仅传 id，从 config.json 查找（兼容旧调用）
app.post('/api/browser/login/:id', async (req, res) => {
  try {
    let p = req.body?.provider
    if (!p || p.id !== req.params.id) {
      // 回退：从 config.json 查找
      const cfg = loadConfig(CONFIG_PATH)
      p = (cfg.providers || []).find((x) => x.id === req.params.id)
    }
    if (!p) return res.status(404).json({ ok: false, error: 'provider not found' })
    if (p.type !== 'browser') return res.status(400).json({ ok: false, error: '仅 browser 类型支持登录' })

    const result = await loginProvider(p)
    res.json({ ok: true, ...result })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// 选择器自检：给定 dataUrl + 登录态 + 选择器，返回每个字段实际抓到的文本
// 同样支持 body 传入完整 provider 配置
app.post('/api/browser/probe/:id', async (req, res) => {
  try {
    let p = req.body?.provider
    if (!p || p.id !== req.params.id) {
      const cfg = loadConfig(CONFIG_PATH)
      p = (cfg.providers || []).find((x) => x.id === req.params.id)
    }
    if (!p) return res.status(404).json({ ok: false, error: 'provider not found' })

    // body 中的 dataUrl/selectors/waitMs 覆盖 provider 配置（用于调试）
    const probeCfg = {
      ...p,
      dataUrl: req.body?.dataUrl || p.dataUrl,
      selectors: req.body?.selectors || p.selectors || {},
      waitMs: req.body?.waitMs ?? p.waitMs ?? 3000,
    }
    const result = await probeSelectors(probeCfg)
    res.json({ ok: true, result })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// 自动识别页面中的余额、今日用量和模型表选择器
app.post('/api/browser/auto-detect/:id', async (req, res) => {
  try {
    const cfg = loadConfig(CONFIG_PATH)
    const id = req.params.id
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      return res.status(400).json({ ok: false, error: 'provider id 无效' })
    }

    const savedProvider = (cfg.providers || []).find((x) => x.id === id)
    const requestProvider = req.body?.provider
    const p = savedProvider || (requestProvider?.id === id ? requestProvider : null)
    if (!p) return res.status(404).json({ ok: false, error: 'provider not found' })
    if (p.type !== 'browser') return res.status(400).json({ ok: false, error: '仅支持浏览器抓取中转站' })
    if (!hasAuthState(id)) return res.status(400).json({ ok: false, error: '请先登录并保存登录态' })

    const dataUrl = new URL(p.dataUrl)
    if (!['http:', 'https:'].includes(dataUrl.protocol)) {
      return res.status(400).json({ ok: false, error: 'dataUrl 仅支持 http(s)' })
    }

    const detectCfg = {
      id,
      dataUrl: dataUrl.toString(),
      waitMs: Math.min(Math.max(Number(p.waitMs) || 3000, 0), 15_000),
    }
    const result = await autoDetectSelectors(detectCfg)
    res.json({ ok: true, result })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// 可视化选择器拾取：打开有头浏览器，用户点击目标元素后返回 CSS 选择器
// fieldKey 决定拾取模式：'modelTable' 时拾取整个 <table>
app.post('/api/browser/pick/:id', async (req, res) => {
  try {
    let p = req.body?.provider
    if (!p || p.id !== req.params.id) {
      const cfg = loadConfig(CONFIG_PATH)
      p = (cfg.providers || []).find((x) => x.id === req.params.id)
    }
    if (!p) return res.status(404).json({ ok: false, error: 'provider not found' })

    const pickCfg = {
      ...p,
      dataUrl: req.body?.dataUrl || p.dataUrl,
      waitMs: req.body?.waitMs ?? p.waitMs ?? 3000,
    }
    const fieldKey = req.body?.fieldKey || ''
    const result = await pickSelector(pickCfg, fieldKey)
    res.json({ ok: true, result })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

const PORT = process.env.PORT || 3002
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[proxy] 中转站聚合服务已启动: http://localhost:${PORT}`)
  console.log(`[proxy] 配置文件路径: ${CONFIG_PATH}`)
  if (!fs.existsSync(CONFIG_PATH)) {
    console.warn(`[proxy] 未发现 config.json，将使用 mock 数据演示。可复制 config.example.json 为 config.json`)
  }
  startRefreshScheduler()
})
