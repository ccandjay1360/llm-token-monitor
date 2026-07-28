import { useLocation } from 'react-router-dom'
import { HardDrive } from 'lucide-react'
import styles from './Header.module.css'

// 路由到标题的映射
const titleMap = {
  '/combined': '双站合计',
  '/': '仪表盘',
  '/analytics': '趋势分析',
  '/providers': '中转站',
  '/settings': '设置',
  '/help': '帮助',
}

const descriptionMap = {
  '/combined': '跨站汇总与余额概览',
  '/': '用量、成本与缓存效率',
  '/analytics': '历史趋势与模型明细',
  '/providers': '延迟、可用性与余额',
  '/settings': '数据源与采集策略',
  '/help': '配置与指标说明',
}

function Header() {
  const location = useLocation()
  const title = titleMap[location.pathname] || 'Token 监控台'
  const description = descriptionMap[location.pathname] || '本地运行状态'

  return (
    <header className={styles.header}>
      <div className={styles.heading}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.description}>{description}</p>
      </div>
      <div className={styles.right}>
        <div className={styles.localStatus} title="数据仅在本机处理">
          <HardDrive size={15} />
          <span>本地运行</span>
        </div>
      </div>
    </header>
  )
}

export default Header
