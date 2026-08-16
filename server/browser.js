// 浏览器自动化抓取：用于不提供 API 的商业中转站
// 流程：
//   1. login(cfg)：启动有头浏览器，用户手动登录，登录态保存到 server/auth/<id>.json
//   2. fetchViaBrowser(cfg)：加载 storageState，访问数据页，按选择器提取数字字段
//
// 浏览器抓取需要为每个站点配置 CSS 选择器，因为各中转站页面结构不同

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDailyUsagePath } from './usage-date.js'
import { extractCacheUsage } from './cache-metrics.js'
import {
  assertBrowserUrl,
  assertSafeProviderId,
  getBrowserSessionError,
  getLoginRedirectError,
  isAuthHttpStatus,
  isSafeProviderId,
} from './browser-session.js'
import { getProviderBrowserEpoch, withProviderBrowserLock } from './browser-lock.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 设置 Playwright 浏览器二进制路径（项目内 .playwright 目录）
// 避免污染系统目录，也避免 sandbox 限制
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve(__dirname, '..', '.playwright')
}

// 动态导入 playwright，确保上面的环境变量已设置
const { chromium } = await import('playwright')

const AUTH_DIR = process.env.AUTH_DIR
  ? path.resolve(process.env.AUTH_DIR)
  : process.env.TOKEN_MONITOR_DATA_DIR
    ? path.join(path.resolve(process.env.TOKEN_MONITOR_DATA_DIR), 'auth')
    : path.resolve(__dirname, 'auth')

function authFilePath(id) {
  assertSafeProviderId(id)
  const authRoot = `${path.resolve(AUTH_DIR)}${path.sep}`
  const filePath = path.resolve(AUTH_DIR, `${id}.json`)
  if (!filePath.startsWith(authRoot)) throw new Error('provider id 无效')
  return filePath
}

export function hasAuthState(id) {
  if (!isSafeProviderId(id)) return false
  return fs.existsSync(authFilePath(id))
}

async function saveAuthState(context, authFile) {
  const temporaryFile = `${authFile}.${process.pid}.${Date.now()}.tmp`
  const backupFile = `${authFile}.bak`
  let originalMoved = false

  try {
    fs.mkdirSync(path.dirname(authFile), { recursive: true })
    await context.storageState({ path: temporaryFile })

    if (fs.existsSync(backupFile)) fs.rmSync(backupFile, { force: true })
    if (fs.existsSync(authFile)) {
      fs.renameSync(authFile, backupFile)
      originalMoved = true
    }
    fs.renameSync(temporaryFile, authFile)
    if (originalMoved) fs.rmSync(backupFile, { force: true })
  } catch (error) {
    if (fs.existsSync(temporaryFile)) fs.rmSync(temporaryFile, { force: true })
    if (originalMoved && !fs.existsSync(authFile) && fs.existsSync(backupFile)) {
      fs.renameSync(backupFile, authFile)
    }
    throw error
  }
}

function authDirExists() {
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true })
  }
}

function launchInteractiveBrowser() {
  const executable = findEdgeExecutable()
  if (!executable) throw new Error('未找到系统 Edge，请安装或修复 Microsoft Edge')

  return chromium.launch({
    executablePath: executable,
    headless: false,
    ignoreDefaultArgs: ['--no-startup-window'],
    args: [
      '--new-window',
      '--start-maximized',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  })
}

function launchHeadlessBrowser() {
  return chromium.launch({ channel: 'msedge', headless: true })
}

function findEdgeExecutable() {
  const candidates = [
    path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(Boolean)
  return candidates.find((candidate) => fs.existsSync(candidate)) || null
}

function loginFinishScript() {
  const mount = () => {
    if (document.getElementById('__token_monitor_login_finish')) return
    const button = document.createElement('button')
    button.id = '__token_monitor_login_finish'
    button.textContent = '✓ 完成登录并保存'
    button.style.cssText = `
      position: fixed; top: 12px; right: 12px; z-index: 2147483647;
      padding: 10px 18px; background: #3b82f6; color: #fff;
      border: none; border-radius: 8px; font-size: 14px;
      font-weight: 600; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    `
    button.onclick = () => {
      window.__tokenMonitorLoginDone = true
      button.textContent = '✓ 已保存，可关闭浏览器'
      button.style.background = '#10b981'
    }
    ;(document.body || document.documentElement).appendChild(button)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true })
  } else {
    mount()
  }
}

const MAX_BROWSER_WAIT_MS = 15_000
// 标量元素慢等上限：SPA 数据接口返回晚于固定 waitMs 时兜底
const FIELD_ELEMENT_WAIT_MS = 8_000

// 两段式元素查询：先立即查询（快路径），未命中再等待元素挂载（慢路径）。
// 避免固定 waitMs 后元素尚未渲染导致字段间歇性抓空（余额变 0）
async function querySelectorWithWait(page, selector) {
  const immediate = await page.$(selector)
  if (immediate) return immediate
  try {
    return await page.waitForSelector(selector, { state: 'attached', timeout: FIELD_ELEMENT_WAIT_MS })
  } catch {
    return null
  }
}

function normalizeWaitMs(value, fallback = 3000) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(Math.max(number, 0), MAX_BROWSER_WAIT_MS)
}

function normalizePercentage(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return null
  return Math.min(number <= 1 ? number * 100 : number, 100)
}

function calculateCacheHitRate(payload) {
  const data = payload?.data ?? payload
  if (!data || typeof data !== 'object') return null

  for (const key of ['cache_hit_rate', 'cacheHitRate', 'cache_hit_ratio', 'cacheHitRatio']) {
    if (data[key] != null) return normalizePercentage(data[key])
  }

  const usage = extractCacheUsage(data)
  if (!usage) return null
  const total = usage.inputTokens + usage.creationTokens + usage.readTokens
  return total > 0 ? (usage.readTokens / total) * 100 : 0
}

async function fetchUsageMetrics(page, cfg) {
  const baseDataUrl = assertBrowserUrl(cfg.dataUrl, 'dataUrl')
  const usageUrl = assertBrowserUrl(
    cfg.usageUrl ? cfg.usageUrl : new URL('/usage', baseDataUrl).toString(),
    'usageUrl',
  )

  try {
    await page.goto(usageUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForTimeout(normalizeWaitMs(cfg.waitMs))
    const dailyUsagePath = buildDailyUsagePath(new Date(), cfg.timezone || 'Asia/Shanghai')
    const response = await page.evaluate(async ({ pathname, timeoutMs }) => {
      const token = localStorage.getItem('auth_token')
      const headers = token ? { Authorization: `Bearer ${token}` } : {}
      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetch(pathname, { headers, signal: controller.signal })
        return {
          ok: response.ok,
          status: response.status,
          payload: response.ok ? await response.json() : null,
        }
      } finally {
        window.clearTimeout(timeoutId)
      }
    }, { pathname: dailyUsagePath, timeoutMs: MAX_BROWSER_WAIT_MS })

    if (isAuthHttpStatus(response?.status)) {
      return { authError: true, status: response.status }
    }
    if (!response?.ok) return null
    const payload = response.payload

    const detected = calculateCacheHitRate(payload)
    const actualCost = Number(payload?.data?.total_actual_cost)
    const totalTokens = Number(payload?.data?.total_tokens)
    const cacheUsage = extractCacheUsage(payload?.data)
    return {
      metrics: {
        ...(detected != null ? { cacheHitRate: detected } : {}),
        ...(Number.isFinite(actualCost) ? { todayCost: actualCost } : {}),
        ...(Number.isFinite(totalTokens) ? { todayTokens: totalTokens } : {}),
        ...(cacheUsage ? {
          cacheInputTokens: cacheUsage.inputTokens,
          cacheCreationTokens: cacheUsage.creationTokens,
          cacheReadTokens: cacheUsage.readTokens,
        } : {}),
      },
    }
  } catch {
    return null
  }
}

// ===== 数字解析工具 =====
// 从文本中提取数字，支持：
//   "$1,234.56" -> 1234.56
//   "1.2M tokens" -> 1200000
//   "5,830,210" -> 5830210
//   "¥234.5" -> 234.5
//   "99%" -> 99（百分比，保留原始数字）
//   "12,345 tokens" -> 12345
function parseNumber(text) {
  if (!text) return 0
  const cleaned = String(text).trim()

  // 百分比：99% -> 99（保留原始数值，由调用方决定换算）
  const pctMatch = cleaned.match(/([\d,.]+)\s*%/)
  if (pctMatch) return parseFloat(pctMatch[1].replace(/,/g, ''))

  // 单位换算
  const mMatch = cleaned.match(/([\d,.]+)\s*M\b/i)
  if (mMatch) return parseFloat(mMatch[1].replace(/,/g, '')) * 1_000_000
  const kMatch = cleaned.match(/([\d,.]+)\s*K\b/i)
  if (kMatch) return parseFloat(kMatch[1].replace(/,/g, '')) * 1_000

  // 普通数字（去除货币符号、千分位、空格）
  const numMatch = cleaned.replace(/[¥$,\s]/g, '').match(/-?\d+(\.\d+)?/)
  return numMatch ? parseFloat(numMatch[0]) : 0
}

// 判断字符串是否含数字（用于识别表格中的"数字列"）
function hasNumber(text) {
  return /\d/.test(text || '')
}

// 判断字符串是否像"模型名"（非纯数字，含字母或常见模型关键字）
function looksLikeModelName(text) {
  if (!text) return false
  const t = text.trim()
  if (!t) return false
  // 模型名通常含字母
  if (!/[a-zA-Z]/.test(t)) return false
  // 不是纯数字
  if (/^[\d,.\s$¥%]+$/.test(t)) return false
  return true
}

// ===== 表格解析 =====
// 给定一个 table 元素，解析为 { headers, rows, models }
// models 是 [{ model, calls, tokens, cost, raw: [...] }] 数组
// 算法：
//   1. 取 thead 或第一行作为 headers
//   2. 自动识别"模型列"：含字母+数字混合的列（如 gpt-4o、claude-3-5）
//   3. 其他数字列依次归类为 calls / tokens / cost（按列名/位置猜测）
function parseTable(page, tableSelector) {
  return page.evaluate((sel) => {
    const table = document.querySelector(sel)
    if (!table) return null

    // 收集所有行（thead + tbody）
    const allRows = Array.from(table.querySelectorAll('tr'))
    if (allRows.length === 0) return null

    // 提取每行的单元格（th 或 td）
    const matrix = allRows.map((row) =>
      Array.from(row.querySelectorAll('th, td')).map((cell) => (cell.textContent || '').trim())
    )

    // 第一行作为 headers（如果是 thead 或全是 th）
    let headers = matrix[0]
    let dataRows = matrix.slice(1)
    // 如果首行没有 th，且看起来像数据（含数字），把 headers 设为通用占位
    const firstRowIsHeader = allRows[0].querySelector('th') !== null
    if (!firstRowIsHeader) {
      headers = headers.map((_, i) => `列${i + 1}`)
    }

    // 识别"模型列"：每行该列文本看起来像模型名
    let modelColIdx = -1
    for (let col = 0; col < headers.length; col++) {
      const samples = dataRows.map((r) => r[col]).filter(Boolean)
      const modelLikeCount = samples.filter(looksLikeModelName).length
      // 80% 以上行该列像模型名，则认为是模型列
      if (samples.length > 0 && modelLikeCount / samples.length >= 0.5) {
        modelColIdx = col
        break
      }
    }

    // 识别各数字列：calls / tokens / cost
    // 启发式：根据 header 名字判断
    const callsKeywords = ['调用', '次数', '请求', 'calls', 'requests', 'count']
    const tokensKeywords = ['token', 'tokens', '令牌']
    const costKeywords = ['消费', '费用', '成本', 'cost', 'spend', 'amount', 'quota', '价格']

    function matchCol(keywords) {
      // 优先看 header 名
      for (let i = 0; i < headers.length; i++) {
        if (i === modelColIdx) continue
        const h = headers[i].toLowerCase()
        if (keywords.some((k) => h.includes(k.toLowerCase()))) return i
      }
      return -1
    }

    const callsCol = matchCol(callsKeywords)
    const tokensCol = matchCol(tokensKeywords)
    const costCol = matchCol(costKeywords)

    // 如果 header 没匹配上，按列位置兜底：
    // 剩余数字列依次分配为 calls / tokens / cost
    if (callsCol === -1 || tokensCol === -1 || costCol === -1) {
      const numericCols = []
      for (let i = 0; i < headers.length; i++) {
        if (i === modelColIdx) continue
        // 该列至少一半行有数字
        const samples = dataRows.map((r) => r[i]).filter(Boolean)
        if (samples.length > 0 && samples.filter(hasNumber).length / samples.length >= 0.5) {
          numericCols.push(i)
        }
      }
      let idx = 0
      if (callsCol === -1 && numericCols[idx] !== undefined) { /* 已分配则跳过 */ }
      // 简化：依次填充未分配的列
      const assignments = [callsCol, tokensCol, costCol]
      let fillIdx = 0
      for (let i = 0; i < assignments.length; i++) {
        if (assignments[i] === -1 && numericCols[fillIdx] !== undefined) {
          assignments[i] = numericCols[fillIdx++]
        } else if (assignments[i] !== -1) {
          // 已分配，跳过对应 numericCol
          const pos = numericCols.indexOf(assignments[i])
          if (pos >= 0 && pos >= fillIdx) fillIdx = pos + 1
        }
      }
      // 写回
      return {
        headers,
        modelColIdx,
        callsCol: assignments[0],
        tokensCol: assignments[1],
        costCol: assignments[2],
        rows: dataRows,
      }
    }

    return {
      headers,
      modelColIdx,
      callsCol,
      tokensCol,
      costCol,
      rows: dataRows,
    }

    function looksLikeModelName(text) {
      if (!text) return false
      const t = text.trim()
      if (!t) return false
      if (!/[a-zA-Z]/.test(t)) return false
      if (/^[\d,.\s$¥%]+$/.test(t)) return false
      return true
    }

    function hasNumber(text) {
      return /\d/.test(text || '')
    }
  }, tableSelector)
}

// ===== 登录流程 =====
// 启动有头浏览器，打开 loginUrl，注入「完成登录」按钮
// 用户手动登录后点击该按钮，浏览器保存 storageState 并关闭
export function login(cfg) {
  assertSafeProviderId(cfg.id)
  return withProviderBrowserLock(cfg.id, () => loginUnlocked(cfg), { priority: true })
}

async function loginUnlocked(cfg) {
  authDirExists()

  const { id, loginUrl, loginWaitUrl = '' } = cfg
  if (!loginUrl) {
    throw new Error('缺少 loginUrl')
  }
  const safeLoginUrl = assertBrowserUrl(loginUrl, 'loginUrl')

  const browser = await launchInteractiveBrowser()
  let context

  try {
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    })
    await context.addInitScript(loginFinishScript)
    const page = await context.newPage()
    await page.goto(safeLoginUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.bringToFront()
    await page.evaluate(loginFinishScript)

    await page.waitForFunction(() => window.__tokenMonitorLoginDone === true, { timeout: 600_000 })

    if (loginWaitUrl) {
      await page.waitForURL(loginWaitUrl, { timeout: 30_000 }).catch(() => {})
    }

    await saveAuthState(context, authFilePath(id))
    return { ok: true, savedAt: Date.now() }
  } finally {
    await context?.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

// ===== 抓取流程 =====
// 加载 storageState，访问 dataUrl，按 selectors 提取数字字段
// selectors 结构：{ balance, todayTokens, todayCost, cacheHitRate, modelTable }
// 返回标量字段 + 模型表（解析后的模型数组）
export function fetchViaBrowser(cfg) {
  assertSafeProviderId(cfg.id)
  return withProviderBrowserLock(cfg.id, () => fetchViaBrowserUnlocked(cfg))
}

async function fetchViaBrowserUnlocked(cfg) {
  const { id, dataUrl, selectors = {} } = cfg
  const browserEpoch = getProviderBrowserEpoch(id)
  const waitMs = normalizeWaitMs(cfg.waitMs)
  if (!dataUrl) {
    throw new Error('缺少 dataUrl')
  }
  const safeDataUrl = assertBrowserUrl(dataUrl, 'dataUrl')

  const authFile = authFilePath(id)
  if (!fs.existsSync(authFile)) {
    throw new Error(`未找到登录态文件，请先调用登录流程：server/auth/${id}.json`)
  }

  const browser = await launchHeadlessBrowser()
  const context = await browser.newContext({
    storageState: authFile,
    viewport: { width: 1280, height: 800 },
  })
  const page = await context.newPage()

  try {
    // 用 domcontentloaded + waitMs 替代 networkidle，避免 SPA 持续网络请求导致卡住
    const dataResponse = await page.goto(safeDataUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    if (isAuthHttpStatus(dataResponse?.status())) throw new Error('登录态已失效，请重新登录')
    if (waitMs > 0) await page.waitForTimeout(waitMs)
    const redirectError = getLoginRedirectError(page.url(), cfg.loginUrl)
    if (redirectError) throw new Error(redirectError)

    const rawText = {}
    const numbers = {}
    let models = []
    let matchedFields = 0
    const attemptedFields = Object.values(selectors).filter(Boolean).length

    for (const [field, selector] of Object.entries(selectors)) {
      if (!selector) continue

      // modelTable 字段：解析表格
      if (field === 'modelTable') {
        try {
          const parsed = await parseTable(page, selector)
          if (parsed) {
            models = parseTableToModels(parsed)
            if (models.length > 0) matchedFields += 1
            rawText[field] = `表格：${parsed.rows.length} 行 × ${parsed.headers.length} 列`
          } else {
            rawText[field] = '<未找到 table 元素>'
          }
        } catch (err) {
          rawText[field] = `<错误: ${err.message}>`
        }
        continue
      }

      // 普通标量字段
      try {
        // 两段式抓取：先快查（多数情况元素已渲染），
        // 未命中再等待元素出现——SPA 数据晚于固定 waitMs 渲染时，
        // 一次性查询会落空导致余额间歇性抓成 0
        const el = await querySelectorWithWait(page, selector)
        if (el) {
          const text = (await el.textContent()) || ''
          if (hasNumber(text)) matchedFields += 1
          rawText[field] = text.trim()
          numbers[field] = parseNumber(text)
        } else {
          rawText[field] = '<未找到元素>'
          numbers[field] = 0
        }
      } catch (err) {
        rawText[field] = `<错误: ${err.message}>`
        numbers[field] = 0
      }
    }

    // 与数据页顺序访问，避免访问令牌过期时两个页面同时刷新令牌。
    const usageResult = await fetchUsageMetrics(page, { ...cfg, dataUrl: safeDataUrl })
    const usageMetrics = usageResult?.metrics || null
    if (usageMetrics?.todayTokens != null) {
      numbers.todayTokens = usageMetrics.todayTokens
      rawText.todayTokens = `${usageMetrics.todayTokens}（今日使用接口）`
    }
    if (usageMetrics?.cacheInputTokens != null) {
      numbers.cacheInputTokens = usageMetrics.cacheInputTokens
      numbers.cacheCreationTokens = usageMetrics.cacheCreationTokens
      numbers.cacheReadTokens = usageMetrics.cacheReadTokens
    }
    if (usageMetrics?.cacheHitRate != null) {
      numbers.cacheHitRate = usageMetrics.cacheHitRate
      rawText.cacheHitRate = `${usageMetrics.cacheHitRate.toFixed(1)}%（今日使用接口）`
    }
    if (usageMetrics?.todayCost != null) {
      numbers.todayCost = usageMetrics.todayCost
      rawText.todayCost = `$${usageMetrics.todayCost.toFixed(4)}（今日使用接口）`
    }

    const sessionError = getBrowserSessionError({
      currentUrl: page.url(),
      loginUrl: cfg.loginUrl,
      attemptedFields,
      matchedFields,
      hasUsageMetrics: !!usageMetrics && Object.keys(usageMetrics).length > 0,
      hasAuthError: !!usageResult?.authError,
    })
    if (sessionError) throw new Error(sessionError)

    // 保存页面续签后的 Cookie 和 localStorage Token，下次抓取继续使用新状态。
    if (getProviderBrowserEpoch(id) === browserEpoch) {
      await saveAuthState(context, authFile)
    }

    return {
      // 标量字段
      balance: numbers.balance || 0,
      todayTokens: numbers.todayTokens || 0,
      todayCost: numbers.todayCost || 0,
      cacheHitRate: numbers.cacheHitRate || 0,
      cacheInputTokens: numbers.cacheInputTokens || 0,
      cacheCreationTokens: numbers.cacheCreationTokens || 0,
      cacheReadTokens: numbers.cacheReadTokens || 0,
      // 兼容旧字段
      usedQuota: numbers.todayCost || 0,
      totalTokens: numbers.todayTokens || 0,
      // 模型分布
      models,
      _rawText: rawText,
      _fetchedAt: Date.now(),
    }
  } finally {
    await browser.close()
  }
}

// ===== 选择器自动识别 =====
// 根据字段标签与附近的数字值推断标量选择器，并按表头识别模型分布表。
export function autoDetectSelectors(cfg) {
  assertSafeProviderId(cfg.id)
  return withProviderBrowserLock(cfg.id, () => autoDetectSelectorsUnlocked(cfg))
}

async function autoDetectSelectorsUnlocked(cfg) {
  const { id, dataUrl } = cfg
  const browserEpoch = getProviderBrowserEpoch(id)
  const waitMs = normalizeWaitMs(cfg.waitMs)
  const authFile = authFilePath(id)
  if (!fs.existsSync(authFile)) throw new Error('未找到登录态文件')
  if (!dataUrl) throw new Error('缺少 dataUrl')
  const safeDataUrl = assertBrowserUrl(dataUrl, 'dataUrl')

  const browser = await launchHeadlessBrowser()
  const context = await browser.newContext({
    storageState: authFile,
    viewport: { width: 1280, height: 800 },
  })
  const page = await context.newPage()

  try {
    const dataResponse = await page.goto(safeDataUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    if (isAuthHttpStatus(dataResponse?.status())) throw new Error('登录态已失效，请重新登录')
    if (waitMs > 0) await page.waitForTimeout(waitMs)
    const redirectError = getLoginRedirectError(page.url(), cfg.loginUrl)
    if (redirectError) throw new Error(redirectError)

    const result = await page.evaluate((fieldHints) => {
      const normalize = (text) => (text || '').toLowerCase().replace(/[\s:：]/g, '')
      const textOf = (el) => (el?.textContent || '').trim()
      const directTextOf = (el) => Array.from(el?.childNodes || [])
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
        .join(' ')
        .trim()
      const isVisible = (el) => {
        const style = getComputedStyle(el)
        const rect = el.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
      }
      const isUniqueSelectorFor = (selector, el) => {
        try {
          const matches = document.querySelectorAll(selector)
          return matches.length === 1 && matches[0] === el
        } catch {
          return false
        }
      }

      const generateSelector = (el) => {
        if (el.id) {
          const selector = `#${CSS.escape(el.id)}`
          if (isUniqueSelectorFor(selector, el)) return selector
        }
        for (const attr of ['data-testid', 'data-test', 'data-cy', 'data-qa']) {
          const value = el.getAttribute(attr)
          if (value) {
            const selector = `[${attr}="${CSS.escape(value)}"]`
            if (isUniqueSelectorFor(selector, el)) return selector
          }
        }

        const parts = []
        let current = el
        while (current && current !== document.body && parts.length < 8) {
          let part = current.tagName.toLowerCase()
          const stableClass = Array.from(current.classList).find((name) =>
            name && !/^(flex|grid|block|inline|text-|font-|p[trblxy]?-[\d[]|m[trblxy]?-[\d[]|w-|h-|gap-|space-|items-|justify-|rounded|shadow)/.test(name)
          )
          if (stableClass) part += `.${CSS.escape(stableClass)}`
          const parent = current.parentElement
          if (parent) {
            const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName)
            if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`
          }
          parts.unshift(part)
          const selector = parts.join(' > ')
          if (isUniqueSelectorFor(selector, el)) return selector
          current = parent
        }
        return null
      }

      const labelElements = Array.from(document.querySelectorAll('p, span, label, dt, h1, h2, h3, h4, div'))
        .filter((el) => isVisible(el))
        .map((el) => ({ el, text: directTextOf(el) || (el.children.length === 0 ? textOf(el) : '') }))
        .filter(({ text }) => text && text.length <= 40)

      const selectors = {}
      const samples = {}
      const confidence = {}

      for (const [field, hints] of Object.entries(fieldHints)) {
        const labels = labelElements
          .map(({ el, text }) => {
            const normalized = normalize(text)
            let score = 0
            for (const hint of hints) {
              const normalizedHint = normalize(hint)
              if (normalized === normalizedHint) score = Math.max(score, 100)
              else if (normalized.includes(normalizedHint)) score = Math.max(score, 70)
            }
            return { el, text, score }
          })
          .filter(({ score }) => score > 0)
          .sort((a, b) => b.score - a.score)

        let best = null
        for (const label of labels) {
          let root = label.el.parentElement
          for (let depth = 0; root && depth < 4; depth++, root = root.parentElement) {
            const candidates = Array.from(root.querySelectorAll('p, span, strong, b, dd'))
              .filter((el) => el !== label.el && isVisible(el))
              .map((el) => ({ el, text: textOf(el) }))
              .filter(({ text }) => text && text.length <= 60 && /\d/.test(text) && normalize(text) !== normalize(label.text))

            if (candidates.length === 0) continue
            for (const candidate of candidates) {
              let score = label.score - depth * 15 - candidate.text.length * 0.1
              if (label.el.nextElementSibling === candidate.el) score += 25
              if ((field === 'balance' || field === 'todayCost') && /[$¥€]/.test(candidate.text)) score += 20
              if (field === 'cacheHitRate' && /%/.test(candidate.text)) score += 25
              if (field === 'todayTokens' && /[$¥€%]/.test(candidate.text)) score -= 20
              if (!best || score > best.score) best = { ...candidate, score }
            }
            break
          }
        }

        if (best) {
          const selector = generateSelector(best.el)
          if (selector) {
            selectors[field] = selector
            samples[field] = best.text
            confidence[field] = best.score >= 100 ? 'high' : 'medium'
          }
        }
      }

      const tableCandidates = []
      for (const table of document.querySelectorAll('table')) {
        if (!isVisible(table)) continue
        const headers = Array.from(table.querySelectorAll('th')).map((cell) => normalize(textOf(cell)))
        const joined = headers.join('|')
        const hasModel = /(模型|model)/.test(joined)
        const hasToken = /(token|令牌)/.test(joined)
        const hasCost = /(消费|成本|费用|cost|actual|实际)/.test(joined)
        const hasRequests = /(请求|调用|request|calls)/.test(joined)
        const validRows = Array.from(table.querySelectorAll('tbody tr')).filter((row) => {
          const cells = Array.from(row.querySelectorAll('td')).map((cell) => textOf(cell))
          return cells.length >= 2 && /[a-zA-Z]/.test(cells[0] || '') && cells.slice(1).some((text) => /\d/.test(text))
        }).length
        if (!hasModel || (!hasToken && !hasCost) || validRows === 0) continue

        let score = 0
        if (hasModel) score += 3
        if (hasToken) score += 2
        if (hasCost) score += 2
        if (hasRequests) score += 1
        score += Math.min(validRows, 3)
        tableCandidates.push({ table, score, headers, validRows })
      }
      tableCandidates.sort((a, b) => b.score - a.score)
      const bestTable = tableCandidates[0]
      const hasClearWinner = bestTable && (!tableCandidates[1] || bestTable.score > tableCandidates[1].score)
      if (hasClearWinner) {
        const selector = generateSelector(bestTable.table)
        if (selector) {
          selectors.modelTable = selector
          samples.modelTable = `${bestTable.validRows} 行，表头：${bestTable.headers.join(' / ')}`
          confidence.modelTable = bestTable.score >= 8 ? 'high' : 'medium'
        }
      }

      const expected = [...Object.keys(fieldHints), 'modelTable']
      return {
        selectors,
        samples,
        confidence,
        missing: expected.filter((field) => !selectors[field]),
      }
    }, {
      balance: ['余额', '可用余额', '账户余额', 'balance', 'remaining balance'],
      todayTokens: ['今日 token', '今日token', '今日令牌', 'today token', 'tokens today'],
      todayCost: ['今日消费', '今日花费', '今日成本', 'today cost', 'today spend'],
    })
    if (getProviderBrowserEpoch(id) === browserEpoch) {
      await saveAuthState(context, authFile)
    }
    return result
  } finally {
    await browser.close()
  }
}

// ===== 元素选择器自检 =====
// 给定 dataUrl + 登录态 + 选择器，返回每个字段实际抓到的文本
// 用于在设置页调试选择器是否正确
// 对 modelTable 字段做特殊处理：解析整个表格返回二维数组
export function probeSelectors(cfg) {
  assertSafeProviderId(cfg.id)
  return withProviderBrowserLock(cfg.id, () => probeSelectorsUnlocked(cfg))
}

async function probeSelectorsUnlocked(cfg) {
  const { id, dataUrl, selectors = {} } = cfg
  const browserEpoch = getProviderBrowserEpoch(id)
  const waitMs = normalizeWaitMs(cfg.waitMs)
  const authFile = authFilePath(id)
  if (!fs.existsSync(authFile)) {
    throw new Error('未找到登录态文件')
  }
  const safeDataUrl = assertBrowserUrl(dataUrl, 'dataUrl')

  const browser = await launchHeadlessBrowser()
  const context = await browser.newContext({
    storageState: authFile,
    viewport: { width: 1280, height: 800 },
  })
  const page = await context.newPage()

  try {
    // 用 domcontentloaded + waitMs 替代 networkidle，避免 SPA 持续网络请求导致卡住
    const dataResponse = await page.goto(safeDataUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    if (isAuthHttpStatus(dataResponse?.status())) throw new Error('登录态已失效，请重新登录')
    if (waitMs > 0) await page.waitForTimeout(waitMs)

    const redirectError = getLoginRedirectError(page.url(), cfg.loginUrl)
    if (redirectError) throw new Error(redirectError)

    const result = {}
    let matchedFields = 0
    const attemptedFields = Object.values(selectors).filter(Boolean).length
    for (const [field, selector] of Object.entries(selectors)) {
      if (!selector) continue

      // modelTable 字段：解析整个表格
      if (field === 'modelTable') {
        try {
          const parsed = await parseTable(page, selector)
          if (parsed) {
            // 同时生成解析后的模型列表
            const models = parseTableToModels(parsed)
            if (models.length > 0) matchedFields += 1
            result[field] = {
              selector,
              found: true,
              text: `表格：${parsed.rows.length} 行 × ${parsed.headers.length} 列`,
              tableInfo: parsed,
              models,
            }
          } else {
            result[field] = { selector, found: false, text: '未找到 table 元素', value: 0 }
          }
        } catch (err) {
          result[field] = { selector, found: false, text: `错误: ${err.message}`, value: 0 }
        }
        continue
      }

      // 普通标量字段
      try {
        const el = await querySelectorWithWait(page, selector)
        if (el) {
          const text = (await el.textContent()) || ''
          if (hasNumber(text)) matchedFields += 1
          result[field] = {
            selector,
            found: true,
            text: text.trim(),
            value: parseNumber(text),
          }
        } else {
          result[field] = { selector, found: false, text: '', value: 0 }
        }
      } catch (err) {
        result[field] = { selector, found: false, text: `错误: ${err.message}`, value: 0 }
      }
    }

    const usageResult = await fetchUsageMetrics(page, { ...cfg, dataUrl: safeDataUrl })
    const usageMetrics = usageResult?.metrics || null
    if (usageMetrics?.cacheHitRate != null) {
      result.cacheHitRate = {
        selector: '自动读取 /usage 数据接口',
        found: true,
        text: `${usageMetrics.cacheHitRate.toFixed(1)}%`,
        value: usageMetrics.cacheHitRate,
      }
    }
    if (usageMetrics?.todayCost != null) {
      result.todayCost = {
        selector: '自动读取 /usage 数据接口',
        found: true,
        text: `$${usageMetrics.todayCost.toFixed(4)}`,
        value: usageMetrics.todayCost,
      }
    }

    const sessionError = getBrowserSessionError({
      currentUrl: page.url(),
      loginUrl: cfg.loginUrl,
      attemptedFields,
      matchedFields,
      hasUsageMetrics: !!usageMetrics && Object.keys(usageMetrics).length > 0,
      hasAuthError: !!usageResult?.authError,
    })
    if (sessionError) throw new Error(sessionError)

    if (getProviderBrowserEpoch(id) === browserEpoch) {
      await saveAuthState(context, authFile)
    }
    return result
  } finally {
    await browser.close()
  }
}

// 把 parseTable 的结果转为模型数组
// [{ model, calls, tokens, cost }]
function parseTableToModels(tableInfo) {
  const { headers, rows, modelColIdx, callsCol, tokensCol, costCol } = tableInfo
  const models = []
  for (const row of rows) {
    const model = modelColIdx >= 0 ? (row[modelColIdx] || '').trim() : ''
    if (!model) continue
    models.push({
      model,
      calls: callsCol >= 0 ? parseNumber(row[callsCol]) : 0,
      promptTokens: 0,
      completionTokens: tokensCol >= 0 ? parseNumber(row[tokensCol]) : 0,
      quota: costCol >= 0 ? parseNumber(row[costCol]) : 0,
    })
  }
  return models
}

// ===== 可视化选择器拾取 =====
// 启动有头浏览器，打开数据页，用户点击目标元素后返回其 CSS 选择器
// fieldKey 决定拾取模式：
//   - 普通字段：拾取点击的元素本身
//   - 'modelTable'：自动向上找最近的 <table> 元素，拾取整个表格
export function pickSelector(cfg, fieldKey) {
  assertSafeProviderId(cfg.id)
  return withProviderBrowserLock(cfg.id, () => pickSelectorUnlocked(cfg, fieldKey))
}

async function pickSelectorUnlocked(cfg, fieldKey) {
  const { id, dataUrl } = cfg
  const browserEpoch = getProviderBrowserEpoch(id)
  const waitMs = normalizeWaitMs(cfg.waitMs)
  const authFile = authFilePath(id)
  if (!fs.existsSync(authFile)) {
    throw new Error('未找到登录态文件，请先登录')
  }
  if (!dataUrl) {
    throw new Error('缺少 dataUrl')
  }
  const safeDataUrl = assertBrowserUrl(dataUrl, 'dataUrl')

  const isTableMode = fieldKey === 'modelTable'
  const tipText = isTableMode
    ? '👆 点击表格中任意一个单元格（如某模型的 Token 数），系统会自动识别整个表格。按 Esc 取消'
    : '👆 点击你想抓取的数字（如余额），按 Esc 取消'

  console.log(`[pick] 启动浏览器，dataUrl=${dataUrl}, fieldKey=${fieldKey}, isTableMode=${isTableMode}`)

  const browser = await launchInteractiveBrowser()
  const context = await browser.newContext({
    storageState: authFile,
    viewport: { width: 1280, height: 800 },
  })
  const page = await context.newPage()

  // 注入拾取 UI：高亮鼠标指向的元素，点击即选中
  // 注意：Playwright 的 addInitScript 只接受 0 个或 1 个参数，多参数必须封装到对象
  await context.addInitScript(({ tipText, isTableMode }) => {
    let highlightEl = null
    let highlight = document.createElement('div')
    highlight.id = '__picker_highlight'
    highlight.style.cssText = `
      position: fixed; pointer-events: none; z-index: 2147483646;
      border: 2px solid #3b82f6; background: rgba(59, 130, 246, 0.15);
      transition: all 0.05s ease;
    `
    document.addEventListener('DOMContentLoaded', () => document.body.appendChild(highlight))

    let tip = document.createElement('div')
    tip.id = '__picker_tip'
    tip.style.cssText = `
      position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
      z-index: 2147483647; padding: 10px 18px;
      background: #1e293b; color: #fff; border-radius: 8px;
      font-size: 13px; font-weight: 500;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `
    tip.textContent = tipText
    document.addEventListener('DOMContentLoaded', () => document.body.appendChild(tip))

    function positionHighlight(el) {
      const r = el.getBoundingClientRect()
      highlight.style.left = r.left + 'px'
      highlight.style.top = r.top + 'px'
      highlight.style.width = r.width + 'px'
      highlight.style.height = r.height + 'px'
    }

    document.addEventListener('mousemove', (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      if (!el || el === highlight || el === tip) return
      if (highlightEl !== el) {
        highlightEl = el
        // 表格模式下，高亮整个 table（如果鼠标在 table 内）
        if (isTableMode) {
          const table = el.closest('table')
          if (table) {
            positionHighlight(table)
            return
          }
        }
        positionHighlight(el)
      }
    }, true)

    // 点击即选中（阻止默认行为，避免触发页面跳转）
    document.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      let el = document.elementFromPoint(e.clientX, e.clientY)
      if (!el) return

      // 表格模式下，自动向上找最近的 table
      if (isTableMode) {
        const table = el.closest('table')
        if (!table) {
          tip.style.background = '#ef4444'
          tip.textContent = '✗ 你点击的元素不在表格内，请点击表格中的任意单元格'
          return
        }
        el = table
      }

      // 生成选择器
      window.__pickedSelector = generateSelector(el)
      window.__pickedText = (el.textContent || '').trim().slice(0, 100)
      tip.style.background = '#10b981'
      tip.textContent = `✓ 已选择：${window.__pickedSelector}（3 秒后自动关闭）`
      setTimeout(() => window.close(), 3000)
    }, true)

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        window.__pickedSelector = null
        window.close()
      }
    })

    // ===== 选择器生成算法 =====
    function generateSelector(el) {
      if (el.id) return `#${CSS.escape(el.id)}`

      for (const attr of ['data-testid', 'data-test', 'data-cy', 'data-qa']) {
        const v = el.getAttribute(attr)
        if (v) return `[${attr}="${CSS.escape(v)}"]`
      }

      if (el.classList.length > 0) {
        const meaningful = Array.from(el.classList).filter((c) =>
          !['text-sm', 'text-lg', 'text-xl', 'mt-2', 'mt-4', 'mb-2', 'mb-4',
            'px-2', 'px-4', 'py-2', 'py-4', 'pt-2', 'pb-2', 'flex', 'inline',
            'block', 'grid', 'w-full', 'h-full', 'font-bold', 'font-medium',
            'text-center', 'text-right', 'text-left', 'rounded', 'shadow'
          ].includes(c)
        )
        for (const c of meaningful) {
          const sel = `.${CSS.escape(c)}`
          if (document.querySelectorAll(sel).length === 1) return sel
        }
        if (meaningful.length >= 2) {
          const sel = `.${CSS.escape(meaningful[0])}.${CSS.escape(meaningful[1])}`
          if (document.querySelectorAll(sel).length === 1) return sel
        }
      }

      // table 标签特殊处理：尝试用 class 或 nth-of-type 唯一化
      const parts = []
      let cur = el
      let depth = 0
      while (cur && cur.nodeType === 1 && depth < 5) {
        let part = cur.tagName.toLowerCase()
        if (cur.id) {
          parts.unshift(`#${CSS.escape(cur.id)}`)
          break
        }
        if (cur.classList.length > 0) {
          const meaningful = Array.from(cur.classList).filter((c) =>
            !['flex', 'inline', 'block', 'grid', 'w-full', 'h-full'].includes(c)
          )
          if (meaningful.length > 0) {
            part += `.${CSS.escape(meaningful[0])}`
          }
        }
        const parent = cur.parentElement
        if (parent) {
          const siblings = Array.from(parent.children).filter((c) => c.tagName === cur.tagName)
          if (siblings.length > 1) {
            const idx = siblings.indexOf(cur) + 1
            part += `:nth-of-type(${idx})`
          }
        }
        parts.unshift(part)
        cur = cur.parentElement
        depth++
      }
      return parts.join(' > ')
    }
  }, { tipText, isTableMode })

  try {
    // 用 domcontentloaded 而非 networkidle：SPA 可能持续有网络请求，networkidle 永远到不了
    // 然后用 waitMs 给 SPA 渲染时间
    console.log(`[pick] 开始导航到 ${dataUrl}`)
    try {
      const dataResponse = await page.goto(safeDataUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      if (isAuthHttpStatus(dataResponse?.status())) throw new Error('登录态已失效，请重新登录')
      console.log(`[pick] 导航成功，当前 URL: ${page.url()}`)
    } catch (gotoErr) {
      if (gotoErr.message === '登录态已失效，请重新登录') throw gotoErr
      console.error(`[pick] 导航失败:`, gotoErr.message)
      // 导航失败时，在页面上显示错误提示，让用户能看到
      try {
        await page.setContent(`
          <html><body style="font-family: sans-serif; padding: 40px;">
            <h2 style="color: #ef4444;">导航失败</h2>
            <p>无法访问：<code>${dataUrl}</code></p>
            <p>错误：<code>${gotoErr.message}</code></p>
            <p>请检查 dataUrl 是否正确，或网络是否能访问该站点。关闭此浏览器后重试。</p>
          </body></html>
        `)
      } catch {}
      // 给用户 10 秒看到错误提示
      await page.waitForTimeout(10_000)
      return { selector: null, text: '', error: gotoErr.message }
    }

    const redirectError = getLoginRedirectError(page.url(), cfg.loginUrl)
    if (redirectError) throw new Error(redirectError)

    // 给 SPA 一点渲染时间
    if (waitMs > 0) await page.waitForTimeout(waitMs)
    console.log(`[pick] 页面加载完成，等待用户点击...`)

    // 等待用户点击或按 Esc（最多 5 分钟）
    try {
      await page.waitForFunction(() => window.__pickedSelector !== undefined, { timeout: 300_000 })
    } catch {
      // 超时或浏览器被关闭
      console.log(`[pick] 等待超时或浏览器被关闭`)
    }

    let result = { selector: null, text: '' }
    try {
      const picked = await page.evaluate(() => ({
        selector: window.__pickedSelector || null,
        text: window.__pickedText || '',
      }))
      if (picked?.selector) result = picked
      console.log(`[pick] 拾取结果:`, result)
    } catch (e) {
      console.log(`[pick] 读取结果失败:`, e.message)
    }

    if (getProviderBrowserEpoch(id) === browserEpoch) {
      await saveAuthState(context, authFile)
    }
    return result
  } finally {
    try { await browser.close() } catch {}
  }
}
