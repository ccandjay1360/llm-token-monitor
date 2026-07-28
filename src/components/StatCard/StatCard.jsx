import styles from './StatCard.module.css'

// StatCard 现在支持：
//   - title: 卡片标题
//   - value: 主值
//   - sub: 副标题（小字描述）
//   - change: 右上角胶囊文案（用于补充信息，如"3 个中转站"）
//   - changeType: 'increase' / 'decrease' 控制胶囊配色
//   - icon: lucide 图标组件
//   - accent: 'blue' | 'green' | 'amber' | 'purple' 控制图标背景色
function StatCard({ title, value, sub, change, changeType, icon: Icon, accent = 'blue' }) {
  return (
    <div className={styles.card}>
      <div className={styles.top}>
        <div className={`${styles.iconBox} ${styles[accent]}`}>
          <Icon size={22} />
        </div>
        {change && (
          <span className={styles.change}>
            {change}
          </span>
        )}
      </div>
      <div className={styles.bottom}>
        <span className={styles.label}>{title}</span>
        <span className={styles.value}>{value}</span>
        {sub && <span className={styles.sub}>{sub}</span>}
      </div>
    </div>
  )
}

export default StatCard
