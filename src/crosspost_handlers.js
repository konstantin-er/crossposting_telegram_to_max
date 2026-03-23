const { config } = require('./config');
const { sendMessageToChannel } = require('./max_api');
const {
  getCrosspostChannel,
  isCrosspostDuplicate,
  logCrosspostPending,
  logCrosspostPosted,
  logCrosspostFailed,
} = require('./crosspost_db');

// Escape special HTML characters in plain text segments
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Convert Telegram message entities to MAX-compatible HTML.
// Telegram entity offsets/lengths are in UTF-16 code units.
// JS strings are UTF-16 internally, so we use raw string indices directly.
function telegramEntitiesToMarkdown(text, entities) {
  if (!entities || entities.length === 0) return escapeHtml(text);

  // Pass 1: collect text_link skip ranges first (needed to filter markers below)
  const skipRanges = []; // { start, end, replacement }
  for (const e of entities) {
    if (e.type === 'text_link') {
      const visibleText = escapeHtml(text.slice(e.offset, e.offset + e.length));
      const url = e.url.replace(/"/g, '&quot;');
      skipRanges.push({ start: e.offset, end: e.offset + e.length, replacement: `<a href="${url}">${visibleText}</a>` });
    }
  }

  const insideSkip = (pos) => skipRanges.some(r => pos >= r.start && pos < r.end);

  // Pass 2: collect formatting markers, skipping those that overlap skip ranges or cover only whitespace
  const markers = []; // { pos, open, str }
  for (const e of entities) {
    const start = e.offset;
    const end = e.offset + e.length;
    let openStr, closeStr;
    switch (e.type) {
      case 'bold':          openStr = '<b>';    closeStr = '</b>';    break;
      case 'italic':        openStr = '<i>';    closeStr = '</i>';    break;
      case 'underline':     openStr = '<u>';    closeStr = '</u>';    break;
      case 'strikethrough': openStr = '<s>';    closeStr = '</s>';    break;
      case 'code':          openStr = '<code>'; closeStr = '</code>'; break;
      case 'pre':           openStr = '<pre>';  closeStr = '</pre>';  break;
      default: continue;
    }

    // Skip if the entire entity range is whitespace-only
    if (text.slice(start, end).trim() === '') continue;

    // If the entity range is fully covered by a skip range, drop both markers
    const fullyCovered = skipRanges.some(r => r.start <= start && end <= r.end);
    if (fullyCovered) continue;

    // Trim trailing whitespace from the close marker position so that
    // bold/italic ranges ending with spaces/newlines don't produce "text **"
    let effectiveEnd = end;
    while (effectiveEnd > start && /\s/.test(text[effectiveEnd - 1])) effectiveEnd--;

    if (!insideSkip(start)) markers.push({ pos: start, open: true, str: openStr });
    if (!insideSkip(effectiveEnd) && closeStr !== '') markers.push({ pos: effectiveEnd, open: false, str: closeStr });
  }

  let result = '';
  for (let pos = 0; pos < text.length; pos++) {
    const skip = skipRanges.find(r => pos >= r.start && pos < r.end);
    if (skip) {
      if (pos === skip.start) result += skip.replacement;
      continue;
    }

    const closing = markers.filter(m => !m.open && m.pos === pos).reverse();
    const opening = markers.filter(m => m.open && m.pos === pos);
    for (const m of closing) result += m.str;
    for (const m of opening) result += m.str;

    result += escapeHtml(text[pos]);
  }

  // Flush closing markers at end of string
  const closing = markers.filter(m => !m.open && m.pos === text.length).reverse();
  for (const m of closing) result += m.str;

  return result;
}

// Get Telegram file URL from file_path
function tgFileUrl(filePath) {
  return `https://api.telegram.org/file/bot${config.telegramBotToken}/${filePath}`;
}

// Build MAX attachments array from a single Telegram message
async function buildAttachments(msg, bot) {
  const attachments = [];

  if (msg.photo) {
    const photo = msg.photo[msg.photo.length - 1];
    try {
      const file = await bot.telegram.getFile(photo.file_id);
      attachments.push({ type: 'image', payload: { url: tgFileUrl(file.file_path) } });
    } catch (e) {
      console.error('crosspost: failed to get photo file', e.message);
    }
  } else if (msg.video) {
    try {
      const file = await bot.telegram.getFile(msg.video.file_id);
      attachments.push({ type: 'video', payload: { url: tgFileUrl(file.file_path) } });
    } catch (e) {
      console.error('crosspost: failed to get video file', e.message);
    }
  } else if (msg.animation) {
    try {
      const file = await bot.telegram.getFile(msg.animation.file_id);
      attachments.push({ type: 'video', payload: { url: tgFileUrl(file.file_path) } });
    } catch (e) {
      console.error('crosspost: failed to get animation file', e.message);
    }
  } else if (msg.document) {
    try {
      const file = await bot.telegram.getFile(msg.document.file_id);
      attachments.push({ type: 'file', payload: { url: tgFileUrl(file.file_path), name: msg.document.file_name || 'file' } });
    } catch (e) {
      console.error('crosspost: failed to get document file', e.message);
    }
  } else if (msg.link_preview_options?.url && /\.(jpe?g|png|gif|webp)(\?.*)?$/i.test(msg.link_preview_options.url)) {
    attachments.push({ type: 'image', payload: { url: msg.link_preview_options.url } });
  }

  return attachments;
}

// Handle a single channel post
async function handleChannelPost(msg, bot) {
  const tgChannelId = String(msg.chat.id);
  const tgMessageId = msg.message_id;

  const mapping = getCrosspostChannel(tgChannelId);
  if (!mapping) return;

  if (isCrosspostDuplicate({ tgChannelId, tgMessageId })) {
    console.log(`crosspost: duplicate skipped ${tgChannelId}/${tgMessageId}`);
    return;
  }

  const rawText = msg.text || msg.caption || '';
  if (mapping.skip_keyword && rawText.includes(mapping.skip_keyword)) {
    console.log(`crosspost: skipped by keyword "${mapping.skip_keyword}" ${tgChannelId}/${tgMessageId}`);
    return;
  }

  const maxChannelId = mapping.max_channel_id;
  logCrosspostPending({ tgChannelId, tgMessageId, maxChannelId });

  try {
    const entities = msg.entities || msg.caption_entities || [];
    const text = telegramEntitiesToMarkdown(rawText, entities);
    const attachments = await buildAttachments(msg, bot);

    const result = await sendMessageToChannel({ chatId: maxChannelId, text, attachments });
    const maxMessageId = result?.message?.body?.mid || result?.body?.mid || result?.mid || null;
    logCrosspostPosted({ tgChannelId, tgMessageId, maxMessageId });
    console.log(`crosspost: posted ${tgChannelId}/${tgMessageId} → MAX ${maxChannelId}`);
  } catch (err) {
    logCrosspostFailed({ tgChannelId, tgMessageId, errorText: err.message });
    console.error(`crosspost: failed ${tgChannelId}/${tgMessageId}`, err.message);
  }
}

// Handle an album (multiple messages with same media_group_id)
async function handleAlbum(messages, bot) {
  if (!messages.length) return;
  const first = messages[0];
  const tgChannelId = String(first.chat.id);
  const tgMessageId = first.message_id;

  const mapping = getCrosspostChannel(tgChannelId);
  if (!mapping) return;

  if (isCrosspostDuplicate({ tgChannelId, tgMessageId })) return;

  const captionMsg = messages.find(m => m.caption) || first;
  const rawText = captionMsg.caption || '';
  if (mapping.skip_keyword && rawText.includes(mapping.skip_keyword)) {
    console.log(`crosspost: album skipped by keyword "${mapping.skip_keyword}" ${tgChannelId}/${tgMessageId}`);
    return;
  }

  const maxChannelId = mapping.max_channel_id;
  logCrosspostPending({ tgChannelId, tgMessageId, maxChannelId });

  try {
    const entities = captionMsg.caption_entities || [];
    const text = telegramEntitiesToMarkdown(rawText, entities);

    const attachments = [];
    for (const msg of messages) {
      const atts = await buildAttachments(msg, bot);
      attachments.push(...atts);
    }

    const result = await sendMessageToChannel({ chatId: maxChannelId, text, attachments });
    const maxMessageId = result?.message?.body?.mid || result?.body?.mid || result?.mid || null;
    logCrosspostPosted({ tgChannelId, tgMessageId, maxMessageId });
    console.log(`crosspost: album posted ${tgChannelId}/${tgMessageId} (${messages.length} items) → MAX ${maxChannelId}`);
  } catch (err) {
    logCrosspostFailed({ tgChannelId, tgMessageId, errorText: err.message });
    console.error(`crosspost: album failed ${tgChannelId}/${tgMessageId}`, err.message);
  }
}

module.exports = { handleChannelPost, handleAlbum };
