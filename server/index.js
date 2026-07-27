import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

  // Exam fees per class/level (admin-configurable)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS exam_fees (
      id            SERIAL PRIMARY KEY,
      exam_class    TEXT UNIQUE NOT NULL,
      fee           INTEGER NOT NULL DEFAULT 0,
      updated_at    TIMESTAMPTZ DEFAULT now()
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
  'id, reg_no, full_name, co_name, phone, email, aadhaar, dob, gender, address, current_class, photo, created_at'

/* ---------------------------------------------------------------- routes */
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
        (full_name, co_name, phone, email, aadhaar, dob, gender, address, current_class, photo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
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

    // A student may only be permitted once per exam session (year)
    const dupYear = await pool.query(
      'SELECT id FROM exam_forms WHERE student_id=$1 AND exam_year=$2',
      [student.id, examYear]
    )
    if (dupYear.rows.length)
      return res.status(409).json({ error: `This student already has an exam form for ${examYear}` })

    const rollNo = await generateRollNo(centerCode.trim(), examYear)
    const { rows } = await pool.query(
      `INSERT INTO exam_forms (student_id, reg_no, roll_no, exam_class, exam_year, center_code, center_name, filled_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [student.id, student.reg_no, rollNo, examClass, examYear, centerCode.trim(), centerName.trim(), filledBy]
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
      SELECT e.*, s.full_name, s.current_class, s.photo
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

// Student lists own exam forms
app.get('/api/student/exams', auth('student'), async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM exam_forms WHERE student_id=$1 ORDER BY created_at DESC',
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
