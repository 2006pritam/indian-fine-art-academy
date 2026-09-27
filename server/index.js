import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPaymentGateway, createPaymentService, initPaymentSchema, mountPaymentRoutes } from './payments.js'
import { initNoticeSchema, mountNoticeRoutes } from './notices.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(__dirname, '..', 'dist')

const { Pool } = pg

// Hosted Postgres (Neon, Render, Railway…) requires SSL; a local Postgres does
// not. Default to SSL and only disable it for localhost, or when PGSSL=false.
const dbUrl = process.env.DATABASE_URL || ''
const isLocal = /@(localhost|127\.0\.0\.1)(:|\/)/.test(dbUrl)
const useSSL = process.env.PGSSL === 'false' ? false : !isLocal

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
})

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret'
const PORT = process.env.PORT || 4000
const indiaDateTime = (date, time) => new Date(`${date}T${time}+05:30`)
const PAYMENT_API_URL = process.env.PAYMENT_API_URL || 'https://famapi.mistahub.in/api'
const PAYMENT_API_KEY = process.env.PAYMENT_API_KEY || ''
const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || process.env.RENDER_EXTERNAL_URL || ''
const payments = createPaymentService({
  pool,
  gateway: createPaymentGateway({ apiUrl: PAYMENT_API_URL, apiKey: PAYMENT_API_KEY }),
  publicAppUrl: PUBLIC_APP_URL,
})

const app = express()
app.use(cors())
app.use(express.json({ limit: '8mb' })) // allow base64 photos

/* ---------------------------------------------------------------- schema */
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id            SERIAL PRIMARY KEY,
      admin_id      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT now()
    );
  `)
  // Migrate legacy schema if needed
  const legacy = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name='students' AND column_name='password_hash' LIMIT 1
  `)
  if (legacy.rows.length) {
    await pool.query('DROP TABLE students')
    console.log('Migrated: dropped legacy students table.')
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS students (
      id            SERIAL PRIMARY KEY,
      reg_no        TEXT UNIQUE,
      full_name     TEXT NOT NULL,
      co_name       TEXT,
      phone         TEXT,
      email         TEXT,
      aadhaar       TEXT UNIQUE NOT NULL,
      dob           TEXT NOT NULL,
      gender        TEXT,
      address       TEXT,
      current_class TEXT,
      photo         TEXT,
      created_at    TIMESTAMPTZ DEFAULT now()
    );
  `)

  // Add reg_no to existing tables that predate this column
  await pool.query(`
    ALTER TABLE students ADD COLUMN IF NOT EXISTS reg_no TEXT UNIQUE;
  `)

  // Approval status for registrations. Existing rows default to 'approved' so
  // nothing already in the DB is suddenly hidden.
  await pool.query(`
    ALTER TABLE students ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';
  `)

  // Exam sessions (years the admin has opened for fill-up)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS exam_sessions (
      id          SERIAL PRIMARY KEY,
      exam_year   TEXT UNIQUE NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT now()
    );
  `)

  // Exam forms table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS exam_forms (
      id            SERIAL PRIMARY KEY,
      student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      reg_no        TEXT NOT NULL,
      roll_no       TEXT UNIQUE,
      exam_class    TEXT NOT NULL,
      exam_year     TEXT NOT NULL,
      center_code   TEXT NOT NULL,
      center_name   TEXT NOT NULL,
      filled_by     TEXT NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT now(),
      UNIQUE (student_id, exam_year, exam_class)
    );
  `)

  // Approval status for exam forms. Existing rows default to 'approved'.
  await pool.query(`
    ALTER TABLE exam_forms ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';
  `)

  // Keep the fee snapshot and payment confirmation with each exam form.
  await pool.query(`
    ALTER TABLE exam_forms ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid';
  `)
  await pool.query(`ALTER TABLE exam_forms ADD COLUMN IF NOT EXISTS payment_method TEXT;`)
  await pool.query(`ALTER TABLE exam_forms ADD COLUMN IF NOT EXISTS payment_order_id TEXT;`)
  await pool.query(`ALTER TABLE exam_forms ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(10,2);`)
  await pool.query(`ALTER TABLE exam_forms ADD COLUMN IF NOT EXISTS payment_paid_at TIMESTAMPTZ;`)

  // Admit card release. admit_released flips true once the admin releases the
  // card (only for approved + paid forms); exam_datetime is the admin-typed
  // "Time & Date of Examination" line shown on the card.
  await pool.query(`
    ALTER TABLE exam_forms ADD COLUMN IF NOT EXISTS admit_released BOOLEAN NOT NULL DEFAULT false;
  `)
  await pool.query(`
    ALTER TABLE exam_forms ADD COLUMN IF NOT EXISTS exam_datetime TEXT;
  `)

  // Attendance for approved exam forms, marked by the admin on exam day.
  // NULL = not yet marked; otherwise 'present' or 'absent'.
  await pool.query(`
    ALTER TABLE exam_forms ADD COLUMN IF NOT EXISTS attendance TEXT;
  `)

  // Subject-wise results. Totals and percentage are calculated again by the
  // server so saved results cannot depend on client-side calculations.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS exam_results (
      id                    SERIAL PRIMARY KEY,
      exam_form_id          INTEGER NOT NULL REFERENCES exam_forms(id) ON DELETE CASCADE,
      subject               TEXT NOT NULL,
      subject_key           TEXT NOT NULL,
      sectional_obtained    NUMERIC(8,2) NOT NULL,
      sectional_total       NUMERIC(8,2) NOT NULL,
      practical_obtained    NUMERIC(8,2) NOT NULL,
      practical_total       NUMERIC(8,2) NOT NULL,
      theory_obtained       NUMERIC(8,2) NOT NULL,
      theory_total          NUMERIC(8,2) NOT NULL,
      total_obtained        NUMERIC(8,2) NOT NULL,
      total_marks           NUMERIC(8,2) NOT NULL,
      percentage            NUMERIC(6,2) NOT NULL,
      grade                 TEXT NOT NULL,
      created_at            TIMESTAMPTZ DEFAULT now(),
      updated_at            TIMESTAMPTZ DEFAULT now(),
      UNIQUE (exam_form_id, subject_key)
    );
  `)

  // Exam fees per class/level (admin-configurable)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS exam_fees (
      id            SERIAL PRIMARY KEY,
      exam_class    TEXT UNIQUE NOT NULL,
      fee           INTEGER NOT NULL DEFAULT 0,
      updated_at    TIMESTAMPTZ DEFAULT now()
    );
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS online_exams (
      id            SERIAL PRIMARY KEY,
      exam_year     TEXT NOT NULL,
      exam_date     DATE NOT NULL,
      start_time    TIME NOT NULL,
      end_time      TIME NOT NULL,
      topic         TEXT NOT NULL,
      target_scope  TEXT NOT NULL DEFAULT 'all',
      student_ids   INTEGER[] NOT NULL DEFAULT '{}',
      created_by    TEXT NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT now()
    );
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS online_exam_submissions (
      id            SERIAL PRIMARY KEY,
      exam_id       INTEGER NOT NULL REFERENCES online_exams(id) ON DELETE CASCADE,
      student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      roll_no       TEXT,
      exam_class    TEXT,
      topic         TEXT,
      file_data     TEXT NOT NULL,
      submitted_at  TIMESTAMPTZ DEFAULT now(),
      UNIQUE (exam_id, student_id)
    );
  `)

  // Backfill any existing rows that have no reg_no
  const noReg = await pool.query(`SELECT id, created_at FROM students WHERE reg_no IS NULL ORDER BY id`)
  for (const row of noReg.rows) {
    const year = new Date(row.created_at).getFullYear()
    const regNo = `IMFAA-${year}-${String(row.id).padStart(4, '0')}`
    await pool.query(`UPDATE students SET reg_no=$1 WHERE id=$2`, [regNo, row.id])
  }
  if (noReg.rows.length) console.log(`Backfilled ${noReg.rows.length} registration number(s).`)

  // Seed the default admin from env if not present
  const adminId = process.env.ADMIN_ID || 'uttam5879'
  const adminPw = process.env.ADMIN_PASSWORD || '5050'
  const { rows } = await pool.query('SELECT id FROM admins WHERE admin_id=$1', [adminId])
  if (rows.length === 0) {
    const hash = await bcrypt.hash(adminPw, 10)
    await pool.query('INSERT INTO admins (admin_id, password_hash) VALUES ($1,$2)', [adminId, hash])
    console.log(`Seeded default admin "${adminId}"`)
  }
  await initPaymentSchema(pool)
  await initNoticeSchema(pool)
  console.log('Database ready.')
}

/* ------------------------------------------------------------ middleware */
function auth(role) {
  return (req, res, next) => {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) return res.status(401).json({ error: 'Not authenticated' })
    try {
      const payload = jwt.verify(token, JWT_SECRET)
      if (role && payload.role !== role) return res.status(403).json({ error: 'Forbidden' })
      req.user = payload
      next()
    } catch {
      res.status(401).json({ error: 'Invalid or expired session' })
    }
  }
}

// Shared columns returned to clients (exclude nothing sensitive except handled per-route)
const STUDENT_COLS =
  'id, reg_no, full_name, co_name, phone, email, aadhaar, dob, gender, address, current_class, photo, status, created_at'

/* ---------------------------------------------------------------- routes */
mountPaymentRoutes(app, auth, payments)
mountNoticeRoutes(app, auth, pool)
app.get('/api/health', (_req, res) => res.json({ ok: true }))

// Admin login
app.post('/api/admin/login', async (req, res) => {
  const { adminId, password } = req.body || {}
  if (!adminId || !password) return res.status(400).json({ error: 'Admin ID and password required' })
  try {
    const { rows } = await pool.query('SELECT * FROM admins WHERE admin_id=$1', [adminId])
    const admin = rows[0]
    if (!admin || !(await bcrypt.compare(password, admin.password_hash)))
      return res.status(401).json({ error: 'Invalid admin credentials' })
    const token = jwt.sign({ id: admin.id, role: 'admin', name: admin.admin_id }, JWT_SECRET, { expiresIn: '8h' })
    res.json({ token, user: { adminId: admin.admin_id, role: 'admin' } })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Student login — ID = aadhaar, password = date of birth
app.post('/api/student/login', async (req, res) => {
  const { aadhaar, dob } = req.body || {}
  if (!aadhaar || !dob) return res.status(400).json({ error: 'Aadhaar number and date of birth required' })
  try {
    const { rows } = await pool.query(`SELECT ${STUDENT_COLS} FROM students WHERE aadhaar=$1`, [aadhaar.trim()])
    const s = rows[0]
    if (!s || s.dob !== dob)
      return res.status(401).json({ error: 'Invalid Aadhaar number or date of birth' })
    const token = jwt.sign({ id: s.id, role: 'student', name: s.full_name }, JWT_SECRET, { expiresIn: '8h' })
    res.json({ token, user: { ...s, role: 'student' } })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Student self profile
app.get('/api/student/me', auth('student'), async (req, res) => {
  const { rows } = await pool.query(`SELECT ${STUDENT_COLS} FROM students WHERE id=$1`, [req.user.id])
  res.json({ student: rows[0] || null })
})

// Public self-registration via a shared link (no auth).
// Rejects if a student with the same Aadhaar already exists in the DB.
app.post('/api/public/register', async (req, res) => {
  const b = req.body || {}
  if (!b.fullName || !b.aadhaar || !b.dob)
    return res.status(400).json({ error: 'Name, Aadhaar number and date of birth are required' })
  const aadhaar = String(b.aadhaar).trim()
  if (!/^\d{12}$/.test(aadhaar))
    return res.status(400).json({ error: 'Aadhaar number must be exactly 12 digits' })
  try {
    const dup = await pool.query('SELECT reg_no FROM students WHERE aadhaar=$1', [aadhaar])
    if (dup.rows.length)
      return res.status(409).json({ error: 'This Aadhaar number is already registered. The form cannot be submitted again.', regNo: dup.rows[0].reg_no })
    const { rows } = await pool.query(
      `INSERT INTO students
        (full_name, co_name, phone, email, aadhaar, dob, gender, address, current_class, photo, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')
       RETURNING id, created_at`,
      [b.fullName, b.coName || null, b.phone || null, b.email || null, aadhaar,
       b.dob, b.gender || null, b.address || null, b.currentClass || null, b.photo || null]
    )
    const { id, created_at } = rows[0]
    const year = new Date(created_at).getFullYear()
    const regNo = `IMFAA-${year}-${String(id).padStart(4, '0')}`
    await pool.query('UPDATE students SET reg_no=$1 WHERE id=$2', [regNo, id])
    res.status(201).json({ ok: true, regNo })
  } catch (e) {
    if (e.code === '23505')
      return res.status(409).json({ error: 'This Aadhaar number is already registered. The form cannot be submitted again.' })
    res.status(500).json({ error: 'Server error' })
  }
})

/* -------------------------------------------------- Admin CRUD: students */
// List
app.get('/api/admin/students', auth('admin'), async (_req, res) => {
  const { rows } = await pool.query(`SELECT ${STUDENT_COLS} FROM students ORDER BY created_at DESC`)
  res.json({ students: rows })
})

// Read one
app.get('/api/admin/students/:id', auth('admin'), async (req, res) => {
  const { rows } = await pool.query(`SELECT ${STUDENT_COLS} FROM students WHERE id=$1`, [req.params.id])
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json({ student: rows[0] })
})

// Create
app.post('/api/admin/students', auth('admin'), async (req, res) => {
  const b = req.body || {}
  if (!b.fullName || !b.aadhaar || !b.dob)
    return res.status(400).json({ error: 'Name, Aadhaar number and date of birth are required' })
  try {
    const dup = await pool.query('SELECT id FROM students WHERE aadhaar=$1', [b.aadhaar.trim()])
    if (dup.rows.length) return res.status(409).json({ error: 'A student with this Aadhaar already exists' })
    // Insert first to get the id, then set reg_no
    const { rows } = await pool.query(
      `INSERT INTO students
        (full_name, co_name, phone, email, aadhaar, dob, gender, address, current_class, photo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, created_at`,
      [b.fullName, b.coName || null, b.phone || null, b.email || null, b.aadhaar.trim(),
       b.dob, b.gender || null, b.address || null, b.currentClass || null, b.photo || null]
    )
    const { id, created_at } = rows[0]
    const year = new Date(created_at).getFullYear()
    const regNo = `IMFAA-${year}-${String(id).padStart(4, '0')}`
    const final = await pool.query(
      `UPDATE students SET reg_no=$1 WHERE id=$2 RETURNING ${STUDENT_COLS}`,
      [regNo, id]
    )
    res.status(201).json({ student: final.rows[0] })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Update
app.put('/api/admin/students/:id', auth('admin'), async (req, res) => {
  const b = req.body || {}
  if (!b.fullName || !b.aadhaar || !b.dob)
    return res.status(400).json({ error: 'Name, Aadhaar number and date of birth are required' })
  try {
    const dup = await pool.query('SELECT id FROM students WHERE aadhaar=$1 AND id<>$2', [b.aadhaar.trim(), req.params.id])
    if (dup.rows.length) return res.status(409).json({ error: 'Another student already uses this Aadhaar' })
    const { rows } = await pool.query(
      `UPDATE students SET
        full_name=$1, co_name=$2, phone=$3, email=$4, aadhaar=$5, dob=$6,
        gender=$7, address=$8, current_class=$9, photo=$10
       WHERE id=$11
       RETURNING ${STUDENT_COLS}`,
      [b.fullName, b.coName || null, b.phone || null, b.email || null, b.aadhaar.trim(),
       b.dob, b.gender || null, b.address || null, b.currentClass || null, b.photo || null,
       req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    res.json({ student: rows[0] })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Delete
app.delete('/api/admin/students/:id', auth('admin'), async (req, res) => {
  await pool.query('DELETE FROM students WHERE id=$1', [req.params.id])
  res.json({ ok: true })
})

// Approve / reject a student registration (admin)
app.patch('/api/admin/students/:id/status', auth('admin'), async (req, res) => {
  const { status } = req.body || {}
  if (!['approved', 'rejected', 'pending'].includes(status))
    return res.status(400).json({ error: 'Status must be approved, rejected or pending' })
  try {
    const { rows } = await pool.query(
      `UPDATE students SET status=$1 WHERE id=$2 RETURNING ${STUDENT_COLS}`,
      [status, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    res.json({ student: rows[0] })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/* ----------------------------------------------------- Exam form routes */

// Lookup a student by registration number (admin — for exam fill-up)
app.get('/api/admin/lookup/:regNo', auth('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${STUDENT_COLS} FROM students WHERE reg_no=$1`,
      [req.params.regNo.trim()]
    )
    if (!rows.length) return res.status(404).json({ error: 'No student found with this registration number' })
    res.json({ student: rows[0] })
  } catch (e) {
    console.error('GET /api/admin/lookup:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Validate exam year range: 2025-2026 .. 2099-2100, and not a future session
function validExamYear(examYear) {
  const m = /^(\d{4})-(\d{4})$/.exec(examYear || '')
  if (!m) return 'Exam year must be in format 2025-2026'
  const start = Number(m[1]), end = Number(m[2])
  if (end !== start + 1) return 'Exam year must be consecutive, e.g. 2025-2026'
  if (start < 2025 || start > 2099) return 'Exam year must be between 2025-2026 and 2099-2100'
  const curYear = new Date().getFullYear()
  // Session starts in the calendar year `start`; cannot permit a session that has not begun
  if (start > curYear) return `Cannot permit exam for a future session (current year ${curYear})`
  return null
}

// Generate roll number: last 3 digits of center code + 3-digit serial for that center+year
async function generateRollNo(centerCode, examYear) {
  const digits = (centerCode.match(/\d+/g) || []).join('')
  const code3 = digits.slice(-3).padStart(3, '0')
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM exam_forms WHERE center_code=$1 AND exam_year=$2`,
    [centerCode, examYear]
  )
  const serial = String(rows[0].c + 1).padStart(3, '0')
  return `${code3}${serial}` // e.g. 137 + 001 => 137001
}

// Shared handler: create an exam form (admin or student)
async function createExamForm(req, res, filledBy) {
  const b = req.body || {}
  const { regNo, examClass, examYear, centerCode, centerName } = b
  const paymentMethod = filledBy === 'student' ? b.paymentMethod : 'cash'
  if (!regNo || !examClass || !examYear || !centerCode || !centerName)
    return res.status(400).json({ error: 'All fields are required' })

  const yearErr = validExamYear(examYear)
  if (yearErr) return res.status(400).json({ error: yearErr })

  try {
    // Year must be an open session
    const open = await pool.query('SELECT id FROM exam_sessions WHERE exam_year=$1', [examYear])
    if (!open.rows.length)
      return res.status(400).json({ error: `Exam session ${examYear} is not open. Ask the admin to open it first.` })

    const stu = await pool.query('SELECT id, reg_no FROM students WHERE reg_no=$1', [regNo.trim()])
    if (!stu.rows.length) return res.status(404).json({ error: 'Student not found' })
    const student = stu.rows[0]
    const feeResult = await pool.query('SELECT fee FROM exam_fees WHERE exam_class=$1', [examClass])
    if (!feeResult.rows.length)
      return res.status(400).json({ error: 'The exam fee has not been set for this class. Ask the admin to set it first.' })
    const fee = Number(feeResult.rows[0].fee)
    if (filledBy === 'student' && fee > 0 && !['upi', 'cash'].includes(paymentMethod))
      return res.status(400).json({ error: 'Choose UPI or cash for payment' })

    // A student may only be permitted once per exam session (year)
    const dupYear = await pool.query(
      'SELECT id FROM exam_forms WHERE student_id=$1 AND exam_year=$2',
      [student.id, examYear]
    )
    if (dupYear.rows.length)
      return res.status(409).json({ error: `This student already has an exam form for ${examYear}` })

    const rollNo = await generateRollNo(centerCode.trim(), examYear)
    // Admin-filled forms are auto-approved; student-filled forms await approval.
    const status = filledBy === 'admin' ? 'approved' : 'pending'
    const paymentStatus = fee === 0 ? 'paid' : paymentMethod === 'cash' ? 'cash_pending' : 'payment_pending'
    const { rows } = await pool.query(
      `INSERT INTO exam_forms (student_id, reg_no, roll_no, exam_class, exam_year, center_code, center_name, filled_by, status, payment_status, payment_method, payment_amount, payment_paid_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CASE WHEN $10='paid' THEN now() ELSE NULL END) RETURNING *`,
      [student.id, student.reg_no, rollNo, examClass, examYear, centerCode.trim(), centerName.trim(), filledBy, status, paymentStatus, paymentMethod || null, fee]
    )
    res.status(201).json({ exam: rows[0] })
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Duplicate exam form or roll number' })
    res.status(500).json({ error: 'Server error' })
  }
}

// Admin fills exam form (any student by reg no)
app.post('/api/admin/exams', auth('admin'), (req, res) => createExamForm(req, res, 'admin'))

/* ------------------------------------------------- Exam session routes */

// List open sessions
app.get('/api/exam-sessions', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT exam_year FROM exam_sessions ORDER BY exam_year')
    res.json({ sessions: rows.map(r => r.exam_year) })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Open a session (admin)
app.post('/api/admin/exam-sessions', auth('admin'), async (req, res) => {
  const { examYear } = req.body || {}
  const yearErr = validExamYear(examYear)
  if (yearErr) return res.status(400).json({ error: yearErr })
  try {
    await pool.query('INSERT INTO exam_sessions (exam_year) VALUES ($1) ON CONFLICT DO NOTHING', [examYear])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Close a session (admin)
app.delete('/api/admin/exam-sessions/:year', auth('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM exam_sessions WHERE exam_year=$1', [req.params.year])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// List all exam forms (admin)
app.get('/api/admin/exams', auth('admin'), async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT e.*, s.full_name, s.current_class, s.photo, s.co_name, s.dob,
             s.status AS student_status
      FROM exam_forms e JOIN students s ON s.id = e.student_id
      ORDER BY e.created_at DESC
    `)
    res.json({ exams: rows })
  } catch (e) {
    console.error('GET /api/admin/exams:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Delete exam form (admin)
app.delete('/api/admin/exams/:id', auth('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM exam_forms WHERE id=$1', [req.params.id])
    res.json({ ok: true })
  } catch (e) {
    console.error('DELETE /api/admin/exams:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Approve / reject an exam form (admin)
app.patch('/api/admin/exams/:id/status', auth('admin'), async (req, res) => {
  const { status } = req.body || {}
  if (!['approved', 'rejected', 'pending'].includes(status))
    return res.status(400).json({ error: 'Status must be approved, rejected or pending' })
  try {
    const { rows } = await pool.query(
      'UPDATE exam_forms SET status=$1 WHERE id=$2 RETURNING *',
      [status, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    res.json({ exam: rows[0] })
  } catch (e) {
    console.error('PATCH /api/admin/exams status:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Mark attendance on an approved exam form (admin).
// attendance: 'present' | 'absent' | null (null clears an accidental mark)
app.patch('/api/admin/exams/:id/attendance', auth('admin'), async (req, res) => {
  const { attendance } = req.body || {}
  if (attendance !== null && !['present', 'absent'].includes(attendance))
    return res.status(400).json({ error: 'Attendance must be present or absent' })
  try {
    // Only approved forms can be marked.
    const found = await pool.query('SELECT status FROM exam_forms WHERE id=$1', [req.params.id])
    if (!found.rows.length) return res.status(404).json({ error: 'Not found' })
    if (found.rows[0].status !== 'approved')
      return res.status(400).json({ error: 'Only approved exam forms can be marked' })

    // Return the joined row so the client keeps the student's name.
    const { rows } = await pool.query(`
      UPDATE exam_forms e SET attendance=$1 WHERE e.id=$2
      RETURNING e.*, (SELECT s.full_name    FROM students s WHERE s.id = e.student_id) AS full_name,
                     (SELECT s.current_class FROM students s WHERE s.id = e.student_id) AS current_class,
                     (SELECT s.photo         FROM students s WHERE s.id = e.student_id) AS photo,
                     (SELECT s.co_name       FROM students s WHERE s.id = e.student_id) AS co_name,
                     (SELECT s.dob           FROM students s WHERE s.id = e.student_id) AS dob
    `, [attendance, req.params.id])
    res.json({ exam: rows[0] })
  } catch (e) {
    console.error('PATCH /api/admin/exams attendance:', e.message)
    res.status(500).json({ error: e.message })
  }
})

/* ------------------------------------------------------- Result routes */

// List saved results with the candidate and exam details needed by the admin.
app.get('/api/admin/results', auth('admin'), async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.*, e.roll_no, e.reg_no, e.exam_class, e.exam_year,
             e.center_code, e.center_name, s.full_name, s.co_name
      FROM exam_results r
      JOIN exam_forms e ON e.id = r.exam_form_id
      JOIN students s ON s.id = e.student_id
      ORDER BY r.updated_at DESC, r.id DESC
    `)
    res.json({ results: rows })
  } catch (e) {
    console.error('GET /api/admin/results:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Create or update a subject result. Only approved students marked present are
// eligible; all derived values are calculated on the server before saving.
app.post('/api/admin/results', auth('admin'), async (req, res) => {
  const b = req.body || {}
  const examId = Number(b.examId)
  const subject = String(b.subject || '').trim().replace(/\s+/g, ' ')
  const grade = String(b.grade || '').trim().toUpperCase()
  const allowedGrades = ['F', 'D', 'B', 'A', 'E', 'O']

  if (!Number.isInteger(examId) || examId < 1)
    return res.status(400).json({ error: 'A valid student exam record is required' })
  if (!subject)
    return res.status(400).json({ error: 'Subject is required' })
  if (subject.length > 120)
    return res.status(400).json({ error: 'Subject must be 120 characters or fewer' })
  if (!allowedGrades.includes(grade))
    return res.status(400).json({ error: 'Grade must be F, D, B, A, E or O' })

  const markFields = [
    ['Sectional obtained marks', b.sectionalObtained],
    ['Sectional total marks', b.sectionalTotal],
    ['Practical obtained marks', b.practicalObtained],
    ['Practical total marks', b.practicalTotal],
    ['Theory obtained marks', b.theoryObtained],
    ['Theory total marks', b.theoryTotal],
  ]
  for (const [label, value] of markFields) {
    if (value === '' || value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) < 0)
      return res.status(400).json({ error: `${label} must be a non-negative number` })
    if (Number(value) > 999999.99)
      return res.status(400).json({ error: `${label} is too large` })
  }

  const sectionalObtained = Number(b.sectionalObtained)
  const sectionalTotal = Number(b.sectionalTotal)
  const practicalObtained = Number(b.practicalObtained)
  const practicalTotal = Number(b.practicalTotal)
  const theoryObtained = Number(b.theoryObtained)
  const theoryTotal = Number(b.theoryTotal)

  if (sectionalTotal <= 0 || practicalTotal <= 0 || theoryTotal <= 0)
    return res.status(400).json({ error: 'Total marks for every paper must be greater than zero' })
  if (sectionalObtained > sectionalTotal || practicalObtained > practicalTotal || theoryObtained > theoryTotal)
    return res.status(400).json({ error: 'Obtained marks cannot be greater than total marks' })

  try {
    const eligible = await pool.query(
      `SELECT e.id
       FROM exam_forms e JOIN students s ON s.id = e.student_id
       WHERE e.id=$1 AND e.status='approved' AND e.attendance='present' AND s.status='approved'`,
      [examId]
    )
    if (!eligible.rows.length)
      return res.status(400).json({ error: 'Results can only be entered for approved students marked present' })

    const totalObtained = sectionalObtained + practicalObtained + theoryObtained
    const totalMarks = sectionalTotal + practicalTotal + theoryTotal
    const percentage = Math.round((totalObtained / totalMarks) * 10000) / 100
    const subjectKey = subject.toLocaleLowerCase('en-IN')

    const saved = await pool.query(`
      INSERT INTO exam_results
        (exam_form_id, subject, subject_key, sectional_obtained, sectional_total,
         practical_obtained, practical_total, theory_obtained, theory_total,
         total_obtained, total_marks, percentage, grade)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (exam_form_id, subject_key) DO UPDATE SET
        subject=EXCLUDED.subject,
        sectional_obtained=EXCLUDED.sectional_obtained,
        sectional_total=EXCLUDED.sectional_total,
        practical_obtained=EXCLUDED.practical_obtained,
        practical_total=EXCLUDED.practical_total,
        theory_obtained=EXCLUDED.theory_obtained,
        theory_total=EXCLUDED.theory_total,
        total_obtained=EXCLUDED.total_obtained,
        total_marks=EXCLUDED.total_marks,
        percentage=EXCLUDED.percentage,
        grade=EXCLUDED.grade,
        updated_at=now()
      RETURNING id
    `, [examId, subject, subjectKey, sectionalObtained, sectionalTotal,
        practicalObtained, practicalTotal, theoryObtained, theoryTotal,
        totalObtained, totalMarks, percentage, grade])

    const { rows } = await pool.query(`
      SELECT r.*, e.roll_no, e.reg_no, e.exam_class, e.exam_year,
             e.center_code, e.center_name, s.full_name, s.co_name
      FROM exam_results r
      JOIN exam_forms e ON e.id = r.exam_form_id
      JOIN students s ON s.id = e.student_id
      WHERE r.id=$1
    `, [saved.rows[0].id])
    res.json({ result: rows[0] })
  } catch (e) {
    console.error('POST /api/admin/results:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Students can view only their own saved subject results.
app.get('/api/student/results', auth('student'), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.*, e.roll_no, e.reg_no, e.exam_class, e.exam_year,
             e.center_code, e.center_name
      FROM exam_results r
      JOIN exam_forms e ON e.id = r.exam_form_id
      WHERE e.student_id=$1
      ORDER BY e.exam_year DESC, r.subject
    `, [req.user.id])
    res.json({ results: rows })
  } catch (e) {
    console.error('GET /api/student/results:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Online exam scheduling / submission API
app.get('/api/admin/online-exams', auth('admin'), async (_req, res) => {
  try {
    const { rows } = await pool.query(`
            SELECT oe.id, oe.exam_year, oe.exam_date::text AS exam_date, oe.start_time, oe.end_time,
              oe.topic, oe.target_scope, oe.student_ids, oe.created_by, oe.created_at,
                    COUNT(oes.id)::int AS submission_count,
                    CARDINALITY(oe.student_ids)::int AS assigned_count,
                    GREATEST(CARDINALITY(oe.student_ids) - COUNT(oes.id), 0)::int AS pending_count
      FROM online_exams oe
      LEFT JOIN online_exam_submissions oes ON oes.exam_id = oe.id
      GROUP BY oe.id
      ORDER BY oe.exam_date DESC, oe.start_time DESC
    `)
    res.json({ exams: rows })
  } catch (e) {
    console.error('GET /api/admin/online-exams:', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/admin/online-exams', auth('admin'), async (req, res) => {
  const b = req.body || {}
  const { examYear, examDate, startTime, endTime, topic, targetScope, studentIds } = b
  if (!examYear || !examDate || !startTime || !endTime || !topic || !String(topic).trim()) {
    return res.status(400).json({ error: 'Exam year, date, start time, end time and topic are required' })
  }
  if (startTime >= endTime) {
    return res.status(400).json({ error: 'End time must be later than the start time' })
  }

  try {
    const week = await pool.query('SELECT id FROM exam_sessions WHERE exam_year=$1', [examYear])
    if (!week.rows.length) return res.status(400).json({ error: `Exam session ${examYear} is not open` })

    const eligible = await pool.query(`
      SELECT e.student_id
      FROM exam_forms e
      JOIN students s ON s.id = e.student_id
      WHERE e.exam_year=$1 AND e.status='approved' AND e.payment_status='paid' AND s.status='approved'
      GROUP BY e.student_id
      ORDER BY e.student_id
    `, [examYear])

    const eligibleIds = eligible.rows.map(r => Number(r.student_id))
    const selectedIds = targetScope === 'specific'
      ? (Array.isArray(studentIds) ? studentIds.map(Number).filter(id => eligibleIds.includes(Number(id))) : [])
      : eligibleIds

    if (!selectedIds.length) {
      return res.status(400).json({ error: 'No approved and paid students are available for this exam selection' })
    }

    const { rows } = await pool.query(`
      INSERT INTO online_exams (exam_year, exam_date, start_time, end_time, topic, target_scope, student_ids, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, exam_year, exam_date::text AS exam_date, start_time, end_time,
            topic, target_scope, student_ids, created_by, created_at
    `, [examYear, examDate, startTime, endTime, String(topic).trim(), targetScope === 'specific' ? 'specific' : 'all', selectedIds, 'admin'])

    res.status(201).json({ exam: rows[0] })
  } catch (e) {
    console.error('POST /api/admin/online-exams:', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.patch('/api/admin/online-exams/:id/reschedule', auth('admin'), async (req, res) => {
  const { examDate, startTime, endTime } = req.body || {}
  if (!examDate || !startTime || !endTime) {
    return res.status(400).json({ error: 'Exam date, start time and end time are required' })
  }
  if (startTime >= endTime) {
    return res.status(400).json({ error: 'End time must be later than the start time' })
  }

  try {
    const { rows } = await pool.query(`
      UPDATE online_exams oe
      SET exam_date = $2, start_time = $3, end_time = $4
      WHERE oe.id = $1
        AND CARDINALITY(oe.student_ids) > (
          SELECT COUNT(*) FROM online_exam_submissions WHERE exam_id = oe.id
        )
      RETURNING oe.id, oe.exam_year, oe.exam_date::text AS exam_date, oe.start_time, oe.end_time,
                oe.topic, oe.target_scope, oe.student_ids, oe.created_by, oe.created_at
    `, [req.params.id, examDate, startTime, endTime])

    if (!rows.length) {
      const exists = await pool.query('SELECT id FROM online_exams WHERE id=$1', [req.params.id])
      if (!exists.rows.length) return res.status(404).json({ error: 'Online exam not found' })
      return res.status(409).json({ error: 'This exam cannot be rescheduled because all assigned students have submitted' })
    }

    res.json({ exam: rows[0] })
  } catch (e) {
    console.error('PATCH /api/admin/online-exams/:id/reschedule:', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/admin/online-exams/:id/submissions', auth('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT oes.*, s.full_name, s.reg_no
      FROM online_exam_submissions oes
      JOIN students s ON s.id = oes.student_id
      WHERE oes.exam_id = $1
      ORDER BY oes.submitted_at DESC
    `, [req.params.id])
    res.json({ submissions: rows })
  } catch (e) {
    console.error('GET /api/admin/online-exams/:id/submissions:', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/student/online-exams', auth('student'), async (req, res) => {
  try {
    const { rows } = await pool.query(`
            SELECT oe.id, oe.exam_year, oe.exam_date::text AS exam_date, oe.start_time, oe.end_time,
              oe.topic, oe.target_scope, oe.student_ids, oe.created_by, oe.created_at,
              ef.roll_no, ef.exam_class,
             EXISTS (
               SELECT 1 FROM online_exam_submissions oes
               WHERE oes.exam_id = oe.id AND oes.student_id = $1
             ) AS submitted,
             (SELECT file_data FROM online_exam_submissions WHERE exam_id = oe.id AND student_id = $1) AS file_data
      FROM online_exams oe
      JOIN exam_forms ef ON ef.student_id = $1 AND ef.exam_year = oe.exam_year
      WHERE ef.status = 'approved' AND ef.payment_status = 'paid'
        AND (oe.target_scope = 'all' OR $1 = ANY(oe.student_ids))
      ORDER BY oe.exam_date ASC, oe.start_time ASC
    `, [req.user.id])
    res.json({ exams: rows })
  } catch (e) {
    console.error('GET /api/student/online-exams:', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/student/online-exams/:id/submit', auth('student'), async (req, res) => {
  const { imageData, topic } = req.body || {}
  if (!imageData || typeof imageData !== 'string') {
    return res.status(400).json({ error: 'A valid image file is required' })
  }
  const fileType = /^data:image\/(png|jpeg|jpg);base64,/i
  if (!fileType.test(imageData)) {
    return res.status(400).json({ error: 'Only PNG, JPG and JPEG images are allowed' })
  }

  try {
    const examCheck = await pool.query(`
            SELECT oe.id, oe.exam_year, oe.exam_date::text AS exam_date, oe.start_time, oe.end_time,
              oe.topic, oe.target_scope, oe.student_ids, oe.created_by, oe.created_at,
              ef.roll_no, ef.exam_class, ef.student_id
      FROM online_exams oe
      JOIN exam_forms ef ON ef.student_id = $1 AND ef.exam_year = oe.exam_year
      WHERE oe.id = $2 AND ef.status = 'approved' AND ef.payment_status = 'paid'
        AND (oe.target_scope = 'all' OR $1 = ANY(oe.student_ids))
    `, [req.user.id, req.params.id])

    if (!examCheck.rows.length) {
      return res.status(404).json({ error: 'No valid online exam assignment was found for this student' })
    }

    const exam = examCheck.rows[0]
    const now = new Date()
    const start = indiaDateTime(exam.exam_date, exam.start_time)
    const end = indiaDateTime(exam.exam_date, exam.end_time)
    if (now < start || now > end) {
      return res.status(400).json({ error: 'This online exam is not currently live' })
    }

    const finalTopic = topic && String(topic).trim() ? String(topic).trim() : exam.topic
    const { rows } = await pool.query(`
      INSERT INTO online_exam_submissions (exam_id, student_id, roll_no, exam_class, topic, file_data)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (exam_id, student_id) DO UPDATE SET
        roll_no = EXCLUDED.roll_no,
        exam_class = EXCLUDED.exam_class,
        topic = EXCLUDED.topic,
        file_data = EXCLUDED.file_data,
        submitted_at = now()
      RETURNING *
    `, [exam.id, req.user.id, exam.roll_no, exam.exam_class, finalTopic, imageData])

    res.status(201).json({ submission: rows[0] })
  } catch (e) {
    console.error('POST /api/student/online-exams/:id/submit:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Release admit cards (admin). Only approved + paid forms are eligible.
//   scope: 'all'      -> every approved+paid form (optionally scoped to examYear)
//   scope: 'specific' -> the single form matching rollNo
// examDatetime is the "Time & Date of Examination" line printed on the card.
app.post('/api/admin/exams/release', auth('admin'), async (req, res) => {
  const { scope, rollNo, examDatetime, examYear } = req.body || {}
  if (!examDatetime || !String(examDatetime).trim())
    return res.status(400).json({ error: 'Time & Date of Examination is required' })
  if (!['all', 'specific'].includes(scope))
    return res.status(400).json({ error: 'Scope must be all or specific' })

  try {
    if (scope === 'specific') {
      if (!rollNo || !String(rollNo).trim())
        return res.status(400).json({ error: 'Roll number is required for a specific release' })
      const found = await pool.query('SELECT status, payment_status FROM exam_forms WHERE roll_no=$1', [rollNo])
      if (!found.rows.length) return res.status(404).json({ error: 'No exam form found for that roll number' })
      const f = found.rows[0]
      if (f.status !== 'approved' || f.payment_status !== 'paid')
        return res.status(400).json({ error: 'Form must be approved and paid before release' })
      await pool.query(
        `UPDATE exam_forms SET admit_released=true, exam_datetime=$1
         WHERE roll_no=$2 AND status='approved' AND payment_status='paid'`,
        [examDatetime, rollNo]
      )
      return res.json({ released: 1 })
    }

    // scope === 'all'
    const params = [examDatetime]
    let sql = `UPDATE exam_forms SET admit_released=true, exam_datetime=$1
               WHERE status='approved' AND payment_status='paid'`
    if (examYear && String(examYear).trim()) {
      params.push(examYear)
      sql += ` AND exam_year=$2`
    }
    const { rowCount } = await pool.query(sql, params)
    res.json({ released: rowCount })
  } catch (e) {
    console.error('POST /api/admin/exams/release:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Toggle admit release for a single exam form (admin). Used from the exams table.
app.patch('/api/admin/exams/:id/admit', auth('admin'), async (req, res) => {
  const { released, examDatetime } = req.body || {}
  try {
    if (released) {
      const found = await pool.query('SELECT status, payment_status, exam_datetime FROM exam_forms WHERE id=$1', [req.params.id])
      if (!found.rows.length) return res.status(404).json({ error: 'Not found' })
      const f = found.rows[0]
      if (f.status !== 'approved' || f.payment_status !== 'paid')
        return res.status(400).json({ error: 'Form must be approved and paid before release' })
      const dt = (examDatetime && String(examDatetime).trim()) || f.exam_datetime
      if (!dt) return res.status(400).json({ error: 'Set a Time & Date first via Admit Release' })
      const { rows } = await pool.query(
        'UPDATE exam_forms SET admit_released=true, exam_datetime=$1 WHERE id=$2 RETURNING *',
        [dt, req.params.id]
      )
      return res.json({ exam: rows[0] })
    }
    const { rows } = await pool.query(
      'UPDATE exam_forms SET admit_released=false WHERE id=$1 RETURNING *',
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    res.json({ exam: rows[0] })
  } catch (e) {
    console.error('PATCH /api/admin/exams admit:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Student fills own exam form
app.post('/api/student/exams', auth('student'), async (req, res) => {
  try {
    const me = await pool.query('SELECT reg_no FROM students WHERE id=$1', [req.user.id])
    if (!me.rows.length) return res.status(404).json({ error: 'Student not found' })
    req.body = { ...req.body, regNo: me.rows[0].reg_no }
    return createExamForm(req, res, 'student')
  } catch (e) {
    console.error('POST /api/student/exams:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Student lists own exam forms (joins student fields for the admit card)
app.get('/api/student/exams', auth('student'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT e.*, s.full_name, s.co_name, s.photo, s.dob
     FROM exam_forms e JOIN students s ON s.id = e.student_id
     WHERE e.student_id=$1 ORDER BY e.created_at DESC`,
    [req.user.id]
  )
  res.json({ exams: rows })
})

/* ------------------------------------------------------- Exam fee routes */

// List exam fees (public — students can see their fee)
app.get('/api/exam-fees', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT exam_class, fee FROM exam_fees ORDER BY id')
    res.json({ fees: rows })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Set / update the fee for a class (admin — upsert)
app.post('/api/admin/exam-fees', auth('admin'), async (req, res) => {
  const { examClass, fee } = req.body || {}
  if (!examClass) return res.status(400).json({ error: 'Class is required' })
  const amount = Number(fee)
  if (!Number.isFinite(amount) || amount < 0)
    return res.status(400).json({ error: 'Fee must be a non-negative number' })
  try {
    await pool.query(
      `INSERT INTO exam_fees (exam_class, fee, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (exam_class) DO UPDATE SET fee = EXCLUDED.fee, updated_at = now()`,
      [examClass, Math.round(amount)]
    )
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Serve the built frontend (single URL for ngrok)
app.use(express.static(distDir))
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(distDir, 'index.html'))
})

init()
  .then(() => {
    const server = app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`))
    const stopPayments = payments.startReconciliation()
    server.on('close', stopPayments)
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} already in use. Kill the old process and retry.`)
        process.exit(1)
      }
    })
  })
  .catch((e) => {
    console.error('Failed to start:', e)
    process.exit(1)
  })
