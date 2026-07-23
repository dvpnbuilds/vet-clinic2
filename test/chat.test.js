import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import test, { after, before } from 'node:test';
import { chatWithReceptionist } from '../ai/chat.js';
import { getDb } from '../db/client.js';
import { listCalendar, listSlots } from '../db/scheduling.js';

const run = promisify(execFile);
const databaseFile = '.vetflow-chat-test.db';
let slot;

before(async () => {
  process.env.TURSO_DATABASE_URL = 'file:./' + databaseFile;
  process.env.ACTIVE_CLINIC_PROFILE = 'ph';
  await rm(databaseFile, { force: true });
  await run(process.execPath, ['db/seed.js'], {
    cwd: process.cwd(),
    env: { ...process.env, TURSO_DATABASE_URL: 'file:./' + databaseFile }
  });
  slot = (await listSlots({ date: '2026-07-30', serviceId: 'service-rabies' }))[0];
});

after(() => {
  getDb().close();
});

test('receptionist receives profile FAQs and replies naturally in Taglish', async () => {
  let receivedSystemPrompt = '';
  const response = await chatWithReceptionist({
    messages: [{ role: 'user', content: 'Saan kayo located at open ba kayo Saturday?' }],
    complete: async ({ messages }) => {
      receivedSystemPrompt = messages[0].content;
      return { content: 'Nasa Quezon City kami. Open kami Saturday, 9 AM hanggang 1 PM.' };
    }
  });

  assert.match(receivedSystemPrompt, /Quezon City/);
  assert.match(response.message, /kami/);
  assert.equal(response.appointment, null);
});

test('chat booking tool reserves a real appointment visible on the calendar', async () => {
  let calls = 0;
  const response = await chatWithReceptionist({
    messages: [{ role: 'user', content: 'Mag-book ako ng anti-rabies sa July 30.' }],
    complete: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          content: '',
          tool_calls: [{
            id: 'book-call-1',
            function: {
              name: 'book_appointment',
              arguments: JSON.stringify({
                slotId: slot.id,
                ownerName: 'Jessa Ramos',
                mobile: '+639171234567',
                petName: 'Kiko',
                species: 'dog',
                breed: 'Aspin'
              })
            }
          }]
        };
      }
      return { content: 'Booked na si Kiko. See you sa clinic!' };
    }
  });

  assert.equal(response.appointment.slotId, slot.id);
  assert.match(response.message, /Booked na/);
  const calendar = await listCalendar({ date: '2026-07-30', view: 'day' });
  assert.ok(calendar.appointments.some((appointment) => appointment.id === response.appointment.id));
});

test('chat booking tool refuses an already-booked slot', async () => {
  let calls = 0;
  const response = await chatWithReceptionist({
    messages: [{ role: 'user', content: 'I-book mo ako sa parehong oras.' }],
    complete: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          tool_calls: [{
            id: 'book-call-2',
            function: {
              name: 'book_appointment',
              arguments: JSON.stringify({
                slotId: slot.id,
                ownerName: 'Marco Lim',
                mobile: '+639179999999',
                petName: 'Ming',
                species: 'cat'
              })
            }
          }]
        };
      }
      return { content: 'Nakuha na ang oras na iyon. Pumili tayo ng ibang slot.' };
    }
  });

  assert.equal(response.appointment, null);
  assert.match(response.message, /ibang slot/);
});
