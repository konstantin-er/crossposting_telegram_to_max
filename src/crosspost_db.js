const { db } = require('./db');

function getCrosspostChannel(tgChannelId) {
  return db.prepare(
    `SELECT * FROM crosspost_channels WHERE tg_channel_id = ? AND enabled = 1`
  ).get(String(tgChannelId));
}

function getAllCrosspostChannels() {
  return db.prepare(`SELECT * FROM crosspost_channels ORDER BY created_at ASC`).all();
}

function addCrosspostChannel({ tgChannelId, tgChannelTitle, maxChannelId, maxChannelTitle, skipKeyword = null }) {
  db.prepare(`
    INSERT INTO crosspost_channels (tg_channel_id, tg_channel_title, max_channel_id, max_channel_title, skip_keyword, enabled, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(tg_channel_id) DO UPDATE SET
      tg_channel_title = excluded.tg_channel_title,
      max_channel_id = excluded.max_channel_id,
      max_channel_title = excluded.max_channel_title,
      skip_keyword = excluded.skip_keyword,
      enabled = 1
  `).run(String(tgChannelId), tgChannelTitle || '', String(maxChannelId), maxChannelTitle || '', skipKeyword || null, Date.now());
}

function removeCrosspostChannel(tgChannelId) {
  db.prepare(`DELETE FROM crosspost_channels WHERE tg_channel_id = ?`).run(String(tgChannelId));
}

function setCrosspostChannelEnabled(tgChannelId, enabled) {
  db.prepare(`UPDATE crosspost_channels SET enabled = ? WHERE tg_channel_id = ?`).run(enabled ? 1 : 0, String(tgChannelId));
}

function isCrosspostDuplicate({ tgChannelId, tgMessageId }) {
  const row = db.prepare(
    `SELECT 1 FROM crosspost_log WHERE tg_channel_id = ? AND tg_message_id = ?`
  ).get(String(tgChannelId), tgMessageId);
  return Boolean(row);
}

function logCrosspostPending({ tgChannelId, tgMessageId, maxChannelId }) {
  db.prepare(`
    INSERT OR IGNORE INTO crosspost_log (tg_channel_id, tg_message_id, max_channel_id, status, created_at)
    VALUES (?, ?, ?, 'pending', ?)
  `).run(String(tgChannelId), tgMessageId, String(maxChannelId), Date.now());
}

function logCrosspostPosted({ tgChannelId, tgMessageId, maxMessageId }) {
  db.prepare(`
    UPDATE crosspost_log SET status = 'posted', max_message_id = ?, posted_at = ?
    WHERE tg_channel_id = ? AND tg_message_id = ?
  `).run(maxMessageId || null, Date.now(), String(tgChannelId), tgMessageId);
}

function logCrosspostFailed({ tgChannelId, tgMessageId, errorText }) {
  db.prepare(`
    UPDATE crosspost_log SET status = 'failed', error_text = ?
    WHERE tg_channel_id = ? AND tg_message_id = ?
  `).run(errorText || '', String(tgChannelId), tgMessageId);
}

module.exports = {
  getCrosspostChannel,
  getAllCrosspostChannels,
  addCrosspostChannel,
  removeCrosspostChannel,
  setCrosspostChannelEnabled,
  isCrosspostDuplicate,
  logCrosspostPending,
  logCrosspostPosted,
  logCrosspostFailed,
};
