import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let db = null;

export function getDb() {
  if (db) return db;

  const dbPath = process.env.DATABASE_URL || './tokenflow.db';
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run schema
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schema);

  // Seed vault credentials if empty
  const count = db.prepare('SELECT COUNT(*) as count FROM vault_credentials').get();
  if (count.count === 0) {
    seedVaultCredentials(db);
  }

  console.log('[DB] Database initialized');
  return db;
}

function seedVaultCredentials(db) {
  const insert = db.prepare(`
    INSERT INTO vault_credentials (id, service_name, display_name, connection_type, status)
    VALUES (?, ?, ?, ?, ?)
  `);

  const credentials = [
    ['cred-gcs', 'gcs-service-account', 'GCS Service Account', 'token_vault', 'connected'],
    ['cred-internal-api', 'internal-api-key', 'Internal API Key', 'token_vault', 'connected'],
    ['cred-source-control', 'source-control-token', 'Source Control Token', 'token_vault', 'restricted'],
  ];

  const insertMany = db.transaction((creds) => {
    for (const cred of creds) {
      insert.run(...cred);
    }
  });

  insertMany(credentials);
  console.log('[DB] Seeded vault credentials');
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
    console.log('[DB] Database closed');
  }
}
