import express from 'express';
import { createDemoAccessMiddleware } from './routes/demo-access.js';
import { health } from './routes/health.js';
import { ownerAction, runReminderCron, unconfirmedAppointments } from './routes/reminders.js';
import { receptionistChat } from './routes/chat.js';
import { dashboard } from './routes/dashboard.js';
import { publicProfile } from './routes/profile.js';
import { blockOff, booking, calendar, slots } from './routes/scheduling-routes.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(express.static('public'));

app.get('/api/profile', publicProfile);
app.get('/api/health', createDemoAccessMiddleware(), health);
app.get('/api/slots', createDemoAccessMiddleware(), slots);
app.post('/api/bookings', createDemoAccessMiddleware(), booking);
app.post('/api/block-offs', createDemoAccessMiddleware(), blockOff);
app.get('/api/calendar', createDemoAccessMiddleware(), calendar);
app.post('/api/cron/reminders', runReminderCron);
app.get('/api/owner/:action', ownerAction);
app.get('/api/appointments/unconfirmed', createDemoAccessMiddleware(), unconfirmedAppointments);
app.post('/api/chat', createDemoAccessMiddleware(), receptionistChat);
app.get('/api/dashboard', createDemoAccessMiddleware(), dashboard);

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
