import { createStaffAccessMiddleware } from '../../../routes/demo-access.js';
import { createInvoice } from '../../../routes/invoices.js';
const protectStaff = createStaffAccessMiddleware();
export default function handler(request, response) { return protectStaff(request, response, () => createInvoice(request, response)); }
