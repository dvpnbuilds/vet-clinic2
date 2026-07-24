import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getDb } from './client.js';

const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));
export async function migrate() {
  const db = getDb();
  await db.execute('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  await db.executeMultiple(await readFile(schemaPath, 'utf8'));
  for (const statement of [
    "ALTER TABLE reviews ADD COLUMN expires_at TEXT",
    "ALTER TABLE reviews ADD COLUMN revoked_at TEXT",
    "ALTER TABLE invoices ADD COLUMN expires_at TEXT",
    "ALTER TABLE invoices ADD COLUMN revoked_at TEXT"
  ]) await db.execute(statement).catch(() => {});
  const expiresAt = new Date(Date.now() + 365 * 86400000).toISOString();
  await db.execute({ sql: 'UPDATE reviews SET expires_at = ? WHERE expires_at IS NULL', args: [expiresAt] });
  await db.execute({ sql: 'UPDATE invoices SET expires_at = ? WHERE expires_at IS NULL', args: [expiresAt] });
  await db.execute({ sql: 'INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)', args: ['v2'] });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) migrate().then(() => console.log('V2 migration applied.')).catch((error) => { console.error('Migration failed:', error.message); process.exitCode = 1; });
