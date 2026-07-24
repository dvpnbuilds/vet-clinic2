import { randomUUID } from 'node:crypto';
import { getDb, query } from './client.js';
import { getActiveClinicProfile } from './profiles/index.js';

export class InvoiceError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const rows = (result) => result.rows.map((row) => Object.fromEntries(Object.entries(row)));
const validToken = (value) => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
const invoiceJobs = new Map();

async function generateInvoiceOnce(appointmentId) {
  const profile = getActiveClinicProfile();
  const transaction = await getDb().transaction('write');
  try {
    const visit = rows(await transaction.execute({ sql: 'SELECT a.id, a.status, s.id AS service_id, s.name, s.price_centavos FROM appointments a JOIN services s ON s.id = a.service_id WHERE a.id = ? AND a.clinic_id = ? AND s.clinic_id = ?', args: [appointmentId, profile.id, profile.id] }))[0];
    if (!visit) throw new InvoiceError('Invoice record is unavailable.', 404);
    if (visit.status !== 'completed') throw new InvoiceError('Only completed appointments can have a record.', 409);
    let invoice = rows(await transaction.execute({ sql: 'SELECT id, receipt_token, status, total_centavos FROM invoices WHERE appointment_id = ? AND clinic_id = ?', args: [appointmentId, profile.id] }))[0];
    if (!invoice) {
      invoice = { id: randomUUID(), receipt_token: randomUUID(), status: 'unpaid', total_centavos: Number(visit.price_centavos) };
      await transaction.execute({ sql: 'INSERT INTO invoices (id, clinic_id, appointment_id, receipt_token, expires_at, total_centavos) VALUES (?, ?, ?, ?, ?, ?)', args: [invoice.id, profile.id, appointmentId, invoice.receipt_token, new Date(Date.now() + 365 * 86400000).toISOString(), invoice.total_centavos] });
      await transaction.execute({ sql: 'INSERT INTO invoice_items (id, invoice_id, service_id, description, unit_price_centavos, total_centavos) VALUES (?, ?, ?, ?, ?, ?)', args: [randomUUID(), invoice.id, visit.service_id, visit.name, invoice.total_centavos, invoice.total_centavos] });
    }
    await transaction.commit();
    return { ...invoice, appointmentId, receiptUrl: '/receipt.html?token=' + encodeURIComponent(invoice.receipt_token) };
  } catch (error) { if (!transaction.closed) await transaction.rollback(); throw error; } finally { transaction.close(); }
}

export async function generateInvoice(appointmentId) {
  if (invoiceJobs.has(appointmentId)) return invoiceJobs.get(appointmentId);
  const task = (async () => { for (let attempt = 0; attempt < 10; attempt += 1) {
    try { return await generateInvoiceOnce(appointmentId); }
    catch (error) {
      if (!/busy|locked/i.test(String(error.message || error)) || attempt === 9) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  } })();
  invoiceJobs.set(appointmentId, task);
  try { return await task; } finally { invoiceJobs.delete(appointmentId); }
}

export async function setInvoiceStatus(invoiceId, status) {
  if (!['paid', 'unpaid'].includes(status)) throw new InvoiceError('Invoice status is invalid.');
  const profile = getActiveClinicProfile();
  const result = await query('UPDATE invoices SET status = ?, paid_at = CASE WHEN ? = ? THEN ? ELSE NULL END, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND clinic_id = ?', [status, status, 'paid', new Date().toISOString(), invoiceId, profile.id]);
  if (!result.rowsAffected) throw new InvoiceError('Invoice record is unavailable.', 404);
  return rows(await query('SELECT id, receipt_token, status, total_centavos FROM invoices WHERE id = ? AND clinic_id = ?', [invoiceId, profile.id]))[0];
}

export async function rotateReceiptToken(invoiceId) { const profile = getActiveClinicProfile(); const token = randomUUID(); const updated = await query('UPDATE invoices SET receipt_token = ?, expires_at = ?, revoked_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND clinic_id = ?', [token, new Date(Date.now() + 365 * 86400000).toISOString(), invoiceId, profile.id]); if (!updated.rowsAffected) throw new InvoiceError('Invoice record is unavailable.', 404); return { token, receiptUrl: '/receipt.html?token=' + encodeURIComponent(token) }; }
export async function revokeReceiptToken(invoiceId) { const profile = getActiveClinicProfile(); const updated = await query('UPDATE invoices SET revoked_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND clinic_id = ? AND revoked_at IS NULL', [new Date().toISOString(), invoiceId, profile.id]); if (!updated.rowsAffected) throw new InvoiceError('Receipt is unavailable.', 404); return { status: 'revoked' }; }

export async function getReceipt(token) {
  if (!validToken(token)) throw new InvoiceError('This receipt is unavailable.', 404);
  const profile = getActiveClinicProfile();
  const invoice = rows(await query('SELECT i.id, i.status, i.total_centavos, i.created_at, p.name AS pet_name, o.name AS owner_name FROM invoices i JOIN appointments a ON a.id = i.appointment_id AND a.clinic_id = i.clinic_id JOIN pets p ON p.id = a.pet_id JOIN owners o ON o.id = a.owner_id WHERE i.receipt_token = ? AND i.clinic_id = ? AND i.revoked_at IS NULL AND i.expires_at > ?', [token, profile.id, new Date().toISOString()]))[0];
  if (!invoice) throw new InvoiceError('This receipt is unavailable.', 404);
  const items = rows(await query('SELECT description, quantity, unit_price_centavos, total_centavos FROM invoice_items WHERE invoice_id = ? ORDER BY id', [invoice.id]));
  return { invoice: { status: invoice.status, totalCentavos: Number(invoice.total_centavos), createdAt: invoice.created_at, petName: invoice.pet_name, ownerName: invoice.owner_name, items } };
}
