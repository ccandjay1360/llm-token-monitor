import { QUOTA_PER_DOLLAR } from '../../api/client.js'

export function buildAnalyticsTrend(stats, historyData, providerId = 'all') {
  if (!stats) return []

  const browserProviderIds = new Set(
    (stats.availableProviders || [])
      .filter((provider) => (
        provider.type === 'browser' &&
        (providerId === 'all' || provider.id === providerId)
      ))
      .map((provider) => provider.id)
  )
  const historyByDate = new Map(
    (historyData?.history || []).map((day) => [day.date, day.providers || {}])
  )

  return (stats.dailyTrend || []).map((day) => {
    let browserTokens = 0
    let browserCost = 0
    const snapshots = historyByDate.get(day.date) || {}
    for (const providerId of browserProviderIds) {
      browserTokens += snapshots[providerId]?.todayTokens || 0
      browserCost += snapshots[providerId]?.todayCost || 0
    }

    return {
      date: day.date.slice(5),
      tokens: (day.promptTokens || 0) + (day.completionTokens || 0) + browserTokens,
      prompt: day.promptTokens || 0,
      completion: day.completionTokens || 0,
      cost: (day.quota || 0) / QUOTA_PER_DOLLAR + browserCost,
      calls: day.calls || 0,
    }
  })
}

export function hasTrendData(data, key) {
  return data.some((item) => Number(item[key]) !== 0)
}
