import { createStaffAccessMiddleware } from '../../routes/demo-access.js';
import { updateInvoice } from '../../routes/invoices.js';
const protectStaff = createStaffAccessMiddleware();
export default function handler(request, response) { return protectStaff(request, response, () => updateInvoice(request, response)); }
