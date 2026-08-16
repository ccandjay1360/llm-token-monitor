import { isSafeProviderId } from './browser-session.js'

const PROVIDER_TYPES = new Set(['oneapi', 'newapi', 'browser', 'mock'])

function assertOptionalUrl(value, fieldName) {
  if (!value) return
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${fieldName} 无效`)
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${fieldName} 仅支持 http(s)`)
  }
}

export function defaultConfig() {
  return { refreshIntervalSec: 300, providers: [] }
}

export function validateConfig(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.providers)) {
    throw new Error('invalid config payload')
  }

  const refreshIntervalSec = input.refreshIntervalSec == null ? 300 : Number(input.refreshIntervalSec)
  if (!Number.isFinite(refreshIntervalSec) || refreshIntervalSec < 25 || refreshIntervalSec > 86_400) {
    throw new Error('refreshIntervalSec must be between 25 and 86400')
  }

  const ids = new Set()
  const providers = input.providers.map((provider) => {
    if (!provider || typeof provider !== 'object') throw new Error('provider 无效')
    if (!isSafeProviderId(provider.id)) throw new Error('provider id 无效')
    if (ids.has(provider.id)) throw new Error(`provider id 重复: ${provider.id}`)
    ids.add(provider.id)
    if (!PROVIDER_TYPES.has(provider.type)) throw new Error(`provider type 无效: ${provider.type}`)
    if (typeof provider.name !== 'string' || provider.name.trim().length === 0) {
      throw new Error('provider name 无效')
    }
    if (provider.enabled != null && typeof provider.enabled !== 'boolean') {
      throw new Error(`provider enabled 无效: ${provider.id}`)
    }

    if (provider.type === 'oneapi' || provider.type === 'newapi') {
      assertOptionalUrl(provider.baseUrl, 'baseUrl')
      if (provider.apiToken != null && typeof provider.apiToken !== 'string') {
        throw new Error(`apiToken 无效: ${provider.id}`)
      }
    }

    if (provider.type === 'browser') {
      assertOptionalUrl(provider.loginUrl, 'loginUrl')
      assertOptionalUrl(provider.dataUrl, 'dataUrl')
      assertOptionalUrl(provider.usageUrl, 'usageUrl')
      const waitMs = provider.waitMs == null ? 3000 : Number(provider.waitMs)
      if (!Number.isFinite(waitMs) || waitMs < 0 || waitMs > 15_000) {
        throw new Error(`waitMs 无效: ${provider.id}`)
      }
      if (provider.selectors != null && (typeof provider.selectors !== 'object' || Array.isArray(provider.selectors))) {
        throw new Error(`selectors 无效: ${provider.id}`)
      }
    }

    return provider.type === 'browser'
      ? { ...provider, selectors: provider.selectors || {} }
      : provider
  })

  return {
    ...input,
    refreshIntervalSec: Math.round(refreshIntervalSec),
    providers,
  }
}
