// 通用数据获取 hook：loading / error / data / refetch
import { useState, useEffect, useCallback, useRef } from 'react'

export function useApi(fetcher, deps = []) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // 请求序号：deps 变化触发新请求时，旧的 in-flight 响应视为过期并丢弃，
  // 避免慢的旧响应后返回时覆盖新数据（如快速切换中转站范围）
  const requestIdRef = useRef(0)

  const run = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)
    try {
      const result = await fetcher()
      if (requestIdRef.current !== requestId) return
      setData(result)
    } catch (err) {
      if (requestIdRef.current !== requestId) return
      setError(err.message || String(err))
    } finally {
      if (requestIdRef.current === requestId) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    run()
  }, [run])

  return { data, loading, error, refetch: run }
}
