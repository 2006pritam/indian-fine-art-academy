import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

const NotificationContext = createContext(null)

const DEFAULT_DURATION = 4500

export function NotificationProvider({ children }) {
  const [notification, setNotification] = useState(null)
  const timerRef = useRef(null)

  const dismiss = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setNotification(null)
  }, [])

  const notify = useCallback((messageOrOptions, type = 'info', duration = DEFAULT_DURATION) => {
    const options = typeof messageOrOptions === 'string'
      ? { message: messageOrOptions, type, duration }
      : { ...messageOrOptions }

    const message = String(options.message || '').trim()
    if (!message) return

    if (timerRef.current) window.clearTimeout(timerRef.current)

    const next = {
      id: Date.now(),
      type: ['success', 'error', 'warning', 'info'].includes(options.type) ? options.type : 'info',
      title: options.title || '',
      message,
      duration: options.duration ?? DEFAULT_DURATION,
    }
    setNotification(next)

    if (next.duration > 0) {
      timerRef.current = window.setTimeout(dismiss, next.duration)
    }
  }, [dismiss])

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
  }, [])

  return (
    <NotificationContext.Provider value={{ notify, dismiss }}>
      {children}
      <NotificationBanner notification={notification} onDismiss={dismiss} />
    </NotificationContext.Provider>
  )
}

export function useNotification() {
  const context = useContext(NotificationContext)
  if (!context) throw new Error('useNotification must be used inside NotificationProvider')
  return context
}

const ICONS = { success: '✓', error: '!', warning: '!', info: 'i' }

function NotificationBanner({ notification, onDismiss }) {
  if (!notification) return null

  return (
    <div
      key={notification.id}
      className={`notification-banner notification-banner--${notification.type}`}
      role={notification.type === 'error' || notification.type === 'warning' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <span className="notification-banner__icon" aria-hidden="true">{ICONS[notification.type]}</span>
      <div className="notification-banner__content">
        {notification.title && <strong>{notification.title}</strong>}
        <span>{notification.message}</span>
      </div>
      <button type="button" className="notification-banner__close" onClick={onDismiss} aria-label="Dismiss notification">
        ×
      </button>
    </div>
  )
}

