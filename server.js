require('dotenv').config();
const Fastify = require('fastify');
const { config, validateConfig } = require('./src/config');
const { migrate, getAllTgChannels } = require('./src/db');
const {
  getAllCrosspostChannels,
  addCrosspostChannel,
  removeCrosspostChannel,
  setCrosspostChannelEnabled,
} = require('./src/crosspost_db');

validateConfig();
migrate();

const app = Fastify({ logger: false });

// Auth middleware
function checkToken(req, reply) {
  if (req.query.token !== config.maxBotToken) {
    reply.code(401).send({ ok: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

app.get('/health', async () => ({ ok: true }));

// List Telegram channels the bot has seen
app.get('/api/admin/tg-channels', async (req, reply) => {
  if (!checkToken(req, reply)) return;
  const channels = getAllTgChannels();
  return { ok: true, channels };
});

// List crosspost mappings
app.get('/api/admin/crosspost-channels', async (req, reply) => {
  if (!checkToken(req, reply)) return;
  const channels = getAllCrosspostChannels();
  return { ok: true, channels };
});

// Add or update a crosspost mapping
app.post('/api/admin/crosspost-channels', async (req, reply) => {
  if (!checkToken(req, reply)) return;
  const { tgChannelId, tgChannelTitle, maxChannelId, maxChannelTitle, skipKeyword } = req.body || {};
  if (!tgChannelId || !maxChannelId) {
    return reply.code(400).send({ ok: false, error: 'tgChannelId and maxChannelId are required' });
  }
  addCrosspostChannel({
    tgChannelId,
    tgChannelTitle,
    maxChannelId,
    maxChannelTitle,
    skipKeyword: skipKeyword || null,
  });
  return { ok: true };
});

// Delete a crosspost mapping
app.delete('/api/admin/crosspost-channels/:tgChannelId', async (req, reply) => {
  if (!checkToken(req, reply)) return;
  removeCrosspostChannel(req.params.tgChannelId);
  return { ok: true };
});

// Toggle enabled/disabled
app.patch('/api/admin/crosspost-channels/:tgChannelId', async (req, reply) => {
  if (!checkToken(req, reply)) return;
  const { enabled } = req.body || {};
  if (enabled === undefined) {
    return reply.code(400).send({ ok: false, error: 'enabled field is required' });
  }
  setCrosspostChannelEnabled(req.params.tgChannelId, enabled);
  return { ok: true };
});

app.listen({ port: config.port, host: '0.0.0.0' }, (err) => {
  if (err) { console.error(err); process.exit(1); }
  console.log(`Crosspost server listening on port ${config.port}`);
});
