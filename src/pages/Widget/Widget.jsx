import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, GripHorizontal, Layers3, Minus, RefreshCw, X } from 'lucide-react'
import { fetchStats, formatTokens, formatUSD, quotaToUSD, triggerRefresh } from '../../api/client'
import { useApi } from '../../hooks/useApi'
import styles from './Widget.module.css'

const DISPLAY_PROVIDER_LIMIT = 2
const AUTO_REFRESH_MS = 25_000
const YUKINO_VIDEO = `${import.meta.env.BASE_URL}yukino-scene.mp4`
const YUKINO_POSTER = `${import.meta.env.BASE_URL}yukino-scene-poster.png`

function Widget() {
  const [providerId, setProviderId] = useState('all')
  const [refreshing, setRefreshing] = useState(false)
  const refreshingRef = useRef(false)
  const { data, loading, error, refetch } = useApi(() => fetchStats(providerId), [providerId])

  const providers = useMemo(
    () => (data?.availableProviders || []).filter((provider) => provider.type === 'browser').slice(0, DISPLAY_PROVIDER_LIMIT),
    [data],
  )

  // 手动刷新：触发后端真实抓取（浏览器访问站点），按钮专用
  const refreshCurrentProvider = useCallback(async () => {
    if (!providerId || refreshingRef.current) return
    refreshingRef.current = true
    setRefreshing(true)
    try {
      await triggerRefresh(providerId)
      await refetch()
    } finally {
      refreshingRef.current = false
      setRefreshing(false)
    }
  }, [providerId, refetch])

  // 自动轮询：只读缓存聚合（轻量 GET /api/stats）。
  // 真实抓取由后台调度器按 refreshIntervalSec 执行；
  // 若这里每 25s 强制 POST /refresh，会与调度器叠加成双倍浏览器启动与站点请求
  useEffect(() => {
    const timer = setInterval(() => {
      void refetch()
    }, AUTO_REFRESH_MS)
    return () => clearInterval(timer)
  }, [refetch])

  const handleRefresh = refreshCurrentProvider

  const summary = data?.summary
  const activeProvider = data?.providers?.[0]
  const dataOk = providerId === 'all'
    ? data?.providers?.every((provider) => provider.ok)
    : activeProvider?.ok
  const lastSuccessfulFetch = providerId === 'all'
    ? summary?.lastSuccessfulFetch
    : activeProvider?.lastSuccessfulFetch
  const freshnessText = dataOk
    ? `更新于 ${formatTime(lastSuccessfulFetch)}`
    : `数据延迟 · 上次成功 ${formatTime(lastSuccessfulFetch)}`
  const desktop = window.desktopWidget

  return (
    <main className={styles.widget}>
      <div className={styles.characterLayer} aria-hidden="true">
        <video
          src={YUKINO_VIDEO}
          poster={YUKINO_POSTER}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
        />
      </div>
      <header className={styles.titlebar}>
        <div className={styles.dragHandle}>
          <GripHorizontal size={16} />
          <span>Token 监控</span>
          <small>雪乃</small>
        </div>
        <div className={styles.windowActions}>
          <button aria-label="收起到托盘" title="收起到托盘" onClick={() => desktop?.hide()}><Minus size={15} /></button>
          <button className={styles.closeButton} aria-label="退出挂件" title="退出挂件" onClick={() => desktop?.quit()}><X size={15} /></button>
        </div>
      </header>

      <section className={styles.providerBar}>
        <div className={styles.providerTabs} role="group" aria-label="中转站范围">
          <button
            className={providerId === 'all' ? styles.providerActive : ''}
            aria-pressed={providerId === 'all'}
            onClick={() => setProviderId('all')}
          >
            <Layers3 size={12} />
            合计
          </button>
          {providers.map((provider) => (
            <button
              key={provider.id}
              className={provider.id === providerId ? styles.providerActive : ''}
              aria-pressed={provider.id === providerId}
              onClick={() => setProviderId(provider.id)}
            >
              <i className={provider.ok ? styles.okDot : styles.errorDot} />
              {provider.name}
            </button>
          ))}
        </div>
        <button className={styles.refreshButton} aria-label="刷新数据" title="刷新数据" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw size={15} className={refreshing ? styles.spinning : ''} />
        </button>
      </section>

      {loading && (
        <div className={styles.skeleton} aria-label="正在读取中转站数据">
          {Array.from({ length: 4 }, (_, index) => <span key={index} />)}
        </div>
      )}
      {error && <div className={styles.error}>无法连接本地监控服务</div>}
      {!loading && !error && !summary && <div className={styles.status}>暂无可用中转站</div>}

      {summary && (
        <section className={styles.metrics}>
          <Metric label="可用余额" value={formatUSD(quotaToUSD(summary.totalQuotaRemaining))} />
          <Metric label="今日 Token" value={formatTokens(summary.todayTokens || 0)} />
          <Metric label="今日消费" value={formatUSD(summary.todayCost || 0)} />
          <Metric label="缓存命中率" value={`${(summary.cacheHitRate || 0).toFixed(1)}%`} />
        </section>
      )}

      <footer className={styles.footer}>
        <span className={dataOk ? styles.fresh : styles.stale}>{freshnessText}</span>
        <button onClick={() => desktop?.openDashboard()}>
          打开仪表盘 <ExternalLink size={13} />
        </button>
      </footer>
    </main>
  )
}

function formatTime(timestamp) {
  if (!timestamp) return '--:--'
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function Metric({ label, value }) {
  return (
    <div className={styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export default Widget
