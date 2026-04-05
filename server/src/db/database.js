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

  // Add nonce column if missing (migration for existing DBs)
  try {
    db.prepare('SELECT nonce FROM tokens LIMIT 1').get();
  } catch {
    db.exec('ALTER TABLE tokens ADD COLUMN nonce TEXT');
  }

  // Add workflow_type column if missing so testbench runs can be hidden from mission control
  try {
    db.prepare('SELECT workflow_type FROM workflows LIMIT 1').get();
  } catch {
    db.exec("ALTER TABLE workflows ADD COLUMN workflow_type TEXT NOT NULL DEFAULT 'mission'");
  }

  try {
    db.prepare('SELECT hidden_from_chain FROM workflows LIMIT 1').get();
  } catch {
    db.exec("ALTER TABLE workflows ADD COLUMN hidden_from_chain INTEGER NOT NULL DEFAULT 0");
  }

  db.exec("UPDATE workflows SET workflow_type = 'mission' WHERE workflow_type IS NULL OR workflow_type = ''");
  db.exec('UPDATE workflows SET hidden_from_chain = 0 WHERE hidden_from_chain IS NULL');

  try {
    db.prepare('SELECT validation_errors FROM uploaded_workflows LIMIT 1').get();
  } catch {
    db.exec("ALTER TABLE uploaded_workflows ADD COLUMN validation_errors TEXT DEFAULT '[]'");
  }

  try {
    db.prepare('SELECT last_error FROM uploaded_workflows LIMIT 1').get();
  } catch {
    db.exec("ALTER TABLE uploaded_workflows ADD COLUMN last_error TEXT DEFAULT ''");
  }

  db.exec("UPDATE uploaded_workflows SET validation_errors = '[]' WHERE validation_errors IS NULL OR validation_errors = ''");
  db.exec("UPDATE uploaded_workflows SET last_error = '' WHERE last_error IS NULL");

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

  // Vertex AI–themed credentials matching the incident model
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
