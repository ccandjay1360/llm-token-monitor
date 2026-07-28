export function extractCacheUsage(data) {
  const inputTokens = Number(data?.total_input_tokens)
  const creationTokens = Number(data?.total_cache_creation_tokens ?? 0)
  const readTokens = Number(data?.total_cache_read_tokens ?? data?.total_cache_tokens)

  if (![inputTokens, creationTokens, readTokens].every(Number.isFinite)) return null
  return { inputTokens, creationTokens, readTokens }
}

export function calculateWeightedCacheHitRate(providers) {
  let readTokens = 0
  let totalTokens = 0

  for (const provider of providers) {
    const input = Number(provider?.cacheInputTokens)
    const creation = Number(provider?.cacheCreationTokens)
    const read = Number(provider?.cacheReadTokens)
    if (![input, creation, read].every(Number.isFinite)) continue

    readTokens += read
    totalTokens += input + creation + read
  }

  return totalTokens > 0 ? (readTokens / totalTokens) * 100 : null
}
