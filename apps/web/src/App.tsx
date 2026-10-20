import { useState } from 'react'
import { AdminTeamManagement } from './components/AdminTeamManagement'
import { OperatorDashboard } from './components/OperatorDashboard'
import './App.css'

export function App() {
  const [activeTab, setActiveTab] = useState<'operator' | 'admin'>('operator')

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
