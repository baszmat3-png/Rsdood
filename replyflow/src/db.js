import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const file = process.env.DB_PATH || 'data/app.db';
fs.mkdirSync(path.dirname(file), { recursive: true });
export const db = new DatabaseSync(file);

db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  name TEXT NOT NULL,
  external_id TEXT NOT NULL DEFAULT '',
  token TEXT NOT NULL DEFAULT '',
  extra TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'any',
  account_id INTEGER,
  scope TEXT NOT NULL DEFAULT 'all',
  post_id TEXT NOT NULL DEFAULT '',
  keywords TEXT NOT NULL DEFAULT '',
  public_mode TEXT NOT NULL DEFAULT 'ai',
  public_text TEXT NOT NULL DEFAULT '',
  dm_mode TEXT NOT NULL DEFAULT 'ai',
  dm_text TEXT NOT NULL DEFAULT '',
  dm_details TEXT NOT NULL DEFAULT '',
  once_per_user INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  channel TEXT NOT NULL,
  kind TEXT NOT NULL,
  account_id INTEGER,
  post_id TEXT NOT NULL DEFAULT '',
  comment_id TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL DEFAULT '',
  user_name TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  campaign_id INTEGER,
  public_reply TEXT NOT NULL DEFAULT '',
  dm_reply TEXT NOT NULL DEFAULT '',
  public_status TEXT NOT NULL DEFAULT '',
  dm_status TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'processing',
  error TEXT NOT NULL DEFAULT '',
  simulated INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_events_comment ON events(channel, comment_id) WHERE comment_id <> '' AND simulated = 0;
CREATE INDEX IF NOT EXISTS ix_events_ts ON events(ts);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_messages_user ON messages(channel, user_id, ts);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

export function getSetting(key, def = '') {
  const r = get('SELECT value FROM settings WHERE key = ?', key);
  return r ? r.value : def;
}
export function setSetting(key, value) {
  run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value ?? ''));
}
