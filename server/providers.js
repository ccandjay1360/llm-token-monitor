// 中转站适配器：统一各家中转站的拉取逻辑
// 支持三种类型：
//   - oneapi / newapi：通过管理 API 拉取（自部署的中转站）
//   - browser：通过 Playwright 浏览器抓取（商业中转站，无 API）
//   - mock：演示用

import fs from 'node:fs'
import {
  login as browserLogin,
  fetchViaBrowser,
  hasAuthState,
} from './browser.js'

// ===== OneAPI / NewAPI 兼容适配器 =====
async function oneApiFetch(cfg) {
  const { baseUrl, apiToken } = cfg
  const headers = {
    Authorization: `Bearer ${apiToken}`,
    'Content-Type': 'application/json',
  }
  const base = baseUrl.replace(/\/$/, '')

  const [userRes, logRes] = await Promise.allSettled([
    fetch(`${base}/api/user/self`, { headers }),
    fetch(`${base}/api/log/self?p=1&type=0&limit=100`, { headers }),
  ])

  let quota = 0
  let usedQuota = 0
  if (userRes.status === 'fulfilled' && userRes.value.ok) {
    const json = await userRes.value.json()
    if (json?.data) {
      quota = json.data.quota ?? 0
      usedQuota = json.data.used_quota ?? 0
    }
  }

  const logs = []
  if (logRes.status === 'fulfilled' && logRes.value.ok) {
    const json = await logRes.value.json()
    if (Array.isArray(json?.data)) {
      for (const item of json.data) {
        logs.push({
          time: item.created_at * 1000,
          model: item.model_name || 'unknown',
          promptTokens: item.prompt_tokens || 0,
          completionTokens: item.completion_tokens || 0,
          quota: item.quota || 0,
          cacheHit: !!(item.cache || item.cached),
          latencyMs: (item.use_time || item.latency) || null,
        })
      }
    }
  }

  return { quota, usedQuota, logs }
}

const newApiFetch = oneApiFetch

// ===== 浏览器抓取适配器 =====
// 商业中转站：用 Playwright 模拟登录态，访问数据页按选择器提取
//
// 单位换算：
//   浏览器抓取到的 balance / todayCost / models[].quota 已经是"美元值"（如 $10.29），
//   而 OneAPI 的 quota 字段单位是 QUOTA_PER_DOLLAR = 500000。
//   为保持后端字段单位统一，browser 模式在这里把美元值 × 500000 转成 OneAPI quota 单位，
//   前端统一用 quotaToUSD() 即可正确换算回美元。
//
// 返回字段：
//   quota / usedQuota       — OneAPI quota 单位（与 OneAPI logs 的 quota 字段一致）
//   balance / todayTokens / todayCost / cacheHitRate  — 浏览器原生字段（美元值 / 数字）
//   models                  — 模型分布（quota 已转为 OneAPI 单位）
//   logs                    — 浏览器模式无逐条日志
const QUOTA_PER_DOLLAR = 500000

async function browserFetch(cfg) {
  const result = await fetchViaBrowser(cfg)
  const logs = []
  // browser 抓取的 models[].quota 是美元值，统一转为 OneAPI quota 单位
  const models = (result.models || []).map((m) => ({
    ...m,
    quota: (m.quota || 0) * QUOTA_PER_DOLLAR,
  }))
  return {
    // 新字段（保留原值，单位为美元 / 数字）
    balance: result.balance || 0,
    todayTokens: result.todayTokens || 0,
    todayCost: result.todayCost || 0,
    cacheHitRate: result.cacheHitRate || 0,
    cacheInputTokens: result.cacheInputTokens || 0,
    cacheCreationTokens: result.cacheCreationTokens || 0,
    cacheReadTokens: result.cacheReadTokens || 0,
    models,
    // 兼容旧字段：美元值 × 500000 = OneAPI quota 单位
    quota: (result.balance || 0) * QUOTA_PER_DOLLAR,
    usedQuota: (result.todayCost || 0) * QUOTA_PER_DOLLAR,
    logs,
    _browserRaw: result._rawText,
    _fetchedAt: result._fetchedAt,
  }
}

// ===== Mock 适配器 =====
function mockFetch(cfg, now = Date.now()) {
  const seed = cfg.id?.length || 7
  const rand = (n) => Math.floor((Math.sin(seed * n + now / 86400000) * 0.5 + 0.5) * n)

  const models = ['gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet', 'gemini-2.0-flash', 'deepseek-chat']
  const logs = []
  for (let i = 0; i < 60; i++) {
    const model = models[i % models.length]
    logs.push({
      time: now - i * 3600 * 1000 * (1 + (i % 4)),
      model,
      promptTokens: 100 + rand(2000),
      completionTokens: 50 + rand(1500),
      quota: 100 + rand(5000),
      cacheHit: i % 5 === 0,
      latencyMs: 300 + rand(1500),
    })
  }
  return {
    quota: 50_000_000,
    usedQuota: 12_500_000,
    logs,
    _mock: true,
  }
}

const ADAPTERS = {
  oneapi: oneApiFetch,
  newapi: newApiFetch,
  browser: browserFetch,
  mock: mockFetch,
}

export async function fetchProvider(cfg) {
  const adapter = ADAPTERS[cfg.type] || mockFetch
  try {
    const result = await adapter(cfg)
    return { ok: true, data: result, fetchedAt: Date.now() }
  } catch (err) {
    // 浏览器抓取失败时（如登录态过期）保留错误信息，不回退到 mock
    // 这样前端能正确显示"登录态失效"
    return {
      ok: false,
      error: err.message,
      data: { quota: 0, usedQuota: 0, logs: [] },
      fetchedAt: Date.now(),
    }
  }
}

export async function loginProvider(cfg) {
  if (cfg.type !== 'browser') {
    throw new Error('仅 browser 类型支持登录流程')
  }
  return browserLogin(cfg)
}

export function providerHasAuth(cfg) {
  if (cfg.type !== 'browser') return true
  return hasAuthState(cfg.id)
}

export function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return { refreshIntervalSec: 300, providers: [] }
  }
  const raw = fs.readFileSync(configPath, 'utf-8')
  const cfg = JSON.parse(raw)
  for (const p of cfg.providers || []) {
    const envKey = `PROVIDER_${p.id.toUpperCase().replace(/-/g, '_')}_TOKEN`
    if (process.env[envKey]) p.apiToken = process.env[envKey]
  }
  return cfg
}
