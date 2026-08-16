import { useState, lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Sidebar from './components/Sidebar/Sidebar'
import Header from './components/Header/Header'
import Widget from './pages/Widget/Widget'
import styles from './App.module.css'

// 路由级懒加载：Dashboard/Analytics 等图表页用到 recharts（约 400KB+），
// 拆分后挂件（?widget=1）首屏无需下载图表库
const Dashboard = lazy(() => import('./pages/Dashboard/Dashboard'))
const Analytics = lazy(() => import('./pages/Analytics/Analytics'))
const Providers = lazy(() => import('./pages/Providers/Providers'))
const Settings = lazy(() => import('./pages/Settings/Settings'))
const Help = lazy(() => import('./pages/Help/Help'))
const Combined = lazy(() => import('./pages/Combined/Combined'))

function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const location = useLocation()
  const isWidget = new URLSearchParams(window.location.search).get('widget') === '1'

  if (isWidget) return <Widget />

  return (
    <div className={styles.appContainer}>
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className={styles.mainContent}>
        <Header />
        <div className={styles.dashboardContent}>
          <Suspense fallback={<div style={{ padding: 24, color: '#606763' }}>加载中…</div>}>
            <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/combined" element={<Combined />} />
            <Route path="/providers" element={<Providers />} />
            <Route
              path="/reports"
              element={<Navigate to={{ pathname: '/analytics', search: location.search }} replace />}
            />
            <Route path="/settings" element={<Settings />} />
            <Route path="/help" element={<Help />} />
            {/* 兜底：未知路由跳转回首页 */}
            <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>
      </div>
    </div>
  )
}

export default App
