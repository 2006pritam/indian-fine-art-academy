import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { PGlite } from '@electric-sql/pglite'
import express from 'express'
import { createPaymentGateway, createPaymentService, gatewayPaymentStatus, initPaymentSchema, mountPaymentRoutes, PaymentError } from './payments.js'

let db, pool, service, replies, requests, created, gateway

before(async () => {
  // Real PostgreSQL SQL in memory. Never connects to DATABASE_URL or a live gateway.
  db = new PGlite()
  let tail = Promise.resolve()
  const acquire = async () => {
    const previous = tail
    let release
    tail = new Promise(resolve => { release = resolve })
    await previous
    return release
  }
  const query = async (sql, params) => params ? db.query(sql, params) : (await db.exec(sql)).at(-1)
  pool = {
    async query(sql, params) {
      const release = await acquire()
      try { return await query(sql, params) } finally { release() }
    },
    async connect() { const release = await acquire(); return { query, release } },
  }
  await pool.query(`CREATE TABLE admins (id SERIAL PRIMARY KEY);
    CREATE TABLE exam_forms (
      id SERIAL PRIMARY KEY, student_id INTEGER NOT NULL DEFAULT 11,
      payment_status TEXT NOT NULL DEFAULT 'payment_pending', payment_method TEXT DEFAULT 'upi',
      payment_order_id TEXT, payment_amount NUMERIC(10,2) DEFAULT 250,
      payment_paid_at TIMESTAMPTZ, admit_released BOOLEAN NOT NULL DEFAULT false
    );`)
  await initPaymentSchema(pool)
})
after(async () => { await db?.close() })
beforeEach(async () => {
  await pool.query('TRUNCATE payment_orders, exam_forms, admins RESTART IDENTITY CASCADE; INSERT INTO admins DEFAULT VALUES;')
  replies = new Map(); requests = []; created = 0
  gateway = createPaymentGateway({
    apiUrl: 'https://gateway.example/api/', apiKey: 'test-key',
    async fetchImpl(url, options) {
      requests.push({ url, ...options })
      if (options.method === 'POST') {
        const id = `order-${++created}`
        return Response.json({ data: { order_id: id, payment_url: `https://checkout.example/${id}` } })
      }
      const id = decodeURIComponent(url.split('/').at(-1))
      const reply = replies.get(id) || { status: 'pending', order_id: id, amount: 250, currency: 'INR' }
      if (typeof reply === 'function') return reply()
      return Response.json(reply)
    },
  })
  service = createPaymentService({ pool, gateway, publicAppUrl: 'https://academy.example/?from=upi#portal' })
})

async function exam(values = {}) {
  const keys = Object.keys(values)
  const result = keys.length
    ? await pool.query(`INSERT INTO exam_forms (${keys.join(',')}) VALUES (${keys.map((_, index) => `$${index + 1}`).join(',')}) RETURNING *`, Object.values(values))
    : await pool.query('INSERT INTO exam_forms DEFAULT VALUES RETURNING *')
  return result.rows[0]
}
const saved = async id => (await pool.query('SELECT * FROM exam_forms WHERE id=$1', [id])).rows[0]
const expectedOrder = { order_id: 'order-1', amount: 250 }

test('reads the payment status inside a successful API envelope', () => {
  assert.equal(gatewayPaymentStatus({ status: 'success', data: { payment_status: 'pending' } }, expectedOrder), 'payment_pending')
  assert.equal(gatewayPaymentStatus({ status: 'success', data: { payment_status: ' FAILED ' } }, expectedOrder), 'payment_failed')
  assert.equal(gatewayPaymentStatus({ data: { payment: { status: ' SUCCESS ', order_id: 'order-1', amount: '250.00', currency: 'INR' } } }, expectedOrder), 'paid')
  assert.throws(() => gatewayPaymentStatus({ status: 'success', data: {} }, expectedOrder), PaymentError)
  assert.throws(() => gatewayPaymentStatus({ success: true }, expectedOrder), PaymentError)
  assert.throws(() => gatewayPaymentStatus({ error: 'Order not found', status: 'success' }, expectedOrder), PaymentError)
  assert.throws(() => gatewayPaymentStatus({ data: { error: 'Order not found', status: 'success' } }, expectedOrder), PaymentError)
})

test('rejects a confirmation for another order, amount, currency, or unknown status', () => {
  for (const body of [
    { status: 'paid', order_id: 'different' }, { status: 'paid', amount: 1 },
    { status: 'paid', amount: 'invalid' }, { status: 'paid', currency: 'USD' },
    { status: 'not-a-payment-status' },
  ]) assert.throws(() => gatewayPaymentStatus(body, expectedOrder), PaymentError)
})

test('missing configuration, unsafe checkout URLs, and gateway failures produce useful errors', async () => {
  for (const apiKey of ['', 'indian-fine-art-academy/.env']) {
    const missing = createPaymentGateway({ apiKey, fetchImpl: () => assert.fail('must not contact gateway') })
    await assert.rejects(missing.create(250, 'https://academy.example'), { status: 503 })
  }
  for (const checkout of ['javascript:alert(1)', 'http://checkout.example', 'https://user:secret@checkout.example', null]) {
    const invalid = createPaymentGateway({ apiKey: 'key', fetchImpl: async () => Response.json({ order_id: 'x', checkout_url: checkout }) })
    await assert.rejects(invalid.create(250, 'https://academy.example'), /invalid checkout/)
  }
  for (const fetchImpl of [
    async () => { throw new Error('timeout') },
    async () => new Response('not JSON'),
    async () => Response.json({ error: 'bad secret' }, { status: 401 }),
  ]) {
    const failed = createPaymentGateway({ apiKey: 'key', fetchImpl })
    await assert.rejects(failed.status(expectedOrder), { status: 502 })
  }
})

test('starts one checkout, reuses pending orders, and confirms payment before a retry', async () => {
  const e = await exam()
  const first = await service.start(e.id, 11)
  const again = await service.start(e.id, 11)
  assert.equal(first.orderId, again.orderId)
  assert.equal(created, 1)
  const request = requests.find(item => item.method === 'POST')
  assert.deepEqual(JSON.parse(request.body), { amount: 250, redirect_url: `https://academy.example/?from=upi&payment_exam=${e.id}#portal` })
  assert.equal(request.headers.Authorization, 'Bearer test-key')
  replies.set(first.orderId, { status: 'success', data: { payment_status: 'paid', amount: 250, order_id: first.orderId } })
  assert.equal((await service.start(e.id, 11)).paid, true)
  assert.equal(created, 1)
  const paid = await saved(e.id)
  assert.equal(paid.payment_status, 'paid')
  assert.ok(paid.payment_paid_at)
  const count = requests.length
  await service.verify(e.id, 11)
  assert.equal(requests.length, count, 'confirmed payments are never downgraded by another response')
})

test('retains failed attempts and accepts a delayed success on an older order', async () => {
  const e = await exam()
  const first = await service.start(e.id, 11)
  replies.set(first.orderId, { status: 'failed' })
  assert.equal((await service.verify(e.id, 11)).payment_status, 'payment_failed')
  const retry = await service.start(e.id, 11)
  assert.notEqual(first.orderId, retry.orderId)
  assert.equal((await pool.query('SELECT * FROM payment_orders')).rows.length, 2)
  replies.set(first.orderId, { status: 'paid', amount: 250 })
  assert.equal((await service.verify(e.id, 11)).payment_status, 'paid')
  assert.equal((await saved(e.id)).payment_status, 'paid')
  assert.equal((await saved(e.id)).payment_order_id, first.orderId)
})

test('reuses an older attempt if the gateway reports it pending again', async () => {
  const e = await exam()
  const first = await service.start(e.id, 11)
  replies.set(first.orderId, { status: 'failed' })
  const second = await service.start(e.id, 11)
  replies.set(first.orderId, { status: 'pending' })
  replies.set(second.orderId, { status: 'failed' })
  const resumed = await service.start(e.id, 11)
  assert.equal(resumed.orderId, first.orderId)
  assert.equal(resumed.exam.payment_status, 'payment_pending')
  assert.equal(created, 2)
})

test('pending payments survive a service restart and become paid on a later check', async () => {
  const e = await exam()
  const order = await service.start(e.id, 11)
  assert.equal((await service.verify(e.id, 11)).payment_status, 'payment_pending')
  const restarted = createPaymentService({ pool, gateway })
  replies.set(order.orderId, { data: { status: 'completed', amount: 250 } })
  assert.equal((await restarted.verify(e.id, 11)).payment_status, 'paid')
})

test('zero fees persist as paid; missing fees and cash forms cannot start UPI checkout', async () => {
  const free = await exam({ payment_amount: 0 })
  assert.equal((await service.start(free.id, 11)).paid, true)
  assert.ok((await saved(free.id)).payment_paid_at)
  const missing = await exam({ payment_amount: null })
  await assert.rejects(service.start(missing.id, 11), /fee is missing/)
  const cash = await exam({ payment_method: 'cash', payment_status: 'cash_pending' })
  await assert.rejects(service.start(cash.id, 11), { status: 400 })
  assert.equal(created, 0)
})

test('gateway errors or mismatched amounts do not mark a form paid or create another charge', async () => {
  const e = await exam()
  const order = await service.start(e.id, 11)
  replies.set(order.orderId, { status: 'paid', amount: 100 })
  await assert.rejects(service.verify(e.id, 11), /amount does not match/)
  assert.equal((await saved(e.id)).payment_status, 'payment_pending')
  replies.set(order.orderId, () => Response.json({ error: 'Unavailable' }, { status: 503 }))
  await assert.rejects(service.start(e.id, 11), PaymentError)
  assert.equal(created, 1)
})

test('admin can mark paid or unpaid; background checks respect the correction', async () => {
  const e = await exam({ admit_released: true })
  const order = await service.start(e.id, 11)
  const paid = await service.setStatus(e.id, 'paid', 1)
  assert.equal(paid.payment_updated_by, 1)
  assert.ok(paid.payment_updated_at)
  assert.ok(paid.payment_paid_at)
  const unpaid = await service.setStatus(e.id, 'unpaid', 1)
  assert.equal(unpaid.payment_paid_at, null)
  assert.equal(unpaid.admit_released, false)
  replies.set(order.orderId, { status: 'paid' })
  const count = requests.length
  assert.equal((await service.verify(e.id, 11)).payment_status, 'unpaid')
  assert.equal(requests.length, count)
  await assert.rejects(service.start(e.id, 11), { status: 409 })
  await assert.rejects(service.setStatus(e.id, 'anything', 1), { status: 400 })
})

test('a correction made during verification wins after the transaction finishes', async () => {
  const e = await exam()
  const order = await service.start(e.id, 11)
  let releaseResponse, started
  const entered = new Promise(resolve => { started = resolve })
  replies.set(order.orderId, async () => {
    started()
    await new Promise(resolve => { releaseResponse = resolve })
    return Response.json({ status: 'paid' })
  })
  const verifying = service.verify(e.id, 11)
  await entered
  const correcting = service.setStatus(e.id, 'unpaid', 1)
  releaseResponse()
  await Promise.all([verifying, correcting])
  assert.equal((await saved(e.id)).payment_status, 'unpaid')
  assert.equal((await service.verify(e.id, 11)).payment_status, 'unpaid')
})

test('students cannot start or verify another student’s payment', async () => {
  const e = await exam()
  await assert.rejects(service.start(e.id, 22), { status: 404 })
  await assert.rejects(service.verify(e.id, 22), { status: 404 })
  await assert.rejects(service.verify('bad-id', 11), { status: 400 })
  assert.equal(requests.length, 0)
})

test('migration preserves legacy orders and manual unpaid statuses and can run again', async () => {
  const e = await exam({ payment_order_id: 'legacy-order', payment_status: 'unpaid' })
  await initPaymentSchema(pool)
  await initPaymentSchema(pool)
  const orders = (await pool.query('SELECT * FROM payment_orders')).rows
  assert.equal(orders.length, 1)
  assert.equal(orders[0].order_id, 'legacy-order')
  assert.equal((await saved(e.id)).payment_manual_override, true)
})

test('background reconciliation confirms payment without a browser returning', async () => {
  const e = await exam()
  const order = await service.start(e.id, 11)
  replies.set(order.orderId, { status: 'paid' })
  await pool.query("UPDATE exam_forms SET payment_checked_at=now() - interval '2 minutes' WHERE id=$1", [e.id])
  const stop = service.startReconciliation()
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await saved(e.id)).payment_status === 'paid') break
      await delay(10)
    }
    assert.equal((await saved(e.id)).payment_status, 'paid')
  } finally { stop() }
})

test('payment routes require the appropriate role and return the persisted exam', async () => {
  const app = express()
  app.use(express.json())
  // The existing authentication middleware supplies a verified role and ID.
  const auth = role => (req, res, next) => {
    if (!req.headers['x-test-role']) return res.sendStatus(401)
    if (req.headers['x-test-role'] !== role) return res.sendStatus(403)
    req.user = { id: role === 'admin' ? 1 : 11 }
    next()
  }
  mountPaymentRoutes(app, auth, service)
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  try {
    const e = await exam()
    const url = `http://127.0.0.1:${server.address().port}/api/admin/exams/${e.id}/payment`
    const request = role => fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) }, body: JSON.stringify({ paymentStatus: 'paid' }) })
    assert.equal((await request()).status, 401)
    assert.equal((await request('student')).status, 403)
    const response = await request('admin')
    assert.equal(response.status, 200)
    assert.equal((await response.json()).exam.payment_status, 'paid')
    assert.equal((await saved(e.id)).payment_status, 'paid')
  } finally { await new Promise(resolve => server.close(resolve)) }
})
