import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Initializes Koodu's local durable tables. UI migration to these tables is separate. */
export function initializeDatabase(path: string): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS companion_profiles (
      id TEXT PRIMARY KEY, display_name TEXT NOT NULL, asset_directory TEXT NOT NULL,
      manifest_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS workspace_state (
      id TEXT PRIMARY KEY, state_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY, content TEXT NOT NULL, category TEXT NOT NULL,
      embedding BLOB, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_accessed TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS memories_category_idx ON memories(category);
    CREATE INDEX IF NOT EXISTS memories_created_at_idx ON memories(created_at);
    CREATE TABLE IF NOT EXISTS usage_events (
      id TEXT PRIMARY KEY, occurred_at INTEGER NOT NULL, model_id TEXT, provider TEXT,
      route TEXT NOT NULL CHECK(route IN ('local','cloud')), input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0, latency_ms INTEGER NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('success','error','cancelled')), error_code TEXT
    );
    CREATE INDEX IF NOT EXISTS usage_events_time_idx ON usage_events(occurred_at);
    CREATE INDEX IF NOT EXISTS usage_events_model_time_idx ON usage_events(model_id, occurred_at);
    CREATE TABLE IF NOT EXISTS agent_tasks (
      id TEXT PRIMARY KEY, agent_type TEXT NOT NULL, task TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued', progress INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS agent_tasks_status_idx ON agent_tasks(status);
    CREATE TABLE IF NOT EXISTS agent_task_events (
      id INTEGER PRIMARY KEY, task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
      occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
      category TEXT NOT NULL, instructions TEXT NOT NULL, enabled INTEGER NOT NULL,
      source TEXT NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS model_profiles (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
      base_url TEXT NOT NULL, role TEXT NOT NULL, max_output_tokens INTEGER NOT NULL,
      monthly_token_limit INTEGER NOT NULL, enabled INTEGER NOT NULL, active INTEGER NOT NULL,
      api_key TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS model_usage (
      model_id TEXT NOT NULL REFERENCES model_profiles(id) ON DELETE CASCADE,
      month TEXT NOT NULL, tokens INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (model_id, month)
    );
    CREATE TABLE IF NOT EXISTS workspace_logs (
      id TEXT PRIMARY KEY, at INTEGER NOT NULL, level TEXT NOT NULL,
      source TEXT NOT NULL, message TEXT NOT NULL, detail TEXT
    );
    CREATE INDEX IF NOT EXISTS workspace_logs_at_idx ON workspace_logs(at DESC);
    CREATE TABLE IF NOT EXISTS agent_drafts (
      id TEXT PRIMARY KEY, agent_type TEXT NOT NULL, task TEXT NOT NULL, created_at INTEGER NOT NULL
    );
  `);
  return db;
}

