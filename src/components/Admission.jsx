import React, { useState, useEffect, useRef } from 'react'
import Logo from './Logo.jsx'
import { useNotification } from './NotificationBanner.jsx'
import { AdminNotices, StudentNoticeBoard } from './Notices.jsx'

const api = async (path, { method = 'GET', body, token, signal } = {}) => {
  const res = await fetch(path, {
    method,
    signal,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Something went wrong')
  return data
}

function paymentNotice(exam) {
  if (exam.payment_manual_override) return { type: 'info', title: 'Payment updated by admin', message: `The academy has marked this fee ${exam.payment_status}. Contact the academy if it needs correcting.` }
  if (exam.payment_status === 'paid') return { type: 'success', title: 'Payment confirmed', message: 'Your UPI payment has been confirmed and saved.' }
  if (exam.payment_status === 'payment_failed') return { type: 'warning', title: 'Payment not completed', message: 'The gateway reports this payment as failed or cancelled. If money was deducted, contact the academy before retrying.' }
  return { type: 'info', title: 'Payment pending', message: 'We will keep checking for confirmation. If money was deducted, wait or ask the academy to verify it before paying again.' }
}

// Recheck while the portal is open, including after switching back from a UPI app.
function usePaymentRefresh(exams, token, onUpdate) {
  const { notify } = useNotification()
  const updateRef = useRef(onUpdate)
  updateRef.current = onUpdate
  const ids = JSON.stringify(exams.filter(e => e.payment_method === 'upi' && e.payment_order_id && e.payment_status !== 'paid' && !e.payment_manual_override).map(e => e.id))
  useEffect(() => {
    const pendingIds = JSON.parse(ids)
    if (!pendingIds.length) return
    const controller = new AbortController()
    let timer, checking = false
    const check = async () => {
      if (checking || controller.signal.aborted) return
      clearTimeout(timer)
      checking = true
      try {
        if (document.visibilityState !== 'hidden') {
          for (const id of pendingIds) {
            try {
              const data = await api(`/api/student/exams/${id}/payment/status`, { method: 'POST', token, signal: controller.signal })
              if (controller.signal.aborted) return
              updateRef.current(data.exam)
              if (data.exam.payment_status === 'paid') notify(paymentNotice(data.exam))
            } catch { /* Manual checks report errors; automatic checks retry quietly. */ }
            if (controller.signal.aborted) return
          }
        }
      } finally {
        checking = false
        if (!controller.signal.aborted) timer = window.setTimeout(check, 15000)
      }
    }
    void check()
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      controller.abort()
      clearTimeout(timer)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [ids, token, notify])
}

const EMPTY = { fullName: '', coName: '', phone: '', email: '', aadhaar: '', dob: '', gender: '', address: '', currentClass: '', photo: '' }
const CLASSES = ['PP1', 'PP2', 'PP3', 'PP4', '1st Year', '2nd Year', '3rd Year Diploma', 'Bisharad', 'Ratna']
const RESULT_GRADES = [
  ['F', 'Fail'],
  ['D', 'Poor'],
  ['B', 'Average'],
  ['A', 'Good'],
  ['E', 'Excellent'],
  ['O', 'Outstanding'],
]
const RESULT_GRADE_LABELS = Object.fromEntries(RESULT_GRADES)

function ResultGrade({ grade }) {
  return (
    <span className={`result-grade-badge result-grade-badge--${String(grade).toLowerCase()}`}>
      <strong>{grade}</strong>
      <small>{RESULT_GRADE_LABELS[grade] || ''}</small>
    </span>
  )
}

// Exam year sessions 2025-2026 .. 2099-2100
const EXAM_YEARS = Array.from({ length: 75 }, (_, i) => `${2025 + i}-${2026 + i}`)

// Academic session label from an enrolment date, e.g. 2026 -> "2026-27"
const sessionFromDate = d => {
  const y = d ? new Date(d).getFullYear() : new Date().getFullYear()
  return `${y}-${String(y + 1).slice(-2)}`
}
// Card number derived from the reg no, e.g. IMFAA-2026-0001 -> RC-20260001
const cardNoFromReg = reg => (reg ? `RC-${(reg.match(/\d+/g) || []).join('')}` : '—')
const maskAadhaar = value => {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length === 12 ? `XXXX XXXX ${digits.slice(-4)}` : (value || '—')
}
const formatCardDate = value => {
  if (!value) return '—'
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}
const formatExamDate = value => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : (value || '—')
}

// Opens the browser's reliable Save as PDF dialog with a useful filename.
function printCard(id, filename) {
  const source = document.getElementById(id)
  if (!source) return
  document.querySelectorAll('.print-card-root').forEach(node => node.remove())
  document.querySelectorAll('.print-page-style').forEach(node => node.remove())
  document.body.classList.remove('is-printing-card')
  const previousTitle = document.title
  const printRoot = document.createElement('div')
  printRoot.className = `print-card-root${id === 'marksheet-print' ? ' print-card-root--marksheet' : ''}${id === 'pass-certificate-print' ? ' print-card-root--certificate' : ''}`
  printRoot.appendChild(source.cloneNode(true))
  const pageStyle = document.createElement('style')
  pageStyle.className = 'print-page-style'
  pageStyle.textContent = id === 'marksheet-print'
    ? '@page { size: A4 landscape; margin: 0.25in; }'
    : id === 'pass-certificate-print'
      ? '@page { size: A4 landscape; margin: 0.2in; }'
      : '@page { size: A4 portrait; margin: 0.35in; }'
  document.head.appendChild(pageStyle)
  document.body.appendChild(printRoot)
  document.body.classList.add('is-printing-card')
  document.title = filename
  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    document.body.classList.remove('is-printing-card')
    printRoot.remove()
    pageStyle.remove()
    document.title = previousTitle
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  window.requestAnimationFrame(() => {
    window.print()
    // Some mobile browsers do not dispatch afterprint, so keep a generous fallback.
    window.setTimeout(cleanup, 300000)
  })
}

const STATUS_LABEL = { approved: 'Approved', pending: 'Pending', rejected: 'Rejected' }
function StatusBadge({ status }) {
  const s = status || 'pending'
  return <span className={`status-badge status-badge--${s}`}>{STATUS_LABEL[s] || s}</span>
}

function PayBadge({ status }) {
  const labels = { paid: 'Paid', cash_pending: 'Cash pending', payment_pending: 'UPI pending', payment_failed: 'Payment failed', unpaid: 'Unpaid' }
  const s = status || 'unpaid'
  return <span className={`pay-badge pay-badge--${s}`}>{labels[s] || s}</span>
}

function fileToDataUrl(file, max = 400) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.8))
      }
      img.onerror = reject
      img.src = reader.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/* ─── Registration Form ─────────────────────────────────────────────────── */
function RegistrationForm({ initial = EMPTY, onSave, onCancel, busy, err, editMode = false }) {
  const [f, setF] = useState(initial)
  const [photoMenu, setPhotoMenu] = useState(false)
  const cameraRef = useRef(null)
  const galleryRef = useRef(null)
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }))
  const pickPhoto = async e => {
    const file = e.target.files[0]
    setPhotoMenu(false)
    if (file) setF(p => ({ ...p, photo: '' })) // reset preview while loading
    if (file) { const url = await fileToDataUrl(file); setF(p => ({ ...p, photo: url })) }
    e.target.value = '' // allow re-picking the same file
  }

  return (
    <form className="reg-form" onSubmit={e => { e.preventDefault(); onSave(f) }}>
      <div className="reg-form__header">
        <h2>{editMode ? 'Edit Student' : 'New Student Registration'}</h2>
        <p>Fields marked * are required. Aadhaar + Date of Birth = student login credentials.</p>
      </div>
      {err && <p className="auth__err">{err}</p>}

      <div className="reg-form__section">
        <h4>Personal Details</h4>
        <div className="reg-form__grid">
          <label className="reg-form__full">Full Name *
            <input value={f.fullName} onChange={set('fullName')} required placeholder="Student's full name" />
          </label>
          <label>C/O (Father / Guardian) *
            <input value={f.coName} onChange={set('coName')} placeholder="Parent or guardian name" />
          </label>
          <label>Gender
            <select value={f.gender} onChange={set('gender')}>
              <option value="">Select</option>
              <option>Male</option><option>Female</option><option>Other</option>
            </select>
          </label>
          <label>Date of Birth * <small>(login password)</small>
            <input type="date" value={f.dob} onChange={set('dob')} required />
          </label>
          <label>Aadhaar Number * <small>(login ID)</small>
            <input value={f.aadhaar} onChange={set('aadhaar')} required placeholder="12-digit Aadhaar" maxLength={12} />
          </label>
        </div>
      </div>

      <div className="reg-form__section">
        <h4>Contact Details</h4>
        <div className="reg-form__grid">
          <label>Phone Number
            <input value={f.phone} onChange={set('phone')} placeholder="Mobile number" />
          </label>
          <label>Email Address
            <input type="email" value={f.email} onChange={set('email')} placeholder="Email (optional)" />
          </label>
          <label className="reg-form__full">Address
            <textarea value={f.address} onChange={set('address')} rows={2} placeholder="Full residential address" />
          </label>
        </div>
      </div>

      <div className="reg-form__section">
        <h4>Academic Details</h4>
        <div className="reg-form__grid">
          <label>Current Class / Level
            <select value={f.currentClass} onChange={set('currentClass')}>
              <option value="">Select level</option>
              {CLASSES.map(c => <option key={c}>{c}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="reg-form__section">
        <h4>Student Photo</h4>
        <div className="reg-form__photo-row">
          <div className="reg-form__photo-preview">
            {f.photo
              ? <img src={f.photo} alt="preview" />
              : <span>{f.fullName ? f.fullName[0] : '?'}</span>}
          </div>
          <button type="button" className="btn btn--sm btn--outline" onClick={() => setPhotoMenu(true)}>
            {f.photo ? 'Change Photo' : 'Choose Photo'}
          </button>
          {/* Hidden inputs driven by the popup */}
          <input ref={cameraRef} type="file" accept="image/*" capture="user" onChange={pickPhoto} style={{ display: 'none' }} />
          <input ref={galleryRef} type="file" accept="image/*" onChange={pickPhoto} style={{ display: 'none' }} />
        </div>
      </div>

      {/* Photo source popup */}
      {photoMenu && (
        <div className="photo-modal" onClick={() => setPhotoMenu(false)}>
          <div className="photo-modal__sheet" onClick={e => e.stopPropagation()}>
            <h4 className="photo-modal__title">Add Student Photo</h4>
            <button type="button" className="photo-modal__opt" onClick={() => { setPhotoMenu(false); cameraRef.current?.click() }}>
              <span className="photo-modal__ico">📷</span>
              <span><strong>Take Photo</strong><small>Use the camera live</small></span>
            </button>
            <button type="button" className="photo-modal__opt" onClick={() => { setPhotoMenu(false); galleryRef.current?.click() }}>
              <span className="photo-modal__ico">🖼️</span>
              <span><strong>Choose from Gallery</strong><small>Pick an existing image</small></span>
            </button>
            <button type="button" className="photo-modal__cancel" onClick={() => setPhotoMenu(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="reg-form__actions">
        {onCancel && <button type="button" className="btn btn--ghost-dark" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="btn" disabled={busy}>{busy ? 'Saving…' : editMode ? 'Update Student' : 'Register Student'}</button>
      </div>
    </form>
  )
}

/* ─── Student Profile Card ──────────────────────────────────────────────── */
function ProfileCard({ s, onEdit, onDelete, backLabel, onBack, onApprove, onReject }) {
  return (
    <div className="profile-card">
      {onBack && <button className="dash__back" onClick={onBack}>← {backLabel || 'Back'}</button>}
      <div className="profile-card__top">
        <div className="profile-card__photo">
          {s.photo ? <img src={s.photo} alt={s.full_name} /> : <span>{s.full_name?.[0]}</span>}
        </div>
        <div className="profile-card__meta">
          {s.reg_no && <div className="reg-badge">{s.reg_no}</div>}
          <h2>{s.full_name}</h2>
          <span className="student-card__course">{s.current_class || 'No class assigned'}</span>
          {s.status && <div className="profile-card__status"><StatusBadge status={s.status} /></div>}
          {(onEdit || onDelete || onApprove || onReject) && (
            <div className="profile-card__actions">
              {onApprove && s.status !== 'approved' && <button className="btn btn--sm btn--approve" onClick={onApprove}>✓ Approve</button>}
              {onReject && s.status !== 'rejected' && <button className="btn btn--sm btn--reject" onClick={onReject}>✗ Reject</button>}
              {onEdit && <button className="btn btn--sm" onClick={onEdit}>Edit</button>}
              {onDelete && <button className="dash__del" onClick={onDelete}>Delete</button>}
            </div>
          )}
        </div>
      </div>
      <div className="profile-card__grid">
        <div><small>C/O</small><strong>{s.co_name || '—'}</strong></div>
        <div><small>Phone</small><strong>{s.phone || '—'}</strong></div>
        <div><small>Email</small><strong>{s.email || '—'}</strong></div>
        <div><small>Aadhaar</small><strong>{s.aadhaar}</strong></div>
        <div><small>Date of Birth</small><strong>{s.dob}</strong></div>
        <div><small>Gender</small><strong>{s.gender || '—'}</strong></div>
        <div className="profile-card__full"><small>Address</small><strong>{s.address || '—'}</strong></div>
        <div><small>Enrolled On</small><strong>{s.created_at ? new Date(s.created_at).toLocaleDateString('en-IN') : '—'}</strong></div>
      </div>
    </div>
  )
}

/* ─── Registration Card (printable / downloadable) ──────────────────────── */
function RegistrationCard({ s }) {
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(s.reg_no || s.aadhaar || '')}`
  const rows = [
    ['Candidate Name', s.full_name],
    ['C/O Name', s.co_name],
    ['Class / Level', s.current_class],
    ['Aadhaar Number', maskAadhaar(s.aadhaar)],
    ['Date of Birth', formatCardDate(s.dob)],
    ['Gender', s.gender],
  ]

  return (
    <div className="reg-card-wrap">
      <div className="reg-card" id="reg-card-print">
        <div className="reg-card__note">
          <span>Official student record</span>
          <strong>Keep this card safe for all academy correspondence</strong>
        </div>

        <div className="reg-card__body">
          <div className="reg-card__head">
            <div className="reg-card__school">
              <Logo size={58} />
              <div>
                <strong>The Indian Music &amp; Fine Art Academy</strong>
                <small>West Bengal, India · Student Registration</small>
              </div>
            </div>
            <div className="reg-card__head-meta">
              <span className={`card-status ${s.status === 'approved' ? 'card-status--active' : 'card-status--waiting'}`}>
                {s.status === 'approved' ? 'Verified record' : 'Registration submitted'}
              </span>
              <div className="reg-card__photo">
                {s.photo ? <img src={s.photo} alt={s.full_name} /> : <span>{s.full_name?.[0] || '?'}</span>}
              </div>
            </div>
          </div>

          <div className="reg-card__ids">
            <div><span>Session</span><strong>{sessionFromDate(s.created_at)}</strong></div>
            <div><span>Registration Card No</span><strong>{cardNoFromReg(s.reg_no)}</strong></div>
            <div><span>Registration No</span><strong>{s.reg_no || '—'}</strong></div>
            <div><span>Mobile</span><strong>{s.phone || '—'}</strong></div>
          </div>

          <table className="reg-card__table">
            <tbody>
              {rows.map(([label, val]) => (
                <tr key={label}>
                  <th>{label}</th>
                  <td>{val || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="reg-card__footer">
            <div className="reg-card__box">
              <span className="reg-card__box-label">School Stamp</span>
              <Logo size={78} />
            </div>
            <div className="reg-card__box">
              <span className="reg-card__box-label">QR Verification</span>
              <img className="reg-card__qr" src={qrSrc} alt="Registration QR code" />
            </div>
            <div className="reg-card__box">
              <span className="reg-card__box-label">Principal Sign</span>
              <span className="reg-card__sign">Authorised Signatory</span>
              <span className="reg-card__verified">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.2 14.2-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4-7 7Z" />
                </svg>
                Digitally Verified
              </span>
            </div>
          </div>

          <p className="reg-card__caption">System generated registration card · No physical signature required</p>
        </div>
      </div>

      <div className="card-download-panel">
        <div>
          <strong>Save your registration card</strong>
          <span>Choose “Save to PDF” in the print window to download it.</span>
        </div>
        <div className="card-download-panel__actions">
          <button className="btn" onClick={() => printCard('reg-card-print', `IMFAA-Registration-${s.reg_no || 'card'}`)}>Download PDF</button>
          <button className="btn btn--outline" onClick={() => printCard('reg-card-print', `IMFAA-Registration-${s.reg_no || 'card'}`)}>Print card</button>
        </div>
      </div>
    </div>
  )
}

/* ─── Admit Card (printable / downloadable) ─────────────────────────────── */
// `e` is an exam-form row carrying joined student fields (full_name, co_name,
// photo, dob) plus roll_no, center_name, center_code, exam_class, exam_year,
// exam_datetime. Printing targets `#admit-card-print`.
function AdmitCard({ e }) {
  const roll = String(e.roll_no || '')
  // Fixed 6 boxes for the roll number, right-aligned like the reference card.
  const rollBoxes = roll.padStart(6, ' ').slice(-6).split('')
  const rows = [
    ["Student's Name", e.full_name],
    ["Father's / C/O Name", e.co_name],
    ['Date of Birth', formatCardDate(e.dob)],
    ['Examination Centre', e.center_name ? `${e.center_name} (${e.center_code})` : '—'],
    ['Class / Level', e.exam_class],
    ['Session', e.exam_year],
  ]

  return (
    <div className="admit-card-wrap">
      <div className="admit-card" id="admit-card-print">
        <div className="admit-card__header">
          <div className="admit-card__header-brand">
            <Logo size={48} />
            <div>
              <strong>The Indian Music &amp; Fine Art Academy</strong>
              <small>West Bengal, India · Examination Division</small>
            </div>
          </div>
          <span className="card-status card-status--exam">Valid for examination</span>
        </div>

        <div className="admit-card__titlerow">
          <span className="admit-card__title">ADMIT CARD</span>
          <div className="admit-card__roll">
            <span className="admit-card__roll-label">ROLL NO.</span>
            <div className="admit-card__roll-boxes">
              {rollBoxes.map((c, i) => (
                <span key={i}>{c.trim()}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="admit-card__body">
          <table className="admit-card__table">
            <tbody>
              {rows.map(([label, val]) => (
                <tr key={label}>
                  <th>{label}</th>
                  <td>{val || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="admit-card__photo">
            {e.photo ? <img src={e.photo} alt={e.full_name} /> : <span>{e.full_name?.[0] || '?'}</span>}
          </div>
        </div>

        <p className="admit-card__exam-time">
          <strong>Time &amp; Date of Examination:</strong> {e.exam_datetime || '—'}
        </p>

        <div className="admit-card__footer">
          <span className="admit-card__verified">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.2 14.2-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4-7 7Z" />
            </svg>
            Digitally Verified
          </span>
          <p className="admit-card__caption">System generated admit card · Carry this card and a valid photo ID</p>
        </div>
      </div>

      <div className="card-download-panel">
        <div>
          <strong>Download your admit card</strong>
          <span>Choose “Save to PDF” in the print window to keep a copy on your phone.</span>
        </div>
        <div className="card-download-panel__actions">
          <button className="btn" onClick={() => printCard('admit-card-print', `IMFAA-Admit-${e.roll_no || 'card'}`)}>Download PDF</button>
          <button className="btn btn--outline" onClick={() => printCard('admit-card-print', `IMFAA-Admit-${e.roll_no || 'card'}`)}>Print card</button>
        </div>
      </div>
    </div>
  )
}

/* ─── Marksheet (printable / downloadable) ─────────────────────────────── */
const formatMark = value => {
  const number = Number(value)
  if (!Number.isFinite(number)) return '0'
  return Number.isInteger(number) ? String(number) : number.toFixed(2)
}

function Marksheet({ student, results }) {
  const first = results[0]
  const grandObtained = results.reduce((sum, row) => sum + Number(row.total_obtained || 0), 0)
  const grandTotal = results.reduce((sum, row) => sum + Number(row.total_marks || 0), 0)
  const overallPercentage = grandTotal > 0 ? (grandObtained / grandTotal) * 100 : 0
  const failed = results.some(row => String(row.grade).toUpperCase() === 'F')
  const overallResult = failed ? 'FAIL' : 'PASS'
  const fileName = `IMFAA-Marksheet-${first.roll_no || student.reg_no || 'result'}-${first.exam_year || ''}`

  const details = [
    ['Student Name', student.full_name],
    ['C/O Name', student.co_name],
    ['Roll Number', first.roll_no],
    ['Registration No.', first.reg_no || student.reg_no],
    ['Examination Class', first.exam_class],
    ['Session', first.exam_year],
    ['Centre Name', first.center_name],
    ['Centre Code', first.center_code],
  ]

  return (
    <div className="marksheet-wrap">
      <article className="marksheet" id="marksheet-print">
        <Logo size={360} className="marksheet__watermark" />
        <div className="marksheet__content">
          <header className="marksheet__header">
            <Logo size={72} />
            <div className="marksheet__academy">
              <span>The Indian Music &amp; Fine Art Academy</span>
              <strong>Statement of Marks</strong>
              <small>West Bengal, India · Examination Division</small>
            </div>
            <div className="marksheet__verified">
              <span>Verified</span>
              <small>{first.exam_year}</small>
            </div>
          </header>

          <div className="marksheet__titlebar">
            <span>Academic Marksheet</span>
            <strong>{first.exam_class}</strong>
          </div>

          <section className="marksheet__details" aria-label="Student and examination details">
            {details.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value || '—'}</strong>
              </div>
            ))}
          </section>

          <div className="marksheet__table-wrap">
            <table className="marksheet__table">
              <thead>
                <tr>
                  <th rowSpan="2">No.</th>
                  <th rowSpan="2" className="marksheet__subject">Subject</th>
                  <th colSpan="2">Sectional</th>
                  <th colSpan="2">Practical</th>
                  <th colSpan="2">Theory</th>
                  <th colSpan="2">Total</th>
                  <th rowSpan="2">%</th>
                  <th rowSpan="2">Grade</th>
                  <th rowSpan="2">Result</th>
                </tr>
                <tr>
                  <th>Obt.</th><th>Max.</th>
                  <th>Obt.</th><th>Max.</th>
                  <th>Obt.</th><th>Max.</th>
                  <th>Obt.</th><th>Max.</th>
                </tr>
              </thead>
              <tbody>
                {results.map((row, index) => {
                  const subjectFailed = String(row.grade).toUpperCase() === 'F'
                  return (
                    <tr key={row.id}>
                      <td>{index + 1}</td>
                      <td className="marksheet__subject"><strong>{row.subject}</strong></td>
                      <td>{formatMark(row.sectional_obtained)}</td>
                      <td>{formatMark(row.sectional_total)}</td>
                      <td>{formatMark(row.practical_obtained)}</td>
                      <td>{formatMark(row.practical_total)}</td>
                      <td>{formatMark(row.theory_obtained)}</td>
                      <td>{formatMark(row.theory_total)}</td>
                      <td><strong>{formatMark(row.total_obtained)}</strong></td>
                      <td>{formatMark(row.total_marks)}</td>
                      <td>{Number(row.percentage || 0).toFixed(2)}</td>
                      <td><strong>{row.grade}</strong></td>
                      <td><span className={`marksheet__row-result ${subjectFailed ? 'is-fail' : 'is-pass'}`}>{subjectFailed ? 'Fail' : 'Pass'}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <section className="marksheet__summary" aria-label="Overall result">
            <div><span>Grand Total</span><strong>{formatMark(grandObtained)} / {formatMark(grandTotal)}</strong></div>
            <div><span>Overall Percentage</span><strong>{overallPercentage.toFixed(2)}%</strong></div>
            <div className={`marksheet__final-result ${failed ? 'is-fail' : 'is-pass'}`}>
              <span>Final Result</span><strong>{overallResult}</strong>
            </div>
          </section>

          <footer className="marksheet__footer">
            <div className="marksheet__signature"><span>Prepared &amp; Checked By</span><strong>Examination Department</strong></div>
            <div className="marksheet__seal"><Logo size={62} /><span>Academy Seal</span></div>
            <div className="marksheet__signature"><span>Controller of Examination</span><strong>Authorised Signatory</strong></div>
          </footer>
          <p className="marksheet__note">This is a digitally generated marksheet. Any alteration makes this document invalid.</p>
        </div>
      </article>

      <div className="card-download-panel">
        <div>
          <strong>Save your official marksheet</strong>
          <span>Choose “Save to PDF” in the print window to download a copy.</span>
        </div>
        <div className="card-download-panel__actions">
          <button className="btn" onClick={() => printCard('marksheet-print', fileName)}>Download PDF</button>
          <button className="btn btn--outline" onClick={() => printCard('marksheet-print', fileName)}>Print marksheet</button>
        </div>
      </div>
    </div>
  )
}

/* ─── Pass Certificate (printable / downloadable) ──────────────────────── */
function PassCertificate({ student, results }) {
  if (!results?.length || results.some(row => String(row.grade).toUpperCase() === 'F')) return null

  const first = results[0]
  const generatedDate = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
  const subjects = results.map(row => row.subject).join(', ')
  const grandObtained = results.reduce((sum, row) => sum + Number(row.total_obtained || 0), 0)
  const grandTotal = results.reduce((sum, row) => sum + Number(row.total_marks || 0), 0)
  const percentage = grandTotal > 0 ? ((grandObtained / grandTotal) * 100).toFixed(2) : '0.00'
  const certificateNo = `CERT-${String(first.exam_year || '').replace(/[^0-9]/g, '').slice(0, 4)}-${first.roll_no || student.reg_no || 'STUDENT'}`
  const fileName = `IMFAA-Pass-Certificate-${first.roll_no || student.reg_no || 'student'}-${first.exam_year || ''}`

  return (
    <div className="certificate-wrap">
      <article className="pass-certificate" id="pass-certificate-print">
        <div className="certificate__watermark" aria-hidden="true">
          THE INDIAN MUSIC &amp; FINE ART ACADEMY
        </div>
        <div className="certificate__inner">
          <header className="certificate__header">
            <Logo size={88} />
            <div className="certificate__academy">
              <h2>THE INDIAN MUSIC &amp; FINE ART ACADEMY</h2>
              <strong>WEST BENGAL · INDIA</strong>
              <span>Indian Fine Arts Association (New Delhi) · Self Organised Board</span>
              <small>Registered in the name of B.M.F.A.A. · Govt. of West Bengal Societies Registration Act XXVI of 1961</small>
            </div>
            <div className="certificate__seal-mini"><Logo size={68} /><span>Official<br />Record</span></div>
          </header>

          <div className="certificate__eyebrow">Certificate of Achievement</div>
          <h1>PASS CERTIFICATE</h1>
          <p className="certificate__lead">This is to certify that</p>
          <div className="certificate__student-name">{student.full_name || 'Student Name'}</div>
          <p className="certificate__body-copy">
            C/O <strong>{student.co_name || '—'}</strong>, Roll No. <strong>{first.roll_no || '—'}</strong>, has successfully passed the
            <strong> {first.exam_class || '—'} </strong> examination conducted by The Indian Music &amp; Fine Art Academy.
          </p>

          <div className="certificate__details">
            <div><span>Examination Class</span><strong>{first.exam_class || '—'}</strong></div>
            <div><span>Subject</span><strong>{subjects || '—'}</strong></div>
            <div><span>Centre Code</span><strong>{first.center_code || '—'}</strong></div>
            <div><span>Centre Name</span><strong>{first.center_name || '—'}</strong></div>
            <div><span>Examination Session</span><strong>{first.exam_year || '—'}</strong></div>
            <div><span>Percentage</span><strong>{percentage}% · PASS</strong></div>
          </div>

          <div className="certificate__result"><span>Successfully Passed</span><strong>PASS</strong></div>

          <footer className="certificate__footer">
            <div className="certificate__seal"><Logo size={112} /><span>Academy Seal</span></div>
            <div className="certificate__certificate-meta"><span>Certificate No.</span><strong>{certificateNo}</strong><span>Generated Date</span><strong>{generatedDate}</strong></div>
            <div className="certificate__digital-sign"><span className="certificate__signature-script">IMFAA Authority</span><strong>Digitally Signed</strong><small>Examination Department</small><em>No physical signature required</em></div>
          </footer>
          <p className="certificate__note">This digitally generated certificate is valid without a handwritten signature. Any alteration makes this certificate invalid.</p>
        </div>
      </article>

      <div className="card-download-panel">
        <div>
          <strong>Download your pass certificate</strong>
          <span>Choose “Save to PDF” in the print window to keep this certificate.</span>
        </div>
        <div className="card-download-panel__actions">
          <button className="btn" onClick={() => printCard('pass-certificate-print', fileName)}>Download PDF</button>
          <button className="btn btn--outline" onClick={() => printCard('pass-certificate-print', fileName)}>Print certificate</button>
        </div>
      </div>
    </div>
  )
}

/* ─── Exam Form ─────────────────────────────────────────────────────────── */
// mode: 'admin' (lookup by reg no) | 'student' (own reg no locked)
function ExamForm({ session, mode, fixedStudent }) {
  const { notify } = useNotification()
  const [regNo, setRegNo] = useState(fixedStudent?.reg_no || '')
  const [student, setStudent] = useState(fixedStudent || null)
  const [lookupErr, setLookupErr] = useState('')
  const [looking, setLooking] = useState(false)
  const [examClass, setExamClass] = useState('')
  const [examYear, setExamYear] = useState('')
  const [centerCode, setCenterCode] = useState('')
  const [centerName, setCenterName] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [openYears, setOpenYears] = useState([])
  const [fees, setFees] = useState({}) // { [exam_class]: fee }
  const [agree, setAgree] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('upi')
  const [paymentBusy, setPaymentBusy] = useState(false)
  const [paymentErr, setPaymentErr] = useState('')
  usePaymentRefresh(mode === 'student' && result ? [result] : [], session.token, exam => setResult(previous => ({ ...previous, ...exam })))

  // Auto-load own profile in student mode
  useEffect(() => {
    if (mode === 'student' && !fixedStudent) {
      api('/api/student/me', { token: session.token })
        .then(d => { if (d.student) { setStudent(d.student); setRegNo(d.student.reg_no); setExamClass(d.student.current_class || '') } })
        .catch(() => {})
    } else if (fixedStudent) {
      setExamClass(fixedStudent.current_class || '')
    }
  }, [])

  // Load open exam sessions for the year dropdown
  useEffect(() => {
    api('/api/exam-sessions').then(d => setOpenYears(d.sessions)).catch(() => {})
  }, [])

  // Load exam fees so the student sees the amount for their chosen class
  useEffect(() => {
    api('/api/exam-fees').then(d => {
      const map = {}
      d.fees.forEach(f => { map[f.exam_class] = f.fee })
      setFees(map)
    }).catch(() => {})
  }, [])

  const feeAmount = fees[examClass]

  const lookup = async () => {
    setLookupErr(''); setStudent(null); setLooking(true)
    try {
      const d = await api(`/api/admin/lookup/${encodeURIComponent(regNo.trim())}`, { token: session.token })
      setStudent(d.student)
      setExamClass(d.student.current_class || '')
    } catch (e) {
      setLookupErr(e.message)
      notify({ type: 'error', title: 'Student not found', message: e.message })
    } finally { setLooking(false) }
  }

  const submit = async e => {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      const path = mode === 'admin' ? '/api/admin/exams' : '/api/student/exams'
      const body = { regNo, examClass, examYear, centerCode, centerName, ...(mode === 'student' ? { paymentMethod } : {}) }
      const d = await api(path, { method: 'POST', body, token: session.token })
      setResult(d.exam)
      notify({ type: 'success', title: 'Exam form submitted', message: `Roll number ${d.exam.roll_no} was generated successfully.` })
    } catch (e) {
      setErr(e.message)
      notify({ type: 'error', title: 'Submission failed', message: e.message })
    } finally { setBusy(false) }
  }

  const startPayment = async () => {
    setPaymentErr(''); setPaymentBusy(true)
    try {
      const d = await api(`/api/student/exams/${result.id}/payment`, { method: 'POST', token: session.token })
      setResult(p => ({ ...p, ...d.exam }))
      if (d.paid) return
      window.location.href = d.checkoutUrl
    } catch (e) { setPaymentErr(e.message) }
    finally { setPaymentBusy(false) }
  }

  const verifyPayment = async () => {
    setPaymentErr(''); setPaymentBusy(true)
    try {
      const d = await api(`/api/student/exams/${result.id}/payment/status`, { method: 'POST', token: session.token })
      setResult(p => ({ ...p, ...d.exam }))
      notify(paymentNotice(d.exam))
    } catch (e) { setPaymentErr(e.message) }
    finally { setPaymentBusy(false) }
  }

  if (result) return (
    <div className="exam-result">
      <div className="exam-result__check">✓</div>
      <h2>Exam Form Submitted</h2>
      <p>Roll number generated for <strong>{result.reg_no}</strong></p>
      <div className="reg-hero">
        <div className="reg-hero__label">Roll Number</div>
        <div className="reg-hero__number">{result.roll_no}</div>
        <div className="reg-hero__sub">{result.exam_class} · Session {result.exam_year}</div>
      </div>
      <div className="exam-result__meta">
        <div><small>Center Code</small><strong>{result.center_code}</strong></div>
        <div><small>Center Name</small><strong>{result.center_name}</strong></div>
        <div><small>Exam Fee</small><strong>{feeAmount === undefined ? '—' : feeAmount > 0 ? `₹${feeAmount}` : 'Free'}</strong></div>
        <div><small>Payment</small><strong><PayBadge status={result.payment_status} /></strong></div>
      </div>
      {paymentErr && <p className="auth__err">{paymentErr}</p>}
      {mode === 'student' && result.payment_method === 'upi' && result.payment_status !== 'paid' && !result.payment_manual_override && (
        <div className="reg-form__actions">
          {result.payment_order_id && <button type="button" className="btn btn--outline" onClick={verifyPayment} disabled={paymentBusy}>{paymentBusy ? 'Checking…' : 'Check UPI Payment'}</button>}
          <button type="button" className="btn" onClick={startPayment} disabled={paymentBusy}>{paymentBusy ? 'Opening…' : result.payment_status === 'payment_failed' ? 'Retry UPI Payment' : 'Pay with UPI'}</button>
        </div>
      )}
      <p className="ds-note">{result.payment_manual_override
        ? <>Payment status was set by an admin. Contact the academy for any correction.</>
        : result.payment_method === 'cash' && result.payment_status !== 'paid'
        ? <>Cash selected. An admin must accept the cash payment before this form becomes paid.</>
        : result.payment_status === 'payment_failed'
          ? <>The UPI payment failed or was cancelled. If money was deducted, ask the academy to verify it before retrying.</>
          : <>UPI payments are confirmed automatically after gateway verification. Exam approval is shown separately.</>}</p>
      <button className="btn" onClick={() => { setResult(null); setExamYear(''); setCenterCode(''); setCenterName(''); setAgree(false) }}>Fill Another</button>
    </div>
  )

  return (
    <form className="reg-form" onSubmit={submit}>
      <div className="reg-form__header">
        <h2>Examination Form Fill-up</h2>
        <p>{mode === 'admin'
          ? 'Enter a student registration number to auto-fill their details, then permit the exam.'
          : 'Fill your examination form. Your details are auto-filled from your registration.'}</p>
      </div>

      {/* Reg number lookup (admin) */}
      {mode === 'admin' && !fixedStudent && (
        <div className="reg-form__section">
          <h4>Select Student</h4>
          <div className="exam-lookup">
            <input value={regNo} onChange={e => setRegNo(e.target.value)} placeholder="Registration number e.g. IMFAA-2026-0001" />
            <button type="button" className="btn btn--sm" onClick={lookup} disabled={!regNo || looking}>{looking ? 'Searching…' : 'Load'}</button>
          </div>
          {lookupErr && <p className="auth__err">{lookupErr}</p>}
        </div>
      )}

      {/* Auto-filled student details */}
      {student && (
        <div className="reg-form__section">
          <h4>Student Details (auto-filled)</h4>
          <div className="exam-autofill">
            <div className="exam-autofill__photo">
              {student.photo ? <img src={student.photo} alt="" /> : <span>{student.full_name?.[0]}</span>}
            </div>
            <div className="exam-autofill__grid">
              <div><small>Reg No</small><strong>{student.reg_no}</strong></div>
              <div><small>Name</small><strong>{student.full_name}</strong></div>
              <div><small>C/O</small><strong>{student.co_name || '—'}</strong></div>
              <div><small>DOB</small><strong>{student.dob}</strong></div>
              <div><small>Aadhaar</small><strong>{student.aadhaar}</strong></div>
              <div><small>Phone</small><strong>{student.phone || '—'}</strong></div>
            </div>
          </div>
        </div>
      )}

      {/* Exam details */}
      {student && (
        <>
          <div className="reg-form__section">
            <h4>Examination Details</h4>
            {err && <p className="auth__err">{err}</p>}
            <div className="reg-form__grid">
              <label>Current Class <small>(from registration)</small>
                <input value={student.current_class || '—'} disabled readOnly />
              </label>
              <label>Exam Class / Level *
                <select value={examClass} onChange={e => setExamClass(e.target.value)} required>
                  <option value="">Select class</option>
                  {CLASSES.map(c => <option key={c}>{c}</option>)}
                </select>
              </label>
              <label>Year of Examination *
                <select value={examYear} onChange={e => setExamYear(e.target.value)} required disabled={!openYears.length}>
                  <option value="">{openYears.length ? 'Select session' : 'No open sessions'}</option>
                  {openYears.map(y => <option key={y}>{y}</option>)}
                </select>
              </label>
            </div>
            {!openYears.length && <p className="auth__err">No exam session is open. The admin must open an exam year first (Exam Years page).</p>}
            {examClass && (
              <div className="exam-fee">
                <span className="exam-fee__label">Examination Fee</span>
                <span className="exam-fee__amount">
                  {feeAmount === undefined ? 'Not set' : feeAmount > 0 ? `₹${feeAmount}` : 'Free'}
                </span>
                <small className="exam-fee__note">{feeAmount === undefined ? 'Ask the admin to set the exam fee before submitting.' : 'Choose UPI for automatic confirmation or cash for admin acceptance.'}</small>
              </div>
            )}
          </div>
          {mode === 'student' && feeAmount > 0 && (
            <div className="reg-form__section">
              <h4>Payment Method</h4>
              <div className="reg-form__grid">
                <label><input type="radio" name="paymentMethod" value="upi" checked={paymentMethod === 'upi'} onChange={e => setPaymentMethod(e.target.value)} /> UPI (online, auto-confirmed)</label>
                <label><input type="radio" name="paymentMethod" value="cash" checked={paymentMethod === 'cash'} onChange={e => setPaymentMethod(e.target.value)} /> Cash (admin accepts manually)</label>
              </div>
            </div>
          )}
          <div className="reg-form__section">
            <h4>Examination Center</h4>
            <div className="reg-form__grid">
              <label>Center Code * <small>(e.g. BD-137)</small>
                <input value={centerCode} onChange={e => setCenterCode(e.target.value)} required placeholder="BD-137" />
              </label>
              <label>Name of Center *
                <input value={centerName} onChange={e => setCenterName(e.target.value)} required placeholder="Center / school name" />
              </label>
            </div>
            <p className="exam-hint">Roll number is auto-generated from the center code — e.g. <strong>BD-137 → 137001</strong> (last 3 digits + serial).</p>
          </div>
          <div className="reg-form__section">
            <label className="exam-terms">
              <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} />
              <span>I confirm all details are correct, agree to the academy's examination rules, and understand the fee is non-refundable.</span>
            </label>
          </div>
          <div className="reg-form__actions">
            <button type="submit" className="btn" disabled={busy || !agree}>{busy ? 'Submitting…' : 'Permit Exam & Generate Roll No'}</button>
          </div>
        </>
      )}
    </form>
  )
}

function ResultMarksModal({ exam, subject, existing, onClose, onSave, busy }) {
  const [marks, setMarks] = useState({
    sectionalObtained: existing?.sectional_obtained ?? '',
    sectionalTotal: existing?.sectional_total ?? '',
    practicalObtained: existing?.practical_obtained ?? '',
    practicalTotal: existing?.practical_total ?? '',
    theoryObtained: existing?.theory_obtained ?? '',
    theoryTotal: existing?.theory_total ?? '',
    grade: existing?.grade || '',
  })

  const set = key => e => setMarks(p => ({ ...p, [key]: e.target.value }))
  const value = key => {
    const n = Number(marks[key])
    return Number.isFinite(n) ? n : 0
  }
  const totalObtained = value('sectionalObtained') + value('practicalObtained') + value('theoryObtained')
  const totalMarks = value('sectionalTotal') + value('practicalTotal') + value('theoryTotal')
  const percentage = totalMarks > 0 ? (totalObtained / totalMarks) * 100 : 0
  const invalid = [
    ['sectionalObtained', 'sectionalTotal'],
    ['practicalObtained', 'practicalTotal'],
    ['theoryObtained', 'theoryTotal'],
  ].some(([obtained, total]) => marks[obtained] === '' || marks[total] === '' || value(total) <= 0 || value(obtained) > value(total))

  const submit = e => {
    e.preventDefault()
    onSave({ ...marks, examId: exam.id })
  }

  return (
    <div className="result-modal" onClick={onClose} role="dialog" aria-modal="true" aria-label="Enter result marks">
      <form className="result-modal__card" onSubmit={submit} onClick={e => e.stopPropagation()}>
        <button type="button" className="result-modal__close" onClick={onClose} aria-label="Close marks entry">×</button>
        <div className="result-modal__head">
          <span className="eyebrow">Marks Entry</span>
          <h2>{existing ? 'Update Result' : 'Process Result'}</h2>
          <p>{exam.full_name} · Roll {exam.roll_no} · {exam.exam_class} · {subject}</p>
        </div>

        <div className="result-marks-grid result-marks-grid--head">
          <strong>Paper</strong><strong>Obtained</strong><strong>Total</strong>
        </div>
        {[
          ['Sectional Paper', 'sectionalObtained', 'sectionalTotal'],
          ['Practical Paper', 'practicalObtained', 'practicalTotal'],
          ['Theory Paper', 'theoryObtained', 'theoryTotal'],
        ].map(([label, obtained, total]) => (
          <div className="result-marks-grid" key={label}>
            <label>{label}</label>
            <input type="number" min="0" step="0.01" value={marks[obtained]} onChange={set(obtained)} required aria-label={`${label} obtained marks`} />
            <input type="number" min="0.01" step="0.01" value={marks[total]} onChange={set(total)} required aria-label={`${label} total marks`} />
          </div>
        ))}

        <div className="result-totals">
          <div><small>Total Obtained</small><strong>{totalObtained.toFixed(2)}</strong></div>
          <div><small>Total Marks</small><strong>{totalMarks.toFixed(2)}</strong></div>
          <div><small>Percentage</small><strong>{percentage.toFixed(2)}%</strong></div>
        </div>

        <label className="result-grade">Grade
          <select value={marks.grade} onChange={set('grade')} required>
            <option value="">Select grade</option>
            {RESULT_GRADES.map(([grade, label]) => <option key={grade} value={grade}>{grade} - {label}</option>)}
          </select>
        </label>

        {invalid && totalMarks > 0 && <p className="auth__err">Each obtained mark must be less than or equal to its paper total.</p>}
        <div className="result-modal__actions">
          <button type="button" className="btn btn--ghost-dark" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={busy || invalid || !marks.grade}>
            {busy ? 'Saving…' : 'Save Result'}
          </button>
        </div>
      </form>
    </div>
  )
}

/* ─── Admin Dashboard ───────────────────────────────────────────────────── */
function AdminDashboard({ session, onLogout }) {
  const { notify } = useNotification()
  const [page, setPage] = useState('home') // home | students | register | detail | edit | exams
  const [students, setStudents] = useState([])
  const [selected, setSelected] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [sideOpen, setSideOpen] = useState(false)
  const [exams, setExams] = useState([])
  const [sessions, setSessions] = useState([])
  const [newYear, setNewYear] = useState('')
  const [fees, setFees] = useState({}) // { [class]: amount }
  const [feeSaved, setFeeSaved] = useState('')
  const [paymentBusyId, setPaymentBusyId] = useState(null)
  // Attendance page: optional exam-year filter ('' = all sessions)
  const [attYear, setAttYear] = useState('')
  // Admit release form
  const [relScope, setRelScope] = useState('all')       // 'all' | 'specific'
  const [relRoll, setRelRoll] = useState('')
  const [relDatetime, setRelDatetime] = useState('')
  const [relYear, setRelYear] = useState('')
  const [relMsg, setRelMsg] = useState('')
  const [results, setResults] = useState([])
  const [resultYear, setResultYear] = useState('')
  const [resultExamId, setResultExamId] = useState('')
  const [resultSubject, setResultSubject] = useState('')
  const [resultModal, setResultModal] = useState(null)
  const [reportYear, setReportYear] = useState('')
  const [onlineExams, setOnlineExams] = useState([])
  const [onlinePreview, setOnlinePreview] = useState(null)
  const [onlinePreviewLoadingId, setOnlinePreviewLoadingId] = useState(null)
  const [onlinePreviewImage, setOnlinePreviewImage] = useState(null)
  const [rescheduleExam, setRescheduleExam] = useState(null)
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [rescheduleStart, setRescheduleStart] = useState('')
  const [rescheduleEnd, setRescheduleEnd] = useState('')
  const [rescheduleBusy, setRescheduleBusy] = useState(false)
  const [onlineExamYear, setOnlineExamYear] = useState('')
  const [onlineExamDate, setOnlineExamDate] = useState('')
  const [onlineExamStart, setOnlineExamStart] = useState('09:00')
  const [onlineExamEnd, setOnlineExamEnd] = useState('10:00')
  const [onlineTopic, setOnlineTopic] = useState('')
  const [onlineScope, setOnlineScope] = useState('all')
  const [onlineSelectedStudents, setOnlineSelectedStudents] = useState([])

  useEffect(() => {
    if (err) notify({ type: 'error', title: 'Action failed', message: err })
  }, [err, notify])

  const load = () => {
    setLoading(true)
    api('/api/admin/students', { token: session.token })
      .then(d => setStudents(d.students))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }

  const loadExams = () => {
    api('/api/admin/exams', { token: session.token })
      .then(d => setExams(d.exams))
      .catch(e => setErr(e.message))
  }

  useEffect(() => {
    if (page !== 'exams' || paymentBusyId !== null) return
    const controller = new AbortController()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      api('/api/admin/exams', { token: session.token, signal: controller.signal })
        .then(d => { if (!controller.signal.aborted) setExams(d.exams) })
        .catch(() => {})
    }, 15000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [page, paymentBusyId, session.token])

  const loadSessions = () => {
    api('/api/exam-sessions')
      .then(d => setSessions(d.sessions))
      .catch(() => {})
  }

  const loadFees = () => {
    api('/api/exam-fees')
      .then(d => {
        const map = {}
        d.fees.forEach(f => { map[f.exam_class] = String(f.fee) })
        setFees(map)
      })
      .catch(() => {})
  }

  const loadResults = () => {
    api('/api/admin/results', { token: session.token })
      .then(d => setResults(d.results))
      .catch(e => setErr(e.message))
  }

  const loadOnlineExams = () => {
    api('/api/admin/online-exams', { token: session.token })
      .then(d => setOnlineExams(d.exams || []))
      .catch(e => setErr(e.message))
  }

  useEffect(() => { if (page === 'students' || page === 'home') load() }, [page])
  useEffect(() => { if (page === 'exams' || page === 'attendance' || page === 'results' || page === 'online') loadExams() }, [page])
  useEffect(() => { if (page === 'years' || page === 'exam-new' || page === 'admit' || page === 'attendance' || page === 'results' || page === 'online') loadSessions() }, [page])
  useEffect(() => { if (page === 'fees') loadFees() }, [page])
  useEffect(() => { if (page === 'results') loadResults() }, [page])
  useEffect(() => { if (page === 'online') loadOnlineExams() }, [page])

  const openSession = async () => {
    if (!newYear) return
    setErr('')
    try {
      await api('/api/admin/exam-sessions', { method: 'POST', body: { examYear: newYear }, token: session.token })
      notify({ type: 'success', title: 'Exam session opened', message: `${newYear} is now available for exam fill-up.` })
      loadSessions()
      setNewYear('')
    } catch (e) { setErr(e.message) }
  }

  const closeSession = async year => {
    if (!confirm(`Close exam session ${year}?`)) return
    setErr('')
    try {
      await api(`/api/admin/exam-sessions/${encodeURIComponent(year)}`, { method: 'DELETE', token: session.token })
      notify({ type: 'success', title: 'Exam session closed', message: `${year} is no longer open for new forms.` })
      loadSessions()
    } catch (e) { setErr(e.message) }
  }

  const delExam = async id => {
    if (!confirm('Delete this exam form?')) return
    setErr('')
    try {
      await api(`/api/admin/exams/${id}`, { method: 'DELETE', token: session.token })
      notify({ type: 'success', title: 'Exam form deleted', message: 'The exam form was removed.' })
      loadExams()
    } catch (e) { setErr(e.message) }
  }

  const saveFee = async examClass => {
    setErr(''); setFeeSaved('')
    try {
      await api('/api/admin/exam-fees', { method: 'POST', body: { examClass, fee: fees[examClass] || 0 }, token: session.token })
      setFeeSaved(examClass)
      notify({ type: 'success', title: 'Fee saved', message: `${examClass} examination fee was updated.` })
      setTimeout(() => setFeeSaved(''), 2000)
    } catch (e) { setErr(e.message) }
  }

  const saveAllFees = async () => {
    setErr(''); setFeeSaved('')
    try {
      for (const c of CLASSES) {
        if (fees[c] !== undefined && fees[c] !== '')
          await api('/api/admin/exam-fees', { method: 'POST', body: { examClass: c, fee: fees[c] || 0 }, token: session.token })
      }
      setFeeSaved('all')
      notify({ type: 'success', title: 'Fees saved', message: 'All examination fees were updated.' })
      setTimeout(() => setFeeSaved(''), 2000)
    } catch (e) { setErr(e.message) }
  }

  const setStudentStatus = async (id, status) => {
    try {
      const d = await api(`/api/admin/students/${id}/status`, { method: 'PATCH', body: { status }, token: session.token })
      setStudents(p => p.map(s => s.id === id ? d.student : s))
      if (selected?.id === id) setSelected(d.student)
      notify({ type: 'success', title: 'Student status updated', message: `Registration marked ${status}.` })
    } catch (e) { setErr(e.message) }
  }

  const setExamStatus = async (id, status) => {
    try {
      const d = await api(`/api/admin/exams/${id}/status`, { method: 'PATCH', body: { status }, token: session.token })
      setExams(p => p.map(e => e.id === id ? d.exam : e))
      notify({ type: 'success', title: 'Exam status updated', message: `Exam form marked ${status}.` })
    } catch (e) { setErr(e.message) }
  }

  const setExamPayment = async (id, paymentStatus) => {
    setErr(''); setPaymentBusyId(id)
    try {
      const d = await api(`/api/admin/exams/${id}/payment`, { method: 'PATCH', body: { paymentStatus }, token: session.token })
      setExams(p => p.map(e => e.id === id ? { ...e, ...d.exam } : e))
      notify({ type: 'success', title: 'Payment updated', message: `Exam fee marked ${paymentStatus}.` })
    } catch (e) { setErr(e.message) }
    finally { setPaymentBusyId(null) }
  }

  // Mark a student present / absent on an approved exam form.
  // Clicking the active choice again clears the mark.
  const setAttendance = async (id, value) => {
    setErr('')
    try {
      const d = await api(`/api/admin/exams/${id}/attendance`, { method: 'PATCH', body: { attendance: value }, token: session.token })
      setExams(p => p.map(e => e.id === id ? { ...e, ...d.exam } : e))
      notify({
        type: 'success',
        title: 'Attendance updated',
        message: value ? `Student marked ${value}.` : 'Attendance mark was cleared.',
      })
    } catch (e) { setErr(e.message) }
  }

  // Toggle admit release for one exam form (from the exams table)
  const toggleAdmit = async (id, released) => {
    try {
      const d = await api(`/api/admin/exams/${id}/admit`, { method: 'PATCH', body: { released }, token: session.token })
      setExams(p => p.map(e => e.id === id ? d.exam : e))
      notify({
        type: 'success',
        title: released ? 'Admit card released' : 'Admit card withdrawn',
        message: released ? 'The student can now view the admit card.' : 'The admit card is no longer visible to the student.',
      })
    } catch (e) { setErr(e.message) }
  }

  // Bulk / specific admit release (from the Admit Release page)
  const releaseAdmit = async () => {
    setErr(''); setRelMsg(''); setBusy(true)
    try {
      const body = { scope: relScope, examDatetime: relDatetime }
      if (relScope === 'specific') body.rollNo = relRoll.trim()
      else if (relYear.trim()) body.examYear = relYear.trim()
      const d = await api('/api/admin/exams/release', { method: 'POST', body, token: session.token })
      setRelMsg(`Released ${d.released} admit card(s).`)
      notify({ type: 'success', title: 'Admit cards released', message: `Released ${d.released} admit card(s).` })
      loadExams()
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  const nav = p => { setPage(p); setSideOpen(false); setErr(''); setRelMsg('') }

  const save = async f => {
    setErr(''); setBusy(true)
    try {
      if (page === 'register') {
        await api('/api/admin/students', { method: 'POST', body: f, token: session.token })
        notify({ type: 'success', title: 'Student registered', message: 'The student record was added successfully.' })
        nav('students')
      } else {
        const d = await api(`/api/admin/students/${selected.id}`, { method: 'PUT', body: f, token: session.token })
        setSelected(d.student); nav('detail')
        notify({ type: 'success', title: 'Student updated', message: 'The student record was updated successfully.' })
      }
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const del = async id => {
    if (!confirm('Delete this student record permanently?')) return
    setErr('')
    try {
      await api(`/api/admin/students/${id}`, { method: 'DELETE', token: session.token })
      load(); nav('students')
      notify({ type: 'success', title: 'Student deleted', message: 'The student record was removed.' })
    } catch (e) { setErr(e.message) }
  }

  const saveResult = async marks => {
    setErr(''); setBusy(true)
    try {
      await api('/api/admin/results', {
        method: 'POST',
        token: session.token,
        body: { ...marks, subject: resultSubject.trim() },
      })
      notify({ type: 'success', title: 'Result saved', message: `${resultSubject.trim()} marks were saved successfully.` })
      setResultModal(null)
      setResultSubject('')
      loadResults()
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  const filtered = students.filter(s =>
    !search || s.full_name.toLowerCase().includes(search.toLowerCase()) ||
    s.aadhaar?.includes(search) || s.phone?.includes(search) || s.reg_no?.includes(search)
  )

  const eligibleOnlineStudents = Array.from(new Map(
    exams
      .filter(e => e.status === 'approved' && e.payment_status === 'paid' && e.student_id)
      .map(e => [e.student_id, { id: e.student_id, full_name: e.full_name, reg_no: e.reg_no, roll_no: e.roll_no, exam_class: e.exam_class, exam_year: e.exam_year }])
  ).values())

  const submitOnlineExam = async () => {
    setErr('')
    if (!onlineExamYear || !onlineExamDate || !onlineExamStart || !onlineExamEnd || !onlineTopic.trim()) {
      setErr('Exam year, date, start/end time and topic are required.')
      return
    }
    if (onlineExamStart >= onlineExamEnd) {
      setErr('End time must be later than start time.')
      return
    }

    try {
      const payload = {
        examYear: onlineExamYear,
        examDate: onlineExamDate,
        startTime: onlineExamStart,
        endTime: onlineExamEnd,
        topic: onlineTopic.trim(),
        targetScope: onlineScope,
        studentIds: onlineScope === 'specific' ? onlineSelectedStudents : [],
      }
      const d = await api('/api/admin/online-exams', { method: 'POST', body: payload, token: session.token })
      setOnlineExams(prev => [d.exam, ...prev])
      setOnlineExamYear(''); setOnlineExamDate(''); setOnlineExamStart('09:00'); setOnlineExamEnd('10:00'); setOnlineTopic(''); setOnlineScope('all'); setOnlineSelectedStudents([])
      notify({ type: 'success', title: 'Online exam scheduled', message: `Created exam for ${d.exam.exam_year}.` })
    } catch (e) {
      setErr(e.message)
    }
  }

  const previewOnlineExam = async examId => {
    setOnlinePreviewLoadingId(examId)
    setOnlinePreview({ examId, submissions: [] })
    try {
      const d = await api(`/api/admin/online-exams/${examId}/submissions`, { token: session.token })
      setOnlinePreview({ examId, submissions: d.submissions || [] })
    } catch (e) {
      setErr(e.message)
    } finally {
      setOnlinePreviewLoadingId(null)
    }
  }

  const openOnlineReschedule = exam => {
    setRescheduleExam(exam)
    setRescheduleDate(String(exam.exam_date || '').slice(0, 10))
    setRescheduleStart(String(exam.start_time || '').slice(0, 5))
    setRescheduleEnd(String(exam.end_time || '').slice(0, 5))
  }

  const saveOnlineReschedule = async event => {
    event.preventDefault()
    if (!rescheduleExam || !rescheduleDate || !rescheduleStart || !rescheduleEnd) return
    if (rescheduleStart >= rescheduleEnd) {
      setErr('End time must be later than the start time.')
      return
    }
    setErr('')
    setRescheduleBusy(true)
    try {
      await api(`/api/admin/online-exams/${rescheduleExam.id}/reschedule`, {
        method: 'PATCH',
        token: session.token,
        body: { examDate: rescheduleDate, startTime: rescheduleStart, endTime: rescheduleEnd },
      })
      setRescheduleExam(null)
      loadOnlineExams()
      notify({ type: 'success', title: 'Online exam rescheduled', message: 'The new date and time are available to students who have not submitted.' })
    } catch (e) {
      setErr(e.message)
    } finally {
      setRescheduleBusy(false)
    }
  }

  const reportRows = exams
    .filter(e => e.status === 'approved' && e.payment_status === 'paid')
    .filter(e => !reportYear || e.exam_year === reportYear)
    .sort((a, b) => {
      const year = (a.exam_year || '').localeCompare(b.exam_year || '')
      if (year) return year
      const cls = (a.exam_class || '').localeCompare(b.exam_class || '')
      if (cls) return cls
      return (a.roll_no || '').localeCompare(b.roll_no || '')
    })

  const exportExamReport = () => {
    if (!reportRows.length) {
      setErr('No approved and paid exam forms are available for the selected report.')
      return
    }

    const headers = ['Exam Year', 'Exam Class', 'Roll No', 'Reg No', 'Student Name', 'Co/Guardian', 'Phone', 'Aadhaar', 'Center Code', 'Center Name', 'Payment Status', 'Status', 'Filled By']
    const csv = [
      headers.join(','),
      ...reportRows.map(row => headers.map(header => {
        const value = {
          'Exam Year': row.exam_year || '',
          'Exam Class': row.exam_class || '',
          'Roll No': row.roll_no || '',
          'Reg No': row.reg_no || '',
          'Student Name': row.full_name || '',
          'Co/Guardian': row.co_name || '',
          'Phone': row.phone || '',
          'Aadhaar': row.aadhaar || '',
          'Center Code': row.center_code || '',
          'Center Name': row.center_name || '',
          'Payment Status': row.payment_status || '',
          'Status': row.status || '',
          'Filled By': row.filled_by || '',
        }[header] ?? ''
        return `"${String(value).replace(/"/g, '""')}"`
      }).join(','))
    ].join('\n')

    const blob = new Blob(['\uFEFF' + csv], { type: 'application/vnd.ms-excel;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `IMFAA-Exam-Report-${reportYear || 'All'}-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    notify({ type: 'success', title: 'Report exported', message: `Downloaded ${reportRows.length} approved and paid records for sign-off.` })
  }

  const MENU = [
    { id: 'home', icon: '🏠', label: 'Dashboard' },
    { id: 'notices', icon: '📢', label: 'Notices' },
    { id: 'students', icon: '👥', label: 'All Students' },
    { id: 'register', icon: '📝', label: 'Registration' },
    { id: 'share', icon: '🔗', label: 'Share Link' },
    { id: 'years', icon: '📅', label: 'Exam Years' },
    { id: 'exams', icon: '📋', label: 'Exam Forms' },
    { id: 'online', icon: '🧠', label: 'Online Exam' },
    { id: 'reports', icon: '📊', label: 'Reports' },
    { id: 'fees', icon: '💰', label: 'Exam Fees' },
    { id: 'admit', icon: '🎟️', label: 'Admit Release' },
    { id: 'attendance', icon: '✅', label: 'Attendance' },
    { id: 'results', icon: '🏆', label: 'Results' },
  ]

  return (
    <div className="ds-layout">
      {/* Sidebar */}
      <aside className={`ds-sidebar ${sideOpen ? 'is-open' : ''}`}>
        <div className="ds-sidebar__brand">
          <Logo size={44} />
          <div>
            <strong>IMFAA</strong>
            <small>Admin Panel</small>
          </div>
        </div>
        <nav className="ds-sidebar__nav">
          {MENU.map(m => (
            <button key={m.id} className={`ds-sidebar__item ${page === m.id || (page === 'detail' && m.id === 'students') || (page === 'edit' && m.id === 'register') ? 'is-active' : ''}`}
              onClick={() => nav(m.id)}>
              <span className="ds-sidebar__icon">{m.icon}</span>
              <span>{m.label}</span>
            </button>
          ))}
        </nav>
        <button className="ds-sidebar__logout" onClick={onLogout}>🚪 Logout</button>
      </aside>
      {sideOpen && <div className="ds-overlay" onClick={() => setSideOpen(false)} />}

      {/* Main */}
      <div className="ds-main">
        <header className="ds-topbar">
          <button className="ds-hamburger" onClick={() => setSideOpen(v => !v)} aria-label="Menu">
            <span /><span /><span />
          </button>
          <h1 className="ds-topbar__title">
            {page === 'home' && 'Dashboard'}
            {page === 'notices' && 'Student Notices'}
            {page === 'students' && 'All Students'}
            {page === 'register' && 'New Registration'}
            {page === 'share' && 'Share Registration Link'}
            {page === 'detail' && 'Student Profile'}
            {page === 'edit' && 'Edit Student'}
            {page === 'years' && 'Exam Years'}
            {page === 'exams' && 'Exam Forms'}
            {page === 'online' && 'Online Exam'}
            {page === 'reports' && 'Exam Report'}
            {page === 'fees' && 'Exam Fees'}
            {page === 'exam-new' && 'New Exam Form'}
            {page === 'admit' && 'Admit Release'}
            {page === 'attendance' && 'Attendance'}
            {page === 'results' && 'Student Results'}
          </h1>
          <span className="ds-topbar__user">👤 {session.user.adminId}</span>
        </header>

        <div className="ds-content">
          {page === 'notices' && <AdminNotices token={session.token} />}
          {/* Home */}
          {page === 'home' && (
            <div>
              <div className="ds-stat-row">
                <div className="ds-stat"><div className="ds-stat__num">{students.length}</div><div className="ds-stat__label">Total Students</div></div>
                <div className="ds-stat"><div className="ds-stat__num">{students.filter(s => s.current_class).length}</div><div className="ds-stat__label">Enrolled</div></div>
                <div className="ds-stat ds-stat--red" onClick={() => nav('register')} style={{ cursor: 'pointer' }}>
                  <div className="ds-stat__num">+</div><div className="ds-stat__label">Add Student</div>
                </div>
              </div>
              <h3 style={{ marginBottom: 14 }}>Recent Registrations</h3>
              <div className="ds-student-list">
                {students.slice(0, 5).map(s => (
                  <div key={s.id} className="ds-student-row" onClick={() => { setSelected(s); nav('detail') }}>
                    <div className="ds-student-row__photo">
                      {s.photo ? <img src={s.photo} alt={s.full_name} /> : <span>{s.full_name[0]}</span>}
                    </div>
                    <div className="ds-student-row__info">
                      <strong>{s.full_name}</strong>
                      <small>{s.reg_no} · {s.current_class || 'No class'}</small>
                    </div>
                    <span className="ds-student-row__arrow">›</span>
                  </div>
                ))}
                {students.length === 0 && !loading && <p className="ds-empty">No students yet. <button className="link-btn" onClick={() => nav('register')}>Register the first one →</button></p>}
              </div>
            </div>
          )}

          {/* Students list */}
          {page === 'students' && (
            <div>
              <div className="ds-toolbar">
                <input className="ds-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, Aadhaar, phone, reg no…" />
                <span className="ds-count">{filtered.length} student(s)</span>
                <button className="btn btn--sm" onClick={() => nav('register')}>+ Register</button>
              </div>
              {loading ? <p>Loading…</p> : (
                <div className="ds-table-wrap">
                  <table className="ds-table">
                    <thead><tr><th>Photo</th><th>Reg No</th><th>Name</th><th>C/O</th><th>Phone</th><th>Class</th><th>Status</th><th></th></tr></thead>
                    <tbody>
                      {filtered.length === 0 && <tr><td colSpan="8" className="ds-empty-cell">No students found.</td></tr>}
                      {filtered.map(s => (
                        <tr key={s.id} className="ds-table__row" onClick={() => { setSelected(s); nav('detail') }}>
                          <td><div className="ds-thumb">{s.photo ? <img src={s.photo} alt="" /> : <span>{s.full_name[0]}</span>}</div></td>
                          <td><span className="reg-badge reg-badge--sm">{s.reg_no}</span></td>
                          <td><strong>{s.full_name}</strong></td>
                          <td>{s.co_name || '—'}</td>
                          <td>{s.phone || '—'}</td>
                          <td>{s.current_class || '—'}</td>
                          <td onClick={e => e.stopPropagation()}><StatusBadge status={s.status} /></td>
                          <td onClick={e => e.stopPropagation()}><button className="dash__del" onClick={() => del(s.id)}>Delete</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Register */}
          {page === 'register' && (
            <RegistrationForm onSave={save} busy={busy} err={err} />
          )}

          {/* Share Link */}
          {page === 'share' && <ShareLink />}

          {/* Detail */}
          {page === 'detail' && selected && (
            <ProfileCard
              s={selected}
              onBack={() => nav('students')}
              backLabel="All Students"
              onEdit={() => nav('edit')}
              onDelete={() => del(selected.id)}
              onApprove={() => setStudentStatus(selected.id, 'approved')}
              onReject={() => setStudentStatus(selected.id, 'rejected')}
            />
          )}

          {/* Edit */}
          {page === 'edit' && selected && (
            <RegistrationForm
              editMode
              initial={{
                fullName: selected.full_name, coName: selected.co_name || '',
                phone: selected.phone || '', email: selected.email || '',
                aadhaar: selected.aadhaar, dob: selected.dob,
                gender: selected.gender || '', address: selected.address || '',
                currentClass: selected.current_class || '', photo: selected.photo || '',
              }}
              onSave={save}
              onCancel={() => nav('detail')}
              busy={busy}
              err={err}
            />
          )}

          {/* Exam Years */}
          {page === 'years' && (
            <div>
              <div className="reg-form__section">
                <h4>Open a New Exam Session</h4>
                <p className="exam-hint">Open an exam year before any exam form can be filled. Only open sessions appear in the fill-up form.</p>
                {err && <p className="auth__err">{err}</p>}
                <div className="exam-lookup">
                  <select value={newYear} onChange={e => setNewYear(e.target.value)}>
                    <option value="">Select year 2025-2026 … 2099-2100</option>
                    {EXAM_YEARS.filter(y => !sessions.includes(y)).map(y => <option key={y}>{y}</option>)}
                  </select>
                  <button type="button" className="btn btn--sm" onClick={openSession} disabled={!newYear}>Open</button>
                </div>
              </div>
              <div className="reg-form__section">
                <h4>Open Sessions ({sessions.length})</h4>
                <div className="ds-table-wrap">
                  <table className="ds-table">
                    <thead><tr><th>Exam Year</th><th></th></tr></thead>
                    <tbody>
                      {sessions.length === 0 && <tr><td colSpan="2" className="ds-empty-cell">No sessions open yet.</td></tr>}
                      {sessions.map(y => (
                        <tr key={y}>
                          <td><strong>{y}</strong></td>
                          <td><button className="dash__del" onClick={() => closeSession(y)}>Close</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Exam Forms */}
          {page === 'exams' && (
            <div>
              <div className="ds-toolbar">
                <span className="ds-count">{exams.length} form(s)</span>
                <button className="btn btn--sm" onClick={() => nav('exam-new')}>+ New Exam Form</button>
              </div>
              <div className="ds-table-wrap">
                <table className="ds-table">
                  <thead><tr><th>Roll No</th><th>Reg No</th><th>Name</th><th>Class</th><th>Session</th><th>Center</th><th>Filled By</th><th>Status</th><th>Payment</th><th>Admit</th><th></th></tr></thead>
                  <tbody>
                    {exams.length === 0 && <tr><td colSpan="11" className="ds-empty-cell">No exam forms yet.</td></tr>}
                    {exams.map(e => (
                      <tr key={e.id}>
                        <td><strong>{e.roll_no}</strong></td>
                        <td><span className="reg-badge reg-badge--sm">{e.reg_no}</span></td>
                        <td>{e.full_name}</td>
                        <td>{e.exam_class}</td>
                        <td>{e.exam_year}</td>
                        <td>{e.center_name} <small>({e.center_code})</small></td>
                        <td>{e.filled_by}</td>
                        <td>
                          <StatusBadge status={e.status} />
                          {e.status === 'pending' && (
                            <span className="approval-btns">
                              <button className="btn btn--xs btn--approve" onClick={() => setExamStatus(e.id, 'approved')}>✓</button>
                              <button className="btn btn--xs btn--reject" onClick={() => setExamStatus(e.id, 'rejected')}>✗</button>
                            </span>
                          )}
                        </td>
                        <td>
                          <PayBadge status={e.payment_status} />
                          <small>{e.payment_method === 'upi' ? 'UPI' : e.payment_method === 'cash' ? 'Cash' : '—'}</small>
                          {e.payment_order_id && <small>Order: {e.payment_order_id}</small>}
                          {e.payment_manual_override && <small>Set by admin</small>}
                          {e.payment_status !== 'paid' && (
                            <button className="btn btn--xs btn--approve" onClick={() => setExamPayment(e.id, 'paid')} disabled={paymentBusyId !== null}>
                              {e.payment_method === 'cash' ? 'Accept Cash' : 'Mark paid'}
                            </button>
                          )}
                          {e.payment_status !== 'unpaid' && (
                            <button className="btn btn--xs" onClick={() => setExamPayment(e.id, 'unpaid')} disabled={paymentBusyId !== null}>Mark unpaid</button>
                          )}
                        </td>
                        <td>
                          {e.admit_released
                            ? <span className="pay-badge pay-badge--paid">Released</span>
                            : <span className="pay-badge pay-badge--unpaid">—</span>}
                          {e.admit_released ? (
                            <button className="btn btn--xs" onClick={() => toggleAdmit(e.id, false)}>Revoke</button>
                          ) : (
                            e.status === 'approved' && e.payment_status === 'paid' &&
                            <button className="btn btn--xs btn--approve" onClick={() => toggleAdmit(e.id, true)}>Release</button>
                          )}
                        </td>
                        <td><button className="dash__del" onClick={() => delExam(e.id)}>Delete</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* New Exam Form */}
          {page === 'exam-new' && (
            <div>
              <button className="dash__back" onClick={() => nav('exams')}>← Exam Forms</button>
              <ExamForm session={session} mode="admin" />
            </div>
          )}

          {/* Online Exam */}
          {page === 'online' && (
            <div>
              <div className="reg-form__section">
                <h4>Schedule Online Exam</h4>
                <p className="exam-hint">Create a live timed question round for approved and paid students. You can schedule the same or different times for individual students or the whole class.</p>
                {err && <p className="auth__err">{err}</p>}
                <div className="reg-form__grid">
                  <label>Exam Year
                    <select value={onlineExamYear} onChange={e => setOnlineExamYear(e.target.value)}>
                      <option value="">Select year</option>
                      {sessions.map(y => <option key={y}>{y}</option>)}
                    </select>
                  </label>
                  <label>Exam Date
                    <input type="date" value={onlineExamDate} onChange={e => setOnlineExamDate(e.target.value)} />
                  </label>
                  <label>Start Time
                    <input type="time" value={onlineExamStart} onChange={e => setOnlineExamStart(e.target.value)} />
                  </label>
                  <label>End Time
                    <input type="time" value={onlineExamEnd} onChange={e => setOnlineExamEnd(e.target.value)} />
                  </label>
                  <label className="reg-form__full">Topic / Question
                    <input value={onlineTopic} onChange={e => setOnlineTopic(e.target.value)} placeholder="Write the exam topic/question here" />
                  </label>
                </div>

                <div className="reg-form__grid">
                  <label>Student Scope
                    <select value={onlineScope} onChange={e => setOnlineScope(e.target.value)}>
                      <option value="all">All approved &amp; paid students</option>
                      <option value="specific">Selected students only</option>
                    </select>
                  </label>
                </div>

                {onlineScope === 'specific' && (
                  <div className="ds-table-wrap">
                    <table className="ds-table">
                      <thead><tr><th>Select</th><th>Roll No</th><th>Name</th><th>Class</th></tr></thead>
                      <tbody>
                        {eligibleOnlineStudents.length === 0 && <tr><td colSpan="4" className="ds-empty-cell">No approved and paid students available.</td></tr>}
                        {eligibleOnlineStudents.map(student => (
                          <tr key={student.id}>
                            <td><input type="checkbox" checked={onlineSelectedStudents.includes(student.id)} onChange={e => {
                              setOnlineSelectedStudents(prev => e.target.checked ? [...prev, student.id] : prev.filter(id => id !== student.id))
                            }} /></td>
                            <td>{student.roll_no}</td>
                            <td>{student.full_name}</td>
                            <td>{student.exam_class}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="reg-form__actions">
                  <button className="btn" onClick={submitOnlineExam}>Create Online Exam</button>
                </div>
              </div>

              <div className="reg-form__section">
                <h4>Scheduled Exams</h4>
                <div className="ds-table-wrap">
                  <table className="ds-table">
                    <thead><tr><th>Topic</th><th>Year</th><th>Date</th><th>Time</th><th>Students</th><th>Submissions</th><th>Actions</th></tr></thead>
                    <tbody>
                      {onlineExams.length === 0 && <tr><td colSpan="7" className="ds-empty-cell">No online exams scheduled yet.</td></tr>}
                      {onlineExams.map(oe => (
                        <tr key={oe.id}>
                          <td><strong>{oe.topic}</strong></td>
                          <td>{oe.exam_year}</td>
                          <td>{formatExamDate(oe.exam_date)}</td>
                          <td>{oe.start_time} - {oe.end_time}</td>
                          <td>{oe.target_scope === 'specific' ? 'Selected students' : 'All'} ({oe.student_ids?.length || 0})</td>
                          <td>{Number(oe.submission_count || 0)} / {Number(oe.assigned_count ?? oe.student_ids?.length ?? 0)}</td>
                          <td>
                            <button className="btn btn--sm" onClick={() => previewOnlineExam(oe.id)} disabled={onlinePreviewLoadingId === oe.id}>{onlinePreviewLoadingId === oe.id ? 'Loading…' : 'Preview'}</button>
                            {Number(oe.pending_count ?? Math.max((oe.student_ids?.length || 0) - Number(oe.submission_count || 0), 0)) > 0 && (
                              <button className="btn btn--sm btn--outline" onClick={() => openOnlineReschedule(oe)}>Reschedule</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {onlinePreview && (
                <div className="reg-form__section">
                  <h4>Submitted Answers</h4>
                  <div className="ds-table-wrap">
                    <table className="ds-table">
                      <thead><tr><th>Roll No</th><th>Name</th><th>Class</th><th>Submitted</th><th>View</th></tr></thead>
                      <tbody>
                        {onlinePreviewLoadingId === onlinePreview.examId && <tr><td colSpan="5" className="ds-empty-cell">Loading submissions…</td></tr>}
                        {onlinePreviewLoadingId !== onlinePreview.examId && (!onlinePreview.submissions || onlinePreview.submissions.length === 0) && <tr><td colSpan="5" className="ds-empty-cell">No submissions yet.</td></tr>}
                        {(onlinePreview.submissions || []).map(sub => (
                          <tr key={sub.id}>
                            <td>{sub.roll_no}</td>
                            <td>{sub.full_name}</td>
                            <td>{sub.exam_class}</td>
                            <td>{new Date(sub.submitted_at).toLocaleString('en-IN')}</td>
                            <td>
                              <button className="btn btn--sm" type="button" aria-label={`View answer from ${sub.full_name}`} title="View submitted answer" onClick={() => setOnlinePreviewImage(sub)}>👁</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {onlinePreviewImage && (
                <div className="result-modal" role="presentation" onClick={() => setOnlinePreviewImage(null)}>
                  <div className="result-modal__card online-answer-modal" role="dialog" aria-modal="true" aria-label={`Submitted answer from ${onlinePreviewImage.full_name}`} onClick={e => e.stopPropagation()}>
                    <button type="button" className="result-modal__close" aria-label="Close image preview" onClick={() => setOnlinePreviewImage(null)}>×</button>
                    <div className="result-modal__head">
                      <span className="eyebrow">Submitted Answer</span>
                      <h2>{onlinePreviewImage.full_name}</h2>
                      <p>Roll {onlinePreviewImage.roll_no} · {onlinePreviewImage.exam_class} · {onlinePreviewImage.topic}</p>
                    </div>
                    <img className="online-answer-modal__image" src={onlinePreviewImage.file_data} alt={`Submitted answer from ${onlinePreviewImage.full_name}`} />
                  </div>
                </div>
              )}
              {rescheduleExam && (
                <div className="result-modal" role="presentation" onClick={() => !rescheduleBusy && setRescheduleExam(null)}>
                  <form className="result-modal__card" role="dialog" aria-modal="true" aria-label="Reschedule online exam" onSubmit={saveOnlineReschedule} onClick={e => e.stopPropagation()}>
                    <button type="button" className="result-modal__close" aria-label="Close reschedule dialog" onClick={() => setRescheduleExam(null)}>×</button>
                    <div className="result-modal__head">
                      <span className="eyebrow">Pending students: {Number(rescheduleExam.pending_count ?? Math.max((rescheduleExam.student_ids?.length || 0) - Number(rescheduleExam.submission_count || 0), 0))}</span>
                      <h2>Reschedule Online Exam</h2>
                      <p>{rescheduleExam.topic}</p>
                    </div>
                    <div className="reg-form__grid">
                      <label>New Exam Date
                        <input type="date" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)} required />
                      </label>
                      <label>New Start Time
                        <input type="time" value={rescheduleStart} onChange={e => setRescheduleStart(e.target.value)} required />
                      </label>
                      <label>New End Time
                        <input type="time" value={rescheduleEnd} onChange={e => setRescheduleEnd(e.target.value)} required />
                      </label>
                    </div>
                    <div className="result-modal__actions">
                      <button type="button" className="btn btn--ghost-dark" onClick={() => setRescheduleExam(null)} disabled={rescheduleBusy}>Cancel</button>
                      <button type="submit" className="btn" disabled={rescheduleBusy}>{rescheduleBusy ? 'Saving…' : 'Save New Schedule'}</button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* Exam Report */}
          {page === 'reports' && (
            <div>
              <div className="reg-form__section">
                <h4>Approved &amp; Paid Exam Report</h4>
                <p className="exam-hint">This report includes all exam forms that were approved and marked paid. Download the sheet for signatures and record keeping.</p>
                {err && <p className="auth__err">{err}</p>}
                <div className="ds-toolbar" style={{ gap: 12, justifyContent: 'flex-start', alignItems: 'center', padding: 0 }}>
                  <select value={reportYear} onChange={e => setReportYear(e.target.value)}>
                    <option value="">All exam years</option>
                    {sessions.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                  <button className="btn btn--sm" onClick={exportExamReport} disabled={!reportRows.length}>Generate Excel Sheet</button>
                </div>
              </div>

              <div className="ds-table-wrap">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th>Class</th>
                      <th>Roll</th>
                      <th>Reg No</th>
                      <th>Student Name</th>
                      <th>Center</th>
                      <th>Payment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportRows.length === 0 && <tr><td colSpan="7" className="ds-empty-cell">No approved and paid exam forms found.</td></tr>}
                    {reportRows.map(row => (
                      <tr key={row.id}>
                        <td>{row.exam_year}</td>
                        <td>{row.exam_class}</td>
                        <td><strong>{row.roll_no}</strong></td>
                        <td>{row.reg_no}</td>
                        <td>{row.full_name}</td>
                        <td>{row.center_name} ({row.center_code})</td>
                        <td><PayBadge status={row.payment_status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Exam Fees */}
          {page === 'fees' && (
            <div>
              <div className="reg-form__section">
                <h4>Set Examination Fees</h4>
                <p className="exam-hint">Enter the exam fee (₹) for each class / level. Fees are stored and shown to students. Leave 0 for free.</p>
                {err && <p className="auth__err">{err}</p>}
                {feeSaved === 'all' && <p className="fee-saved">✓ All fees saved</p>}
              </div>
              <div className="ds-table-wrap">
                <table className="ds-table fee-table">
                  <thead><tr><th>Class / Level</th><th>Exam Fee (₹)</th><th></th></tr></thead>
                  <tbody>
                    {CLASSES.map(c => (
                      <tr key={c}>
                        <td><strong>{c}</strong></td>
                        <td>
                          <div className="fee-input">
                            <span>₹</span>
                            <input
                              type="number" min="0" placeholder="0"
                              value={fees[c] ?? ''}
                              onChange={e => setFees(p => ({ ...p, [c]: e.target.value }))}
                            />
                          </div>
                        </td>
                        <td>
                          <button className="btn btn--sm" onClick={() => saveFee(c)}>
                            {feeSaved === c ? '✓ Saved' : 'Save'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="reg-form__actions">
                <button className="btn" onClick={saveAllFees}>Save All Fees</button>
              </div>
            </div>
          )}

          {/* Admit Release */}
          {page === 'admit' && (
            <div className="reg-form admit-release">
              <div className="reg-form__section">
                <h4>Release Admit Cards</h4>
                <p className="exam-hint">
                  Only forms that are <strong>approved</strong> and marked <strong>paid</strong> can be released.
                  Enter the Time &amp; Date of Examination — it is printed on every card in this release.
                </p>
                {err && <p className="auth__err">{err}</p>}
                {relMsg && <p className="fee-saved">✓ {relMsg}</p>}

                <div className="admit-release-form">
                  <div className="admit-release-scope">
                    <label className="admit-release-radio">
                      <input type="radio" name="relScope" value="all"
                        checked={relScope === 'all'} onChange={() => setRelScope('all')} />
                      <span>All Students (every approved &amp; paid form)</span>
                    </label>
                    <label className="admit-release-radio">
                      <input type="radio" name="relScope" value="specific"
                        checked={relScope === 'specific'} onChange={() => setRelScope('specific')} />
                      <span>Specific Student (by roll number)</span>
                    </label>
                  </div>

                  {relScope === 'specific' && (
                    <div className="reg-form__grid">
                      <label>Roll Number
                        <input value={relRoll} onChange={e => setRelRoll(e.target.value)} placeholder="Enter roll number" />
                      </label>
                    </div>
                  )}

                  {relScope === 'all' && (
                    <div className="reg-form__grid">
                      <label>Exam Year <small>(optional — blank = all sessions)</small>
                        <select value={relYear} onChange={e => setRelYear(e.target.value)}>
                          <option value="">All sessions</option>
                          {sessions.map(y => <option key={y}>{y}</option>)}
                        </select>
                      </label>
                    </div>
                  )}

                  <div className="reg-form__grid">
                    <label className="reg-form__full">Time &amp; Date of Examination
                      <input value={relDatetime} onChange={e => setRelDatetime(e.target.value)}
                        placeholder="10:00 AM to 01:00 PM on 10-06-2023 (Sunday)" />
                    </label>
                  </div>

                  <div className="reg-form__actions">
                    <button className="btn" onClick={releaseAdmit}
                      disabled={busy || !relDatetime.trim() || (relScope === 'specific' && !relRoll.trim())}>
                      {busy ? 'Releasing…' : 'Release Admit Cards'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Attendance — approved exam forms only */}
          {page === 'attendance' && (() => {
            const approved = exams.filter(e => e.status === 'approved' && (!attYear || e.exam_year === attYear))
            const present = approved.filter(e => e.attendance === 'present').length
            const absent = approved.filter(e => e.attendance === 'absent').length
            return (
              <div>
                <p className="exam-hint">
                  Students whose exam form is filled and <strong>approved</strong>. Mark each one
                  Present or Absent — click the same button again to clear the mark.
                </p>
                {err && <p className="auth__err">{err}</p>}

                <div className="ds-toolbar att-toolbar">
                  <label className="att-filter">
                    Exam Year
                    <select value={attYear} onChange={e => setAttYear(e.target.value)}>
                      <option value="">All sessions</option>
                      {sessions.map(y => <option key={y}>{y}</option>)}
                    </select>
                  </label>
                  <span className="ds-count">
                    {approved.length} student(s) · {present} present · {absent} absent
                    {approved.length - present - absent > 0 && ` · ${approved.length - present - absent} unmarked`}
                  </span>
                </div>

                <div className="ds-table-wrap">
                  <table className="ds-table">
                    <thead><tr><th>Roll No</th><th>Reg No</th><th>Name</th><th>Class</th><th>Session</th><th>Center</th><th>Attendance</th></tr></thead>
                    <tbody>
                      {approved.length === 0 && (
                        <tr><td colSpan="7" className="ds-empty-cell">No approved exam forms{attYear && ` for ${attYear}`} yet.</td></tr>
                      )}
                      {approved.map(e => (
                        <tr key={e.id}>
                          <td><strong>{e.roll_no}</strong></td>
                          <td><span className="reg-badge reg-badge--sm">{e.reg_no}</span></td>
                          <td>{e.full_name}</td>
                          <td>{e.exam_class}</td>
                          <td>{e.exam_year}</td>
                          <td>{e.center_name} <small>({e.center_code})</small></td>
                          <td>
                            <span className={`att-badge att-badge--${e.attendance || 'none'}`}>
                              {e.attendance === 'present' ? 'Present' : e.attendance === 'absent' ? 'Absent' : 'Not marked'}
                            </span>
                            <span className="att-btns">
                              <button
                                className={`btn btn--xs btn--approve${e.attendance === 'present' ? ' is-active' : ''}`}
                                onClick={() => setAttendance(e.id, e.attendance === 'present' ? null : 'present')}>
                                Present
                              </button>
                              <button
                                className={`btn btn--xs btn--reject${e.attendance === 'absent' ? ' is-active' : ''}`}
                                onClick={() => setAttendance(e.id, e.attendance === 'absent' ? null : 'absent')}>
                                Absent
                              </button>
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })()}

          {page === 'results' && (() => {
            const eligible = exams.filter(e =>
              e.status === 'approved' &&
              e.student_status === 'approved' &&
              e.attendance === 'present' &&
              (!resultYear || e.exam_year === resultYear)
            )
            const selectedExam = eligible.find(e => String(e.id) === String(resultExamId))
            const selectedResult = selectedExam && resultSubject.trim()
              ? results.find(r => r.exam_form_id === selectedExam.id && r.subject.toLowerCase() === resultSubject.trim().toLowerCase())
              : null

            return (
              <div className="results-page">
                <div className="reg-form result-entry">
                  <div className="reg-form__header">
                    <h2>Enter Student Result</h2>
                    <p>Only approved students whose approved exam attendance is marked Present appear here.</p>
                  </div>
                  {err && <p className="auth__err">{err}</p>}
                  <div className="reg-form__grid">
                    <label>Exam Year
                      <select value={resultYear} onChange={e => { setResultYear(e.target.value); setResultExamId('') }}>
                        <option value="">All sessions</option>
                        {[...new Set(exams.map(e => e.exam_year))].filter(Boolean).sort().map(y => <option key={y}>{y}</option>)}
                      </select>
                    </label>
                    <label>Student Name *
                      <select value={resultExamId} onChange={e => setResultExamId(e.target.value)} required>
                        <option value="">Select approved present student</option>
                        {eligible.map(e => <option key={e.id} value={e.id}>{e.full_name} · Roll {e.roll_no}</option>)}
                      </select>
                    </label>
                  </div>

                  {selectedExam && (
                    <>
                      <div className="result-autofill">
                        <div><small>Student Name</small><strong>{selectedExam.full_name}</strong></div>
                        <div><small>Roll Number</small><strong>{selectedExam.roll_no}</strong></div>
                        <div><small>C/O Name</small><strong>{selectedExam.co_name || '—'}</strong></div>
                        <div><small>Examination Class</small><strong>{selectedExam.exam_class}</strong></div>
                        <div><small>Center Name</small><strong>{selectedExam.center_name}</strong></div>
                        <div><small>Center Code</small><strong>{selectedExam.center_code}</strong></div>
                      </div>
                      <div className="result-subject-row">
                        <label>Subject *
                          <input value={resultSubject} onChange={e => setResultSubject(e.target.value)} placeholder="Enter subject name" maxLength={120} />
                        </label>
                        <button
                          type="button"
                          className="btn"
                          disabled={!resultSubject.trim()}
                          onClick={() => setResultModal({ exam: selectedExam, existing: selectedResult })}>
                          {selectedResult ? 'Update Marks' : 'Process Marks'}
                        </button>
                      </div>
                    </>
                  )}

                  {!eligible.length && <p className="ds-empty">No approved students marked present{resultYear && ` for ${resultYear}`}.</p>}
                </div>

                <div className="result-list">
                  <h3>Saved Results ({results.length})</h3>
                  <div className="ds-table-wrap">
                    <table className="ds-table">
                      <thead><tr><th>Roll No</th><th>Name</th><th>Subject</th><th>Class</th><th>Obtained</th><th>Total</th><th>Percentage</th><th>Grade</th></tr></thead>
                      <tbody>
                        {results.length === 0 && <tr><td colSpan="8" className="ds-empty-cell">No results saved yet.</td></tr>}
                        {results.map(r => (
                          <tr key={r.id}>
                            <td><strong>{r.roll_no}</strong></td>
                            <td>{r.full_name}</td>
                            <td>{r.subject}</td>
                            <td>{r.exam_class}</td>
                            <td>{Number(r.total_obtained).toFixed(2)}</td>
                            <td>{Number(r.total_marks).toFixed(2)}</td>
                            <td>{Number(r.percentage).toFixed(2)}%</td>
                            <td><ResultGrade grade={r.grade} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {resultModal && (
                  <ResultMarksModal
                    exam={resultModal.exam}
                    subject={resultSubject.trim()}
                    existing={resultModal.existing}
                    busy={busy}
                    onClose={() => setResultModal(null)}
                    onSave={saveResult}
                  />
                )}
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}

/* ─── Student Dashboard ─────────────────────────────────────────────────── */
function StudentDashboard({ session, onLogout }) {
  const { notify } = useNotification()
  const [student, setStudent] = useState(session.user)
  const [sideOpen, setSideOpen] = useState(false)
  const [page, setPage] = useState(() => new URLSearchParams(window.location.search).has('payment_exam') ? 'exams' : 'profile')
  const [exams, setExams] = useState([])
  const [openYears, setOpenYears] = useState([])
  const [admitIdx, setAdmitIdx] = useState(0)
  const [resultIdx, setResultIdx] = useState(0)
  const [results, setResults] = useState([])
  const [paymentRetryId, setPaymentRetryId] = useState(null)
  const [paymentCheckId, setPaymentCheckId] = useState(null)
  const [onlineExams, setOnlineExams] = useState([])
  const [onlineUpload, setOnlineUpload] = useState({})
  const [onlineSubmitting, setOnlineSubmitting] = useState({})
  const [onlineClock, setOnlineClock] = useState({})
  const updatePayment = exam => setExams(previous => previous.map(item => item.id === exam.id ? { ...item, ...exam } : item))
  usePaymentRefresh(exams, session.token, updatePayment)

  const readImageFile = file => new Promise((resolve, reject) => {
    if (!file || !file.type || !/^image\/(png|jpeg|jpg)$/i.test(file.type)) {
      reject(new Error('Only PNG, JPG and JPEG images are allowed.'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Image could not be read.'))
    reader.readAsDataURL(file)
  })

  const handleOnlineFile = async (examId, file) => {
    if (!file) return
    try {
      const imageData = await readImageFile(file)
      setOnlineUpload(prev => ({ ...prev, [examId]: imageData }))
    } catch (error) {
      notify({ type: 'error', title: 'Invalid file', message: error.message })
    }
  }

  const submitOnlineAnswer = async exam => {
    const imageData = onlineUpload[exam.id]
    if (!imageData) {
      notify({ type: 'warning', title: 'No answer image', message: 'Choose a PNG, JPG or JPEG image before submitting.' })
      return
    }
    setOnlineSubmitting(prev => ({ ...prev, [exam.id]: true }))
    try {
      const d = await api(`/api/student/online-exams/${exam.id}/submit`, {
        method: 'POST',
        token: session.token,
        body: { imageData, topic: exam.topic || '' },
      })
      setOnlineExams(prev => prev.map(item => item.id === exam.id ? { ...item, submitted: true, file_data: d.submission?.file_data || item.file_data } : item))
      setOnlineUpload(prev => ({ ...prev, [exam.id]: '' }))
      notify({ type: 'success', title: 'Answer submitted', message: `Your answer for “${exam.topic}” was uploaded successfully.` })
    } catch (error) {
      notify({ type: 'error', title: 'Submission failed', message: error.message })
    } finally {
      setOnlineSubmitting(prev => ({ ...prev, [exam.id]: false }))
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = {}
      for (const exam of onlineExams) {
        const start = new Date(`${exam.exam_date}T${exam.start_time}`).getTime()
        const end = new Date(`${exam.exam_date}T${exam.end_time}`).getTime()
        const now = Date.now()
        next[exam.id] = {
          active: now >= start && now <= end,
          remainingMs: now < start ? Math.max(0, start - now) : now <= end ? Math.max(0, end - now) : 0,
        }
      }
      setOnlineClock(next)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [onlineExams])

  useEffect(() => {
    const next = {}
    for (const exam of onlineExams) {
      const start = new Date(`${exam.exam_date}T${exam.start_time}`).getTime()
      const end = new Date(`${exam.exam_date}T${exam.end_time}`).getTime()
      const now = Date.now()
      next[exam.id] = {
        active: now >= start && now <= end,
        remainingMs: now < start ? Math.max(0, start - now) : now <= end ? Math.max(0, end - now) : 0,
      }
    }
    setOnlineClock(next)
  }, [onlineExams])

  useEffect(() => {
    api('/api/student/me', { token: session.token })
      .then(d => { if (d.student) setStudent(d.student) })
      .catch(() => {})
  }, [])

  const loadExams = () => {
    api('/api/student/exams', { token: session.token })
      .then(d => setExams(d.exams))
      .catch(() => {})
  }

  const loadResults = () => {
    api('/api/student/results', { token: session.token })
      .then(d => { setResults(d.results); setResultIdx(0) })
      .catch(() => {})
  }

  const loadOnlineExams = () => {
    api('/api/student/online-exams', { token: session.token })
      .then(d => setOnlineExams(d.exams || []))
      .catch(() => {})
  }

  const retryPayment = async exam => {
    setPaymentRetryId(exam.id)
    try {
      const d = await api(`/api/student/exams/${exam.id}/payment`, { method: 'POST', token: session.token })
      updatePayment(d.exam)
      if (d.paid) {
        notify(paymentNotice(d.exam))
        return
      }
      window.location.href = d.checkoutUrl
    } catch (e) {
      notify({ type: 'error', title: 'Payment could not start', message: e.message })
    } finally {
      setPaymentRetryId(null)
    }
  }

  const checkPayment = async exam => {
    setPaymentCheckId(exam.id)
    try {
      const d = await api(`/api/student/exams/${exam.id}/payment/status`, { method: 'POST', token: session.token })
      updatePayment(d.exam)
      notify(paymentNotice(d.exam))
    } catch (error) {
      notify({ type: 'error', title: 'Payment check failed', message: error.message })
    } finally { setPaymentCheckId(null) }
  }

  useEffect(() => { loadExams(); loadResults(); loadOnlineExams() }, [])
  useEffect(() => {
    const examId = new URLSearchParams(window.location.search).get('payment_exam')
    if (!examId) return
    setPage('exams')
    const controller = new AbortController()
    api(`/api/student/exams/${encodeURIComponent(examId)}/payment/status`, { method: 'POST', token: session.token, signal: controller.signal })
      .then(d => { if (!controller.signal.aborted) { updatePayment(d.exam); notify(paymentNotice(d.exam)) } })
      .catch(e => { if (!controller.signal.aborted) notify({ type: 'error', title: 'Payment check failed', message: e.message }) })
      .finally(() => {
        if (controller.signal.aborted) return
        const url = new URL(window.location.href)
        url.searchParams.delete('payment_exam')
        window.history.replaceState({}, '', url.pathname + url.search + url.hash)
        loadExams()
      })
    return () => controller.abort()
  }, [session.token])
  useEffect(() => { if (page === 'exams' || page === 'exam' || page === 'admit' || page === 'online') loadExams() }, [page])
  useEffect(() => { if (page === 'exam') api('/api/exam-sessions').then(d => setOpenYears(d.sessions)).catch(() => {}) }, [page])
  useEffect(() => { if (page === 'results' || page === 'online') loadResults(); if (page === 'online') loadOnlineExams() }, [page])

  // Open years the student has not yet filled
  const availableYears = openYears.filter(y => !exams.some(e => e.exam_year === y))

  const nav = p => { setPage(p); setSideOpen(false) }

  const s = student
  const registrationReady = Boolean(s.reg_no)
  const releasedAdmitCount = exams.filter(e => e.admit_released).length
  const resultGroups = Array.from(results.reduce((groups, row) => {
    const key = row.exam_form_id || `${row.exam_year}-${row.roll_no}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
    return groups
  }, new Map()).values())

  const MENU = [
    { id: 'profile', icon: '👤', label: 'My Profile' },
    { id: 'card', icon: '🎫', label: 'Registration Card' },
    { id: 'exam', icon: '📝', label: 'Exam Fillup' },
    { id: 'exams', icon: '📋', label: 'My Exam Forms' },
    { id: 'online', icon: '🧠', label: 'Online Exam' },
    { id: 'admit', icon: '🎟️', label: 'Admit Card' },
    { id: 'results', icon: '🏆', label: 'My Marksheet' },
  ]

  const TITLES = { profile: 'My Profile', card: 'Registration Card', exam: 'Examination Form Fill-up', exams: 'My Exam Forms', online: 'Online Exam', admit: 'Admit Card', results: 'My Marksheet' }

  return (
    <div className="ds-layout">
      <aside className={`ds-sidebar ${sideOpen ? 'is-open' : ''}`}>
        <div className="ds-sidebar__brand">
          <Logo size={44} />
          <div>
            <strong>IMFAA</strong>
            <small>Student Portal</small>
          </div>
        </div>
        <div className="ds-sidebar__student-photo">
          {s.photo ? <img src={s.photo} alt={s.full_name} /> : <span>{s.full_name?.[0]}</span>}
          <strong>{s.full_name}</strong>
          {s.reg_no && <small>{s.reg_no}</small>}
        </div>
        <nav className="ds-sidebar__nav">
          {MENU.map(m => (
            <button key={m.id} className={`ds-sidebar__item ${page === m.id ? 'is-active' : ''}`} onClick={() => nav(m.id)}>
              <span className="ds-sidebar__icon">{m.icon}</span><span>{m.label}</span>
            </button>
          ))}
        </nav>
        <button className="ds-sidebar__logout" onClick={onLogout}>🚪 Logout</button>
      </aside>
      {sideOpen && <div className="ds-overlay" onClick={() => setSideOpen(false)} />}

      <div className="ds-main">
        <header className="ds-topbar">
          <button className="ds-hamburger" onClick={() => setSideOpen(v => !v)} aria-label="Menu">
            <span /><span /><span />
          </button>
          <h1 className="ds-topbar__title">{TITLES[page]}</h1>
          <span className="ds-topbar__user">👤 {s.full_name}</span>
        </header>
        <div className="ds-content">
          <StudentNoticeBoard token={session.token} />
          {page === 'profile' && (
            <>
              {s.reg_no && (
                <div className="reg-hero">
                  <div className="reg-hero__label">Registration Number</div>
                  <div className="reg-hero__number">{s.reg_no}</div>
                  <div className="reg-hero__sub">The Indian Music &amp; Fine Art Academy, West Bengal</div>
                </div>
              )}
              <ProfileCard s={s} />
              <section className="student-documents" aria-labelledby="student-documents-title">
                <div className="student-documents__head">
                  <div>
                    <span className="eyebrow">My documents</span>
                    <h2 id="student-documents-title">Download your official cards</h2>
                  </div>
                  <p>Open a card, then save it as a PDF or print a copy.</p>
                </div>
                <div className="student-documents__grid">
                  <article className="student-document">
                    <span className="student-document__icon">ID</span>
                    <div className="student-document__copy">
                      <span className={`card-status ${registrationReady ? 'card-status--active' : 'card-status--waiting'}`}>
                        {registrationReady ? 'Ready' : s.status === 'rejected' ? 'Needs attention' : 'Approval pending'}
                      </span>
                      <h3>Registration Card</h3>
                      <p>{registrationReady ? 'Your permanent academy registration and student details.' : 'The card becomes downloadable after the academy approves your registration.'}</p>
                    </div>
                    <button className="btn btn--sm" onClick={() => nav('card')}>{registrationReady ? 'View & download' : 'View status'}</button>
                  </article>
                  <article className={`student-document ${releasedAdmitCount ? '' : 'student-document--waiting'}`}>
                    <span className="student-document__icon">EX</span>
                    <div className="student-document__copy">
                      <span className={`card-status ${releasedAdmitCount ? 'card-status--active' : 'card-status--waiting'}`}>
                        {releasedAdmitCount ? `${releasedAdmitCount} ready` : 'Not released'}
                      </span>
                      <h3>Admit Card</h3>
                      <p>{releasedAdmitCount ? 'Your examination admit card is ready to download.' : 'It will appear after approval, payment and academy release.'}</p>
                    </div>
                    <button className="btn btn--sm btn--outline" onClick={() => nav('admit')}>View status</button>
                  </article>
                  <article className={`student-document ${resultGroups.length ? '' : 'student-document--waiting'}`}>
                    <span className="student-document__icon">MS</span>
                    <div className="student-document__copy">
                      <span className={`card-status ${resultGroups.length ? 'card-status--active' : 'card-status--waiting'}`}>
                        {resultGroups.length ? `${resultGroups.length} published` : 'Not published'}
                      </span>
                      <h3>Academic Marksheet</h3>
                      <p>{resultGroups.length ? 'Your subject marks, percentage and final result are ready.' : 'It will appear after the academy publishes your examination result.'}</p>
                    </div>
                    <button className="btn btn--sm btn--outline" onClick={() => nav('results')}>{resultGroups.length ? 'View & download' : 'View status'}</button>
                  </article>
                  <article className={`student-document ${resultGroups.length && !resultGroups[0].some(row => String(row.grade).toUpperCase() === 'F') ? '' : 'student-document--waiting'}`}>
                    <span className="student-document__icon">PC</span>
                    <div className="student-document__copy">
                      <span className={`card-status ${resultGroups.length && !resultGroups[0].some(row => String(row.grade).toUpperCase() === 'F') ? 'card-status--active' : 'card-status--waiting'}`}>
                        {resultGroups.length && !resultGroups[0].some(row => String(row.grade).toUpperCase() === 'F') ? 'Pass certificate' : 'Available after pass'}
                      </span>
                      <h3>Pass Certificate</h3>
                      <p>A formal digital certificate with your roll, centre, class and examination details.</p>
                    </div>
                    <button className="btn btn--sm btn--outline" onClick={() => nav('results')}>View certificate</button>
                  </article>
                </div>
              </section>
              <p className="ds-note">Your login credentials are your Aadhaar number and date of birth. Contact the admin to update any details.</p>
            </>
          )}

          {page === 'card' && (registrationReady ? (
            <RegistrationCard s={s} />
          ) : (
            <div className="document-waiting">
              <span className="document-waiting__icon">ID</span>
              <span className="card-status card-status--waiting">{s.status === 'rejected' ? 'Needs attention' : 'Approval pending'}</span>
              <h2>{s.status === 'rejected' ? 'Registration needs review' : 'Registration card is being prepared'}</h2>
              <p>{s.status === 'rejected' ? 'Please contact the academy to correct your registration details.' : 'Your registration card will be ready to download as soon as the academy approves your application.'}</p>
            </div>
          ))}

          {page === 'exam' && (
            availableYears.length ? (
              <ExamForm session={session} mode="student" fixedStudent={s} />
            ) : openYears.length ? (
              <div className="exam-result">
                <div className="exam-result__check">✓</div>
                <h2>Exam Form Already Submitted</h2>
                <p>You have already filled the exam form for every open session.</p>
                {exams.map(e => (
                  <div key={e.id} className="reg-hero">
                    <div className="reg-hero__label">Roll Number · {e.exam_year}</div>
                    <div className="reg-hero__number">{e.roll_no}</div>
                    <div className="reg-hero__sub">{e.exam_class} · {e.center_name}</div>
                  </div>
                ))}
                <button className="btn" onClick={() => nav('exams')}>View My Exam Forms</button>
              </div>
            ) : (
              <div className="exam-result">
                <h2>No Exam Session Open</h2>
                <p>There is no open examination session right now. Please check back once the academy opens a session.</p>
              </div>
            )
          )}

          {page === 'exams' && (
            <div>
              <div className="ds-toolbar">
                <span className="ds-count">{exams.length} form(s)</span>
                <button className="btn btn--sm" onClick={() => nav('exam')}>+ New Exam Form</button>
              </div>
              <div className="ds-table-wrap">
                <table className="ds-table">
                  <thead><tr><th>Roll No</th><th>Class</th><th>Session</th><th>Center</th><th>Status</th><th>Payment</th><th></th></tr></thead>
                  <tbody>
                    {exams.length === 0 && <tr><td colSpan="7" className="ds-empty-cell">You have no exam forms yet.</td></tr>}
                    {exams.map(e => (
                      <tr key={e.id}>
                        <td><strong>{e.roll_no}</strong></td>
                        <td>{e.exam_class}</td>
                        <td>{e.exam_year}</td>
                        <td>{e.center_name} <small>({e.center_code})</small></td>
                        <td><StatusBadge status={e.status} /></td>
                        <td>
                          <PayBadge status={e.payment_status} />
                          {e.payment_manual_override && <small>Set by admin. Contact the academy for corrections.</small>}
                        </td>
                        <td>
                          {e.payment_method === 'upi' && e.payment_status !== 'paid' && !e.payment_manual_override && (
                            <>
                              {e.payment_order_id && <button type="button" className="btn btn--xs btn--outline" onClick={() => checkPayment(e)} disabled={paymentCheckId !== null || paymentRetryId !== null}>{paymentCheckId === e.id ? 'Checking…' : 'Check payment'}</button>}
                              <button type="button" className="btn btn--xs" onClick={() => retryPayment(e)} disabled={paymentRetryId !== null || paymentCheckId !== null}>
                                {paymentRetryId === e.id ? 'Opening…' : e.payment_status === 'payment_failed' ? 'Retry payment' : e.payment_order_id ? 'Continue payment' : 'Pay now'}
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="ds-note">UPI payments update automatically after confirmation. If money was deducted but the fee still shows unpaid, ask the academy admin to verify it and mark it paid.</p>
            </div>
          )}

          {page === 'admit' && (() => {
            const released = exams.filter(e => e.admit_released)
            if (released.length === 0)
              return (
                <div className="document-waiting">
                  <span className="document-waiting__icon">EX</span>
                  <span className="card-status card-status--waiting">Not released</span>
                  <h2>Admit card is not available yet</h2>
                  <p>Your admit card will appear here after the academy approves your exam form, confirms payment and releases the card.</p>
                </div>
              )
            const idx = Math.min(admitIdx, released.length - 1)
            return (
              <div>
                {released.length > 1 && (
                  <div className="ds-toolbar">
                    <label className="admit-picker">
                      Select exam:&nbsp;
                      <select value={idx} onChange={ev => setAdmitIdx(Number(ev.target.value))}>
                        {released.map((e, i) => (
                          <option key={e.id} value={i}>{e.exam_year} — {e.exam_class} (Roll {e.roll_no})</option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                <AdmitCard e={released[idx]} />
              </div>
            )
          })()}

          {page === 'results' && (
            results.length === 0 ? (
              <div className="document-waiting">
                <span className="document-waiting__icon">MS</span>
                <span className="card-status card-status--waiting">Not published</span>
                <h2>Your marksheet is not available yet</h2>
                <p>The academy will publish your marksheet after your examination results have been entered.</p>
              </div>
            ) : (
              <div className="student-results">
                {resultGroups.length > 1 && (
                  <div className="ds-toolbar marksheet-picker">
                    <label>Select marksheet:&nbsp;
                      <select value={Math.min(resultIdx, resultGroups.length - 1)} onChange={event => setResultIdx(Number(event.target.value))}>
                        {resultGroups.map((group, index) => (
                          <option key={`${group[0].exam_form_id || index}`} value={index}>
                            {group[0].exam_year} — {group[0].exam_class} (Roll {group[0].roll_no})
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                <Marksheet student={s} results={resultGroups[Math.min(resultIdx, resultGroups.length - 1)]} />
                <PassCertificate student={s} results={resultGroups[Math.min(resultIdx, resultGroups.length - 1)]} />
              </div>
            )
          )}

          {page === 'online' && (
            <div className="reg-form__section">
              <h4>Live Online Exams</h4>
              <p className="exam-hint">Only approved and paid students assigned to this exam can upload a photo answer while the timer is live.</p>
              <div className="ds-table-wrap">
                <table className="ds-table">
                  <thead><tr><th>Topic</th><th>Roll No</th><th>Class</th><th>Schedule</th><th>Status</th><th>Answer</th></tr></thead>
                  <tbody>
                    {onlineExams.length === 0 && <tr><td colSpan="6" className="ds-empty-cell">No online exam is assigned to you yet.</td></tr>}
                    {onlineExams.map(exam => {
                      const state = onlineClock[exam.id] || { active: false, remainingMs: 0 }
                      const totalSeconds = Math.max(0, Math.floor((state.remainingMs || 0) / 1000))
                      const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0')
                      const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0')
                      const seconds = String(totalSeconds % 60).padStart(2, '0')

                      return (
                        <tr key={exam.id}>
                          <td><strong>{exam.topic}</strong></td>
                          <td>{exam.roll_no}</td>
                          <td>{exam.exam_class}</td>
                          <td>{formatExamDate(exam.exam_date)} · {exam.start_time} to {exam.end_time}</td>
                          <td>
                            {exam.submitted ? <span className="status-badge status-badge--approved">Submitted</span> : state.active ? <span className="status-badge status-badge--live">Live</span> : <span className="status-badge status-badge--pending">Not live</span>}
                            {!exam.submitted && state.active && <div className="exam-timer">{hours}:{minutes}:{seconds}</div>}
                          </td>
                          <td>
                            {!exam.submitted && state.active ? (
                              <div className="online-exam-upload">
                                <input type="file" accept="image/png,image/jpeg,image/jpg" onChange={e => handleOnlineFile(exam.id, e.target.files?.[0])} />
                                {onlineUpload[exam.id] && (
                                  <>
                                    <img src={onlineUpload[exam.id]} alt="Selected answer preview" className="online-exam-preview" />
                                    <button className="btn btn--sm" onClick={() => submitOnlineAnswer(exam)} disabled={onlineSubmitting[exam.id]}>
                                      {onlineSubmitting[exam.id] ? 'Submitting…' : 'Submit answer'}
                                    </button>
                                  </>
                                )}
                              </div>
                            ) : exam.submitted ? (
                              <button className="btn btn--sm btn--outline" onClick={() => window.open(exam.file_data, '_blank')}>View answer</button>
                            ) : (
                              <span className="ds-empty">Waiting for live time</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Login Panels ──────────────────────────────────────────────────────── */
function AdminLogin({ onSuccess }) {
  const [adminId, setAdminId] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const { notify } = useNotification()
  const submit = async e => {
    e.preventDefault(); setErr(''); setBusy(true)
    try { const d = await api('/api/admin/login', { method: 'POST', body: { adminId, password } }); notify({ type: 'success', title: 'Welcome back', message: 'Admin portal login successful.' }); onSuccess({ token: d.token, user: d.user, role: 'admin' }) }
    catch (e) {
      setErr(e.message)
      notify({ type: 'error', title: 'Login failed', message: e.message })
    } finally { setBusy(false) }
  }
  return (
    <form className="auth__form" onSubmit={submit}>
      <h3>Admin Login</h3>
      <p className="auth__hint">Restricted access for academy administrators.</p>
      {err && <p className="auth__err">{err}</p>}
      <label>Admin ID<input value={adminId} onChange={e => setAdminId(e.target.value)} required placeholder="Admin ID" /></label>
      <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="Password" /></label>
      <button className="btn btn--full" disabled={busy}>{busy ? 'Signing in…' : 'Login as Admin'}</button>
    </form>
  )
}

function StudentLogin({ onSuccess }) {
  const [aadhaar, setAadhaar] = useState('')
  const [dob, setDob] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const { notify } = useNotification()
  const submit = async e => {
    e.preventDefault(); setErr(''); setBusy(true)
    try { const d = await api('/api/student/login', { method: 'POST', body: { aadhaar, dob } }); notify({ type: 'success', title: 'Welcome', message: `Signed in as ${d.user.full_name}.` }); onSuccess({ token: d.token, user: d.user, role: 'student' }) }
    catch (e) {
      setErr(e.message)
      notify({ type: 'error', title: 'Login failed', message: e.message })
    } finally { setBusy(false) }
  }
  return (
    <form className="auth__form" onSubmit={submit}>
      <h3>Student Login</h3>
      <p className="auth__hint">Login with your Aadhaar number and date of birth.</p>
      {err && <p className="auth__err">{err}</p>}
      <label>Aadhaar Number<input value={aadhaar} onChange={e => setAadhaar(e.target.value)} required placeholder="12-digit Aadhaar" maxLength={12} /></label>
      <label>Date of Birth (Password)<input type="date" value={dob} onChange={e => setDob(e.target.value)} required /></label>
      <button className="btn btn--full" disabled={busy}>{busy ? 'Signing in…' : 'Login as Student'}</button>
    </form>
  )
}

/* ─── Share Registration Link (admin) ───────────────────────────────────── */
function ShareLink() {
  const link = `${window.location.origin}/register`
  const [copied, setCopied] = useState(false)
  const { notify } = useNotification()
  const msg = `Register for The Indian Music & Fine Art Academy: ${link}`

  const copy = async () => {
    try { await navigator.clipboard.writeText(link) }
    catch { /* fallback */ const t = document.createElement('textarea'); t.value = link; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove() }
    setCopied(true)
    notify({ type: 'success', title: 'Link copied', message: 'The public registration link is ready to share.' })
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="share-link">
      <div className="reg-form__section">
        <h4>Public Registration Link</h4>
        <p className="exam-hint">
          Share this link with anyone. They can fill the registration form themselves — no login needed.
          If a student with the same Aadhaar number already exists, the form will be blocked from submitting again.
        </p>
        <div className="share-link__box">
          <input readOnly value={link} onFocus={e => e.target.select()} />
          <button className="btn btn--sm" onClick={copy}>{copied ? '✓ Copied' : 'Copy Link'}</button>
        </div>
        <div className="share-link__actions">
          <a className="btn btn--sm btn--outline" href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer">Share on WhatsApp</a>
          <a className="btn btn--sm btn--outline" href={link} target="_blank" rel="noopener noreferrer">Open Form</a>
        </div>
      </div>
    </div>
  )
}

/* ─── Public Registration (shared link) ─────────────────────────────────── */
export function PublicRegister() {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(null)   // { regNo }
  const [dupRegNo, setDupRegNo] = useState('')
  const { notify } = useNotification()

  const save = async f => {
    setErr(''); setDupRegNo(''); setBusy(true)
    try {
      const res = await fetch('/api/public/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(f),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409) {
        if (data.regNo) {
          setDupRegNo(data.regNo)
          notify({ type: 'warning', title: 'Already registered', message: `Existing registration number: ${data.regNo}.` })
        }
        else {
          setErr(data.error || 'This Aadhaar number is already registered.')
          notify({ type: 'warning', title: 'Already registered', message: data.error || 'This Aadhaar number is already registered.' })
        }
        return
      }
      if (!res.ok) {
        setErr(data.error || 'Something went wrong')
        notify({ type: 'error', title: 'Registration failed', message: data.error || 'Something went wrong.' })
        return
      }
      setDone({ regNo: data.regNo })
      notify({ type: 'success', title: 'Registration successful', message: `Your registration number is ${data.regNo}.` })
    } catch {
      setErr('Network error — please try again.')
      notify({ type: 'error', title: 'Network error', message: 'Please check your connection and try again.' })
    } finally { setBusy(false) }
  }

  return (
    <div className="public-reg">
      <div className="public-reg__brand">
        <Logo size={64} />
        <div>
          <strong>The Indian Music &amp; Fine Art Academy</strong>
          <small>Online Student Registration · West Bengal, India</small>
        </div>
      </div>

      {done ? (
        <div className="exam-result">
          <div className="exam-result__check">✓</div>
          <h2>Registration Successful</h2>
          <p>Your details have been submitted to the academy.</p>
          <div className="reg-hero">
            <div className="reg-hero__label">Your Registration Number</div>
            <div className="reg-hero__number">{done.regNo}</div>
            <div className="reg-hero__sub">Keep this safe — log in later with your Aadhaar &amp; date of birth.</div>
          </div>
        </div>
      ) : dupRegNo ? (
        <div className="exam-result">
          <div className="exam-result__check exam-result__check--warn">!</div>
          <h2>Already Registered</h2>
          <p>A student with this Aadhaar number already exists in our records. The form cannot be submitted again.</p>
          <div className="reg-hero">
            <div className="reg-hero__label">Existing Registration Number</div>
            <div className="reg-hero__number">{dupRegNo}</div>
          </div>
        </div>
      ) : (
        <RegistrationForm onSave={save} busy={busy} err={err} />
      )}
    </div>
  )
}

/* ─── Admission Hub ─────────────────────────────────────────────────────── */
export default function Admission({ open, onClose }) {
  const [tab, setTab] = useState('student')
  const [session, setSession] = useState(null)
  const { notify } = useNotification()

  useEffect(() => {
    const saved = localStorage.getItem('ifaa_session')
    if (saved) { try { setSession(JSON.parse(saved)) } catch {} }
  }, [])

  const login = s => { setSession(s); localStorage.setItem('ifaa_session', JSON.stringify(s)) }
  const logout = () => {
    setSession(null)
    localStorage.removeItem('ifaa_session')
    notify({ type: 'info', title: 'Signed out', message: 'You have been logged out safely.' })
  }

  // Full-screen dashboard when logged in
  if (session) {
    return (
      <div className="ds-fullscreen">
        <button className="ds-fullscreen__close" onClick={onClose} title="Back to website">✕ Back to site</button>
        {session.role === 'admin'
          ? <AdminDashboard session={session} onLogout={logout} />
          : <StudentDashboard session={session} onLogout={logout} />}
      </div>
    )
  }

  if (!open) return null

  return (
    <div className="auth-overlay" onClick={onClose}>
      <div className="auth-modal" onClick={e => e.stopPropagation()}>
        <button className="auth-modal__close" onClick={onClose} aria-label="Close">×</button>
        <div className="auth-modal__brand">
          <Logo size={56} />
          <div><strong>Admission Portal</strong><small>The Indian Music &amp; Fine Art Academy</small></div>
        </div>
        <div className="auth__tabs">
          <button className={tab === 'student' ? 'is-active' : ''} onClick={() => setTab('student')}>Student Login</button>
          <button className={tab === 'admin' ? 'is-active' : ''} onClick={() => setTab('admin')}>Admin Login</button>
        </div>
        {tab === 'student' ? <StudentLogin onSuccess={login} /> : <AdminLogin onSuccess={login} />}
      </div>
    </div>
  )
}
