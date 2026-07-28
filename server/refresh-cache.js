export function resolveRefreshTargets(providers, requestedProviderId = '') {
  if (!requestedProviderId) return providers

  const provider = providers.find((item) => item.id === requestedProviderId)
  if (!provider) throw new Error(`中转站不存在: ${requestedProviderId}`)
  return [provider]
}

export function mergeRefreshedProviders(cachedProviders = [], refreshedProviders = []) {
  const refreshedById = new Map(refreshedProviders.map((provider) => [provider.id, provider]))
  const merged = cachedProviders.map((provider) => refreshedById.get(provider.id) || provider)

  for (const provider of refreshedProviders) {
    if (!cachedProviders.some((cached) => cached.id === provider.id)) merged.push(provider)
  }

  return merged
}

export function preserveFailedProviderData(refreshedProviders = [], cachedProviders = []) {
  const cachedById = new Map(cachedProviders.map((provider) => [provider.id, provider]))

  return refreshedProviders.map((provider) => {
    const cached = cachedById.get(provider.id)
    if (provider.ok !== false || !cached?.data) return provider

    return {
      ...cached,
      ok: false,
      error: provider.error,
      fetchedAt: provider.fetchedAt,
      lastSuccessfulFetch: cached.lastSuccessfulFetch || cached.fetchedAt,
      stale: true,
    }
  })
}
