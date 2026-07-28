import { Activity, CircleDollarSign, Database, Gauge, Layers3 } from 'lucide-react'
import StatCard from '../../components/StatCard/StatCard'
import { fetchStats, formatTokens, formatUSD } from '../../api/client'
import { useApi } from '../../hooks/useApi'
import styles from './Combined.module.css'

function Combined() {
  const { data, loading, error } = useApi(() => fetchStats('all'), [])

  if (loading) return <div className={styles.loading}>加载合计数据中...</div>
  if (error) return <div className={styles.errorBox}>{error}</div>

  const providers = (data.providers || []).filter((provider) => provider.type === 'browser')
  const summary = data.summary
  const totalBalance = providers.reduce((total, provider) => total + (provider.balance || 0), 0)
  const updatedAt = summary.lastSuccessfulFetch
    ? new Date(summary.lastSuccessfulFetch).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : '--:--'

  const cards = [
    { title: '可用余额合计', value: formatUSD(totalBalance), sub: `${providers.length} 个中转站余额相加`, change: '实时汇总', changeType: 'increase', icon: CircleDollarSign, accent: 'green' },
    { title: '今日 Token 合计', value: formatTokens(summary.todayTokens || 0), sub: `累计 Token ${formatTokens(summary.totalTokens || 0)}`, change: '今日', changeType: 'increase', icon: Database, accent: 'blue' },
    { title: '今日消费合计', value: formatUSD(summary.todayCost || 0), sub: `累计调用 ${summary.totalCalls || 0} 次`, change: '今日', changeType: 'decrease', icon: Activity, accent: 'amber' },
    { title: '平均缓存命中率', value: `${(summary.cacheHitRate || 0).toFixed(1)}%`, sub: '按中转站平均值计算', change: '双站均值', changeType: 'increase', icon: Gauge, accent: 'purple' },
  ]

  return (
    <div className={styles.page}>
      <div className={styles.intro}>
        <div><h2>汇总概览</h2><p>Waw 与 Kunkun 的数据汇总，不随单站筛选切换。</p></div>
        <span className={summary.hasStaleProviders ? styles.stale : styles.updated}>
          {summary.hasStaleProviders ? `数据延迟 · 上次成功 ${updatedAt}` : `更新于 ${updatedAt}`}
        </span>
      </div>

      <div className="stats-grid">{cards.map((card) => <StatCard key={card.title} {...card} />)}</div>

      <section className={styles.tableSection}>
        <div className={styles.sectionHeader}>
          <div><h3><Layers3 size={18} />合计来源</h3><p>各中转站的当前数据</p></div>
          <span>{providers.length} 个站点</span>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th>中转站</th><th>状态</th><th>余额</th><th>今日 Token</th><th>今日消费</th><th>缓存命中率</th></tr></thead>
            <tbody>{providers.map((provider) => (
              <tr key={provider.id}>
                <td>{provider.name}</td>
                <td><span className={provider.ok ? styles.statusOk : styles.statusError}><i />{provider.ok ? '正常' : '异常'}</span></td>
                <td>{formatUSD(provider.balance || 0)}</td>
                <td>{formatTokens(provider.todayTokens || 0)}</td>
                <td>{formatUSD(provider.todayCost || 0)}</td>
                <td>{(provider.cacheHitRate || 0).toFixed(1)}%</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className={styles.modelSection}>
        <div className={styles.sectionHeader}><div><h3>合计模型分布</h3><p>按消耗 Token 排序</p></div></div>
        <div className={styles.modelList}>{(data.modelBreakdown || []).slice(0, 8).map((model) => (
          <div className={styles.modelRow} key={model.model}><strong>{model.model}</strong><span>{formatTokens((model.promptTokens || 0) + (model.completionTokens || 0))}</span></div>
        ))}</div>
      </section>
    </div>
  )
}

export default Combined
