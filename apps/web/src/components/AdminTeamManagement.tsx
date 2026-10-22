import React, { useCallback, useEffect, useState } from 'react'
import { MatchSchedulePanel } from './MatchSchedulePanel'
import './AdminTeamManagement.css'

export interface Category {
  id: string
  code: string
  label: string
  enabled: boolean
  revision: number
}

export interface CompetitionGroup {
  id: string
  categoryId: string
  name: string
  enabled: boolean
  revision: number
}

export interface Team {
  id: string
  categoryId: string
  code: string
  name: string
  institution: string | null
  groupId: string | null
  archivedAt: string | null
  revision: number
}

export interface Match {
  id: string
  categoryId: string
  groupId: string | null
  stage: string
  stageLabel: string | null
  scheduledAt: string | null
  sequence: number
  teamAId: string
  teamBId: string
  status: string
  matchVersion: number
  hasStarted: boolean
  tieId: string | null
  rondeNumber: number | null
  generationBatchId: string | null
  category?: { code: string; label: string }
  group?: { name: string }
  teamA?: { code: string; name: string }
  teamB?: { code: string; name: string }
}

interface ImportPreviewResult {
  id: string
  valid: boolean
  previewHash: string
  catalogRevision: number
  summary: {
    totalRows: number
    validRows: number
    errorRows: number
  }
  errors: Array<{ row: number; column?: string; message: string }>
}

interface UserSession {
  username: string
  role: string
}

async function parseResponseError(res: Response, fallback: string): Promise<string> {
  try {
    const text = await res.text()
    if (!text) return `${fallback} (Status HTTP ${res.status})`
    const data = JSON.parse(text)
    return data?.error?.message ?? data?.message ?? `${fallback} (Status HTTP ${res.status})`
  } catch {
    return `${fallback} (Status HTTP ${res.status})`
  }
}

export function AdminTeamManagement() {
  const [activeTab, setActiveTab] = useState<'categories' | 'teams' | 'import' | 'matches'>('teams')
  const [categories, setCategories] = useState<Category[]>([])
  const [groups, setGroups] = useState<CompetitionGroup[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [matches, setMatches] = useState<Match[]>([])

  const [loading, setLoading] = useState<boolean>(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Auth & Session States
  const [session, setSession] = useState<UserSession | null>(null)
  const [csrfToken, setCsrfToken] = useState<string>('')
  const [loginUsername, setLoginUsername] = useState('superadmin')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginSubmitting, setLoginSubmitting] = useState(false)

  // Filters & Form States
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [includeArchived, setIncludeArchived] = useState<boolean>(false)

  // New Category Form
  const [catCode, setCatCode] = useState('')
  const [catLabel, setCatLabel] = useState('')

  // New Group Form
  const [groupCategory, setGroupCategory] = useState('')
  const [groupName, setGroupName] = useState('')

  // New Team Form
  const [teamCategory, setTeamCategory] = useState('')
  const [teamCode, setTeamCode] = useState('')
  const [teamName, setTeamName] = useState('')
  const [teamInstitution, setTeamInstitution] = useState('')
  const [teamGroup, setTeamGroup] = useState('')

  // CSV Import Form
  const [csvContent, setCsvContent] = useState('')
  const [previewResult, setPreviewResult] = useState<ImportPreviewResult | null>(null)

  // Match Schedule Form
  const [matchCategory, setMatchCategory] = useState('')
  const [matchGroup, setMatchGroup] = useState('')
  const [matchTeamA, setMatchTeamA] = useState('')
  const [matchTeamB, setMatchTeamB] = useState('')
  const [matchSequence, setMatchSequence] = useState(1)
  const [matchStage, setMatchStage] = useState('Babak Grup')
  const [matchStageValue, setMatchStageValue] = useState('GROUP')

  const loadData = useCallback(async () => {
    try {
      const [catsRes, grpsRes, teamsRes, matchesRes] = await Promise.all([
        fetch('/api/v1/categories'),
        fetch('/api/v1/groups'),
        fetch(`/api/v1/teams?includeArchived=${includeArchived}`),
        fetch('/api/v1/matches'),
      ])

      if (catsRes.status === 401 || catsRes.status === 403) {
        setErrorMessage('Sesi belum aktif. Silakan login sebagai Super-Admin atau Operator di bawah.')
        return
      }

      if (!catsRes.ok || !grpsRes.ok || !teamsRes.ok || !matchesRes.ok) {
        throw new Error('Gagal memuat data dari server.')
      }

      const [catsData, grpsData, teamsData, matchesData] = await Promise.all([
        catsRes.json(),
        grpsRes.json(),
        teamsRes.json(),
        matchesRes.json(),
      ])

      setCategories(catsData)
      setGroups(grpsData)
      setTeams(teamsData)
      setMatches(matchesData)
      if (catsData.length > 0 && !selectedCategory) {
        setSelectedCategory(catsData[0].id)
        setGroupCategory(catsData[0].id)
        setTeamCategory(catsData[0].id)
        setMatchCategory(catsData[0].id)
      }
      setErrorMessage(null)
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Kesalahan jaringan')
    } finally {
      setLoading(false)
    }
  }, [includeArchived, selectedCategory])

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/auth/me')
      if (res.ok) {
        const data = await res.json()
        setSession({ username: data.userId ?? 'superadmin', role: data.role })
        if (data.csrfToken) setCsrfToken(data.csrfToken)
        return true
      }
    } catch {}
    try {
      const bRes = await fetch('/api/v1/auth/bootstrap')
      if (bRes.ok) {
        const bData = await bRes.json()
        if (bData.csrfToken) setCsrfToken(bData.csrfToken)
      }
    } catch {}
    setSession(null)
    return false
  }, [])

  useEffect(() => {
    let ignore = false
    async function init() {
      await checkSession()
      if (!ignore) {
        await loadData()
      }
    }
    void init()
    return () => {
      ignore = true
    }
  }, [checkSession, loadData])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoginError(null)
    setLoginSubmitting(true)
    try {
      let token = csrfToken
      if (!token) {
        const bRes = await fetch('/api/v1/auth/bootstrap')
        if (bRes.ok) {
          const bData = await bRes.json()
          token = bData.csrfToken
          setCsrfToken(token)
        }
      }
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': token,
        },
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword,
        }),
      })
      if (!res.ok) {
        const errText = await parseResponseError(res, 'Login gagal')
        throw new Error(errText)
      }
      const data = await res.json()
      setSession({ username: loginUsername.trim(), role: data.role })
      if (data.csrfToken) setCsrfToken(data.csrfToken)
      setLoginPassword('')
      setErrorMessage(null)
      loadData()
    } catch (err: unknown) {
      setLoginError(err instanceof Error ? err.message : 'Login gagal')
    } finally {
      setLoginSubmitting(false)
    }
  }

  async function handleLogout() {
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'x-csrf-token': csrfToken },
      })
    } catch {}
    setSession(null)
    try {
      const bRes = await fetch('/api/v1/auth/bootstrap')
      if (bRes.ok) {
        const bData = await bRes.json()
        if (bData.csrfToken) setCsrfToken(bData.csrfToken)
      }
    } catch {}
    loadData()
  }

  // Category Actions
  async function handleCreateCategory(e: React.FormEvent) {
    e.preventDefault()
    setErrorMessage(null)
    try {
      const res = await fetch('/api/v1/categories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ code: catCode.trim(), label: catLabel.trim(), enabled: true }),
      })
      if (!res.ok) {
        const errMsg = await parseResponseError(res, 'Gagal membuat kategori')
        throw new Error(errMsg)
      }
      setCatCode('')
      setCatLabel('')
      loadData()
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Error')
    }
  }

  // Group Actions
  async function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault()
    setErrorMessage(null)
    try {
      const res = await fetch('/api/v1/groups', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ categoryId: groupCategory, name: groupName.trim() }),
      })
      if (!res.ok) {
        const errMsg = await parseResponseError(res, 'Gagal membuat grup')
        throw new Error(errMsg)
      }
      setGroupName('')
      loadData()
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Error')
    }
  }

  // Team Actions
  async function handleCreateTeam(e: React.FormEvent) {
    e.preventDefault()
    setErrorMessage(null)
    if (!teamGroup) {
      setErrorMessage('Grup wajib dipilih.')
      return
    }
    try {
      const res = await fetch('/api/v1/teams', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          categoryId: teamCategory,
          code: teamCode.trim(),
          name: teamName.trim(),
          institution: teamInstitution.trim() || null,
          groupId: teamGroup,
        }),
      })
      if (!res.ok) {
        const errMsg = await parseResponseError(res, 'Gagal membuat tim')
        throw new Error(errMsg)
      }
      setTeamCode('')
      setTeamName('')
      setTeamInstitution('')
      setTeamGroup('')
      loadData()
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Error')
    }
  }

  async function handleToggleArchiveTeam(team: Team) {
    setErrorMessage(null)
    try {
      const isArchived = team.archivedAt !== null
      const res = await fetch(`/api/v1/teams/${team.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          expectedRevision: team.revision,
          archived: !isArchived,
        }),
      })
      if (!res.ok) {
        const errMsg = await parseResponseError(res, 'Gagal mengubah status arsip tim')
        throw new Error(errMsg)
      }
      loadData()
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Error')
    }
  }

  // CSV Import Actions
  async function handlePreviewImport(e: React.FormEvent) {
    e.preventDefault()
    setErrorMessage(null)
    setPreviewResult(null)
    try {
      // Find latest category revision or use 1
      const revision = categories.length > 0 ? categories[0].revision : 1
      const res = await fetch('/api/v1/team-imports/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          csvContent,
          expectedRevision: revision,
        }),
      })
      if (!res.ok) {
        const errMsg = await parseResponseError(res, 'Gagal memproses pratinjau CSV')
        throw new Error(errMsg)
      }
      const data = await res.json()
      setPreviewResult(data)
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Error')
    }
  }

  async function handleCommitImport() {
    if (!previewResult) return
    setErrorMessage(null)
    try {
      const res = await fetch(`/api/v1/team-imports/${previewResult.id}/commit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          previewHash: previewResult.previewHash,
          expectedRevision: previewResult.catalogRevision,
        }),
      })
      if (!res.ok) {
        const errMsg = await parseResponseError(res, 'Gagal menyimpan impor tim')
        throw new Error(errMsg)
      }
      setPreviewResult(null)
      setCsvContent('')
      loadData()
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Error')
    }
  }

  // Match Schedule Actions
  async function handleCreateMatch(e: React.FormEvent) {
    e.preventDefault()
    setErrorMessage(null)
    try {
      const res = await fetch('/api/v1/matches', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          categoryId: matchCategory,
          groupId: matchGroup || null,
          stage: matchStageValue,
          sequence: Number(matchSequence),
          stageLabel: matchStage.trim() || null,
          teamAId: matchTeamA,
          teamBId: matchTeamB,
        }),
      })
      if (!res.ok) {
        const errMsg = await parseResponseError(res, 'Gagal membuat jadwal match')
        throw new Error(errMsg)
      }
      loadData()
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Error')
    }
  }

  const filteredTeams = selectedCategory
    ? teams.filter((t) => t.categoryId === selectedCategory)
    : teams

  const availableTeamsForMatch = matchCategory
    ? teams.filter((t) => t.categoryId === matchCategory && t.archivedAt === null)
    : []

  return (
    <div className="admin-container">
      <header className="admin-header">
        <div className="admin-header-main">
          <div>
            <h1>MRC X 2026 — Kontrol Data Tim & Pertandingan</h1>
            <p>Manajemen Master Kategori, Penempatan Grup, Tim, Impor CSV, dan Penjadwalan Manual.</p>
          </div>
          {session ? (
            <div className="admin-auth-bar">
              <span className="admin-user-badge">
                👤 Masuk sebagai: <strong>{session.username}</strong> ({session.role})
              </span>
              <button type="button" className="btn-secondary btn-sm" onClick={handleLogout}>
                Keluar (Logout)
              </button>
            </div>
          ) : (
            <div className="admin-auth-card">
              <div className="admin-auth-header">
                <strong>Autentikasi Super-Admin</strong>
                <span>Masuk untuk mengelola master data.</span>
              </div>
              <form onSubmit={handleLogin} className="admin-login-form">
                <input
                  type="text"
                  placeholder="Username"
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                  required
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                />
                <button type="submit" className="btn-primary btn-sm" disabled={loginSubmitting}>
                  {loginSubmitting ? '...' : 'Masuk'}
                </button>
              </form>
              {loginError && <div className="admin-auth-error">{loginError}</div>}
            </div>
          )}
        </div>
      </header>

      <nav className="admin-tabs">
        <button
          type="button"
          className={`admin-tab ${activeTab === 'teams' ? 'active' : ''}`}
          onClick={() => setActiveTab('teams')}
        >
          Daftar Tim
        </button>
        <button
          type="button"
          className={`admin-tab ${activeTab === 'categories' ? 'active' : ''}`}
          onClick={() => setActiveTab('categories')}
        >
          Kategori & Grup
        </button>
        <button
          type="button"
          className={`admin-tab ${activeTab === 'import' ? 'active' : ''}`}
          onClick={() => setActiveTab('import')}
        >
          Impor CSV
        </button>
        <button
          type="button"
          className={`admin-tab ${activeTab === 'matches' ? 'active' : ''}`}
          onClick={() => setActiveTab('matches')}
        >
          Jadwal Pertandingan
        </button>
      </nav>

      {errorMessage && (
        <div className="state-box error">
          <strong>Perhatian:</strong> {errorMessage}
        </div>
      )}

      {loading && <div className="state-box loading">Memuat data terkini...</div>}

      {/* TAB: TEAMS */}
      {activeTab === 'teams' && !loading && (
        <section className="section-panel">
          <h2>Tambah Tim Baru</h2>
          <form onSubmit={handleCreateTeam} className="form-grid">
            <div className="form-field">
              <label htmlFor="team-cat">Kategori</label>
              <select
                id="team-cat"
                value={teamCategory}
                onChange={(e) => {
                  setTeamCategory(e.target.value)
                  setTeamGroup('')
                }}
                required
              >
                <option value="">Pilih Kategori</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.label} ({c.code})</option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="team-code">Kode Tim (Unik)</label>
              <input
                id="team-code"
                type="text"
                placeholder="Contoh: LF-01"
                value={teamCode}
                onChange={(e) => setTeamCode(e.target.value)}
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="team-name">Nama Tim</label>
              <input
                id="team-name"
                type="text"
                placeholder="Contoh: Garuda 1"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="team-inst">Institusi (Opsional)</label>
              <input
                id="team-inst"
                type="text"
                placeholder="Contoh: PNP"
                value={teamInstitution}
                onChange={(e) => setTeamInstitution(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="team-grp">Grup</label>
              <select
                id="team-grp"
                value={teamGroup}
                onChange={(e) => setTeamGroup(e.target.value)}
                required
              >
                <option value="">Pilih Grup</option>
                {groups
                  .filter((g) => g.categoryId === teamCategory)
                  .map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
              </select>
            </div>
            <div className="form-field" style={{ alignSelf: 'flex-end' }}>
              <button type="submit" className="btn-primary">Simpan Tim</button>
            </div>
          </form>

          <hr style={{ margin: '1.5rem 0', borderColor: '#e2e8f0' }} />

          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
            <label>
              Filter Kategori:{' '}
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
              >
                <option value="">Semua Kategori</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
              />
              Tampilkan Tim Terarsip
            </label>
          </div>

          {filteredTeams.length === 0 ? (
            <div className="state-box empty">Belum ada data tim yang terdaftar.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>Nama Tim</th>
                  <th>Institusi</th>
                  <th>Grup</th>
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filteredTeams.map((team) => (
                  <tr key={team.id}>
                    <td><code>{team.code}</code></td>
                    <td><strong>{team.name}</strong></td>
                    <td>{team.institution ?? '—'}</td>
                    <td>{groups.find((g) => g.id === team.groupId)?.name ?? '—'}</td>
                    <td>
                      <span className={`status-badge ${team.archivedAt ? 'archived' : 'active'}`}>
                        {team.archivedAt ? 'Diarsipkan' : 'Aktif'}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className={team.archivedAt ? 'btn-success' : 'btn-danger'}
                        onClick={() => handleToggleArchiveTeam(team)}
                      >
                        {team.archivedAt ? 'Aktifkan Kembali' : 'Arsipkan'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* TAB: CATEGORIES & GROUPS */}
      {activeTab === 'categories' && !loading && (
        <section className="section-panel">
          <h2>Kategori Pertandingan</h2>
          <form onSubmit={handleCreateCategory} className="form-grid">
            <div className="form-field">
              <label htmlFor="cat-code">Kode Kategori</label>
              <input
                id="cat-code"
                type="text"
                placeholder="LF-OPEN"
                value={catCode}
                onChange={(e) => setCatCode(e.target.value)}
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="cat-label">Label Resmi</label>
              <input
                id="cat-label"
                type="text"
                placeholder="Line Follower Open"
                value={catLabel}
                onChange={(e) => setCatLabel(e.target.value)}
                required
              />
            </div>
            <div className="form-field" style={{ alignSelf: 'flex-end' }}>
              <button type="submit" className="btn-primary">Tambah Kategori</button>
            </div>
          </form>

          <table className="data-table" style={{ marginBottom: '2rem' }}>
            <thead>
              <tr>
                <th>Kode</th>
                <th>Label</th>
                <th>Revisi</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id}>
                  <td><code>{c.code}</code></td>
                  <td>{c.label}</td>
                  <td>{c.revision}</td>
                  <td>
                    <span className="status-badge active">{c.enabled ? 'Aktif' : 'Non-aktif'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Grup Kompetisi</h2>
          <form onSubmit={handleCreateGroup} className="form-grid">
            <div className="form-field">
              <label htmlFor="grp-cat">Kategori</label>
              <select
                id="grp-cat"
                value={groupCategory}
                onChange={(e) => setGroupCategory(e.target.value)}
                required
              >
                <option value="">Pilih Kategori</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="grp-name">Nama Grup</label>
              <input
                id="grp-name"
                type="text"
                placeholder="Grup A"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                required
              />
            </div>
            <div className="form-field" style={{ alignSelf: 'flex-end' }}>
              <button type="submit" className="btn-primary">Tambah Grup</button>
            </div>
          </form>

          <table className="data-table">
            <thead>
              <tr>
                <th>Kategori</th>
                <th>Nama Grup</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id}>
                  <td>{categories.find((c) => c.id === g.categoryId)?.label ?? g.categoryId}</td>
                  <td><strong>{g.name}</strong></td>
                  <td>
                    <span className="status-badge active">{g.enabled ? 'Aktif' : 'Non-aktif'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* TAB: IMPORT CSV */}
      {activeTab === 'import' && !loading && (
        <section className="section-panel">
          <h2>Impor Tim Melalui CSV (All-or-Nothing)</h2>
          <p style={{ fontSize: '0.875rem', color: '#64748b' }}>
            Format Header: <code>categoryCode,teamCode,teamName,institution,groupName</code>.
            Jika satu saja baris salah, seluruh berkas ditolak dan tidak ada data yang masuk sebagian.
          </p>

          <form onSubmit={handlePreviewImport}>
            <div className="form-field">
              <label htmlFor="csv-area">Isi CSV</label>
              <textarea
                id="csv-area"
                rows={6}
                value={csvContent}
                onChange={(e) => setCsvContent(e.target.value)}
                placeholder={'categoryCode,teamCode,teamName,institution,groupName\nLF-OPEN,LF-01,Tim Garuda,PNP,Grup A'}
                required
              />
            </div>
            <div style={{ marginTop: '1rem' }}>
              <button type="submit" className="btn-primary">Pratinjau Impor</button>
            </div>
          </form>

          {previewResult && (
            <div className="preview-summary">
              <h3>Hasil Pratinjau</h3>
              <p>
                Status: <strong>{previewResult.valid ? 'Valid (Siap Disimpan)' : 'Terdapat Kesalahan'}</strong><br />
                Total Baris: {previewResult.summary.totalRows} | Baris Valid: {previewResult.summary.validRows} | Baris Error: {previewResult.summary.errorRows}
              </p>

              {previewResult.errors.length > 0 && (
                <div className="error-list">
                  <strong>Daftar Kesalahan Baris:</strong>
                  <ul>
                    {previewResult.errors.map((err, idx) => (
                      <li key={idx}>Baris {err.row} ({err.column ?? 'umum'}): {err.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              {previewResult.valid && (
                <div style={{ marginTop: '1rem' }}>
                  <button type="button" className="btn-primary" onClick={handleCommitImport}>
                    Konfirmasi Simpan Seluruh Tim
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* TAB: MATCHES */}
      {activeTab === 'matches' && !loading && (
        <>
          <MatchSchedulePanel
            categories={categories}
            groups={groups}
            matches={matches}
            csrfToken={csrfToken}
            sessionActive={session?.role === 'SUPER_ADMIN'}
            onChanged={() => {
              void loadData()
            }}
            onError={setErrorMessage}
          />

          <section className="section-panel">
            <details className="schedule-manual-details">
              <summary>Tambahkan Jadwal Manual</summary>
              <p className="schedule-field-note">
                Gunakan formulir ini hanya untuk pertandingan di luar generate otomatis,
                misalnya babak gugur. Nomor urut harus belum dipakai pada kategori yang sama.
              </p>
              <form onSubmit={handleCreateMatch} className="form-grid">
            <div className="form-field">
              <label htmlFor="m-cat">Kategori</label>
              <select
                id="m-cat"
                value={matchCategory}
                onChange={(e) => {
                  setMatchCategory(e.target.value)
                  setMatchTeamA('')
                  setMatchTeamB('')
                }}
                required
              >
                <option value="">Pilih Kategori</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="m-stage-value">Tahap</label>
              <select
                id="m-stage-value"
                value={matchStageValue}
                onChange={(e) => setMatchStageValue(e.target.value)}
              >
                <option value="GROUP">Babak Grup</option>
                <option value="KNOCKOUT">Babak Gugur</option>
                <option value="FINAL">Final</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="m-stage">Label Babak / Tahap</label>
              <input
                id="m-stage"
                type="text"
                value={matchStage}
                onChange={(e) => setMatchStage(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="m-grp">Grup (Opsional)</label>
              <select
                id="m-grp"
                value={matchGroup}
                onChange={(e) => setMatchGroup(e.target.value)}
              >
                <option value="">Tanpa Grup</option>
                {groups
                  .filter((g) => g.categoryId === matchCategory)
                  .map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="m-seq">Urutan (Sequence)</label>
              <input
                id="m-seq"
                type="number"
                min={1}
                value={matchSequence}
                onChange={(e) => setMatchSequence(Number(e.target.value))}
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="m-teama">Tim A</label>
              <select
                id="m-teama"
                value={matchTeamA}
                onChange={(e) => setMatchTeamA(e.target.value)}
                required
              >
                <option value="">Pilih Tim A</option>
                {availableTeamsForMatch.map((t) => (
                  <option key={t.id} value={t.id}>{t.code} — {t.name}</option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="m-teamb">Tim B (Harus Berbeda)</label>
              <select
                id="m-teamb"
                value={matchTeamB}
                onChange={(e) => setMatchTeamB(e.target.value)}
                required
              >
                <option value="">Pilih Tim B</option>
                {availableTeamsForMatch.map((t) => (
                  <option key={t.id} value={t.id}>{t.code} — {t.name}</option>
                ))}
              </select>
            </div>
            <div className="form-field" style={{ alignSelf: 'flex-end' }}>
              <button type="submit" className="btn-primary">Buat Jadwal Match</button>
            </div>
          </form>

              <hr style={{ margin: '1.5rem 0', borderColor: '#e2e8f0' }} />

              {matches.length === 0 ? (
                <div className="state-box empty">Belum ada pertandingan yang dijadwalkan.</div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>No</th>
                      <th>Kategori</th>
                      <th>Grup</th>
                      <th>Tahap</th>
                      <th>Tim A</th>
                      <th>vs</th>
                      <th>Tim B</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matches.map((m) => (
                      <tr key={m.id}>
                        <td><strong>#{m.sequence}</strong></td>
                        <td>{m.category?.label ?? m.categoryId}</td>
                        <td>{m.group?.name ?? '—'}</td>
                        <td>{m.stageLabel ?? m.stage}</td>
                        <td>{m.teamA?.name ?? m.teamAId}</td>
                        <td><span style={{ color: '#94a3b8' }}>vs</span></td>
                        <td>{m.teamB?.name ?? m.teamBId}</td>
                        <td>
                          <span className="status-badge active">{m.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </details>
          </section>
        </>
      )}
    </div>
  )
}
