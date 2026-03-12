const { config } = require('./config');

// Send a message to a MAX channel on behalf of the bot.
// attachments: array of MAX attachment objects (e.g. { type: 'image', payload: { url } })
async function sendMessageToChannel({ chatId, text, attachments = [] }) {
  const endpoint = `${config.maxApiBase}/messages?chat_id=${encodeURIComponent(chatId)}`;
  const body = { format: 'markdown' };
  if (text) body.text = text;
  if (attachments.length > 0) body.attachments = attachments;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: config.maxBotToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`MAX send message error: ${res.status} ${errText}`);
  }
  return res.json();
}

module.exports = { sendMessageToChannel };
