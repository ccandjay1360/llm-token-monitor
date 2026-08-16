import assert from 'node:assert/strict'
import {
  assertBrowserUrl,
  assertSafeProviderId,
  getBrowserSessionError,
  getLoginRedirectError,
  isAuthHttpStatus,
  isSafeProviderId,
} from './browser-session.js'

assert.equal(isSafeProviderId('provider-123_demo'), true)
assert.equal(isSafeProviderId('../config'), false)
assert.equal(isSafeProviderId(''), false)
assert.equal(assertSafeProviderId('provider-1'), 'provider-1')
assert.throws(() => assertSafeProviderId('../config'), /provider id 无效/)

assert.equal(assertBrowserUrl('https://example.com/path'), 'https://example.com/path')
assert.throws(() => assertBrowserUrl('file:///secret.json', 'dataUrl'), /dataUrl 仅支持 http\(s\)/)
assert.equal(isAuthHttpStatus(401), true)
assert.equal(isAuthHttpStatus(403), true)
assert.equal(isAuthHttpStatus(500), false)

assert.equal(
  getBrowserSessionError({
    currentUrl: 'https://wawapi.top/login?redirect=%2Fconsole',
    loginUrl: 'https://wawapi.top/login',
    attemptedFields: 4,
    matchedFields: 0,
    hasUsageMetrics: false,
  }),
  '登录态已失效，请重新登录',
)

assert.equal(
  getBrowserSessionError({
    currentUrl: 'https://wawapi.top/console',
    loginUrl: 'https://wawapi.top/login',
    attemptedFields: 4,
    matchedFields: 0,
    hasUsageMetrics: false,
  }),
  '页面未匹配到任何数据，登录态可能已失效或页面结构已变更',
)

assert.equal(
  getBrowserSessionError({
    currentUrl: 'https://wawapi.top/console',
    loginUrl: 'https://wawapi.top/login',
    attemptedFields: 4,
    matchedFields: 1,
    hasUsageMetrics: false,
  }),
  '',
)

assert.equal(
  getBrowserSessionError({
    currentUrl: 'https://wawapi.top/console',
    loginUrl: 'https://wawapi.top/login',
    attemptedFields: 4,
    matchedFields: 1,
    hasUsageMetrics: false,
    hasAuthError: true,
  }),
  '登录态已失效，请重新登录',
)

assert.equal(
  getBrowserSessionError({
    currentUrl: 'https://wawapi.top/console',
    loginUrl: 'https://wawapi.top/login',
    attemptedFields: 4,
    matchedFields: 0,
    hasUsageMetrics: true,
  }),
  '',
)

assert.equal(
  getBrowserSessionError({
    currentUrl: 'https://wawapi.top/console',
    loginUrl: 'https://wawapi.top/login',
    attemptedFields: 0,
    matchedFields: 0,
    hasUsageMetrics: false,
  }),
  '未配置可读取的数据字段，请先完成自动识别或手动拾取',
)

// ===== 页面导航后的重定向检测（getLoginRedirectError）=====
// 回归保护：goto 之后、字段抓取之前只能判断"是否被带到登录页"，
// 不允许误报「未配置可读取的数据字段」（该提示只应在抓取结束后综合判断）
assert.equal(
  getLoginRedirectError('https://wawapi.top/console', 'https://wawapi.top/login'),
  '',
)
assert.equal(
  getLoginRedirectError('https://wawapi.top/login?redirect=%2Fconsole', 'https://wawapi.top/login'),
  '登录态已失效，请重新登录',
)
// 路径含 /login 的页面即使不传 loginUrl 也要识别
assert.equal(
  getLoginRedirectError('https://example.com/login'),
  '登录态已失效，请重新登录',
)
// 对照：getBrowserSessionError 缺省参数时会在抓取前误报（这正是曾经的 bug 调用方式）
assert.equal(
  getBrowserSessionError({ currentUrl: 'https://wawapi.top/console', loginUrl: 'https://wawapi.top/login' }),
  '未配置可读取的数据字段，请先完成自动识别或手动拾取',
)

console.log('browser session test passed')
