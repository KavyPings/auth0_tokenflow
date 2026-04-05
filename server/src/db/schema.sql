-- TokenFlow OS Database Schema
-- Capability tokens, audit logs, workflows, vault credentials,
-- testbench results, and uploaded workflow definitions.

-- ═══════════════════════════════════════════════════════════
-- Capability Tokens
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  resource_id TEXT,
  agent_id TEXT NOT NULL,
  minted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  context TEXT DEFAULT '{}',
  parent_token_id TEXT,
  step_index INTEGER NOT NULL,
  nonce TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════
-- Immutable Audit Log
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  details TEXT DEFAULT '{}',
  timestamp TEXT DEFAULT (datetime('now')),
  actor TEXT NOT NULL
);

-- ═══════════════════════════════════════════════════════════
-- Workflow Runs
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  applicant_data TEXT DEFAULT '{}',
  workflow_type TEXT NOT NULL DEFAULT 'mission',
  hidden_from_chain INTEGER NOT NULL DEFAULT 0,
  current_step INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════
-- Credential Vault Registry (names only, never values)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS vault_credentials (
  id TEXT PRIMARY KEY,
  service_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  connection_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected',
  last_accessed TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════
-- Testbench Results — persisted pass/fail results
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS test_runs (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL,
  scenario_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  assertions TEXT DEFAULT '[]',
  summary TEXT DEFAULT '{}',
  token_chain TEXT DEFAULT '[]',
  audit_log TEXT DEFAULT '[]',
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  duration_ms INTEGER DEFAULT 0
);

-- ═══════════════════════════════════════════════════════════
-- Uploaded Workflow Definitions
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS uploaded_workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  definition TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'validated',
  validation_errors TEXT DEFAULT '[]',
  last_error TEXT DEFAULT '',
  uploaded_at TEXT DEFAULT (datetime('now')),
  last_run_at TEXT
);

-- ═══════════════════════════════════════════════════════════
-- Indexes
-- ═══════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_tokens_workflow ON tokens(workflow_id);
CREATE INDEX IF NOT EXISTS idx_tokens_status ON tokens(status);
CREATE INDEX IF NOT EXISTS idx_tokens_nonce ON tokens(nonce);
CREATE INDEX IF NOT EXISTS idx_audit_workflow ON audit_log(workflow_id);
CREATE INDEX IF NOT EXISTS idx_audit_token ON audit_log(token_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_scenario ON test_runs(scenario_id);
