import { useState } from 'react'
import { AdminTeamManagement } from './components/AdminTeamManagement'
import { OperatorDashboard } from './components/OperatorDashboard'
import './App.css'

export function App() {
  const [activeTab, setActiveTab] = useState<'admin' | 'operator'>('operator')

  return (
    <main>
      <nav style={{ display: 'flex', gap: '1rem', padding: '1rem 1.5rem', background: '#0f172a', color: '#fff' }}>
        <button
          onClick={() => setActiveTab('operator')}
          style={{
            background: activeTab === 'operator' ? '#2563eb' : 'transparent',
            color: '#fff',
            border: 'none',
            padding: '0.5rem 1rem',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Dashboard Operator Arena
        </button>
        <button
          onClick={() => setActiveTab('admin')}
          style={{
            background: activeTab === 'admin' ? '#2563eb' : 'transparent',
            color: '#fff',
            border: 'none',
            padding: '0.5rem 1rem',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Manajemen Tim & Jadwal
        </button>
      </nav>
      {activeTab === 'operator' ? <OperatorDashboard /> : <AdminTeamManagement />}
    </main>
  )
}

export default App
