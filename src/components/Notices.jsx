import React, { useEffect, useRef, useState } from 'react'
import { useNotification } from './NotificationBanner.jsx'

async function noticeApi(path, token, { method = 'GET', body, signal } = {}) {
  const response = await fetch(path, {
    method, signal,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Unable to load notices. Please try again.')
  return data
}

export function AdminNotices({ token }) {
  const { notify } = useNotification()
  const [notices, setNotices] = useState([])
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const inputRef = useRef(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    noticeApi('/api/admin/notices', token, { signal: controller.signal })
      .then(data => setNotices(data.notices))
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [token, reload])

  const clear = () => { setMessage(''); setEditingId(null) }
  const save = async event => {
    event.preventDefault()
    if (!message.trim() || busy) return
    setBusy(true); setError('')
    try {
      const data = await noticeApi(`/api/admin/notices${editingId ? `/${editingId}` : ''}`, token, {
        method: editingId ? 'PATCH' : 'POST', body: { message: message.trim() },
      })
      setNotices(previous => editingId ? previous.map(item => item.id === editingId ? data.notice : item) : [data.notice, ...previous])
      clear()
      notify({ type: 'success', title: editingId ? 'Notice updated' : 'Notice published', message: data.notice.is_active ? 'Students will see this notice on their dashboard.' : 'This notice is saved and hidden from students.' })
    } catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }
  const toggle = async notice => {
    setBusy(true); setError('')
    try {
      const data = await noticeApi(`/api/admin/notices/${notice.id}`, token, { method: 'PATCH', body: { isActive: !notice.is_active } })
      setNotices(previous => previous.map(item => item.id === notice.id ? data.notice : item))
      notify({ type: 'success', title: data.notice.is_active ? 'Notice published' : 'Notice hidden', message: data.notice.is_active ? 'The notice is visible to students.' : 'The notice has been removed from the student dashboard.' })
    } catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }
  const remove = async notice => {
    if (!window.confirm('Delete this notice from the notice board?')) return
    setBusy(true); setError('')
    try {
      await noticeApi(`/api/admin/notices/${notice.id}`, token, { method: 'DELETE' })
      setNotices(previous => previous.filter(item => item.id !== notice.id))
      if (editingId === notice.id) clear()
      notify({ type: 'success', title: 'Notice deleted', message: 'The notice was removed.' })
    } catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }

  return (
    <section className="notice-manager">
      <form className="notice-editor" onSubmit={save}>
        <h2>{editingId ? 'Edit notice' : 'Publish a student notice'}</h2>
        <p>Announcements appear as scrolling notices on every student dashboard.</p>
        <label htmlFor="notice-message">Notice text</label>
        <textarea id="notice-message" ref={inputRef} value={message} onChange={event => setMessage(event.target.value)} maxLength={1000} rows={4} required disabled={busy || loading} placeholder="Write an exam update, holiday announcement, or message for students…" />
        <small className="notice-editor__count">{message.length}/1,000 characters</small>
        {error && <p className="auth__err" role="alert">{error}</p>}
        <div className="notice-actions">
          <button className="btn btn--sm" disabled={busy || loading || !message.trim()}>{busy ? 'Saving…' : editingId ? 'Save changes' : 'Publish notice'}</button>
          {editingId && <button className="btn btn--sm btn--outline" type="button" onClick={clear} disabled={busy}>Cancel edit</button>}
          {error && <button className="btn btn--sm btn--outline" type="button" disabled={busy} onClick={() => setReload(value => value + 1)}>Reload notices</button>}
        </div>
      </form>
      <div className="notice-list">
        <h3>Notice board <small>({notices.length})</small></h3>
        {loading ? <p>Loading notices…</p> : !notices.length && <p className="ds-note">No notices yet. Publish your first announcement above.</p>}
        {notices.map(notice => (
          <article className="notice-item" key={notice.id}>
            <div className="notice-item__meta">
              <span className={`pay-badge pay-badge--${notice.is_active ? 'paid' : 'unpaid'}`}>{notice.is_active ? 'Published' : 'Hidden'}</span>
              <small>Updated {new Date(notice.updated_at).toLocaleString('en-IN')}</small>
            </div>
            <p>{notice.message}</p>
            <div className="notice-actions">
              <button type="button" className="btn btn--xs btn--outline" disabled={busy || loading} onClick={() => { setEditingId(notice.id); setMessage(notice.message); inputRef.current?.focus() }}>Edit</button>
              <button type="button" className="btn btn--xs" disabled={busy || loading} onClick={() => toggle(notice)}>{notice.is_active ? 'Hide notice' : 'Publish notice'}</button>
              <button type="button" className="dash__del" disabled={busy || loading} onClick={() => remove(notice)}>Delete</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

export function StudentNoticeBoard({ token }) {
  const [notices, setNotices] = useState([])
  const [paused, setPaused] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    let timer, loading = false
    const load = async () => {
      if (loading || controller.signal.aborted) return
      clearTimeout(timer)
      loading = true
      try {
        if (document.visibilityState !== 'hidden') {
          const data = await noticeApi('/api/student/notices', token, { signal: controller.signal })
          if (!controller.signal.aborted) { setNotices(data.notices); setError(false) }
        }
      } catch { if (!controller.signal.aborted) setError(true) }
      finally {
        loading = false
        if (!controller.signal.aborted) timer = window.setTimeout(load, 30000)
      }
    }
    void load()
    window.addEventListener('focus', load)
    document.addEventListener('visibilitychange', load)
    return () => {
      controller.abort(); clearTimeout(timer)
      window.removeEventListener('focus', load)
      document.removeEventListener('visibilitychange', load)
    }
  }, [token])

  if (!notices.length) return error ? <p className="ds-note" role="status">Notices are temporarily unavailable. Retrying shortly.</p> : null
  const duration = Math.max(20, notices.reduce((length, notice) => length + notice.message.length, 0) / 7)
  return (
    <section className="student-notice-board" aria-label="Academy notice board">
      <div className={`notice-marquee${paused ? ' is-paused' : ''}`}>
        <strong className="notice-marquee__label">Notice Board</strong>
        <div className="notice-marquee__window">
          <div className="notice-marquee__track" style={{ '--notice-duration': `${duration}s` }}>
            {[0, 1].map(copy => (
              <div className="notice-marquee__group" key={copy} aria-hidden={copy === 1 ? true : undefined}>
                {notices.map(notice => <span key={notice.id}>{notice.message}</span>)}
              </div>
            ))}
          </div>
        </div>
        <button type="button" className="notice-marquee__pause" aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? 'Resume' : 'Pause'}</button>
      </div>
      <details className="notice-board__all">
        <summary>Read all notices ({notices.length})</summary>
        <ul>{notices.map(notice => <li key={notice.id}>{notice.message}</li>)}</ul>
      </details>
    </section>
  )
}
