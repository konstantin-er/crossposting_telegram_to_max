const { config } = require('./config');

// Send a message to a MAX channel on behalf of the bot.
// attachments: array of MAX attachment objects (e.g. { type: 'image', payload: { url } })
async function sendMessageToChannel({ chatId, text, attachments = [] }) {
  const endpoint = `${config.maxApiBase}/messages?chat_id=${encodeURIComponent(chatId)}`;
  const body = { format: 'html' };
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

// Upload a video to MAX and return the token needed for message attachment.
// MAX video upload protocol:
//   Step 1: POST /uploads?type=video → { url, token }  (token is issued here)
//   Step 2: POST uploadUrl with raw binary body + Content-Range / Content-Disposition headers
async function uploadVideoToMax(buffer, mimeType, filename) {
  const initRes = await fetch(`${config.maxApiBase}/uploads?type=video`, {
    method: 'POST',
    headers: { Authorization: config.maxBotToken },
  });
  const initData = await initRes.json();
  const uploadUrl = initData.url;
  const token = initData.token;
  if (!uploadUrl || !token) throw new Error('MAX uploads video: no url or token in init response');

  const fileSize = buffer.length;
  await fetch(uploadUrl, {
    method: 'POST',
    body: buffer,
    headers: {
      'Content-Type': mimeType || 'video/mp4',
      'Content-Range': `bytes 0-${fileSize - 1}/${fileSize}`,
      'Content-Disposition': `attachment; filename="${filename || 'video.mp4'}"`,
    },
  });
  return { token };
}

module.exports = { sendMessageToChannel, uploadVideoToMax };
