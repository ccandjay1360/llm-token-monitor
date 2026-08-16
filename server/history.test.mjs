import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 必须在动态 import history.js 之前设置数据目录，隔离测试写入
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-monitor-history-'))
process.env.TOKEN_MONITOR_DATA_DIR = dataDir

const { recordSnapshot, getHistory } = await import('./history.js')

const now = Date.now()
recordSnapshot([
  {
    id: 'oneapi-a',
    name: '站点A',
    type: 'oneapi',
    data: { quota: 10_000_000, usedQuota: 2_500_000, logs: [] }, // 无 balance 字段
  },
  {
    id: 'browser-b',
    name: '站点B',
    type: 'browser',
    data: { balance: 12.34, todayTokens: 5000, todayCost: 1.25 }, // balance 为美元
  },
])

const history = getHistory(1)
const today = history[0]
const oneapi = today.providers['oneapi-a']
const browser = today.providers['browser-b']

// OneAPI 的 quota（内部单位）必须换算成美元：10_000_000 / 500_000 = $20
assert.equal(oneapi.balance, 20)
// browser 的 balance 保持美元原值
assert.equal(browser.balance, 12.34)
// 两类站点的 balance 单位一致（同为美元量级）
assert.ok(oneapi.balance < 10_000, 'oneapi balance 应为美元而非内部单位')

console.log('history snapshot test passed')
