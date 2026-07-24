import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import test, { after, before } from 'node:test';
import { getDb, query } from '../db/client.js';
import { getDashboard } from '../db/dashboard.js';
import { generateInvoice, getReceipt, setInvoiceStatus } from '../db/invoices.js';
import { completeAppointment } from '../db/reviews.js';

const run = promisify(execFile); const databaseFile = '.vetflow-invoices-test.db';
before(async () => { process.env.TURSO_DATABASE_URL = 'file:./' + databaseFile; process.env.ACTIVE_CLINIC_PROFILE = 'ph'; await rm(databaseFile, { force: true }); await run(process.execPath, ['db/seed.js'], { cwd: process.cwd(), env: { ...process.env, TURSO_DATABASE_URL: 'file:./' + databaseFile } }); });
after(() => getDb().close());

test('a completed appointment creates one itemized invoice and a tokenized receipt', async () => {
  const appointment = (await query('SELECT id FROM appointments WHERE status = ? LIMIT 1', ['pending'])).rows[0];
  await completeAppointment(appointment.id);
  const invoice = await generateInvoice(appointment.id);
  const replay = await generateInvoice(appointment.id);
  assert.equal(invoice.id, replay.id);
  assert.equal(invoice.total_centavos, 65000);
  const receipt = await getReceipt(invoice.receipt_token);
  assert.equal(receipt.invoice.items.length, 1);
  assert.deepEqual(receipt.invoice.items[0], { description: 'General Consultation', quantity: 1, unit_price_centavos: 65000, total_centavos: 65000 });
});

test('concurrent invoice generation safely replays one persisted record', async () => {
  const appointment = (await query('SELECT id FROM appointments WHERE status = ? LIMIT 1', ['completed'])).rows[0];
  const invoices = await Promise.all(Array.from({ length: 4 }, () => generateInvoice(appointment.id)));
  assert.equal(new Set(invoices.map((invoice) => invoice.id)).size, 1);
});

test('paid status persists and dashboard revenue/outstanding reconcile to invoices', async () => {
  const invoice = (await query('SELECT id FROM invoices LIMIT 1')).rows[0];
  await setInvoiceStatus(invoice.id, 'paid');
  assert.equal((await query('SELECT status, paid_at FROM invoices WHERE id = ?', [invoice.id])).rows[0].status, 'paid');
  await setInvoiceStatus(invoice.id, 'unpaid');
  const dashboard = await getDashboard();
  const totals = (await query('SELECT COALESCE(SUM(CASE WHEN status = ? THEN total_centavos ELSE 0 END), 0) AS revenue, COALESCE(SUM(CASE WHEN status = ? THEN total_centavos ELSE 0 END), 0) AS outstanding FROM invoices WHERE clinic_id = ?', ['paid', 'unpaid', 'clinic-pawsitive'])).rows[0];
  assert.deepEqual(dashboard.invoices, { revenueCentavos: Number(totals.revenue), outstandingCentavos: Number(totals.outstanding) });
  assert.equal(dashboard.invoices.outstandingCentavos, 65000);
});
