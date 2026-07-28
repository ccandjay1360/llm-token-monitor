import { Cpu, Zap, Clock, Hash } from 'lucide-react'
import { formatTokens } from '../../api/client'
import styles from './RecentActivity.module.css'

const iconForLog = (log) => {
  if (log.cacheHit) return Zap
  return Cpu
}

const colorForLog = (log) => {
  if (log.cacheHit) return '#087f5b'
  if (log.latencyMs && log.latencyMs > 2000) return '#b4232f'
  return '#72a190'
}

function timeAgo(ts) {
  const diff = Date.now() - ts
  if (diff < 60_000) return `${Math.floor(diff / 1000)} 秒前`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

function RecentActivity({ logs = [] }) {
  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <h3 className={styles.title}>最近请求</h3>
        <span className={styles.count}>共 {logs.length} 条</span>
      </div>
      <div className={styles.list}>
        {logs.length === 0 && (
          <div className={styles.empty}>暂无请求记录</div>
        )}
        {logs.map((log, idx) => {
          const Icon = iconForLog(log)
          const color = colorForLog(log)
          return (
            <div key={idx} className={styles.item}>
              <div
                className={styles.iconBox}
                style={{ background: `${color}15`, color }}
              >
                <Icon size={18} />
              </div>
              <div className={styles.content}>
                <p className={styles.text}>
                  <strong>{log.model}</strong>
                  <span className={styles.target}> · {log.providerName}</span>
                </p>
                <p className={styles.meta}>
                  <Hash size={11} /> {formatTokens(log.promptTokens + log.completionTokens)} tokens
                  {log.latencyMs && (
                    <>
                      <Clock size={11} /> {Math.round(log.latencyMs)} ms
                    </>
                  )}
                  {log.cacheHit && (
                    <span className={styles.cacheTag}>缓存命中</span>
                  )}
                </p>
              </div>
              <span className={styles.time}>{timeAgo(log.time)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default RecentActivity
