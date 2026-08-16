import assert from 'node:assert/strict'
import { buildDailyUsagePath, dateKeyInTimezone, getDailyDateRange } from './usage-date.js'

const now = new Date('2026-07-27T16:30:00.000Z')
assert.deepEqual(getDailyDateRange(now, 'Asia/Shanghai'), {
  startDate: '2026-07-28',
  endDate: '2026-07-29',
})
assert.equal(dateKeyInTimezone(now, 'Asia/Shanghai'), '2026-07-28')
assert.equal(
  buildDailyUsagePath(now, 'Asia/Shanghai'),
  '/api/v1/usage/stats?start_date=2026-07-28&end_date=2026-07-29&timezone=Asia%2FShanghai',
)

console.log('usage date test passed')
