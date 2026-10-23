import React, { useState } from 'react'

interface ConfirmModalProps {
  isOpen: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'primary'
  requireReason?: boolean
  reasonLabel?: string
  reasonPlaceholder?: string
  onConfirm: (reason?: string) => void
  onCancel: () => void
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Konfirmasi',
  cancelText = 'Batal',
  variant = 'warning',
  requireReason = false,
  reasonLabel = 'Alasan (wajib diisi):',
  reasonPlaceholder = 'Tuliskan alasan...',
  onConfirm,
  onCancel,
}) => {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  if (!isOpen) return null

  const handleConfirm = () => {
    if (requireReason && !reason.trim()) {
      setError('Alasan wajib diisi sebelum melanjutkan.')
      return
    }
    setError('')
    onConfirm(reason.trim())
    setReason('')
  }

  const handleCancel = () => {
    setError('')
    setReason('')
    onCancel()
  }

  const btnBg = variant === 'danger' ? '#dc2626' : variant === 'warning' ? '#d97706' : '#0284c7'

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '1rem',
      }}
      onClick={handleCancel}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          maxWidth: '480px',
          width: '100%',
          padding: '1.5rem',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>
          {title}
        </h3>
        <p style={{ margin: '0 0 1rem 0', fontSize: '14px', color: '#475569', lineHeight: 1.5 }}>
          {message}
        </p>

        {requireReason && (
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#1e293b', marginBottom: '4px' }}>
              {reasonLabel}
            </label>
            <textarea
              value={reason}
              onChange={(e) => {
                setReason(e.target.value)
                if (e.target.value.trim()) setError('')
              }}
              placeholder={reasonPlaceholder}
              rows={2}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: '6px',
                border: error ? '1px solid #ef4444' : '1px solid #cbd5e1',
                fontSize: '13px',
                fontFamily: 'inherit',
                resize: 'none',
              }}
            />
            {error && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{error}</div>}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: '8px 16px', fontSize: '13px' }}
            onClick={handleCancel}
          >
            {cancelText}
          </button>
          <button
            type="button"
            className="btn"
            style={{
              padding: '8px 18px',
              fontSize: '13px',
              fontWeight: 600,
              backgroundColor: btnBg,
              color: '#ffffff',
              border: 'none',
            }}
            onClick={handleConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
