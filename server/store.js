// 内存缓存 + 文件持久化
// 避免频繁请求中转站导致被限流；同时断电重启后可恢复最近一次数据

import fs from 'node:fs'
import path from 'node:path'

const DATA_DIR = process.env.TOKEN_MONITOR_DATA_DIR
  ? path.resolve(process.env.TOKEN_MONITOR_DATA_DIR)
  : import.meta.dirname
fs.mkdirSync(DATA_DIR, { recursive: true })
const CACHE_FILE = path.join(DATA_DIR, 'cache.json')
const TTL_MS = 60 * 1000 // 内存缓存 1 分钟

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

export function readCache() {
  const now = Date.now()
  if (memCache) {
    return now - memCacheAt < TTL_MS ? memCache : null
  }
  const persisted = readLastCache()
  return persisted && now - memCacheAt < TTL_MS ? persisted : null
}

export function writeCache(data) {
  memCache = data
  memCacheAt = Date.now()
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2))
  } catch (err) {
    console.warn('[store] 写入缓存失败:', err.message)
  }
}
