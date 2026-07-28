import { useApi } from '../../hooks/useApi'
import { fetchStats, quotaToUSD, formatUSD } from '../../api/client'
import { Server, Clock, Wallet, Activity, AlertCircle, CheckCircle2 } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import styles from './Providers.module.css'

function latencyColor(ms) {
  if (ms == null) return '#858c88'
  if (ms < 800) return '#087f5b'
  if (ms < 2000) return '#9a6700'
  return '#b4232f'
}

function Providers() {
  const { data, loading, error } = useApi(fetchStats, [])

  if (loading) return <div className={styles.loading}>加载中…</div>
  if (error) return <div className={styles.errorBox}>{error}</div>

  const providers = data.providers
  const latencyData = providers.map((p) => ({
    name: p.name,
    latency: p.avgLatencyMs || 0,
    color: latencyColor(p.avgLatencyMs),
  }))
  const hasLatencyData = latencyData.some((entry) => entry.latency > 0)

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>中转站健康度</h2>
      <p className={styles.subtitle}>各中转站的延迟、可用性与余额对比</p>

      <div className={styles.chartCard}>
        <h3>平均延迟对比</h3>
        {hasLatencyData ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={latencyData} layout="vertical" margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#dfe3df" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 12, fill: '#606763' }} axisLine={false} tickLine={false} unit=" ms" />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#606763' }} axisLine={false} tickLine={false} width={140} />
              <Tooltip
                cursor={{ fill: '#f4f5f3' }}
                formatter={(v) => [`${Math.round(v)} ms`, '平均延迟']}
              />
              <Bar dataKey="latency" radius={[0, 6, 6, 0]} maxBarSize={28} animationDuration={1200}>
                {latencyData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className={styles.emptyLatency}>等待采集延迟数据</div>
        )}
      </div>

      <div className={styles.grid}>
        {providers.map((p) => (
          <div key={p.id} className={`${styles.card} ${p.ok ? styles.ok : styles.fail}`}>
            <div className={styles.cardHeader}>
              <div className={styles.nameBox}>
                <Server size={18} />
                <div>
                  <div className={styles.name}>{p.name}</div>
                  <div className={styles.meta}>{p.type}{p.isMock ? ' · 示例' : ''}</div>
                </div>
              </div>
              {p.ok ? (
                <span className={styles.statusOk}><CheckCircle2 size={14} /> 正常</span>
              ) : (
                <span className={styles.statusFail}><AlertCircle size={14} /> 异常</span>
              )}
            </div>

            <div className={styles.metrics}>
              <div className={styles.metric}>
                <Clock size={14} />
                <span className={styles.metricLabel}>平均延迟</span>
                <span className={styles.metricValue} style={{ color: latencyColor(p.avgLatencyMs) }}>
                  {p.avgLatencyMs ? `${Math.round(p.avgLatencyMs)} ms` : '--'}
                </span>
              </div>
              <div className={styles.metric}>
                <Activity size={14} />
                <span className={styles.metricLabel}>调用数</span>
                <span className={styles.metricValue}>{p.calls}</span>
              </div>
              <div className={styles.metric}>
                <Wallet size={14} />
                <span className={styles.metricLabel}>余额</span>
                <span className={styles.metricValue}>{formatUSD(quotaToUSD(p.quota))}</span>
              </div>
              <div className={styles.metric}>
                <Wallet size={14} />
                <span className={styles.metricLabel}>已用</span>
                <span className={styles.metricValue}>{formatUSD(quotaToUSD(p.usedQuota))}</span>
              </div>
            </div>

            {p.error && (
              <div className={styles.errorDetail}>错误：{p.error}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default Providers
