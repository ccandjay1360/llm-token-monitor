// 聚合统计：跨中转站汇总
// 从 index.js 抽出为纯函数模块，便于单元测试
// 同时支持 OneAPI（有 logs）和 browser（有 models 数组）两种数据源

import { calculateWeightedCacheHitRate } from './cache-metrics.js'
import { dateKeyInTimezone } from './usage-date.js'

export function aggregate(cacheData, requestedProviderId = '') {
  const availableProviders = cacheData?.providers || []
  // 范围选择：
  //   - 未指定 providerId：汇总全部
  //   - 指定且命中：仅汇总该站
  //   - 指定但未命中（已被禁用/删除）：返回空集而不是静默回退全部，
  //     否则前端停留在已失效的单站 tab 时会无提示地看到"全部合计"数据
  const selectedProvider = requestedProviderId
    ? availableProviders.find((p) => p.id === requestedProviderId)
    : undefined
  const providers = requestedProviderId
    ? (selectedProvider ? [selectedProvider] : [])
    : availableProviders
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
    const key = dateKeyInTimezone(d, 'Asia/Shanghai')
    dayMap.set(key, { date: key, promptTokens: 0, completionTokens: 0, quota: 0, calls: 0 })
  }
  for (const l of allLogs) {
    const key = dateKeyInTimezone(new Date(l.time), 'Asia/Shanghai')
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
      providerId: selectedProvider?.id || requestedProviderId || 'all',
      providerName: selectedProvider?.name || (requestedProviderId ? requestedProviderId : '全部中转站'),
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
