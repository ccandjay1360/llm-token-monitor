// 内存缓存 + 文件持久化
// 避免频繁请求中转站导致被限流；同时断电重启后可恢复最近一次数据

import fs from 'node:fs'
import path from 'node:path'
import { writeJsonAtomically } from './json-store.js'

const DATA_DIR = process.env.TOKEN_MONITOR_DATA_DIR
  ? path.resolve(process.env.TOKEN_MONITOR_DATA_DIR)
  : import.meta.dirname
fs.mkdirSync(DATA_DIR, { recursive: true })
const CACHE_FILE = path.join(DATA_DIR, 'cache.json')
const DEFAULT_TTL_MS = 60 * 1000 // 内存缓存默认 1 分钟

let memCache = null
let memCacheAt = 0

export function readLastCache() {
  if (memCache) return memCache
  if (!fs.existsSync(CACHE_FILE)) return null
  try {
    const persisted = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'))
    memCache = persisted
    memCacheAt = Number(persisted.fetchedAt) || fs.statSync(CACHE_FILE).mtimeMs
    return memCache
  } catch {
    return null
  }
}

// ttlMs 由调用方传入（跟随配置的 refreshIntervalSec），
// 避免硬编码 TTL 与用户配置的刷新间隔脱节：否则间隔设长后，
// 每次读 stats 仍会在 TTL 过期后触发全量刷新，配置形同虚设
export function readCache(ttlMs = DEFAULT_TTL_MS) {
  const now = Date.now()
  if (memCache) {
    return now - memCacheAt < ttlMs ? memCache : null
  }
  const persisted = readLastCache()
  return persisted && now - memCacheAt < ttlMs ? persisted : null
}

export function writeCache(data) {
  memCache = data
  memCacheAt = Date.now()
  try {
    writeJsonAtomically(CACHE_FILE, data)
  } catch (err) {
    console.warn('[store] 写入缓存失败:', err.message)
  }
}
