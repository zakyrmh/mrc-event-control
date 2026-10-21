import { useEffect, useState } from 'react'
import { AdminTeamManagement } from './components/AdminTeamManagement'
import { OperatorDashboard } from './components/OperatorDashboard'
import { OverlayDisplay } from './components/OverlayDisplay'
import './App.css'

export function App() {
  const [activeTab, setActiveTab] = useState<'operator' | 'admin'>('operator')
  const [isOverlayRoute, setIsOverlayRoute] = useState<boolean>(() => {
    return (
      window.location.pathname.startsWith('/overlay') ||
      window.location.search.includes('overlay') ||
      window.location.hash.includes('overlay')
    )
  })

  useEffect(() => {
    const handlePopState = () => {
      setIsOverlayRoute(
        window.location.pathname.startsWith('/overlay') ||
          window.location.search.includes('overlay') ||
          window.location.hash.includes('overlay'),
      )
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  if (isOverlayRoute) {
    return <OverlayDisplay clientRole="OBS_BROWSER_SOURCE" />
  }

  return (
    <>
      <header className="app-header">
        <div className="app-brand">
          <span className="app-brand-title">MRC X 2026</span>
          <span className="app-brand-badge">Event Control</span>
        </div>
        <nav className="app-nav">
          <button
            type="button"
            className={`app-nav-button ${activeTab === 'operator' ? 'active' : ''}`}
            onClick={() => setActiveTab('operator')}
          >
            Dashboard Operator Arena
          </button>
          <button
            type="button"
            className={`app-nav-button ${activeTab === 'admin' ? 'active' : ''}`}
            onClick={() => setActiveTab('admin')}
          >
            Manajemen Tim & Jadwal
          </button>
        </nav>
      </header>
      <main className="app-main">
        {activeTab === 'operator' ? <OperatorDashboard /> : <AdminTeamManagement />}
      </main>
    </>
  )
}

export default App
