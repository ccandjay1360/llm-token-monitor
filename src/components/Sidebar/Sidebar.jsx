import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  BarChart3,
  Combine,
  Server,
  Settings,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import styles from './Sidebar.module.css'

const navItems = [
  { icon: Combine, label: '双站合计', path: '/combined' },
  { icon: LayoutDashboard, label: '仪表盘', path: '/' },
  { icon: BarChart3, label: '趋势分析', path: '/analytics' },
  { icon: Server, label: '中转站', path: '/providers' },
  { icon: Settings, label: '设置', path: '/settings' },
  { icon: HelpCircle, label: '帮助', path: '/help' },
]

function Sidebar({ collapsed, onToggle }) {
  const location = useLocation()

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
      <div className={styles.logo}>
        <div className={styles.logoIcon}>
          <BarChart3 size={22} />
        </div>
        {!collapsed && <span className={styles.logoText}>Token 监控</span>}
      </div>

      <nav className={styles.nav}>
        {navItems.map((item) => (
          <NavLink
            key={item.label}
            to={{ pathname: item.path, search: location.search }}
            end={item.path === '/'}
            className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.active : ''}`
            }
          >
            <item.icon size={20} />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className={styles.footer}>
        <span className={styles.statusMark} />
        {!collapsed && <span className={styles.localText}>数据保留在本机</span>}
      </div>

      <button className={styles.toggleBtn} onClick={onToggle} aria-label={collapsed ? '展开侧栏' : '收起侧栏'} title={collapsed ? '展开侧栏' : '收起侧栏'}>
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>
    </aside>
  )
}

export default Sidebar
