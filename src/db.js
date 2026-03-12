const Database = require('better-sqlite3');
const { config } = require('./config');

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crosspost_channels (
      tg_channel_id   TEXT PRIMARY KEY,
      tg_channel_title TEXT NOT NULL DEFAULT '',
      max_channel_id  TEXT NOT NULL,
      max_channel_title TEXT NOT NULL DEFAULT '',
      skip_keyword    TEXT,
      enabled         INTEGER NOT NULL DEFAULT 1,
      created_at      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS crosspost_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      tg_channel_id   TEXT NOT NULL,
      tg_message_id   INTEGER NOT NULL,
      max_channel_id  TEXT NOT NULL,
      max_message_id  TEXT,
      status          TEXT NOT NULL DEFAULT 'pending',
      error_text      TEXT,
      created_at      INTEGER NOT NULL,
      posted_at       INTEGER,
      UNIQUE(tg_channel_id, tg_message_id)
    );

    CREATE TABLE IF NOT EXISTS tg_seen_channels (
      channel_id  TEXT PRIMARY KEY,
      title       TEXT,
      username    TEXT,
      seen_at     INTEGER NOT NULL
    );
  `);
}

function upsertTgChannel({ channelId, title, username }) {
  db.prepare(`
    INSERT INTO tg_seen_channels (channel_id, title, username, seen_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET
      title = excluded.title,
      username = excluded.username,
      seen_at = excluded.seen_at
  `).run(String(channelId), title || '', username || '', Date.now());
}

function getAllTgChannels() {
  return db.prepare(`SELECT * FROM tg_seen_channels ORDER BY seen_at DESC`).all();
}

module.exports = { db, migrate, upsertTgChannel, getAllTgChannels };
