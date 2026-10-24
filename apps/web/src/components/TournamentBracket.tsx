import React from 'react'
import './TournamentBracket.css'

export interface BracketParticipant {
  id: string
  name: string
  code?: string
  score?: number | null
  isWinner?: boolean
}

export interface BracketMatch {
  id: string
  slotId: string
  label: string
  sequence?: number
  matchVersion?: number
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED' | 'EMPTY'
  teamA?: BracketParticipant | null
  teamB?: BracketParticipant | null
  sourceA?: string
  sourceB?: string
}

export interface TournamentBracketProps {
  categoryCode: string
  categoryLabel: string
  matches: BracketMatch[]
  onSelectMatch?: (matchId: string, matchVersion: number) => void
  readOnly?: boolean
}

export const TournamentBracket: React.FC<TournamentBracketProps> = ({
  categoryCode,
  categoryLabel,
  matches,
  onSelectMatch,
  readOnly = false,
}) => {
  const cat = categoryCode.toLowerCase()
  const isJunior = cat.includes('junior')
  const isSoccer = cat.includes('soccer')
  const isSumo = cat.includes('sumo')

  const getMatchBySlot = (slotId: string): BracketMatch | undefined => {
    return matches.find((m) => m.slotId === slotId)
  }

  const renderCard = (slotId: string, defaultTitle: string, defaultSourceA = '', defaultSourceB = '') => {
    const m = getMatchBySlot(slotId)
    const teamA = m?.teamA
    const teamB = m?.teamB
    const isLive = m?.status === 'IN_PROGRESS' || m?.status === 'PAUSED'
    const isDone = m?.status === 'COMPLETED'
    const canSelect = !readOnly && m && m.status === 'SCHEDULED' && teamA && teamB && onSelectMatch

    return (
      <div className={`bracket-match-card ${isLive ? 'is-live' : isDone ? 'is-completed' : ''}`}>
        <div className="bracket-match-header">
          <span>{m?.sequence ? `Match #${m.sequence}` : defaultTitle}</span>
          <span style={{ fontSize: '10px' }}>
            {isLive ? '🔴 LIVE' : isDone ? '✓ SELESAI' : 'TERJADWAL'}
          </span>
        </div>

        {/* Tim A */}
        <div className={`bracket-team-row ${teamA?.isWinner ? 'winner' : ''}`}>
          <span className="bracket-team-name" title={teamA?.name ?? defaultSourceA}>
            {teamA?.name || <em style={{ color: 'var(--color-stone)' }}>{defaultSourceA || 'TBD'}</em>}
          </span>
          <span className="bracket-team-score">{teamA?.score ?? '-'}</span>
        </div>

        {/* Tim B */}
        <div className={`bracket-team-row ${teamB?.isWinner ? 'winner' : ''}`}>
          <span className="bracket-team-name" title={teamB?.name ?? defaultSourceB}>
            {teamB?.name || <em style={{ color: 'var(--color-stone)' }}>{defaultSourceB || 'TBD'}</em>}
          </span>
          <span className="bracket-team-score">{teamB?.score ?? '-'}</span>
        </div>

        {canSelect && (
          <button
            type="button"
            className="btn btn-primary"
            style={{ padding: '3px 8px', fontSize: '11px', marginTop: '2px', width: '100%' }}
            onClick={() => onSelectMatch(m.id, m.matchVersion ?? 1)}
          >
            Pilih ke Meja &rarr;
          </button>
        )}
      </div>
    )
  }

  // 1. Template LINE FOLLOWER JUNIOR (8 Tim: QF -> SF -> Final)
  if (isJunior) {
    return (
      <div className="bracket-container">
        <div className="bracket-header">
          <h3 className="bracket-title">
            <span>🏆 Bagan Sistem Gugur: {categoryLabel}</span>
          </h3>
          <span className="status-pill info">8 Juara Grup (A s/d H)</span>
        </div>

        <div className="bracket-scroll-wrapper">
          <div className="bracket-tree">
            {/* Ronde 1: Perempat Final */}
            <div className="bracket-round">
              <div className="bracket-round-title">Perempat Final</div>
              {renderCard('QF1', 'QF 1', 'Juara Grup A', 'Juara Grup B')}
              {renderCard('QF2', 'QF 2', 'Juara Grup C', 'Juara Grup D')}
              {renderCard('QF3', 'QF 3', 'Juara Grup E', 'Juara Grup F')}
              {renderCard('QF4', 'QF 4', 'Juara Grup G', 'Juara Grup H')}
            </div>

            {/* Ronde 2: Semi Final */}
            <div className="bracket-round">
              <div className="bracket-round-title">Semi Final</div>
              {renderCard('SF1', 'Semi Final 1', 'Pemenang QF 1', 'Pemenang QF 2')}
              {renderCard('SF2', 'Semi Final 2', 'Pemenang QF 3', 'Pemenang QF 4')}
            </div>

            {/* Ronde 3: Final & Juara 3 */}
            <div className="bracket-round">
              <div className="bracket-round-title">Grand Final & Juara 3</div>
              {renderCard('FINAL', 'Grand Final (Juara 1 & 2)', 'Pemenang SF 1', 'Pemenang SF 2')}
              {renderCard('BRONZE', 'Perebutan Juara 3', 'Kalah SF 1', 'Kalah SF 2')}
            </div>

            {/* Podium Pemenang */}
            <div className="bracket-round" style={{ justifyContent: 'center' }}>
              <div className="bracket-winner-podium">
                <span className="trophy">🏆</span>
                <strong style={{ fontSize: '14px', color: '#854d0e' }}>JUARA 1 (WINNER)</strong>
                <span style={{ fontSize: '13px', fontWeight: 600 }}>
                  {getMatchBySlot('FINAL')?.teamA?.isWinner
                    ? getMatchBySlot('FINAL')?.teamA?.name
                    : getMatchBySlot('FINAL')?.teamB?.isWinner
                      ? getMatchBySlot('FINAL')?.teamB?.name
                      : '-'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 2. Template ROBOT SOCCER (11 Tim: Grup A-K dengan Slot K & Poin Tertinggi)
  if (isSoccer) {
    return (
      <div className="bracket-container">
        <div className="bracket-header">
          <h3 className="bracket-title">
            <span>🏆 Bagan Sistem Gugur: {categoryLabel}</span>
          </h3>
          <span className="status-pill info">11 Juara Grup (A s/d K) + Slot Poin Tertinggi</span>
        </div>

        <div className="bracket-scroll-wrapper">
          <div className="bracket-tree">
            {/* Babak 1 (Babak Gugur Awal) */}
            <div className="bracket-round">
              <div className="bracket-round-title">Babak Gugur 1</div>
              {renderCard('R1_AB', 'Match 1', 'Juara Grup A', 'Juara Grup B')}
              {renderCard('R1_CD', 'Match 2', 'Juara Grup C', 'Juara Grup D')}
              {renderCard('R1_EF', 'Match 3', 'Juara Grup E', 'Juara Grup F')}
              {renderCard('R1_GH', 'Match 4', 'Juara Grup G', 'Juara Grup H')}
              {renderCard('R1_IJ', 'Match 5', 'Juara Grup I', 'Juara Grup J')}
              <div className="bracket-special-slot">
                <span>GRUP K (Lolos Otomatis ke Perempat Final)</span>
              </div>
            </div>

            {/* Babak 2 (Perempat Final) */}
            <div className="bracket-round">
              <div className="bracket-round-title">Perempat Final</div>
              {renderCard('QF1', 'Perempat Final 1', 'Pemenang A vs B', 'Pemenang C vs D')}
              {renderCard('QF2', 'Perempat Final 2', 'Pemenang E vs F', 'Pemenang G vs H')}
              {renderCard('QF3', 'Perempat Final 3', 'Pemenang I vs J', 'Juara Grup K')}
              <div className="bracket-special-slot">
                <span>POIN TERTINGGI (Kualifikasi ke Semi Final)</span>
              </div>
            </div>

            {/* Babak 3 (Semi Final) */}
            <div className="bracket-round">
              <div className="bracket-round-title">Semi Final</div>
              {renderCard('SF1', 'Semi Final 1', 'Pemenang QF 1', 'Poin Tertinggi')}
              {renderCard('SF2', 'Semi Final 2', 'Pemenang QF 2', 'Pemenang QF 3')}
            </div>

            {/* Babak 4 (Final & Juara 3) */}
            <div className="bracket-round">
              <div className="bracket-round-title">Grand Final & Juara 3</div>
              {renderCard('FINAL', 'Grand Final', 'Pemenang SF 1', 'Pemenang SF 2')}
              {renderCard('BRONZE', 'Perebutan Juara 3', 'Kalah SF 1', 'Kalah SF 2')}
            </div>

            {/* Podium Pemenang */}
            <div className="bracket-round" style={{ justifyContent: 'center' }}>
              <div className="bracket-winner-podium">
                <span className="trophy">🏆</span>
                <strong style={{ fontSize: '14px', color: '#854d0e' }}>WINNER SOCCER</strong>
                <span style={{ fontSize: '13px', fontWeight: 600 }}>
                  {getMatchBySlot('FINAL')?.teamA?.isWinner
                    ? getMatchBySlot('FINAL')?.teamA?.name
                    : getMatchBySlot('FINAL')?.teamB?.isWinner
                      ? getMatchBySlot('FINAL')?.teamB?.name
                      : '-'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 3. Template SUMOBOT (10 Tim: Grup A-J dengan Slot Poin Tertinggi)
  if (isSumo) {
    return (
      <div className="bracket-container">
        <div className="bracket-header">
          <h3 className="bracket-title">
            <span>🏆 Bagan Sistem Gugur: {categoryLabel}</span>
          </h3>
          <span className="status-pill info">10 Juara Grup (A s/d J) + Slot Poin Tertinggi</span>
        </div>

        <div className="bracket-scroll-wrapper">
          <div className="bracket-tree">
            {/* Babak 1 */}
            <div className="bracket-round">
              <div className="bracket-round-title">Babak 1</div>
              {renderCard('R1_AB', 'Match 1', 'Juara Grup A', 'Juara Grup B')}
              {renderCard('R1_CD', 'Match 2', 'Juara Grup C', 'Juara Grup D')}
              {renderCard('R1_EF', 'Match 3', 'Juara Grup E', 'Juara Grup F')}
              {renderCard('R1_GH', 'Match 4', 'Juara Grup G', 'Juara Grup H')}
              {renderCard('R1_IJ', 'Match 5', 'Juara Grup I', 'Juara Grup J')}
            </div>

            {/* Babak 2 */}
            <div className="bracket-round">
              <div className="bracket-round-title">Babak 2</div>
              {renderCard('R2_1', 'Kualifikasi SF 1', 'Pemenang Match 1', 'Pemenang Match 2')}
              {renderCard('R2_2', 'Kualifikasi SF 2', 'Pemenang Match 3', 'Pemenang Match 4')}
              <div className="bracket-special-slot">
                <span>Pemenang Match 5 menunggu penantang</span>
              </div>
              <div className="bracket-special-slot">
                <span>POIN TERTINGGI (Lolos ke SF)</span>
              </div>
            </div>

            {/* Babak 3: Semi Final */}
            <div className="bracket-round">
              <div className="bracket-round-title">Semi Final</div>
              {renderCard('SF1', 'Semi Final 1', 'Pemenang Kualifikasi 1', 'Poin Tertinggi')}
              {renderCard('SF2', 'Semi Final 2', 'Pemenang Kualifikasi 2', 'Pemenang Match 5')}
            </div>

            {/* Babak 4: Final & Juara 3 */}
            <div className="bracket-round">
              <div className="bracket-round-title">Grand Final & Juara 3</div>
              {renderCard('FINAL', 'Grand Final', 'Pemenang SF 1', 'Pemenang SF 2')}
              {renderCard('BRONZE', 'Perebutan Juara 3', 'Kalah SF 1', 'Kalah SF 2')}
            </div>

            {/* Podium Pemenang */}
            <div className="bracket-round" style={{ justifyContent: 'center' }}>
              <div className="bracket-winner-podium">
                <span className="trophy">🏆</span>
                <strong style={{ fontSize: '14px', color: '#854d0e' }}>WINNER SUMO</strong>
                <span style={{ fontSize: '13px', fontWeight: 600 }}>
                  {getMatchBySlot('FINAL')?.teamA?.isWinner
                    ? getMatchBySlot('FINAL')?.teamA?.name
                    : getMatchBySlot('FINAL')?.teamB?.isWinner
                      ? getMatchBySlot('FINAL')?.teamB?.name
                      : '-'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 4. Template LINE FOLLOWER UMUM (13 Tim: Grup A-M)
  return (
    <div className="bracket-container">
      <div className="bracket-header">
        <h3 className="bracket-title">
          <span>🏆 Bagan Sistem Gugur: {categoryLabel}</span>
        </h3>
        <span className="status-pill info">13 Juara Grup (A s/d M) • Segitiga K-L-M</span>
      </div>

      <div className="bracket-scroll-wrapper">
        <div className="bracket-tree">
          {/* Babak 1: Babak Awal */}
          <div className="bracket-round">
            <div className="bracket-round-title">Babak Awal (Ronde 1)</div>
            {renderCard('R1_1', 'Match 1', 'Juara Grup A', 'Juara Grup B')}
            {renderCard('R1_2', 'Match 2', 'Juara Grup C', 'Juara Grup D')}
            {renderCard('R1_3', 'Match 3', 'Juara Grup E', 'Juara Grup F')}
            {renderCard('R1_4', 'Match 4', 'Juara Grup G', 'Juara Grup H')}
            {renderCard('R1_5', 'Match 5', 'Juara Grup I', 'Juara Grup J')}

            {/* Match 6: Kualifikasi Segitiga K, L, M */}
            <div className="bracket-round-group-box">
              <div className="bracket-group-box-header">
                <strong>Match 6 (Segitiga K, L, M)</strong>
                <span className="badge-warning">Top 1 Lanjut</span>
              </div>
              {renderCard('R1_6A', 'Match 6A', 'Juara Grup K', 'Juara Grup L')}
              {renderCard('R1_6B', 'Match 6B', 'Juara Grup K', 'Juara Grup M')}
              {renderCard('R1_6C', 'Match 6C', 'Juara Grup L', 'Juara Grup M')}
              <div style={{ fontSize: '11px', color: 'var(--color-stone)', textAlign: 'center', padding: '2px 0' }}>
                Peringkat 1 lolos ke Babak 2 • Peringkat 2 & 3 gugur
              </div>
            </div>
          </div>

          {/* Babak 2: Perempat Final (Menuju 3 Besar) */}
          <div className="bracket-round">
            <div className="bracket-round-title">Babak 2 (Menuju 3 Besar)</div>
            {renderCard('QF1', 'Babak 2 - Blok Atas', 'Pemenang Match 1', 'Pemenang Match 2')}
            {renderCard('QF2', 'Babak 2 - Blok Tengah', 'Pemenang Match 3', 'Pemenang Match 4')}
            {renderCard('QF3', 'Babak 2 - Blok Bawah', 'Pemenang Match 5', 'Top 1 Segitiga (K-L-M)')}
          </div>

          {/* Babak 3: Babak Final 3 Besar (Sesuai Diagram Resmi) */}
          <div className="bracket-round">
            <div className="bracket-round-title">Babak Final (3 Besar)</div>
            <div className="bracket-round-group-box" style={{ backgroundColor: '#fff', border: '2px solid #eab308' }}>
              <div className="bracket-group-box-header" style={{ paddingBottom: '6px', borderBottom: '1px solid #fef08a' }}>
                <strong style={{ color: '#854d0e', fontSize: '12px' }}>Perebutan Juara 1, 2, & 3</strong>
                <span className="badge-warning">3 Finalis</span>
              </div>
              {renderCard('FINAL_1', 'Final Match 1', 'Pemenang Blok Atas', 'Pemenang Blok Tengah')}
              {renderCard('FINAL_2', 'Final Match 2', 'Pemenang Blok Atas', 'Pemenang Blok Bawah')}
              {renderCard('FINAL_3', 'Final Match 3', 'Pemenang Blok Tengah', 'Pemenang Blok Bawah')}
            </div>
          </div>

          {/* Podium Juara 1 (WINNER 1st) */}
          <div className="bracket-round" style={{ justifyContent: 'center' }}>
            <div className="bracket-winner-podium">
              <span className="trophy">🏆</span>
              <strong style={{ fontSize: '14px', color: '#854d0e' }}>WINNER 1st</strong>
              <span style={{ fontSize: '11px', color: '#a16207' }}>Line Follower Umum</span>
              <span style={{ fontSize: '13px', fontWeight: 700, marginTop: '4px' }}>
                {getMatchBySlot('FINAL_1')?.teamA?.isWinner
                  ? getMatchBySlot('FINAL_1')?.teamA?.name
                  : getMatchBySlot('FINAL_1')?.teamB?.isWinner
                    ? getMatchBySlot('FINAL_1')?.teamB?.name
                    : '-'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
