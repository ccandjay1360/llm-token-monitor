import { useState } from 'react'
import StatCard from '../../components/StatCard/StatCard'
import LineChartCard from '../../components/LineChartCard/LineChartCard'
import BarChartCard from '../../components/BarChartCard/BarChartCard'
import PieChartCard from '../../components/PieChartCard/PieChartCard'
import RecentActivity from '../../components/RecentActivity/RecentActivity'
import ProviderScope from '../../components/ProviderScope/ProviderScope'
import { useApi } from '../../hooks/useApi'
import { useProviderScope } from '../../hooks/useProviderScope'
import { fetchStats, fetchHistory, triggerRefresh, quotaToUSD, formatUSD, formatTokens } from '../../api/client'
import { Coins, Activity, Zap, CircleDollarSign, RefreshCw, AlertTriangle, TrendingUp } from 'lucide-react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import styles from './Dashboard.module.css'

function Dashboard() {
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState(null)
  const { providerId, setProviderId } = useProviderScope()
  // 同时拉取 stats 和 history（history 用于 Token 使用趋势线图）
  const { data, loading, error, refetch } = useApi(() => fetchStats(providerId), [providerId])
  const { data: historyData, refetch: refetchHistory } = useApi(() => fetchHistory(30), [])

  const handleRefresh = async () => {
    setRefreshing(true)
    setRefreshError(null)
    try {
      await triggerRefresh(providerId)
      await Promise.all([refetch(), refetchHistory()])
    } catch (err) {
      setRefreshError(err.message || String(err))
    } finally {
      setRefreshing(false)
    }
  }

  if (loading) {
    return <div className={styles.loading}>加载中…</div>
  }
  if (error) {
    return (
      <div className={styles.errorBox}>
        <AlertTriangle size={20} />
        <div>
          <p>无法连接后端代理服务</p>
          <p className={styles.errorHint}>请确认已运行 <code>npm run dev:all</code>，且 3017 端口可用</p>
          <p className={styles.errorDetail}>{error}</p>
        </div>
      </div>
    )
  }

  const s = data.summary
  const totalCost = quotaToUSD(s.totalQuota)
  const remainingCost = quotaToUSD(s.totalQuotaRemaining)
  const usedCost = quotaToUSD(s.totalUsedQuota)
  const freshnessText = s.hasStaleProviders
    ? `数据延迟 · 上次成功 ${formatUpdateTime(s.lastSuccessfulFetch)}`
    : `更新于 ${formatUpdateTime(s.lastSuccessfulFetch)}`

  // 构造 4 张 KPI 卡
  const cards = [
    {
      title: 'Token 总消耗',
      value: formatTokens(s.totalTokens),
      sub: `Prompt ${formatTokens(s.totalPromptTokens)} / Completion ${formatTokens(s.totalCompletionTokens)}`,
      changeType: 'increase',
      change: `${s.totalCalls} 次调用`,
      icon: Coins,
      accent: 'blue',
    },
    {
      title: '累计成本',
      value: formatUSD(totalCost),
      sub: `已用 ${formatUSD(usedCost)} / 余额 ${formatUSD(remainingCost)}`,
      changeType: 'decrease',
      change: `${data.providers.length} 个中转站`,
      icon: Activity,
      accent: 'green',
    },
    {
      title: '今日 Token',
      value: formatTokens(s.todayTokens || 0),
      sub: `累计 Token ${formatTokens(s.totalTokens)}`,
      changeType: 'increase',
      change: '本日累计',
      icon: Zap,
      accent: 'amber',
    },
    {
      title: '今日消费额度',
      value: formatUSD(s.todayCost || 0),
      sub: `累计成本 ${formatUSD(totalCost)}`,
      changeType: 'decrease',
      change: '本日累计',
      icon: CircleDollarSign,
      accent: 'purple',
    },
  ]

  // 流量分布：缓存命中 vs 未命中
  const cacheDistribution = [
    { name: '缓存命中', value: Math.round(s.cacheHitRate * 100) / 100, color: '#087f5b' },
    { name: '未命中', value: Math.round((100 - s.cacheHitRate) * 100) / 100, color: '#d9ddd9' },
  ]

  // ===== Token 使用趋势（30 天历史）=====
  // 把 history 数据转为 LineChartCard 需要的格式
  // historyData.history: [{ date, providers: { [id]: { todayTokens, todayCost, ... } } }]
  // 每天聚合所有中转站的 todayTokens 作为当日总量
  const tokenTrend = (historyData?.history || []).map((day) => {
    let totalTokens = 0
    let totalCost = 0
    let cacheHitRateTotal = 0
    let cacheHitRateCount = 0
    const providers = day.providers || {}
    for (const id of Object.keys(providers)) {
      if (providerId !== 'all' && id !== providerId) continue
      const snapshot = providers[id]
      totalTokens += snapshot.todayTokens || 0
      totalCost += snapshot.todayCost || 0
      if (snapshot.type === 'browser' && snapshot.cacheHitRate != null) {
        cacheHitRateTotal += Number(snapshot.cacheHitRate) || 0
        cacheHitRateCount += 1
      }
    }
    return {
      date: day.date,
      tokens: totalTokens,
      cost: totalCost,
      cacheHitRate: cacheHitRateCount > 0
        ? cacheHitRateTotal / cacheHitRateCount
        : null,
    }
  })

  const trendDays = tokenTrend.filter((day) => (
    day.tokens > 0 || day.cacheHitRate != null
  )).length

  return (
    <>
      <div className={styles.toolbar}>
        <ProviderScope
          providers={data.availableProviders}
          value={data.scope?.providerId || providerId}
          onChange={setProviderId}
        />
        <div className={styles.toolbarActions}>
          {s.isMock && <span className={styles.mockBadge}>示例数据 · 配置中转站后查看真实数据</span>}
          <span className={s.hasStaleProviders ? styles.dataStale : styles.dataFresh}>{freshnessText}</span>
          {refreshError && <span className={styles.refreshError}>{refreshError}</span>}
          <button className={styles.refreshBtn} onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw size={14} /> {refreshing ? '刷新中…' : '刷新'}
          </button>
        </div>
      </div>

      <div className="stats-grid">
        {cards.map((c) => (
          <StatCard key={c.title} {...c} />
        ))}
      </div>

      <div className="charts-grid">
        <LineChartCard data={data.dailyTrend} />
        <BarChartCard data={data.modelBreakdown} />
        <PieChartCard data={cacheDistribution} title="缓存命中分布" />
      </div>

      {/* Token 使用趋势：30 天历史数据 */}
      <div className={styles.trendSection}>
        <div className={styles.sectionHeader}>
          <h3>
            <TrendingUp size={16} />
            Token 与缓存趋势（近 30 天）
          </h3>
          <span className={styles.trendHint}>
            {trendDays > 0
              ? `共 ${trendDays} 天数据`
              : '暂无历史数据，刷新几次后即可生成趋势'}
          </span>
        </div>
        <TokenTrendChart data={tokenTrend} />
      </div>

      <RecentActivity logs={data.recentLogs} />
    </>
  )
}

function formatUpdateTime(timestamp) {
  if (!timestamp) return '--:--'
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// Token 趋势图组件：基于 recharts 的折线图
function TokenTrendChart({ data }) {
  // 格式化日期为 MM-DD
  const formatted = data.map((d) => ({
    ...d,
    label: d.date.slice(5), // YYYY-MM-DD -> MM-DD
  }))

  return (
    <div className={styles.trendChartWrap}>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={formatted} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#dfe3df" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#858c88" />
          <YAxis yAxisId="tokens" tick={{ fontSize: 11 }} stroke="#858c88" />
          <YAxis
            yAxisId="cache"
            orientation="right"
            domain={[0, 100]}
            tickCount={6}
            tick={{ fontSize: 11, fill: '#087f5b' }}
            stroke="#72a190"
            tickFormatter={(value) => `${value}%`}
          />
          <Tooltip content={<TokenTrendTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            yAxisId="tokens"
            type="monotone"
            dataKey="tokens"
            name="Token"
            stroke="#087f5b"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
          <Line
            yAxisId="cache"
            type="monotone"
            dataKey="cacheHitRate"
            name="缓存命中率"
            stroke="#72a190"
            strokeWidth={2}
            strokeDasharray="6 4"
            connectNulls
            dot={{ r: 3, fill: '#fff', strokeWidth: 2 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function TokenTrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null

  const point = payload[0].payload
  return (
    <div className={styles.trendTooltip}>
      <strong>日期 {label}</strong>
      <span><i className={styles.tokenDot} />Token：{formatTokens(point.tokens)}</span>
      {point.cacheHitRate != null && (
        <span><i className={styles.cacheDot} />缓存命中率：{point.cacheHitRate.toFixed(1)}%</span>
      )}
      <span>当日成本：{formatUSD(point.cost)}</span>
    </div>
  )
}

export default Dashboard
