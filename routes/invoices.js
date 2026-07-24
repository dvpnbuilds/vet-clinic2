import { InvoiceError, generateInvoice, getReceipt, revokeReceiptToken, rotateReceiptToken, setInvoiceStatus } from '../db/invoices.js';
import { getActiveClinicProfile } from '../db/profiles/index.js';

function fail(response, error, publicReceipt = false) {
  const publicMessage = () => getActiveClinicProfile().invoices.unavailable;
  if (error instanceof InvoiceError) return response.status(error.status).json({ error: publicReceipt ? publicMessage() : error.message });
  console.error('Invoice route failed:', error);
  return response.status(500).json({ error: publicReceipt ? publicMessage() : 'Invoice records are temporarily unavailable.' });
}
export async function createInvoice(request, response) { try { return response.status(201).json({ invoice: await generateInvoice(request.params?.id || request.query?.id) }); } catch (error) { return fail(response, error); } }
export async function updateInvoice(request, response) { try { return response.status(200).json({ invoice: await setInvoiceStatus(request.params?.id || request.query?.id, request.body?.status) }); } catch (error) { return fail(response, error); } }
export async function receipt(request, response) { try { return response.status(200).json(await getReceipt(request.params?.token || request.query?.token)); } catch (error) { return fail(response, error, true); } }
export async function rotateReceipt(request, response) { try { return response.status(200).json({ receipt: await rotateReceiptToken(request.params?.id || request.query?.id) }); } catch (error) { return fail(response, error); } }
export async function revokeReceipt(request, response) { try { return response.status(200).json({ receipt: await revokeReceiptToken(request.params?.id || request.query?.id) }); } catch (error) { return fail(response, error); } }
