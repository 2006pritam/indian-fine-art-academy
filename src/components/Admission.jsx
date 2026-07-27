import React, { useState, useEffect, useRef } from 'react'
import Logo from './Logo.jsx'

const api = async (path, { method = 'GET', body, token } = {}) => {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Something went wrong')
  return data
}

const EMPTY = { fullName: '', coName: '', phone: '', email: '', aadhaar: '', dob: '', gender: '', address: '', currentClass: '', photo: '' }
const CLASSES = ['PP1', 'PP2', 'PP3', 'PP4', '1st Year', '2nd Year', '3rd Year Diploma', 'Bisharad', 'Ratna']

// Exam year sessions 2025-2026 .. 2099-2100
const EXAM_YEARS = Array.from({ length: 75 }, (_, i) => `${2025 + i}-${2026 + i}`)

// Academic session label from an enrolment date, e.g. 2026 -> "2026-27"
const sessionFromDate = d => {
  const y = d ? new Date(d).getFullYear() : new Date().getFullYear()
  return `${y}-${String(y + 1).slice(-2)}`
}
// Card number derived from the reg no, e.g. IMFAA-2026-0001 -> RC-20260001
const cardNoFromReg = reg => (reg ? `RC-${(reg.match(/\d+/g) || []).join('')}` : '—')

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
function ProfileCard({ s, onEdit, onDelete, backLabel, onBack }) {
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
          {(onEdit || onDelete) && (
            <div className="profile-card__actions">
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
    ['Aadhaar Number', s.aadhaar],
    ['Date of Birth', s.dob],
    ['Gender', s.gender],
  ]

  return (
    <div className="reg-card-wrap">
      <div className="reg-card" id="reg-card-print">
        <div className="reg-card__note">
          Note - (This Registration Card must be kept safe for all academy correspondence)
        </div>

        <div className="reg-card__body">
          <div className="reg-card__head">
            <div className="reg-card__school">
              <Logo size={58} />
              <div>
                <strong>The Indian Music &amp; Fine Art Academy</strong>
                <small>West Bengal, India</small>
              </div>
            </div>
            <div className="reg-card__photo">
              {s.photo ? <img src={s.photo} alt={s.full_name} /> : <span>{s.full_name?.[0] || '?'}</span>}
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

          <p className="reg-card__caption">This is a system generated card — signature not required.</p>
        </div>
      </div>

      <button className="btn reg-card__print-btn" onClick={() => window.print()}>
        Print / Download PDF
      </button>
    </div>
  )
}

/* ─── Exam Form ─────────────────────────────────────────────────────────── */
// mode: 'admin' (lookup by reg no) | 'student' (own reg no locked)
function ExamForm({ session, mode, fixedStudent }) {
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

  const lookup = async () => {
    setLookupErr(''); setStudent(null); setLooking(true)
    try {
      const d = await api(`/api/admin/lookup/${encodeURIComponent(regNo.trim())}`, { token: session.token })
      setStudent(d.student)
      setExamClass(d.student.current_class || '')
    } catch (e) { setLookupErr(e.message) } finally { setLooking(false) }
  }

  const submit = async e => {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      const path = mode === 'admin' ? '/api/admin/exams' : '/api/student/exams'
      const body = { regNo, examClass, examYear, centerCode, centerName }
      const d = await api(path, { method: 'POST', body, token: session.token })
      setResult(d.exam)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
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
      </div>
      <button className="btn" onClick={() => { setResult(null); setExamYear(''); setCenterCode(''); setCenterName('') }}>Fill Another</button>
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
          </div>
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
          <div className="reg-form__actions">
            <button type="submit" className="btn" disabled={busy}>{busy ? 'Submitting…' : 'Permit Exam & Generate Roll No'}</button>
          </div>
        </>
      )}
    </form>
  )
}

/* ─── Admin Dashboard ───────────────────────────────────────────────────── */
function AdminDashboard({ session, onLogout }) {
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

  useEffect(() => { if (page === 'students' || page === 'home') load() }, [page])
  useEffect(() => { if (page === 'exams') loadExams() }, [page])
  useEffect(() => { if (page === 'years' || page === 'exam-new') loadSessions() }, [page])
  useEffect(() => { if (page === 'fees') loadFees() }, [page])

  const openSession = async () => {
    if (!newYear) return
    await api('/api/admin/exam-sessions', { method: 'POST', body: { examYear: newYear }, token: session.token })
      .catch(e => setErr(e.message))
    loadSessions()
    setNewYear('')
  }

  const closeSession = async year => {
    if (!confirm(`Close exam session ${year}?`)) return
    await fetch(`/api/admin/exam-sessions/${encodeURIComponent(year)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${session.token}` } })
    loadSessions()
  }

  const delExam = async id => {
    if (!confirm('Delete this exam form?')) return
    await fetch(`/api/admin/exams/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${session.token}` } })
    loadExams()
  }

  const saveFee = async examClass => {
    setErr(''); setFeeSaved('')
    try {
      await api('/api/admin/exam-fees', { method: 'POST', body: { examClass, fee: fees[examClass] || 0 }, token: session.token })
      setFeeSaved(examClass)
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
      setTimeout(() => setFeeSaved(''), 2000)
    } catch (e) { setErr(e.message) }
  }

  const nav = p => { setPage(p); setSideOpen(false); setErr('') }

  const save = async f => {
    setErr(''); setBusy(true)
    try {
      if (page === 'register') {
        await api('/api/admin/students', { method: 'POST', body: f, token: session.token })
        nav('students')
      } else {
        const d = await api(`/api/admin/students/${selected.id}`, { method: 'PUT', body: f, token: session.token })
        setSelected(d.student); nav('detail')
      }
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const del = async id => {
    if (!confirm('Delete this student record permanently?')) return
    await fetch(`/api/admin/students/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${session.token}` } })
    load(); nav('students')
  }

  const filtered = students.filter(s =>
    !search || s.full_name.toLowerCase().includes(search.toLowerCase()) ||
    s.aadhaar?.includes(search) || s.phone?.includes(search) || s.reg_no?.includes(search)
  )

  const MENU = [
    { id: 'home', icon: '🏠', label: 'Dashboard' },
    { id: 'students', icon: '👥', label: 'All Students' },
    { id: 'register', icon: '📝', label: 'Registration' },
    { id: 'share', icon: '🔗', label: 'Share Link' },
    { id: 'years', icon: '📅', label: 'Exam Years' },
    { id: 'exams', icon: '📋', label: 'Exam Forms' },
    { id: 'fees', icon: '💰', label: 'Exam Fees' },
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
            {page === 'students' && 'All Students'}
            {page === 'register' && 'New Registration'}
            {page === 'share' && 'Share Registration Link'}
            {page === 'detail' && 'Student Profile'}
            {page === 'edit' && 'Edit Student'}
            {page === 'years' && 'Exam Years'}
            {page === 'exams' && 'Exam Forms'}
            {page === 'fees' && 'Exam Fees'}
            {page === 'exam-new' && 'New Exam Form'}
          </h1>
          <span className="ds-topbar__user">👤 {session.user.adminId}</span>
        </header>

        <div className="ds-content">
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
                    <thead><tr><th>Photo</th><th>Reg No</th><th>Name</th><th>C/O</th><th>Phone</th><th>Class</th><th></th></tr></thead>
                    <tbody>
                      {filtered.length === 0 && <tr><td colSpan="7" className="ds-empty-cell">No students found.</td></tr>}
                      {filtered.map(s => (
                        <tr key={s.id} className="ds-table__row" onClick={() => { setSelected(s); nav('detail') }}>
                          <td><div className="ds-thumb">{s.photo ? <img src={s.photo} alt="" /> : <span>{s.full_name[0]}</span>}</div></td>
                          <td><span className="reg-badge reg-badge--sm">{s.reg_no}</span></td>
                          <td><strong>{s.full_name}</strong></td>
                          <td>{s.co_name || '—'}</td>
                          <td>{s.phone || '—'}</td>
                          <td>{s.current_class || '—'}</td>
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
                  <thead><tr><th>Roll No</th><th>Reg No</th><th>Name</th><th>Class</th><th>Session</th><th>Center</th><th>Filled By</th><th></th></tr></thead>
                  <tbody>
                    {exams.length === 0 && <tr><td colSpan="8" className="ds-empty-cell">No exam forms yet.</td></tr>}
                    {exams.map(e => (
                      <tr key={e.id}>
                        <td><strong>{e.roll_no}</strong></td>
                        <td><span className="reg-badge reg-badge--sm">{e.reg_no}</span></td>
                        <td>{e.full_name}</td>
                        <td>{e.exam_class}</td>
                        <td>{e.exam_year}</td>
                        <td>{e.center_name} <small>({e.center_code})</small></td>
                        <td>{e.filled_by}</td>
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
        </div>
      </div>
    </div>
  )
}

/* ─── Student Dashboard ─────────────────────────────────────────────────── */
function StudentDashboard({ session, onLogout }) {
  const [student, setStudent] = useState(session.user)
  const [sideOpen, setSideOpen] = useState(false)
  const [page, setPage] = useState('profile') // profile | exam | exams
  const [exams, setExams] = useState([])
  const [openYears, setOpenYears] = useState([])

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

  useEffect(() => { if (page === 'exams' || page === 'exam') loadExams() }, [page])
  useEffect(() => { if (page === 'exam') api('/api/exam-sessions').then(d => setOpenYears(d.sessions)).catch(() => {}) }, [page])

  // Open years the student has not yet filled
  const availableYears = openYears.filter(y => !exams.some(e => e.exam_year === y))

  const nav = p => { setPage(p); setSideOpen(false) }

  const s = student

  const MENU = [
    { id: 'profile', icon: '👤', label: 'My Profile' },
    { id: 'card', icon: '🎫', label: 'Registration Card' },
    { id: 'exam', icon: '📝', label: 'Exam Fillup' },
    { id: 'exams', icon: '📋', label: 'My Exam Forms' },
  ]

  const TITLES = { profile: 'My Profile', card: 'Registration Card', exam: 'Examination Form Fill-up', exams: 'My Exam Forms' }

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
              <p className="ds-note">Your login credentials are your Aadhaar number and date of birth. Contact the admin to update any details.</p>
            </>
          )}

          {page === 'card' && <RegistrationCard s={s} />}

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
                  <thead><tr><th>Roll No</th><th>Class</th><th>Session</th><th>Center</th></tr></thead>
                  <tbody>
                    {exams.length === 0 && <tr><td colSpan="4" className="ds-empty-cell">You have no exam forms yet.</td></tr>}
                    {exams.map(e => (
                      <tr key={e.id}>
                        <td><strong>{e.roll_no}</strong></td>
                        <td>{e.exam_class}</td>
                        <td>{e.exam_year}</td>
                        <td>{e.center_name} <small>({e.center_code})</small></td>
                      </tr>
                    ))}
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
  const submit = async e => {
    e.preventDefault(); setErr(''); setBusy(true)
    try { const d = await api('/api/admin/login', { method: 'POST', body: { adminId, password } }); onSuccess({ token: d.token, user: d.user, role: 'admin' }) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
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
  const submit = async e => {
    e.preventDefault(); setErr(''); setBusy(true)
    try { const d = await api('/api/student/login', { method: 'POST', body: { aadhaar, dob } }); onSuccess({ token: d.token, user: d.user, role: 'student' }) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
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
  const msg = `Register for The Indian Music & Fine Art Academy: ${link}`

  const copy = async () => {
    try { await navigator.clipboard.writeText(link) }
    catch { /* fallback */ const t = document.createElement('textarea'); t.value = link; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove() }
    setCopied(true); setTimeout(() => setCopied(false), 2000)
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

  const save = async f => {
    setErr(''); setDupRegNo(''); setBusy(true)
    try {
      const res = await fetch('/api/public/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(f),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409) {
        if (data.regNo) setDupRegNo(data.regNo)
        else setErr(data.error || 'This Aadhaar number is already registered.')
        return
      }
      if (!res.ok) { setErr(data.error || 'Something went wrong'); return }
      setDone({ regNo: data.regNo })
    } catch {
      setErr('Network error — please try again.')
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

  useEffect(() => {
    const saved = localStorage.getItem('ifaa_session')
    if (saved) { try { setSession(JSON.parse(saved)) } catch {} }
  }, [])

  const login = s => { setSession(s); localStorage.setItem('ifaa_session', JSON.stringify(s)) }
  const logout = () => { setSession(null); localStorage.removeItem('ifaa_session') }

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
