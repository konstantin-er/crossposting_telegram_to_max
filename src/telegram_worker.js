require('dotenv').config();
const { Telegraf } = require('telegraf');
const { config } = require('./config');
const { migrate, upsertTgChannel } = require('./db');
const { handleChannelPost, handleAlbum } = require('./crosspost_handlers');

if (!config.telegramBotToken) {
  console.error('TELEGRAM_BOT_TOKEN is not set — crosspost worker will not start');
  process.exit(0);
}

migrate();

const bot = new Telegraf(config.telegramBotToken);

// Album buffer: media_group_id → { messages[], timer }
const albumBuffer = new Map();
const ALBUM_TIMEOUT_MS = 1500;

function flushAlbum(mediaGroupId) {
  const album = albumBuffer.get(mediaGroupId);
  if (!album) return;
  albumBuffer.delete(mediaGroupId);
  handleAlbum(album.messages, bot).catch(err => {
    console.error('crosspost: album handler error', err);
  });
}

bot.on('channel_post', async (ctx) => {
  const msg = ctx.channelPost || ctx.message;
  if (!msg) return;

  console.log('channel_post received', JSON.stringify({ chat_id: msg.chat?.id, text: (msg.text || msg.caption || '').slice(0, 100) }));

  // Record the channel so it shows up in the TG channels list
  upsertTgChannel({
    channelId: String(msg.chat.id),
    title: msg.chat.title || '',
    username: msg.chat.username || '',
  });

  try {
    if (msg.media_group_id) {
      const id = msg.media_group_id;
      if (!albumBuffer.has(id)) {
        albumBuffer.set(id, { messages: [], timer: null });
      }
      const album = albumBuffer.get(id);
      album.messages.push(msg);
      clearTimeout(album.timer);
      album.timer = setTimeout(() => flushAlbum(id), ALBUM_TIMEOUT_MS);
    } else {
      await handleChannelPost(msg, bot);
    }
  } catch (err) {
    console.error('crosspost: channel_post handler error', err);
  }
});

bot.launch().catch(err => {
  console.error('Crosspost worker failed to start:', err.message);
  process.exit(1);
});
console.log('Crosspost worker (Telegram long-polling) started');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
