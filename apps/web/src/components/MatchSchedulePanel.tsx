import { useEffect, useMemo, useState } from 'react'
import './MatchSchedulePanel.css'

export interface ScheduleCategory {
  id: string
  code: string
  label: string
}

export interface ScheduleGroup {
  id: string
  categoryId: string
  name: string
}

export interface ScheduleMatchRow {
  id: string
  categoryId: string
  groupId: string | null
  stage: string
  stageLabel: string | null
  sequence: number
  rondeNumber: number | null
  tieId: string | null
  status: string
  hasStarted: boolean
  generationBatchId: string | null
  teamAId: string
  teamBId: string
  teamA?: { code: string; name: string }
  teamB?: { code: string; name: string }
  group?: { name: string }
}

interface PreviewMatch {
  tieId: string
  roundIndex: number
  rondeNumber: number
  teamAId: string
  teamACode: string
  teamAName: string
  teamBId: string
  teamBCode: string
  teamBName: string
  exists: boolean
}

interface PreviewGroup {
  groupId: string
  groupName: string
  teamCount: number
  plannedCount: number
  existingCount: number
  newCount: number
  matches: PreviewMatch[]
}

interface PreviewResult {
  categoryId: string
  categoryCode: string
  categoryLabel: string
  stage: string
  stageLabel: string | null
  rondeCount: number
  catalogRevision: number
  totalPlanned: number
  totalNew: number
  totalExisting: number
  groups: PreviewGroup[]
}

interface GenerateResult {
  batchId: string
  created: number
  skipped: Array<{ groupName: string; rondeNumber: number }>
  groups: Array<{ groupName: string; created: number; skipped: number }>
  catalogRevision: number
}

interface BatchRow {
  id: string
  categoryId: string
  stage: string
  rondeCount: number
  stageLabel: string | null
  createdCount: number
  createdAt: string
  rolledBackAt: string | null
}

export interface MatchSchedulePanelProps {
  categories: ScheduleCategory[]
  groups: ScheduleGroup[]
  matches: ScheduleMatchRow[]
  csrfToken: string
  sessionActive: boolean
  onChanged: () => void
  onError: (message: string | null) => void
}

const STAGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'GROUP', label: 'Babak Grup' },
]

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const text = await res.text()
    if (!text) return `${fallback} (Status HTTP ${res.status})`
    const data = JSON.parse(text)
    return data?.error?.message ?? `${fallback} (Status HTTP ${res.status})`
  } catch {
    return `${fallback} (Status HTTP ${res.status})`
  }
}

export function MatchSchedulePanel({
  categories,
  groups,
  matches,
  csrfToken,
  sessionActive,
  onChanged,
  onError,
}: MatchSchedulePanelProps) {
  const [categoryId, setCategoryId] = useState('')
  const [stage, setStage] = useState('GROUP')
  const [rondeCount, setRondeCount] = useState('')
  const [stageLabel, setStageLabel] = useState('Babak Grup')
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])

  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const [draftOrder, setDraftOrder] = useState<string[]>([])
  const [orderDirty, setOrderDirty] = useState(false)
  const [savingOrder, setSavingOrder] = useState(false)
  const [jumpTarget, setJumpTarget] = useState('')
  const [jumpTargetMatchId, setJumpTargetMatchId] = useState('')

  const [batches, setBatches] = useState<BatchRow[]>([])
  const [rollingBack, setRollingBack] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  const [selectionCategory, setSelectionCategory] = useState<string | null>(null)
  const [orderSourceKey, setOrderSourceKey] = useState<string | null>(null)

  const categoryGroups = useMemo(
    () => groups.filter((g) => g.categoryId === categoryId),
    [groups, categoryId],
  )

  const categoryMatches = useMemo(
    () =>
      matches
        .filter((m) => m.categoryId === categoryId)
        .slice()
        .sort((a, b) => a.sequence - b.sequence),
    [matches, categoryId],
  )

  const matchIdsKey = categoryMatches.map((m) => m.id).join(',')

  // Reset dependent state during render instead of in an effect, so switching
  // category never renders one frame with the previous category's selection.
  if (selectionCategory !== categoryId) {
    setSelectionCategory(categoryId)
    setSelectedGroupIds(categoryGroups.map((group) => group.id))
    setPreview(null)
    setStatusMessage(null)
  }

  if (orderSourceKey !== matchIdsKey) {
    setOrderSourceKey(matchIdsKey)
    setDraftOrder(categoryMatches.map((m) => m.id))
    setOrderDirty(false)
  }

  // Batch history is external state owned by the server, so an effect is the
  // right place to read it. State is only written after the await resolves.
  useEffect(() => {
    if (!categoryId || !sessionActive) {
      return
    }

    const controller = new AbortController()

    void (async () => {
      try {
        const res = await fetch(
          `/api/v1/match-schedules/batches?categoryId=${encodeURIComponent(categoryId)}`,
          { signal: controller.signal },
        )
        if (!res.ok) return
        const rows = (await res.json()) as BatchRow[]
        if (!controller.signal.aborted) setBatches(rows)
      } catch {
        if (!controller.signal.aborted) setBatches([])
      }
    })()

    return () => {
      controller.abort()
    }
  }, [categoryId, sessionActive, refreshToken])

  // Never show batches from a previously selected category: the fetch for the
  // new category may still be in flight.
  const visibleBatches = useMemo(
    () =>
      sessionActive ? batches.filter((batch) => batch.categoryId === categoryId) : [],
    [batches, categoryId, sessionActive],
  )

  const orderedMatches = useMemo(() => {
    const byId = new Map(categoryMatches.map((m) => [m.id, m]))
    return draftOrder.map((id) => byId.get(id)).filter(Boolean) as ScheduleMatchRow[]
  }, [draftOrder, categoryMatches])

  function toggleGroup(groupId: string) {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId],
    )
  }

  async function handlePreview() {
    onError(null)
    setStatusMessage(null)
    setPreview(null)

    if (!categoryId) {
      onError('Pilih kategori terlebih dahulu.')
      return
    }
    const ronde = Number(rondeCount)
    if (!Number.isInteger(ronde) || ronde < 1) {
      onError('Jumlah ronde per tie wajib diisi dengan angka positif. Tidak ada nilai bawaan.')
      return
    }
    if (selectedGroupIds.length === 0) {
      onError('Pilih minimal satu grup.')
      return
    }

    setPreviewLoading(true)
    try {
      const params = new URLSearchParams({
        categoryId,
        stage,
        rondeCount: String(ronde),
        groupIds: selectedGroupIds.join(','),
      })
      if (stageLabel.trim()) params.set('stageLabel', stageLabel.trim())

      const res = await fetch(`/api/v1/match-schedules/group-preview?${params.toString()}`)
      if (!res.ok) {
        throw new Error(await readError(res, 'Gagal menyiapkan pratinjau'))
      }
      const data: PreviewResult = await res.json()
      setPreview(data)
      setExpandedGroups(new Set(data.groups.slice(0, 2).map((g) => g.groupId)))
      setStatusMessage(
        `Pratinjau: ${data.totalNew} pertandingan baru, ${data.totalExisting} sudah ada.`,
      )
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Gagal menyiapkan pratinjau')
    } finally {
      setPreviewLoading(false)
    }
  }

  async function handleGenerate() {
    if (!preview) return
    onError(null)
    setGenerating(true)
    try {
      const res = await fetch('/api/v1/match-schedules/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          categoryId: preview.categoryId,
          stage: preview.stage,
          rondeCount: preview.rondeCount,
          stageLabel: stageLabel.trim() || null,
          groupIds: preview.groups.map((g) => g.groupId),
          expectedCatalogRevision: preview.catalogRevision,
          saveTieConfig: true,
        }),
      })
      if (!res.ok) {
        throw new Error(await readError(res, 'Gagal membuat jadwal'))
      }
      const data: GenerateResult = await res.json()
      setStatusMessage(
        `Selesai. ${data.created} pertandingan dibuat, ${data.skipped.length} dilewati karena sudah ada.`,
      )
      setPreview(null)
      onChanged()
      setRefreshToken((n) => n + 1)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Gagal membuat jadwal')
    } finally {
      setGenerating(false)
    }
  }

  function moveBy(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= draftOrder.length) return
    const next = [...draftOrder]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item as string)
    setDraftOrder(next)
    setOrderDirty(true)
  }

  function handleJump() {
    const position = Number(jumpTarget)
    if (!Number.isInteger(position) || position < 1 || position > draftOrder.length) {
      onError(`Nomor tujuan harus antara 1 dan ${draftOrder.length}.`)
      return
    }
    const currentIndex = draftOrder.findIndex((id) => id === jumpTargetMatchId)
    if (currentIndex === -1) return
    const next = [...draftOrder]
    const [item] = next.splice(currentIndex, 1)
    next.splice(position - 1, 0, item as string)
    setDraftOrder(next)
    setOrderDirty(true)
    setJumpTarget('')
  }

  async function handleSaveOrder() {
    if (!orderDirty || draftOrder.length === 0) return
    onError(null)
    setSavingOrder(true)
    try {
      const revision = await fetchCurrentCatalogRevision()
      const res = await fetch('/api/v1/match-schedules/reorder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          categoryId,
          expectedCatalogRevision: revision,
          orderedMatchIds: draftOrder,
        }),
      })
      if (!res.ok) {
        throw new Error(await readError(res, 'Gagal menyimpan urutan'))
      }
      setOrderDirty(false)
      setStatusMessage('Urutan pertandingan tersimpan.')
      onChanged()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Gagal menyimpan urutan')
    } finally {
      setSavingOrder(false)
    }
  }

  async function fetchCurrentCatalogRevision(): Promise<number> {
    // The server is the only authority for the revision; never guess it locally.
    const res = await fetch('/api/v1/match-schedules/catalog-revision')
    if (!res.ok) {
      throw new Error(await readError(res, 'Gagal membaca revisi katalog'))
    }
    const data = await res.json()
    return data.catalogRevision as number
  }

  async function handleRollback(batchId: string) {
    onError(null)
    setRollingBack(batchId)
    try {
      const res = await fetch(`/api/v1/match-schedules/${batchId}/rollback`, {
        method: 'POST',
        headers: { 'x-csrf-token': csrfToken },
      })
      if (!res.ok) {
        throw new Error(await readError(res, 'Gagal membatalkan batch'))
      }
      const data = await res.json()
      setStatusMessage(`Batch dibatalkan. ${data.deleted} pertandingan dihapus.`)
      onChanged()
      setRefreshToken((n) => n + 1)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Gagal membatalkan batch')
    } finally {
      setRollingBack(null)
    }
  }

  if (!sessionActive) {
    return (
      <section className="section-panel">
        <h2>Generate Jadwal Babak Grup</h2>
        <div className="state-box empty">
          Masuk sebagai Super-Admin untuk membuat jadwal otomatis.
        </div>
      </section>
    )
  }

  return (
    <section className="schedule-panel">
      <header className="schedule-panel-header">
        <div>
          <h2>Generate Jadwal Babak Grup</h2>
          <p className="schedule-panel-hint">
            Round robin satu putaran per grup. Jumlah pertandingan mengikuti jumlah tim
            (C(n,2) x ronde), bukan angka tetap. Sistem tidak menentukan peserta lolos.
          </p>
        </div>
      </header>

      {statusMessage && (
        <div className="schedule-status" role="status">
          {statusMessage}
        </div>
      )}

      <div className="schedule-config">
        <div className="form-field">
          <label htmlFor="sched-cat">Kategori</label>
          <select
            id="sched-cat"
            value={categoryId}
            onChange={(e) => {
              const nextId = e.target.value
              setCategoryId(nextId)
              const selectedCat = categories.find((c) => c.id === nextId)
              if (selectedCat && selectedCat.code.toLowerCase().includes('sumo')) {
                setRondeCount('3')
              }
            }}
          >
            <option value="">Pilih Kategori</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} ({c.code})
              </option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label htmlFor="sched-stage">Tahap</label>
          <select id="sched-stage" value={stage} onChange={(e) => setStage(e.target.value)}>
            {STAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label htmlFor="sched-ronde">Ronde per Pertemuan (Tie)</label>
          <input
            id="sched-ronde"
            type="number"
            min={1}
            max={99}
            value={rondeCount}
            onChange={(e) => setRondeCount(e.target.value)}
            placeholder="Belum ditetapkan panitia"
          />
          <span className="schedule-field-note">
            {categories.find((c) => c.id === categoryId)?.code.toLowerCase().includes('sumo')
              ? 'Sumobot: 3 kali main / ronde per pertemuan grup (2 menit/ronde).'
              : 'Tidak ada nilai bawaan. Isi sesuai keputusan panitia (mis. 3 untuk Sumobot).'}
          </span>
        </div>

        <div className="form-field">
          <label htmlFor="sched-label">Label Tahap</label>
          <input
            id="sched-label"
            type="text"
            value={stageLabel}
            onChange={(e) => setStageLabel(e.target.value)}
            placeholder="Babak Grup"
          />
        </div>
      </div>

      {categoryId && (
        <div className="schedule-groups">
          <span className="schedule-groups-label">Grup yang digenerate:</span>
          {categoryGroups.length === 0 && (
            <span className="schedule-field-note">
              Kategori ini belum memiliki grup.
            </span>
          )}
          {categoryGroups.map((group) => (
            <label key={group.id} className="schedule-group-chip">
              <input
                type="checkbox"
                checked={selectedGroupIds.includes(group.id)}
                onChange={() => toggleGroup(group.id)}
              />
              {group.name}
            </label>
          ))}
        </div>
      )}

      <div className="schedule-actions">
        <button
          type="button"
          className="btn-primary"
          onClick={handlePreview}
          disabled={previewLoading || !categoryId}
        >
          {previewLoading ? 'Menyiapkan...' : 'Pratinjau Generate'}
        </button>
      </div>

      {preview && (
        <div className="schedule-preview">
          <h3>
            Pratinjau — {preview.totalNew} baru / {preview.totalExisting} sudah ada
          </h3>
          <p className="schedule-field-note">
            {preview.totalPlanned} pertandingan direncanakan untuk {preview.groups.length} grup
            pada {preview.rondeCount} ronde per tie.
          </p>

          {preview.groups.map((group) => {
            const expanded = expandedGroups.has(group.groupId)
            return (
              <div key={group.groupId} className="schedule-preview-group">
                <button
                  type="button"
                  className="schedule-preview-toggle"
                  onClick={() =>
                    setExpandedGroups((prev) => {
                      const next = new Set(prev)
                      if (next.has(group.groupId)) next.delete(group.groupId)
                      else next.add(group.groupId)
                      return next
                    })
                  }
                >
                  <span>{expanded ? '▾' : '▸'}</span>
                  <strong>{group.groupName}</strong>
                  <span className="schedule-preview-meta">
                    {group.teamCount} tim · {group.newCount} baru
                    {group.existingCount > 0 ? ` · ${group.existingCount} dilewati` : ''}
                  </span>
                </button>

                {expanded && (
                  <table className="data-table schedule-preview-table">
                    <thead>
                      <tr>
                        <th>Putaran</th>
                        <th>Ronde</th>
                        <th>Tim A</th>
                        <th>vs</th>
                        <th>Tim B</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.matches.map((match) => (
                        <tr
                          key={`${match.tieId}-${match.rondeNumber}`}
                          className={match.exists ? 'schedule-row-existing' : ''}
                        >
                          <td>{match.roundIndex}</td>
                          <td>{match.rondeNumber}</td>
                          <td>{match.teamAName}</td>
                          <td className="schedule-vs">vs</td>
                          <td>{match.teamBName}</td>
                          <td>
                            {match.exists ? (
                              <span className="status-badge archived">Sudah ada</span>
                            ) : (
                              <span className="status-badge active">Baru</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })}

          <div className="schedule-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={handleGenerate}
              disabled={generating || preview.totalNew === 0}
            >
              {generating
                ? 'Membuat...'
                : `Konfirmasi Generate ${preview.totalNew} Pertandingan`}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setPreview(null)}
              disabled={generating}
            >
              Batal
            </button>
          </div>
        </div>
      )}

      <hr className="schedule-divider" />

      <h3>Jadwal Tersimpan</h3>
      {categoryMatches.length === 0 ? (
        <div className="state-box empty">
          Belum ada pertandingan untuk kategori ini.
        </div>
      ) : (
        <>
          <div className="schedule-order-bar">
            <span className="schedule-field-note">
              {orderDirty
                ? 'Urutan belum disimpan.'
                : 'Urutan tersimpan. Gunakan ▲▼ atau pindahkan ke nomor tertentu.'}
            </span>
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={handleSaveOrder}
              disabled={!orderDirty || savingOrder}
            >
              {savingOrder ? 'Menyimpan...' : 'Simpan Urutan'}
            </button>
          </div>

          <div className="schedule-jump">
            <label htmlFor="jump-match">Pertandingan</label>
            <select
              id="jump-match"
              value={jumpTargetMatchId}
              onChange={(e) => setJumpTargetMatchId(e.target.value)}
            >
              <option value="">Pilih pertandingan</option>
              {orderedMatches.map((match) => (
                <option key={match.id} value={match.id}>
                  #{match.sequence} — {match.teamA?.name ?? '?'} vs {match.teamB?.name ?? '?'}
                </option>
              ))}
            </select>
            <label htmlFor="jump-pos">Pindahkan ke #</label>
            <input
              id="jump-pos"
              type="number"
              min={1}
              max={orderedMatches.length}
              value={jumpTarget}
              onChange={(e) => setJumpTarget(e.target.value)}
            />
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={handleJump}
              disabled={!jumpTargetMatchId || !jumpTarget}
            >
              Pindahkan
            </button>
          </div>

          <table className="data-table schedule-table">
            <thead>
              <tr>
                <th>Urutan</th>
                <th>Grup</th>
                <th>Ronde</th>
                <th>Tahap</th>
                <th>Tim A</th>
                <th>vs</th>
                <th>Tim B</th>
                <th>Status</th>
                <th>Catatan</th>
              </tr>
            </thead>
            <tbody>
              {orderedMatches.map((match, index) => (
                <tr key={match.id}>
                  <td>
                    <div className="schedule-order-cell">
                      <strong>{index + 1}</strong>
                      <div className="schedule-order-buttons">
                        <button
                          type="button"
                          aria-label={`Naikkan pertandingan ${index + 1}`}
                          onClick={() => moveBy(index, -1)}
                          disabled={index === 0}
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          aria-label={`Turunkan pertandingan ${index + 1}`}
                          onClick={() => moveBy(index, 1)}
                          disabled={index === orderedMatches.length - 1}
                        >
                          ▼
                        </button>
                      </div>
                    </div>
                  </td>
                  <td>{match.group?.name ?? '—'}</td>
                  <td>{match.rondeNumber ?? '—'}</td>
                  <td>{match.stageLabel ?? match.stage}</td>
                  <td>
                    {match.teamA
                      ? `${match.teamA.code} — ${match.teamA.name}`
                      : match.teamAId}
                  </td>
                  <td className="schedule-vs">vs</td>
                  <td>
                    {match.teamB
                      ? `${match.teamB.code} — ${match.teamB.name}`
                      : match.teamBId}
                  </td>
                  <td>
                    <span className="status-badge active">{match.status}</span>
                  </td>
                  <td>
                    {match.hasStarted ? (
                      <span className="schedule-field-note">Sudah dimainkan</span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {visibleBatches.length > 0 && (
        <>
          <hr className="schedule-divider" />
          <h3>Riwayat Batch Generate</h3>
          <table className="data-table schedule-batch-table">
            <thead>
              <tr>
                <th>Dibuat</th>
                <th>Tahap</th>
                <th>Ronde/Tie</th>
                <th>Jumlah</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {visibleBatches.map((batch) => (
                <tr key={batch.id}>
                  <td>{new Date(batch.createdAt).toLocaleString('id-ID')}</td>
                  <td>{batch.stageLabel ?? batch.stage}</td>
                  <td>{batch.rondeCount}</td>
                  <td>{batch.createdCount}</td>
                  <td>
                    {batch.rolledBackAt ? (
                      <span className="status-badge archived">Dibatalkan</span>
                    ) : (
                      <span className="status-badge active">Aktif</span>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn-danger btn-sm"
                      onClick={() => handleRollback(batch.id)}
                      disabled={Boolean(batch.rolledBackAt) || rollingBack === batch.id}
                    >
                      {rollingBack === batch.id ? 'Membatalkan...' : 'Batalkan Batch'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}
