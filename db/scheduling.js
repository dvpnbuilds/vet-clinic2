import { randomUUID } from 'node:crypto';
import { getDb, query } from './client.js';
import { getActiveClinicProfile } from './profiles/index.js';

const SLICE_MINUTES = 10;
const ACTIVE_APPOINTMENT_STATUSES = ['pending', 'confirmed', 'completed'];
const PET_SPECIES = new Set(['dog', 'cat', 'other']);
const timeZoneOffsetsByDate = new Map();

export class SchedulingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function asRows(result) {
  return result.rows.map((row) => Object.fromEntries(Object.entries(row)));
}

function parseDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new SchedulingError('date must use YYYY-MM-DD.');
  }
  const parsed = new Date(date + 'T00:00:00.000Z');
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new SchedulingError('date is invalid.');
  }
  return parsed;
}

function parseClock(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || '');
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new SchedulingError('Invalid clinic hours.');
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function toClock(minutes) {
  return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
}

function localDateTimeParts(timeZone, instant) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  return Object.fromEntries(formatter.formatToParts(instant)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
}

function timeZoneOffsetMilliseconds(timeZone, instant) {
  const values = localDateTimeParts(timeZone, instant);
  const localAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  return localAsUtc - instant.getTime();
}

function timeZoneOffsetsForDate(date, timeZone) {
  const key = timeZone + ':' + date;
  const cached = timeZoneOffsetsByDate.get(key);
  if (cached) return cached;

  const dayStart = new Date(date + 'T00:00:00.000Z').getTime();
  const offsets = new Set();
  // Sampling both sides of the local date captures the standard and daylight
  // offsets on transition days without relying on the host machine timezone.
  for (let timestamp = dayStart - 36 * 60 * 60 * 1000; timestamp <= dayStart + 60 * 60 * 60 * 1000; timestamp += 60 * 60 * 1000) {
    offsets.add(timeZoneOffsetMilliseconds(timeZone, new Date(timestamp)));
  }
  const result = [...offsets];
  if (timeZoneOffsetsByDate.size >= 366) timeZoneOffsetsByDate.clear();
  timeZoneOffsetsByDate.set(key, result);
  return result;
}

export function localDateTimeToIso(date, clock, timeZone) {
  parseDate(date);
  parseClock(clock);
  const target = { date, clock };
  const localAsUtc = new Date(date + 'T' + clock + ':00.000Z').getTime();
  const candidates = timeZoneOffsetsForDate(date, timeZone)
    .map((offset) => new Date(localAsUtc - offset))
    .filter((candidate) => {
      const local = localDateTimeParts(timeZone, candidate);
      return local.year + '-' + local.month + '-' + local.day === target.date
        && local.hour + ':' + local.minute === target.clock
        && local.second === '00';
    })
    .sort((left, right) => left.getTime() - right.getTime());

  // DST spring gaps have no matching instant. During autumn overlaps we use
  // the first occurrence, so a wall-clock slot has one stable persisted ID.
  return candidates[0]?.toISOString() || null;
}

function firstInstantOfLocalDate(date, timeZone) {
  for (let minute = 0; minute < 24 * 60; minute += 1) {
    const instant = localDateTimeToIso(date, toClock(minute), timeZone);
    if (instant) return instant;
  }
  throw new SchedulingError('No valid time exists on this local date.');
}

function addLocalDays(date, days) {
  const value = parseDate(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function slotId(vetId, serviceId, startsAt) {
  return 'slot_' + encodeURIComponent(vetId + '_' + serviceId + '_' + startsAt);
}

function listSlices(startsAt, endsAt) {
  const slices = [];
  for (let time = new Date(startsAt).getTime(); time < new Date(endsAt).getTime(); time += SLICE_MINUTES * 60 * 1000) {
    slices.push(new Date(time).toISOString());
  }
  return slices;
}

function asTimestamp(value, label) {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    throw new SchedulingError(label + ' is invalid.');
  }
  return timestamp;
}


function requiredString(value, label, maxLength) {
  if (typeof value !== 'string') {
    throw new SchedulingError(label + ' must be text.');
  }
  const trimmed = value.trim();
  if (!trimmed) throw new SchedulingError(label + ' is required.');
  if (trimmed.length > maxLength) {
    throw new SchedulingError(label + ' must be ' + maxLength + ' characters or fewer.');
  }
  return trimmed;
}

function optionalString(value, label, maxLength) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new SchedulingError(label + ' must be text.');
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    throw new SchedulingError(label + ' must be ' + maxLength + ' characters or fewer.');
  }
  return trimmed;
}

function validateBookingInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SchedulingError('Booking details are required.');
  }
  if (!input.owner || typeof input.owner !== 'object' || Array.isArray(input.owner)) {
    throw new SchedulingError('Owner details are required.');
  }
  if (!input.pet || typeof input.pet !== 'object' || Array.isArray(input.pet)) {
    throw new SchedulingError('Pet details are required.');
  }

  const slotId = requiredString(input.slotId, 'slotId', 600);
  const ownerName = requiredString(input.owner.name, 'Owner name', 120);
  const mobile = optionalString(input.owner.mobile, 'Mobile number', 32);
  const email = optionalString(input.owner.email, 'Email address', 254);
  if (!mobile && !email) {
    throw new SchedulingError('An owner mobile number or email is required.');
  }
  if (mobile && !/^\+?[0-9][0-9() -]{6,24}$/.test(mobile)) {
    throw new SchedulingError('Mobile number is invalid.');
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new SchedulingError('Email address is invalid.');
  }

  const species = requiredString(input.pet.species, 'Pet species', 16).toLowerCase();
  if (!PET_SPECIES.has(species)) {
    throw new SchedulingError('Pet species is invalid.');
  }
  const birthDate = optionalString(input.pet.birthDate, 'Pet birth date', 10);
  if (birthDate) parseDate(birthDate);

  return {
    slotId,
    owner: { name: ownerName, mobile, email },
    pet: {
      name: requiredString(input.pet.name, 'Pet name', 120),
      species,
      breed: optionalString(input.pet.breed, 'Breed', 120),
      birthDate,
      notes: optionalString(input.pet.notes, 'Pet notes', 1_000)
    },
    notes: optionalString(input.notes, 'Appointment notes', 1_000)
  };
}

async function loadClinicAndService(serviceId) {
  const profile = getActiveClinicProfile();
  const result = await query(
    'SELECT id, name, duration_minutes, price_centavos FROM services WHERE id = ? AND clinic_id = ? AND active = 1',
    [serviceId, profile.id]
  );
  const service = asRows(result)[0];
  if (!service) {
    throw new SchedulingError('Service not found.', 404);
  }
  return { profile, service };
}

async function getBlockOffs(clinicId, startsAt, endsAt) {
  const result = await query(
    'SELECT vet_id, starts_at, ends_at, reason FROM block_offs WHERE clinic_id = ? AND starts_at < ? AND ends_at > ?',
    [clinicId, endsAt, startsAt]
  );
  return asRows(result);
}

function overlapsBlockOff(blockOffs, vetId, startsAt, endsAt) {
  return blockOffs.some((block) => (
    (block.vet_id === null || block.vet_id === vetId)
    && block.starts_at < endsAt
    && block.ends_at > startsAt
  ));
}

async function remainingCapacity(vetId, startsAt, endsAt, capacity) {
  const result = await query(
    'SELECT starts_at, COUNT(*) AS booked FROM slot_reservations WHERE vet_id = ? AND starts_at >= ? AND starts_at < ? GROUP BY starts_at',
    [vetId, startsAt, endsAt]
  );
  const counts = new Map(asRows(result).map((row) => [row.starts_at, Number(row.booked)]));
  return Math.min(...listSlices(startsAt, endsAt).map((slice) => capacity - (counts.get(slice) || 0)));
}

export async function listSlots(input, { now = new Date() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SchedulingError('Slot search details are required.');
  }
  const { date } = input;
  const serviceId = requiredString(input.serviceId, 'serviceId', 160);
  const { profile, service } = await loadClinicAndService(serviceId);
  const localDate = parseDate(date);
  const weekday = localDate.getUTCDay();
  const dayStart = firstInstantOfLocalDate(date, profile.timezone);
  const dayEnd = firstInstantOfLocalDate(addLocalDays(date, 1), profile.timezone);
  const nowTimestamp = asTimestamp(now, 'Current time');
  if (new Date(dayEnd).getTime() <= nowTimestamp) {
    throw new SchedulingError('Please choose a future date.');
  }
  const vets = asRows(await query(
    'SELECT id, name FROM vets WHERE clinic_id = ? AND active = 1 ORDER BY name',
    [profile.id]
  ));
  const blockOffs = await getBlockOffs(profile.id, dayStart, dayEnd);
  const slots = [];

  for (const vet of vets) {
    const hours = asRows(await query(
      'SELECT starts_at, ends_at, capacity FROM vet_hours WHERE vet_id = ? AND weekday = ? ORDER BY starts_at',
      [vet.id, weekday]
    ));

    for (const period of hours) {
      const firstMinute = parseClock(period.starts_at);
      const lastStartMinute = parseClock(period.ends_at) - Number(service.duration_minutes);
      for (let minute = firstMinute; minute <= lastStartMinute; minute += SLICE_MINUTES) {
        const startsAt = localDateTimeToIso(date, toClock(minute), profile.timezone);
        if (!startsAt) continue;
        const endsAt = new Date(new Date(startsAt).getTime() + Number(service.duration_minutes) * 60 * 1000).toISOString();
        if (new Date(startsAt).getTime() <= nowTimestamp) {
          continue;
        }
        if (overlapsBlockOff(blockOffs, vet.id, startsAt, endsAt)) {
          continue;
        }

        const id = slotId(vet.id, service.id, startsAt);
        await query(
          'INSERT OR IGNORE INTO slots (id, clinic_id, vet_id, service_id, starts_at, ends_at, capacity) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [id, profile.id, vet.id, service.id, startsAt, endsAt, Number(period.capacity)]
        );
        const remaining = await remainingCapacity(vet.id, startsAt, endsAt, Number(period.capacity));
        const available = remaining > 0;
        await query(
          'UPDATE slots SET status = ? WHERE id = ?',
          [available ? 'available' : 'unavailable', id]
        );
        if (available) {
          slots.push({
            id,
            vetId: vet.id,
            vetName: vet.name,
            serviceId: service.id,
            startsAt,
            endsAt,
            capacity: Number(period.capacity),
            remainingCapacity: remaining
          });
        }
      }
    }
  }

  return slots.sort((left, right) => left.startsAt.localeCompare(right.startsAt) || left.vetName.localeCompare(right.vetName));
}

async function transactionRows(transaction, sql, args = []) {
  return asRows(await transaction.execute({ sql, args }));
}

function appointmentResult(appointment) {
  return {
    id: appointment.id,
    slotId: appointment.slot_id,
    serviceId: appointment.service_id,
    vetId: appointment.vet_id,
    startsAt: appointment.starts_at,
    endsAt: appointment.ends_at,
    status: appointment.status
  };
}

export async function bookSlot(input, { now = new Date() } = {}) {
  input = validateBookingInput(input);
  const nowTimestamp = asTimestamp(now, 'Current time');
  const profile = getActiveClinicProfile();
  const appointmentId = randomUUID();
  let transaction;
  try {
    transaction = await getDb().transaction('write');
    const slot = (await transactionRows(
      transaction,
      'SELECT s.*, v.active AS vet_active FROM slots s JOIN vets v ON v.id = s.vet_id WHERE s.id = ? AND s.clinic_id = ?',
      [input.slotId, profile.id]
    ))[0];
    if (!slot || !Number(slot.vet_active)) {
      throw new SchedulingError('Slot not found.', 404);
    }
    if (slot.status !== 'available') {
      throw new SchedulingError('That time is no longer available.', 409);
    }
    if (new Date(slot.starts_at).getTime() <= nowTimestamp) {
      throw new SchedulingError('That time has already passed.', 409);
    }

    const block = (await transactionRows(
      transaction,
      'SELECT id FROM block_offs WHERE clinic_id = ? AND (vet_id IS NULL OR vet_id = ?) AND starts_at < ? AND ends_at > ? LIMIT 1',
      [profile.id, slot.vet_id, slot.ends_at, slot.starts_at]
    ))[0];
    if (block) {
      throw new SchedulingError('That time is unavailable.', 409);
    }

    const slices = listSlices(slot.starts_at, slot.ends_at);
    const occupiedRows = await transactionRows(
      transaction,
      'SELECT starts_at, capacity_index FROM slot_reservations WHERE vet_id = ? AND starts_at >= ? AND starts_at < ?',
      [slot.vet_id, slot.starts_at, slot.ends_at]
    );
    const occupied = new Set(occupiedRows.map((row) => row.starts_at + ':' + row.capacity_index));
    let capacityIndex = -1;
    for (let index = 0; index < Number(slot.capacity); index += 1) {
      if (slices.every((slice) => !occupied.has(slice + ':' + index))) {
        capacityIndex = index;
        break;
      }
    }
    if (capacityIndex === -1) {
      throw new SchedulingError('That time is no longer available.', 409);
    }

    const ownerId = randomUUID();
    const petId = randomUUID();
    await transaction.execute({
      sql: 'INSERT INTO owners (id, clinic_id, name, mobile, email, preferred_channel) VALUES (?, ?, ?, ?, ?, ?)',
      args: [ownerId, profile.id, input.owner.name.trim(), input.owner.mobile || null, input.owner.email || null, input.owner.email && !input.owner.mobile ? 'email' : 'sms']
    });
    await transaction.execute({
      sql: 'INSERT INTO pets (id, clinic_id, owner_id, name, species, breed, birth_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      args: [petId, profile.id, ownerId, input.pet.name.trim(), input.pet.species.trim(), input.pet.breed || null, input.pet.birthDate || null, input.pet.notes || null]
    });
    await transaction.execute({
      sql: 'INSERT INTO appointments (id, clinic_id, slot_id, vet_id, service_id, owner_id, pet_id, starts_at, ends_at, confirmation_token, reschedule_token, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [appointmentId, profile.id, slot.id, slot.vet_id, slot.service_id, ownerId, petId, slot.starts_at, slot.ends_at, randomUUID(), randomUUID(), input.notes || null]
    });
    for (const startsAt of slices) {
      await transaction.execute({
        sql: 'INSERT INTO slot_reservations (id, appointment_id, vet_id, starts_at, capacity_index) VALUES (?, ?, ?, ?, ?)',
        args: [randomUUID(), appointmentId, slot.vet_id, startsAt, capacityIndex]
      });
    }
    if (Number(slot.capacity) <= 1) {
      await transaction.execute({
        sql: 'UPDATE slots SET status = ? WHERE id = ?',
        args: ['unavailable', slot.id]
      });
    }
    await transaction.commit();
    transaction.close();
    transaction = null;
    return appointmentResult({ id: appointmentId, slot_id: slot.id, service_id: slot.service_id, vet_id: slot.vet_id, starts_at: slot.starts_at, ends_at: slot.ends_at, status: 'pending' });
  } catch (error) {
    if (transaction && !transaction.closed) {
      await transaction.rollback();
    }
    if (error instanceof SchedulingError) {
      throw error;
    }
    if (String(error.message).includes('UNIQUE constraint failed') || String(error.message).includes('database is locked') || String(error.message).includes('SQLITE_BUSY')) {
      throw new SchedulingError('That time is no longer available.', 409);
    }
    throw error;
  } finally {
    transaction?.close();
  }
}

export async function createBlockOff(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SchedulingError('Block-off details are required.');
  }
  const vetId = optionalString(input.vetId, 'vetId', 160);
  const startsAt = requiredString(input.startsAt, 'Block-off start time', 40);
  const endsAt = requiredString(input.endsAt, 'Block-off end time', 40);
  const reason = optionalString(input.reason, 'Block-off reason', 500);
  const profile = getActiveClinicProfile();
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new SchedulingError('Block-off start and end times are invalid.');
  }
  const id = randomUUID();
  if (vetId) {
    const vet = asRows(await query('SELECT id FROM vets WHERE id = ? AND clinic_id = ?', [vetId, profile.id]))[0];
    if (!vet) throw new SchedulingError('Vet not found.', 404);
  }
  // One conditional write makes conflict detection and insertion indivisible:
  // either this block wins first, or an overlapping active appointment does.
  let inserted;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      inserted = await query(
        'INSERT INTO block_offs (id, clinic_id, vet_id, starts_at, ends_at, reason) SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM appointments WHERE clinic_id = ? AND status IN (?, ?) AND (? IS NULL OR vet_id = ?) AND starts_at < ? AND ends_at > ?)',
        [id, profile.id, vetId, start.toISOString(), end.toISOString(), reason, profile.id, 'pending', 'confirmed', vetId, vetId, end.toISOString(), start.toISOString()]
      );
      break;
    } catch (error) {
      if (!String(error.message).includes('database is locked') && !String(error.message).includes('SQLITE_BUSY')) throw error;
      if (attempt === 2) throw new SchedulingError('Scheduling changed. Please try again.', 409);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (inserted.rowsAffected === 0) {
    throw new SchedulingError('This block-off overlaps an existing appointment.', 409);
  }
  return { id, vetId, startsAt: start.toISOString(), endsAt: end.toISOString(), reason };
}

export async function listCalendar(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SchedulingError('Calendar details are required.');
  }
  const { date } = input;
  const view = input.view === undefined ? 'day' : input.view;
  const profile = getActiveClinicProfile();
  if (!['day', 'week'].includes(view)) {
    throw new SchedulingError('view must be day or week.');
  }
  parseDate(date);
  const startsAt = firstInstantOfLocalDate(date, profile.timezone);
  const endsAt = firstInstantOfLocalDate(addLocalDays(date, view === 'week' ? 7 : 1), profile.timezone);
  const appointments = asRows(await query(
    'SELECT a.id, a.starts_at, a.ends_at, a.status, s.name AS service_name, v.name AS vet_name, p.name AS pet_name, o.name AS owner_name FROM appointments a JOIN services s ON s.id = a.service_id JOIN vets v ON v.id = a.vet_id JOIN pets p ON p.id = a.pet_id JOIN owners o ON o.id = a.owner_id WHERE a.clinic_id = ? AND a.starts_at >= ? AND a.starts_at < ? AND a.status IN (?, ?, ?) ORDER BY a.starts_at',
    [profile.id, startsAt, endsAt, ...ACTIVE_APPOINTMENT_STATUSES]
  ));
  const blockOffs = asRows(await query(
    'SELECT id, vet_id, starts_at, ends_at, reason FROM block_offs WHERE clinic_id = ? AND starts_at < ? AND ends_at > ? ORDER BY starts_at',
    [profile.id, endsAt, startsAt]
  ));
  return { view, startsAt, endsAt, appointments, blockOffs };
}
