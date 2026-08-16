// 中转站 Token 消耗聚合代理
// 启动：node server/index.js
// 默认监听 3017（可用 PORT 环境变量覆盖），提供 /api/* 接口供前端调用

import express from 'express'
import cors from 'cors'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig, fetchProvider, loginProvider, providerHasAuth } from './providers.js'
import { autoDetectSelectors, hasAuthState, probeSelectors, pickSelector } from './browser.js'
import { isSafeProviderId } from './browser-session.js'
import { readCache, readLastCache, writeCache } from './store.js'
import { recordSnapshot, getHistory } from './history.js'
import {
  mergeRefreshedProviders,
  preserveFailedProviderData,
  resolveRefreshTargets,
} from './refresh-cache.js'
import { aggregate } from './aggregate.js'
import { createApiAuthMiddleware } from './api-auth.js'
import { validateConfig } from './config.js'
import { writeJsonAtomically } from './json-store.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.TOKEN_MONITOR_DATA_DIR
  ? path.resolve(process.env.TOKEN_MONITOR_DATA_DIR)
  : __dirname
fs.mkdirSync(DATA_DIR, { recursive: true })
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')
let refreshInFlight = null
const API_AUTH_TOKEN = process.env.TOKEN_MONITOR_API_TOKEN || ''

const app = express()
app.use(cors({
  origin(origin, callback) {
    const isLocalOrigin = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(origin || '')
    if (!origin || origin === 'null' || isLocalOrigin) return callback(null, true)
    return callback(new Error('CORS origin not allowed'))
  },
}))
app.use(express.json({ limit: '1mb' }))
app.use(createApiAuthMiddleware(API_AUTH_TOKEN))

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

let refreshSchedulerTimer = null
let refreshSchedulerSeconds = 0

function startRefreshScheduler() {
  const configuredSeconds = Number(loadConfig(CONFIG_PATH).refreshIntervalSec) || 300
  const seconds = Math.max(configuredSeconds, 25)
  // 间隔未变化时不重建定时器；变化时（如 PUT /api/config 后）热重载
  if (refreshSchedulerTimer && seconds === refreshSchedulerSeconds) return

  if (refreshSchedulerTimer) clearInterval(refreshSchedulerTimer)
  refreshSchedulerSeconds = seconds
  refreshSchedulerTimer = setInterval(() => {
    refreshAndStore().catch((error) => console.error('[refresh] scheduled refresh failed:', error.message))
  }, seconds * 1000)
  refreshSchedulerTimer.unref?.()
  console.log(`[refresh] background interval: ${seconds}s`)
}

// ===== 聚合统计：跨中转站汇总（实现在 aggregate.js）=====

// ===== 路由 =====
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'token-monitor', ts: Date.now() }))

// stale-while-revalidate 策略：
//   - 缓存有效 → 直接返回
//   - 缓存过期但存在旧数据 → 立即返回旧数据，同时后台触发一次刷新（不阻塞请求）
//   - 完全无缓存（首次启动）→ 同步等待首次刷新完成
// TTL 跟随配置的 refreshIntervalSec，避免轮询方在 TTL 过期后
// 每次请求都触发全量刷新（抓取需启动浏览器，代价高且易被站点限流）
app.get('/api/stats', async (req, res) => {
  const intervalSec = Number(loadConfig(CONFIG_PATH).refreshIntervalSec) || 300
  let cache = readCache(Math.max(intervalSec, 25) * 1000)
  if (!cache) {
    const stale = readLastCache()
    if (stale) {
      refreshAndStore().catch((error) => console.error('[stats] background refresh failed:', error.message))
      cache = stale
    } else {
      cache = await refreshAndStore()
    }
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
  try {
    const next = validateConfig(req.body)
    const old = loadConfig(CONFIG_PATH)
    const merged = validateConfig({
      ...next,
      providers: next.providers.map((p) => {
        const prev = old.providers?.find((o) => o.id === p.id)
        return { ...p, apiToken: p.apiToken || prev?.apiToken || '' }
      }),
    })
    writeJsonAtomically(CONFIG_PATH, merged)
    // 刷新间隔热生效：无需重启后端
    startRefreshScheduler()
    res.json({ ok: true })
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message })
  }
})

// ===== 浏览器抓取专用接口 =====
// 触发登录：打开有头浏览器，用户手动登录后保存登录态
// 支持两种调用方式：
//   1. body 传入完整 provider 配置（推荐，未保存也能用）
//   2. 仅传 id，从 config.json 查找（兼容旧调用）
app.post('/api/browser/login/:id', async (req, res) => {
  try {
    if (!isSafeProviderId(req.params.id)) return res.status(400).json({ ok: false, error: 'provider id 无效' })
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
    if (!isSafeProviderId(req.params.id)) return res.status(400).json({ ok: false, error: 'provider id 无效' })
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
    if (!isSafeProviderId(req.params.id)) return res.status(400).json({ ok: false, error: 'provider id 无效' })
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

const PORT = process.env.PORT || 3017
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[proxy] 中转站聚合服务已启动: http://localhost:${PORT}`)
  console.log(`[proxy] 配置文件路径: ${CONFIG_PATH}`)
  if (!fs.existsSync(CONFIG_PATH)) {
    console.warn(`[proxy] 未发现 config.json，将使用 mock 数据演示。可复制 config.example.json 为 config.json`)
  }
  startRefreshScheduler()
})
