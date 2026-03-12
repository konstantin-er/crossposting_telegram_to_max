const path = require('path');
require('dotenv').config();

const config = {
  port: Number(process.env.PORT || 3000),
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data.sqlite'),
  maxApiBase: process.env.MAX_API_BASE || 'https://platform-api.max.ru',
  maxBotToken: process.env.MAX_BOT_TOKEN || '',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
};

function validateConfig() {
  const missing = [];
  if (!config.maxBotToken) missing.push('MAX_BOT_TOKEN');
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}

module.exports = { config, validateConfig };
