import React from 'react'

interface PhaseStepperProps {
  currentPhase: string | null | undefined
  currentStatus: string
}

const STEPS = [
  { id: 'CALLING', label: 'Panggil Tim' },
  { id: 'VERIFICATION', label: 'Verifikasi' },
  { id: 'WARMUP', label: 'Uji Lapangan' },
  { id: 'READY', label: 'Siap Bertanding' },
  { id: 'COMPETITION', label: 'Berlangsung' },
  { id: 'RESULT', label: 'Keputusan' },
]

export const PhaseStepper: React.FC<PhaseStepperProps> = ({ currentPhase, currentStatus }) => {
  // Tentukan step indeks saat ini
  let activeIndex = -1

  if (currentPhase === 'PRE_MATCH' || !currentPhase) {
    activeIndex = -1
  } else if (currentPhase === 'CALLING') {
    activeIndex = 0
  } else if (currentPhase === 'VERIFICATION') {
    activeIndex = 1
  } else if (currentPhase === 'WARMUP') {
    activeIndex = 2
  } else if (currentPhase === 'READY') {
    activeIndex = 3
  } else if (currentPhase === 'COMPETITION' || currentPhase === 'INTERMISSION' || currentStatus === 'IN_PROGRESS' || currentStatus === 'PAUSED') {
    activeIndex = 4
  } else if (currentPhase === 'RESULT' || currentPhase === 'FINISHED' || currentStatus === 'COMPLETED') {
    activeIndex = 5
  }

  const activeLabel = activeIndex >= 0 ? STEPS[activeIndex]?.label : 'Pra-Pertandingan'

  return (
    <div style={{ marginBottom: '1.25rem', width: '100%' }}>
      {/* Mobile/Tablet Compact Stepper (tampil di layar <= 768px via media query inline/css) */}
      <div className="stepper-compact" style={{ display: 'none', background: '#f8fafc', padding: '8px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', fontWeight: 600 }}>
        <span>Langkah {activeIndex >= 0 ? activeIndex + 1 : 0} dari 6: <strong style={{ color: '#0284c7' }}>{activeLabel}</strong></span>
      </div>

      {/* Desktop & Tablet Full Stepper */}
      <div className="stepper-full" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: '#f8fafc', padding: '12px 16px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
        {STEPS.map((step, idx) => {
          const isDone = idx < activeIndex
          const isActive = idx === activeIndex

          return (
            <React.Fragment key={step.id}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', flex: 1, minWidth: '70px', textAlign: 'center' }}>
                <div
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    fontWeight: 700,
                    transition: 'all 0.2s ease',
                    background: isDone ? '#16a34a' : isActive ? '#0284c7' : '#e2e8f0',
                    color: isDone || isActive ? '#ffffff' : '#64748b',
                    boxShadow: isActive ? '0 0 0 3px rgba(2, 132, 199, 0.25)' : 'none',
                  }}
                >
                  {isDone ? '✓' : idx + 1}
                </div>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: isActive ? 700 : isDone ? 600 : 500,
                    color: isActive ? '#0369a1' : isDone ? '#15803d' : '#94a3b8',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {step.label}
                </span>
              </div>

              {idx < STEPS.length - 1 && (
                <div
                  style={{
                    flex: 1,
                    height: '3px',
                    background: idx < activeIndex ? '#16a34a' : '#e2e8f0',
                    margin: '0 4px',
                    marginBottom: '18px',
                    borderRadius: '2px',
                    transition: 'background 0.2s ease',
                  }}
                />
              )}
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}
