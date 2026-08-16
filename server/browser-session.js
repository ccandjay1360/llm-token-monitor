function normalizePathname(pathname) {
  const normalized = pathname.replace(/\/+$/, '')
  return normalized || '/'
}

export function isSafeProviderId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id)
}

export function assertSafeProviderId(id) {
  if (!isSafeProviderId(id)) throw new Error('provider id 无效')
  return id
}

export function assertBrowserUrl(value, fieldName = 'URL') {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${fieldName} 无效`)
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${fieldName} 仅支持 http(s)`)
  }
  return url.toString()
}

export function isAuthHttpStatus(status) {
  return status === 401 || status === 403
}

function isAuthenticationPage(currentUrl, loginUrl = '') {
  try {
    const current = new URL(currentUrl)
    if (/\/(?:login|sign-in|signin)(?:\/|$)/i.test(current.pathname)) return true
    if (!loginUrl) return false

    const login = new URL(loginUrl)
    return current.origin === login.origin
      && normalizePathname(current.pathname) === normalizePathname(login.pathname)
  } catch {
    return false
  }
}

export function getBrowserSessionError({
  currentUrl,
  loginUrl = '',
  attemptedFields = 0,
  matchedFields = 0,
  hasUsageMetrics = false,
  hasAuthError = false,
}) {
  if (hasAuthError || isAuthenticationPage(currentUrl, loginUrl)) {
    return '登录态已失效，请重新登录'
  }
  if (attemptedFields === 0 && !hasUsageMetrics) {
    return '未配置可读取的数据字段，请先完成自动识别或手动拾取'
  }
  if (attemptedFields > 0 && matchedFields === 0 && !hasUsageMetrics) {
    return '页面未匹配到任何数据，登录态可能已失效或页面结构已变更'
  }
  return ''
}

// 页面导航后的重定向检测：仅判断是否被带到登录页。
// 专用于 goto 之后、字段抓取之前的检查，不要用 getBrowserSessionError 代替——
// 后者的 attemptedFields/hasUsageMetrics 默认为 0/false，会在字段抓取前
// 误报「未配置可读取的数据字段」。
export function getLoginRedirectError(currentUrl, loginUrl = '') {
  return isAuthenticationPage(currentUrl, loginUrl) ? '登录态已失效，请重新登录' : ''
}
