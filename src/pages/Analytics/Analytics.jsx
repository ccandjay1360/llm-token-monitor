import { useApi } from '../../hooks/useApi'
import { useProviderScope } from '../../hooks/useProviderScope'
import { fetchHistory, fetchStats, formatTokens, quotaToUSD } from '../../api/client'
import ProviderScope from '../../components/ProviderScope/ProviderScope'
import { buildAnalyticsTrend, hasTrendData } from './trendData'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { useMemo, useState } from 'react'
import styles from './Analytics.module.css'

function CustomTooltip({ active, payload, label }) {
  if (active && payload && payload.length) {
    return (
      <div className={styles.tooltip}>
        <p className={styles.tooltipLabel}>{label}</p>
        {payload.map((p, i) => (
          <p key={i} className={styles.tooltipValue} style={{ color: p.color }}>
            {p.name}: {formatTokens(p.value)}
          </p>
        ))}
      </div>
    )
  }
  return null
}

function Analytics() {
  const { providerId, setProviderId } = useProviderScope()
  const { data, loading, error } = useApi(() => fetchStats(providerId), [providerId])
  const { data: historyData, loading: historyLoading, error: historyError } = useApi(() => fetchHistory(14), [])
  const [metric, setMetric] = useState('tokens')

  const chartData = useMemo(() => {
    const scopeId = data?.scope?.providerId || providerId
    return buildAnalyticsTrend(data, historyData, scopeId)
  }, [data, historyData, providerId])

  const modelTable = data?.modelBreakdown || []

  if (loading || historyLoading) return <div className={styles.loading}>加载中…</div>
  if (error || historyError) return <div className={styles.errorBox}>{error || historyError}</div>

  const metricConfig = {
    tokens: { key: 'tokens', name: '总 Token', color: '#087f5b' },
    prompt: { key: 'prompt', name: 'Prompt', color: '#087f5b' },
    completion: { key: 'completion', name: 'Completion', color: '#3d8f73' },
    cost: { key: 'cost', name: '成本 ($)', color: '#087f5b' },
    calls: { key: 'calls', name: '调用次数', color: '#087f5b' },
  }
  const cur = metricConfig[metric]
  const hasData = hasTrendData(chartData, cur.key)

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h2 className={styles.title}>用量趋势</h2>
          <p className={styles.subtitle}>Token 消耗与成本随时间变化</p>
        </div>
        <ProviderScope
          providers={data.availableProviders}
          value={data.scope?.providerId || providerId}
          onChange={setProviderId}
        />
      </div>

      <div className={styles.tabs}>
        {Object.entries(metricConfig).map(([k, v]) => (
          <button
            key={k}
            className={`${styles.tab} ${metric === k ? styles.tabActive : ''}`}
            onClick={() => setMetric(k)}
          >
            {v.name}
          </button>
        ))}
      </div>

      <div className={styles.card}>
        <h3 className={styles.cardTitle}>近 14 天趋势</h3>
        {hasData ? (
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <defs>
                <linearGradient id="colorMetric" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={cur.color} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={cur.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#dfe3df" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#606763' }} axisLine={{ stroke: '#dfe3df' }} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#606763' }} axisLine={false} tickLine={false}
                tickFormatter={(val) => metric === 'cost' ? `$${val.toFixed(2)}` : formatTokens(val)} />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Area
                type="monotone"
                dataKey={cur.key}
                name={cur.name}
                stroke={cur.color}
                strokeWidth={2.5}
                fill="url(#colorMetric)"
                animationDuration={1200}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className={styles.emptyTrend}>
            <strong>暂无「{cur.name}」历史数据</strong>
            <span>趋势从接入后的每日快照开始记录</span>
          </div>
        )}
      </div>

      <div className={styles.card}>
        <h3 className={styles.cardTitle}>模型明细</h3>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>模型</th>
              <th>调用次数</th>
              <th>Prompt</th>
              <th>Completion</th>
              <th>总 Token</th>
              <th>成本 ($)</th>
            </tr>
          </thead>
          <tbody>
            {modelTable.map((m) => (
              <tr key={m.model}>
                <td className={styles.modelCell}>{m.model}</td>
                <td>{m.calls}</td>
                <td>{formatTokens(m.promptTokens)}</td>
                <td>{formatTokens(m.completionTokens)}</td>
                <td><strong>{formatTokens(m.promptTokens + m.completionTokens)}</strong></td>
                <td>${quotaToUSD(m.quota).toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default Analytics
