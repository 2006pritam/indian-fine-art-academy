export async function initNoticeSchema(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS student_notices (
    id SERIAL PRIMARY KEY,
    message TEXT NOT NULL CHECK (char_length(trim(message)) BETWEEN 1 AND 1000),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`)
}

export function mountNoticeRoutes(app, auth, pool) {
  const handle = action => async (req, res) => {
    try { await action(req, res) }
    catch (error) {
      console.error('Notice operation failed:', error.code || error.name)
      res.status(500).json({ error: 'Unable to update notices. Please try again.' })
    }
  }
  const validId = (req, res, next) => {
    if (!/^[1-9]\d*$/.test(req.params.id) || Number(req.params.id) > 2147483647) return res.status(400).json({ error: 'Invalid notice' })
    next()
  }
  const validate = (req, res, next) => {
    const { message, isActive } = req.body || {}
    if ((req.method === 'POST' || message !== undefined) && (typeof message !== 'string' || !message.trim() || message.trim().length > 1000)) {
      return res.status(400).json({ error: 'Write a notice between 1 and 1,000 characters.' })
    }
    if (isActive !== undefined && typeof isActive !== 'boolean') return res.status(400).json({ error: 'Notice visibility must be true or false.' })
    if (message === undefined && isActive === undefined) return res.status(400).json({ error: 'Provide notice text or visibility to update.' })
    next()
  }

  app.get('/api/student/notices', auth('student'), handle(async (_req, res) => {
    const { rows } = await pool.query('SELECT id, message, updated_at FROM student_notices WHERE is_active=true ORDER BY created_at DESC, id DESC')
    res.set('Cache-Control', 'no-store').json({ notices: rows })
  }))
  app.get('/api/admin/notices', auth('admin'), handle(async (_req, res) => {
    const { rows } = await pool.query('SELECT * FROM student_notices ORDER BY created_at DESC, id DESC')
    res.set('Cache-Control', 'no-store').json({ notices: rows })
  }))
  app.post('/api/admin/notices', auth('admin'), validate, handle(async (req, res) => {
    const { rows } = await pool.query('INSERT INTO student_notices (message, is_active, created_by) VALUES ($1,$2,$3) RETURNING *', [req.body.message.trim(), req.body.isActive ?? true, req.user.id])
    res.status(201).json({ notice: rows[0] })
  }))
  app.patch('/api/admin/notices/:id', auth('admin'), validId, validate, handle(async (req, res) => {
    const { rows } = await pool.query(`UPDATE student_notices SET message=COALESCE($1, message),
      is_active=COALESCE($2, is_active), updated_at=now() WHERE id=$3 RETURNING *`,
    [req.body.message?.trim() ?? null, req.body.isActive ?? null, req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Notice not found' })
    res.json({ notice: rows[0] })
  }))
  app.delete('/api/admin/notices/:id', auth('admin'), validId, handle(async (req, res) => {
    const { rows } = await pool.query('DELETE FROM student_notices WHERE id=$1 RETURNING id', [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Notice not found' })
    res.json({ ok: true })
  }))
}
