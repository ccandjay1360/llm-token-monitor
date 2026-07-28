import { useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Sidebar from './components/Sidebar/Sidebar'
import Header from './components/Header/Header'
import Dashboard from './pages/Dashboard/Dashboard'
import Analytics from './pages/Analytics/Analytics'
import Providers from './pages/Providers/Providers'
import Settings from './pages/Settings/Settings'
import Help from './pages/Help/Help'
import Widget from './pages/Widget/Widget'
import Combined from './pages/Combined/Combined'
import styles from './App.module.css'

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
        </div>
      </div>
    </div>
  )
}

export default App
