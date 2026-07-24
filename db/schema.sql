PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS clinics (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  locale TEXT NOT NULL,
  timezone TEXT NOT NULL,
  currency TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  price_centavos INTEGER NOT NULL DEFAULT 0 CHECK (price_centavos >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vets (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vet_hours (
  id TEXT PRIMARY KEY,
  vet_id TEXT NOT NULL REFERENCES vets(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity > 0),
  UNIQUE (vet_id, weekday, starts_at, ends_at)
);

CREATE TABLE IF NOT EXISTS block_offs (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  vet_id TEXT REFERENCES vets(id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS owners (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mobile TEXT,
  email TEXT,
  preferred_channel TEXT NOT NULL DEFAULT 'sms' CHECK (preferred_channel IN ('sms', 'email')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pets (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  species TEXT NOT NULL,
  breed TEXT,
  birth_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS slots (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  vet_id TEXT NOT NULL REFERENCES vets(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity > 0),
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'blocked', 'unavailable')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (vet_id, service_id, starts_at)
);

CREATE TABLE IF NOT EXISTS slot_reservations (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  vet_id TEXT NOT NULL REFERENCES vets(id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,
  capacity_index INTEGER NOT NULL CHECK (capacity_index >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (vet_id, starts_at, capacity_index)
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  slot_id TEXT REFERENCES slots(id) ON DELETE SET NULL,
  vet_id TEXT NOT NULL REFERENCES vets(id) ON DELETE RESTRICT,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE RESTRICT,
  pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE RESTRICT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show', 'rescheduled')),
  confirmation_token TEXT NOT NULL UNIQUE,
  reschedule_token TEXT NOT NULL UNIQUE,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS walk_ins (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  appointment_id TEXT NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  arrived_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  appointment_id TEXT NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  due_at TEXT NOT NULL,
  sent_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'skipped')),
  claim_token TEXT,
  claimed_at TEXT,
  delivery_started_at TEXT,
  provider_message_id TEXT,
  last_error TEXT,
  rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  feedback TEXT,
  rated_at TEXT,
  feedback_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((rating IS NULL AND feedback IS NULL) OR rating IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS pet_card_tokens (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  pet_id TEXT NOT NULL UNIQUE REFERENCES pets(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  appointment_id TEXT NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  receipt_token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid')),
  total_centavos INTEGER NOT NULL CHECK (total_centavos >= 0),
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((status = 'paid' AND paid_at IS NOT NULL) OR (status = 'unpaid' AND paid_at IS NULL))
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  service_id TEXT REFERENCES services(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_centavos INTEGER NOT NULL CHECK (unit_price_centavos >= 0),
  total_centavos INTEGER NOT NULL CHECK (total_centavos >= 0)
);

CREATE TABLE IF NOT EXISTS booking_idempotency (
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  result_json TEXT,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  PRIMARY KEY (clinic_id, idempotency_key),
  CHECK ((status = 'processing' AND result_json IS NULL AND completed_at IS NULL) OR (status = 'completed' AND result_json IS NOT NULL AND completed_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS vaccinations (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  administered_on TEXT NOT NULL,
  due_on TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE CASCADE,
  pet_id TEXT REFERENCES pets(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('confirm', 'appointment_24h', 'appointment_2h', 'vaccine_due', 'no_show')),
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  due_at TEXT NOT NULL,
  sent_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'skipped')),
  dedupe_key TEXT NOT NULL UNIQUE,
  claim_token TEXT,
  claimed_at TEXT,
  last_error TEXT,
  provider_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (appointment_id IS NOT NULL OR pet_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS reminder_delivery_attempts (
  reminder_id TEXT PRIMARY KEY REFERENCES reminders(id) ON DELETE CASCADE,
  claim_token TEXT NOT NULL,
  started_at TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'delivering' CHECK (outcome IN ('delivering', 'sent', 'uncertain')),
  provider_message_id TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS reminder_delivery_attempt_history (
  id TEXT PRIMARY KEY,
  reminder_id TEXT NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  claim_token TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('delivering', 'sent', 'uncertain')),
  provider_message_id TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS demo_rate_limits (
  ip TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0)
);

CREATE INDEX IF NOT EXISTS idx_services_clinic_active ON services (clinic_id, active);
CREATE INDEX IF NOT EXISTS idx_vets_clinic_active ON vets (clinic_id, active);
CREATE INDEX IF NOT EXISTS idx_slots_vet_time ON slots (vet_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_slot_reservations_vet_time ON slot_reservations (vet_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_appointments_clinic_time ON appointments (clinic_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_walk_ins_clinic_arrived ON walk_ins (clinic_id, arrived_at);
CREATE INDEX IF NOT EXISTS idx_reviews_clinic_due ON reviews (clinic_id, due_at, status);
CREATE INDEX IF NOT EXISTS idx_reviews_clinic_feedback ON reviews (clinic_id, feedback_at);
CREATE INDEX IF NOT EXISTS idx_pet_card_tokens_token ON pet_card_tokens (token, expires_at);
CREATE INDEX IF NOT EXISTS idx_invoices_clinic_status ON invoices (clinic_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_receipt_token ON invoices (receipt_token);
CREATE INDEX IF NOT EXISTS idx_booking_idempotency_appointment ON booking_idempotency (appointment_id);
CREATE INDEX IF NOT EXISTS idx_reminders_due_unsent ON reminders (due_at, sent_at, status);
CREATE INDEX IF NOT EXISTS idx_reminder_delivery_attempts_outcome ON reminder_delivery_attempts (outcome, started_at);
CREATE INDEX IF NOT EXISTS idx_reminder_delivery_attempt_history_reminder ON reminder_delivery_attempt_history (reminder_id, started_at);
CREATE INDEX IF NOT EXISTS idx_vaccinations_due ON vaccinations (due_on);
