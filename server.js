import express from 'express';
import { createDemoAccessMiddleware, createPublicWriteRateLimitMiddleware, createStaffAccessMiddleware } from './routes/demo-access.js';
import { health } from './routes/health.js';
import { ownerAction, reminderReconciliation, retryReminderRoute, runReminderCron, unconfirmedAppointments } from './routes/reminders.js';
import { receptionistChat } from './routes/chat.js';
import { dashboard } from './routes/dashboard.js';
import { publicProfile } from './routes/profile.js';
import { blockOff, booking, calendar, slots } from './routes/scheduling-routes.js';
import { createWalkInRoute } from './routes/walk-ins.js';
import { completeAppointmentRoute, previewReviewRoute, submitReviewFeedbackRoute, submitReviewRatingRoute, reviewReconciliationRoute, retryReviewRoute, revokeReviewRoute } from './routes/reviews.js';
import { issuePetCardToken, petCard } from './routes/pet-cards.js';
import { createInvoice, receipt, revokeReceipt, rotateReceipt, updateInvoice } from './routes/invoices.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(express.static('public'));

app.get('/api/profile', publicProfile);
app.get('/api/health', createDemoAccessMiddleware(), health);
app.get('/api/slots', createDemoAccessMiddleware(), slots);
app.post('/api/bookings', createDemoAccessMiddleware(), booking);
app.post('/api/walk-ins', createPublicWriteRateLimitMiddleware(), createWalkInRoute);
app.post('/api/appointments/:id/complete', createStaffAccessMiddleware(), completeAppointmentRoute);
app.post('/api/appointments/:id/invoice', createStaffAccessMiddleware(), createInvoice);
app.patch('/api/invoices/:id', createStaffAccessMiddleware(), updateInvoice);
app.post('/api/invoices/:id/receipt-token', createStaffAccessMiddleware(), rotateReceipt);
app.post('/api/invoices/:id/receipt-revoke', createStaffAccessMiddleware(), revokeReceipt);
app.get('/api/receipts/:token', receipt);
app.post('/api/pets/:id/card-token', createStaffAccessMiddleware(), issuePetCardToken);
app.get('/api/pets/card/:token', petCard);
app.get('/api/reviews/:token', previewReviewRoute);
app.post('/api/reviews/:token/rating', createPublicWriteRateLimitMiddleware({ keyPrefix: 'review' }), submitReviewRatingRoute);
app.post('/api/reviews/:token/feedback', createPublicWriteRateLimitMiddleware({ keyPrefix: 'review' }), submitReviewFeedbackRoute);
app.get('/api/reviews/reconciliation', createStaffAccessMiddleware(), reviewReconciliationRoute);
app.post('/api/reviews/:id/revoke', createStaffAccessMiddleware(), revokeReviewRoute);
app.post('/api/reviews/:id/retry', createStaffAccessMiddleware(), retryReviewRoute);
app.post('/api/block-offs', createStaffAccessMiddleware(), blockOff);
app.get('/api/calendar', createStaffAccessMiddleware(), calendar);
app.post('/api/cron/reminders', runReminderCron);
app.get('/api/owner/:action', ownerAction);
app.post('/api/owner/:action', ownerAction);
app.get('/api/appointments/unconfirmed', createStaffAccessMiddleware(), unconfirmedAppointments);
app.get('/api/reminders/reconciliation', createStaffAccessMiddleware(), reminderReconciliation);
app.post('/api/reminders/:id/retry', createStaffAccessMiddleware(), retryReminderRoute);
app.post('/api/chat', createDemoAccessMiddleware(), receptionistChat);
app.get('/api/dashboard', createStaffAccessMiddleware(), dashboard);

app.use('/api', (request, response) => {
  response.status(404).json({ error: 'API route not found.' });
});

app.use((error, request, response, next) => {
  if (error instanceof SyntaxError && 'body' in error) {
    return response.status(400).json({ error: 'Invalid JSON request body.' });
  }
  return next(error);
});

app.use((error, request, response, next) => {
  console.error(error);
  response.status(500).json({ error: 'Unexpected server error.' });
});

if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  const port = Number.parseInt(process.env.PORT || '3000', 10);
  app.listen(port, () => console.log('VetFlow listening on http://localhost:' + port));
}

export default app;
