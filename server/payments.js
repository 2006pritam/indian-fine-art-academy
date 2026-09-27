export class PaymentError extends Error {
  constructor(message, status = 502) {
    super(message)
    this.status = status
  }
}

const PAID = new Set(['paid', 'success', 'successful', 'completed', 'complete'])
const FAILED = new Set(['failed', 'failure', 'payment_failed', 'cancelled', 'canceled', 'rejected', 'expired', 'declined'])
const PENDING = new Set(['pending', 'created', 'initiated', 'processing', 'in_progress', 'unpaid', 'payment_pending'])
const object = value => value && typeof value === 'object' && !Array.isArray(value)

// A wrapper's "success" describes the API request, not the payment inside it.
function payload(data) {
  if (!object(data) || data.error || data.success === false) throw new PaymentError('The gateway could not verify this payment. Please try again.')
  const body = object(data.data) ? data.data : data
  if (body.error || body.success === false) throw new PaymentError('The gateway could not verify this payment. Please try again.')
  return body
}

export function gatewayPaymentStatus(data, order) {
  const body = payload(data)
  const payment = payload(object(body.payment) ? body.payment : object(body.order) ? body.order : body)
  const value = payment.payment_status ?? payment.paymentStatus ?? payment.transaction_status ?? payment.status
  const status = String(value ?? '').trim().toLowerCase()
  const orderId = payment.order_id ?? payment.orderId ?? body.order_id ?? body.orderId
  const amount = payment.amount ?? body.amount
  const currency = payment.currency ?? body.currency
  if (orderId != null && String(orderId) !== String(order.order_id)) throw new PaymentError('The gateway returned a different payment order. Contact the academy.')
  if (amount != null && (String(amount).trim() === '' || !Number.isFinite(Number(amount)) || Math.round(Number(amount) * 100) !== Math.round(Number(order.amount) * 100))) {
    throw new PaymentError('The payment amount does not match the exam fee. Contact the academy.')
  }
  if (currency != null && String(currency).toUpperCase() !== 'INR') throw new PaymentError('The payment currency does not match the exam fee.')
  if (PAID.has(status)) return 'paid'
  if (FAILED.has(status)) return 'payment_failed'
  if (PENDING.has(status)) return 'payment_pending'
  throw new PaymentError('The gateway has not returned a valid payment status. Please check again shortly.')
}

export function createPaymentGateway({ apiUrl, apiKey, fetchImpl = fetch }) {
  const key = (apiKey || '').trim()
  const configured = Boolean(key) && !/(^|[\\/])\.env(?:\.[\w-]+)?$/i.test(key)
  const base = (apiUrl || 'https://famapi.mistahub.in/api').replace(/\/+$/, '')
  async function request(endpoint, body) {
    if (!configured) throw new PaymentError('Online payment is not configured. Please contact the academy.', 503)
    let response, data
    try {
      response = await fetchImpl(`${base}${endpoint}`, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000),
      })
      data = await response.json()
    } catch {
      throw new PaymentError('The payment gateway is unavailable. Please check again shortly.')
    }
    if (!response.ok) throw new PaymentError('The payment gateway could not complete the request. Please try again or contact the academy.')
    return data
  }
  return {
    configured,
    async create(amount, redirectUrl) {
      const data = payload(await request('/create-order', { amount, redirect_url: redirectUrl }))
      const orderId = data.order_id ?? data.orderId ?? data.id
      const checkoutUrl = data.checkout_url ?? data.checkoutUrl ?? data.payment_url ?? data.paymentUrl ?? data.url
      let url
      try { url = new URL(checkoutUrl) } catch { /* handled below */ }
      if (!orderId || !url || url.protocol !== 'https:' || url.username || url.password) throw new PaymentError('The gateway returned an invalid checkout. Please contact the academy.')
      return { orderId: String(orderId), checkoutUrl: url.href }
    },
    async status(order) {
      return gatewayPaymentStatus(await request(`/status/${encodeURIComponent(order.order_id)}`), order)
    },
  }
}

export async function initPaymentSchema(pool) {
  await pool.query(`
    ALTER TABLE exam_forms ADD COLUMN IF NOT EXISTS payment_manual_override BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE exam_forms ADD COLUMN IF NOT EXISTS payment_updated_by INTEGER REFERENCES admins(id) ON DELETE SET NULL;
    ALTER TABLE exam_forms ADD COLUMN IF NOT EXISTS payment_updated_at TIMESTAMPTZ;
    ALTER TABLE exam_forms ADD COLUMN IF NOT EXISTS payment_checked_at TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS payment_orders (
      order_id TEXT PRIMARY KEY,
      exam_form_id INTEGER NOT NULL REFERENCES exam_forms(id) ON DELETE CASCADE,
      amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
      checkout_url TEXT,
      status TEXT NOT NULL DEFAULT 'payment_pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS payment_orders_exam_idx ON payment_orders(exam_form_id);
    INSERT INTO payment_orders (order_id, exam_form_id, amount, status)
      SELECT payment_order_id, id, payment_amount,
             CASE WHEN payment_status IN ('paid', 'payment_failed') THEN payment_status ELSE 'payment_pending' END
      FROM exam_forms WHERE payment_order_id IS NOT NULL AND payment_amount > 0
      ON CONFLICT (order_id) DO NOTHING;
    UPDATE exam_forms SET payment_manual_override=true, payment_updated_at=now()
      WHERE payment_status='unpaid' AND payment_order_id IS NOT NULL AND payment_updated_at IS NULL;
  `)
}

export function createPaymentService({ pool, gateway, publicAppUrl }) {
  async function withExam(id, studentId, action) {
    if (!/^[1-9]\d*$/.test(String(id)) || !Number.isSafeInteger(Number(id))) throw new PaymentError('Invalid exam form', 400)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query(
        `SELECT * FROM exam_forms WHERE id=$1${studentId == null ? '' : ' AND student_id=$2'} FOR UPDATE`,
        studentId == null ? [id] : [id, studentId],
      )
      if (!rows.length) throw new PaymentError('Exam form not found', 404)
      const result = await action(client, rows[0])
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
  }

  async function reconcile(client, exam) {
    if (exam.payment_status === 'paid' || exam.payment_manual_override) return exam
    const { rows: orders } = await client.query('SELECT * FROM payment_orders WHERE exam_form_id=$1 ORDER BY created_at DESC', [exam.id])
    if (!orders.length) throw new PaymentError('No online payment order exists yet', 400)
    let latestStatus = exam.payment_status
    let verificationError
    for (const order of orders) {
      try {
        const status = order.status === 'paid' ? 'paid' : await gateway.status(order)
        await client.query('UPDATE payment_orders SET status=$1 WHERE order_id=$2', [status, order.order_id])
        if (order.order_id === exam.payment_order_id) latestStatus = status
        if (status === 'paid') {
          const { rows } = await client.query(`UPDATE exam_forms SET payment_status='paid',
            payment_order_id=$2, payment_paid_at=COALESCE(payment_paid_at, now()), payment_updated_at=now(), payment_checked_at=now()
            WHERE id=$1 RETURNING *`, [exam.id, order.order_id])
          return rows[0]
        }
      } catch (error) {
        if (!(error instanceof PaymentError)) throw error
        verificationError = error
      }
    }
    // Do not offer another checkout if an earlier attempt cannot be verified.
    if (verificationError) throw verificationError
    const { rows } = await client.query(`UPDATE exam_forms SET payment_status=$1, payment_checked_at=now()
      WHERE id=$2 RETURNING *`, [latestStatus, exam.id])
    return rows[0]
  }

  return {
    async start(id, studentId, fallbackUrl) {
      return withExam(id, studentId, async (client, exam) => {
        if (exam.payment_status === 'paid') return { paid: true, exam }
        if (exam.payment_manual_override) throw new PaymentError('Payment status was set by an admin. Please contact the academy before paying again.', 409)
        if (exam.payment_method !== 'upi') throw new PaymentError('This form is not using UPI payment', 400)
        if (exam.payment_amount == null || !Number.isFinite(Number(exam.payment_amount)) || Number(exam.payment_amount) < 0) {
          throw new PaymentError('The exam fee is missing. Please contact the academy.', 400)
        }
        if (Number(exam.payment_amount) === 0) {
          const { rows } = await client.query("UPDATE exam_forms SET payment_status='paid', payment_paid_at=now(), payment_updated_at=now() WHERE id=$1 RETURNING *", [exam.id])
          return { paid: true, exam: rows[0] }
        }
        if (exam.payment_order_id) {
          exam = await reconcile(client, exam)
          if (exam.payment_status === 'paid') return { paid: true, exam }
          const { rows: pending } = await client.query("SELECT * FROM payment_orders WHERE exam_form_id=$1 AND status='payment_pending' ORDER BY created_at DESC LIMIT 1", [exam.id])
          if (pending.length) {
            const order = pending[0]
            if (!order.checkout_url) throw new PaymentError('Your existing UPI payment is awaiting confirmation. Check its status or contact the academy before paying again.', 409)
            const { rows } = await client.query("UPDATE exam_forms SET payment_status='payment_pending', payment_order_id=$1 WHERE id=$2 RETURNING *", [order.order_id, exam.id])
            return { checkoutUrl: order.checkout_url, orderId: order.order_id, exam: rows[0] }
          }
        }
        let redirectUrl
        try {
          redirectUrl = new URL(publicAppUrl || fallbackUrl)
          if (!['https:', 'http:'].includes(redirectUrl.protocol)) throw new Error()
          redirectUrl.searchParams.set('payment_exam', String(exam.id))
        } catch { throw new PaymentError('The payment return URL is not configured correctly. Contact the academy.', 503) }
        const order = await gateway.create(Number(exam.payment_amount), redirectUrl.href)
        await client.query('INSERT INTO payment_orders (order_id, exam_form_id, amount, checkout_url) VALUES ($1,$2,$3,$4)', [order.orderId, exam.id, exam.payment_amount, order.checkoutUrl])
        const { rows } = await client.query(`UPDATE exam_forms SET payment_order_id=$1, payment_status='payment_pending',
          payment_paid_at=NULL, payment_checked_at=now() WHERE id=$2 RETURNING *`, [order.orderId, exam.id])
        return { ...order, exam: rows[0] }
      })
    },
    verify(id, studentId) {
      return withExam(id, studentId, reconcile)
    },
    async setStatus(id, status, adminId) {
      if (!['paid', 'unpaid'].includes(status)) throw new PaymentError('Payment status must be paid or unpaid', 400)
      return withExam(id, null, async (client, exam) => {
        const { rows } = await client.query(`UPDATE exam_forms SET payment_status=$1, payment_manual_override=true,
          payment_paid_at=CASE WHEN $1='paid' THEN COALESCE(payment_paid_at, now()) ELSE NULL END,
          payment_updated_by=$2, payment_updated_at=now(),
          admit_released=CASE WHEN $1='unpaid' THEN false ELSE admit_released END
          WHERE id=$3 RETURNING *`, [status, adminId, exam.id])
        return rows[0]
      })
    },
    startReconciliation() {
      if (!gateway.configured) return () => {}
      let running = false, stopped = false
      const tick = async () => {
        if (running || stopped) return
        running = true
        try {
          const { rows } = await pool.query(`SELECT id FROM exam_forms
            WHERE payment_method='upi' AND payment_status IN ('payment_pending','payment_failed')
              AND payment_order_id IS NOT NULL AND payment_manual_override=false
              AND (payment_checked_at IS NULL OR payment_checked_at < now() - interval '1 minute')
            ORDER BY payment_checked_at NULLS FIRST LIMIT 25`)
          for (const exam of rows) {
            if (stopped) break
            try { await this.verify(exam.id) }
            catch { console.error(`Automatic payment verification will retry for exam ${exam.id}.`) }
            finally { await pool.query('UPDATE exam_forms SET payment_checked_at=now() WHERE id=$1', [exam.id]) }
          }
        } catch { console.error('Automatic payment verification will retry on the next cycle.') }
        finally { running = false }
      }
      const timer = setInterval(tick, 60000)
      timer.unref?.()
      void tick()
      return () => { stopped = true; clearInterval(timer) }
    },
  }
}

export function mountPaymentRoutes(app, auth, payments) {
  const handle = action => async (req, res) => {
    try { res.json(await action(req)) }
    catch (error) {
      if (!(error instanceof PaymentError)) console.error('Payment operation failed:', error.code || error.name)
      res.status(error instanceof PaymentError ? error.status : 500).json({ error: error instanceof PaymentError ? error.message : 'Unable to update payment. Please try again.' })
    }
  }
  app.post('/api/student/exams/:id/payment', auth('student'), handle(req => payments.start(req.params.id, req.user.id, `${req.protocol}://${req.get('host')}/`)))
  app.post('/api/student/exams/:id/payment/status', auth('student'), handle(async req => {
    const exam = await payments.verify(req.params.id, req.user.id)
    return { paymentStatus: exam.payment_status, exam }
  }))
  app.patch('/api/admin/exams/:id/payment', auth('admin'), handle(async req => ({ exam: await payments.setStatus(req.params.id, req.body?.paymentStatus, req.user.id) })))
}
