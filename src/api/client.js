// 前端 API 客户端：统一封装对后端代理的调用

const desktopApi = window.tokenMonitor?.api
const BASE = desktopApi?.baseUrl || (window.location.protocol === 'file:'
  ? 'http://127.0.0.1:3002/api'
  : '/api')

function withApiAuth(options = {}) {
  return {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(desktopApi?.token ? { 'x-token-monitor-auth': desktopApi.token } : {}),
      ...options.headers,
    },
  }
}

async function request(pathname, options = {}) {
  const res = await fetch(`${BASE}${pathname}`, withApiAuth(options))
  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.clone().json()
      detail = body?.error ? `：${body.error}` : ''
    } catch {
      // 非 JSON 响应保留状态码信息
    }
    throw new Error(`API ${pathname} 失败: ${res.status} ${res.statusText}${detail}`)
  }
  return res.json()
}

// 拉取聚合统计（含 summary / modelBreakdown / dailyTrend / providers / recentLogs）
export const fetchStats = (providerId = 'all') => {
  const query = providerId && providerId !== 'all'
    ? `?providerId=${encodeURIComponent(providerId)}`
    : ''
  return request(`/stats${query}`)
}

// 拉取历史趋势数据（默认 30 天）
// 返回：{ days, history: [{ date, providers: { [id]: snapshot } }] }
export const fetchHistory = (days = 30) =>
  request(`/history?days=${days}`)

// 触发主动刷新（重新拉取中转站数据）
export const triggerRefresh = (providerId = 'all') =>
  request(providerId && providerId !== 'all'
    ? `/refresh?providerId=${encodeURIComponent(providerId)}`
    : '/refresh', { method: 'POST' }).then(() => fetchStats(providerId))

// 读取后端配置（脱敏，无 token 原文）
export const fetchConfig = () => request('/config')

// 更新后端配置
export const saveConfig = (config) =>
  request('/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  })

// 触发浏览器登录流程（会打开有头浏览器让用户手动登录）
// 注意：此接口可能阻塞较长时间（用户手动操作），需设置较长超时
// provider 完整配置作为 body 传入，避免依赖 config.json 中已保存的内容
export function triggerBrowserLogin(provider) {
  const id = encodeURIComponent(provider.id)
  return fetch(`${BASE}/browser/login/${id}`, withApiAuth({
    method: 'POST',
    body: JSON.stringify({ provider }),
  })).then((r) => r.json())
}

// 探测选择器（不保存配置，仅返回当前选择器抓到的文本，用于调试）
// provider 完整配置传入，dataUrl/selectors 可在 body 中覆盖（已由调用方填充）
export function probeBrowserSelectors(provider) {
  const id = encodeURIComponent(provider.id)
  return fetch(`${BASE}/browser/probe/${id}`, withApiAuth({
    method: 'POST',
    body: JSON.stringify({
      provider,
      dataUrl: provider.dataUrl,
      selectors: provider.selectors,
      waitMs: provider.waitMs,
    }),
  })).then((r) => r.json())
}

// 自动识别数据页中的标量字段和模型表选择器
export function autoDetectBrowserSelectors(provider) {
  const id = encodeURIComponent(provider.id)
  return request(`/browser/auto-detect/${id}`, {
    method: 'POST',
    body: JSON.stringify({
      provider: {
        id: provider.id,
        type: provider.type,
        dataUrl: provider.dataUrl,
        waitMs: provider.waitMs,
      },
    }),
  })
}

// 可视化拾取选择器（打开有头浏览器，用户点击目标元素后返回 CSS 选择器）
// fieldKey 决定拾取模式：'modelTable' 时拾取整个 <table>
export function pickBrowserSelector(provider, fieldKey) {
  const id = encodeURIComponent(provider.id)
  return fetch(`${BASE}/browser/pick/${id}`, withApiAuth({
    method: 'POST',
    body: JSON.stringify({
      provider,
      dataUrl: provider.dataUrl,
      waitMs: provider.waitMs,
      fieldKey,
    }),
  })).then((r) => r.json())
}

// ===== 单位换算 =====
// OneAPI / NewAPI 默认 quota 单位 = 500000 = $1
// 这里提供换算工具，前端展示统一用美元（$）作为成本单位
export const QUOTA_PER_DOLLAR = 500000

export function quotaToUSD(quota) {
  if (!quota) return 0
  return quota / QUOTA_PER_DOLLAR
}

// Token 数格式化（K / M）
export function formatTokens(n) {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

// 美元格式化
export function formatUSD(usd) {
  if (usd >= 1000) return `$${(usd / 1000).toFixed(2)}K`
  if (usd >= 1) return `$${usd.toFixed(2)}`
  return `$${usd.toFixed(4)}`
}
