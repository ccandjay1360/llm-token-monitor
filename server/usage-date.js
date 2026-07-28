export function getDailyDateRange(now = new Date(), timezone = 'Asia/Shanghai') {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  return {
    startDate: formatter.format(now),
    endDate: formatter.format(new Date(now.getTime() + 24 * 60 * 60 * 1000)),
  }
}

export function buildDailyUsagePath(now = new Date(), timezone = 'Asia/Shanghai') {
  const { startDate, endDate } = getDailyDateRange(now, timezone)
  const query = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    timezone,
  })
  return `/api/v1/usage/stats?${query}`
}
