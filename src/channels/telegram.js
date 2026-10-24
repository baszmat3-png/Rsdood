async function api(token, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) return { ok: false, error: j.description || `HTTP ${r.status}` };
  return { ok: true, data: j.result };
}

export function setWebhook(token, url, secret) {
  return api(token, 'setWebhook', { url, secret_token: secret, allowed_updates: ['message', 'callback_query'] });
}

/** تحويل تحديث تيليغرام إلى حدث موحّد. الرسائل في المجموعات تُعامل كتعليقات. */
export const answerCallback = (token, id) => api(token, 'answerCallbackQuery', { callback_query_id: id });

export function parseTelegram(update) {
  const cq = update.callback_query;
  if (cq?.data && cq.message?.chat?.type === 'private' && !cq.from?.is_bot) {
    const btn = (cq.message.reply_markup?.inline_keyboard || []).flat().find((b) => b.callback_data === cq.data);
    const nm = [cq.from?.first_name, cq.from?.last_name].filter(Boolean).join(' ') || cq.from?.username || '';
    return [{ kind: 'message', channel: 'telegram', userId: String(cq.from.id), userName: nm, text: btn?.text || '', payload: cq.data, type: 'text', ref: { chatId: cq.message.chat.id }, cbId: cq.id }];
  }
  const m = update.message;
  if (!m || !m.text || m.from?.is_bot) return [];
  const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || m.from?.username || '';
  if (m.chat.type === 'private') {
    return [{ kind: 'message', channel: 'telegram', userId: String(m.from.id), userName: name, text: m.text, ref: { chatId: m.chat.id } }];
  }
  // منشور القناة المرتبط: يظهر في مجموعة النقاش كرسالة مُحوّلة
  const postId = String(m.reply_to_message?.forward_origin?.message_id ?? m.reply_to_message?.message_id ?? m.message_thread_id ?? '');
  return [{
    kind: 'comment', channel: 'telegram', postId, commentId: `${m.chat.id}:${m.message_id}`,
    userId: String(m.from.id), userName: name, text: m.text, ref: { chatId: m.chat.id, messageId: m.message_id },
  }];
}

export const telegram = {
  async sendMenu(account, ev, msg) {
    const chat = ev.ref?.chatId ?? ev.userId;
    if (msg.image) { const r = await api(account.token, 'sendPhoto', { chat_id: chat, photo: msg.image }); if (!r.ok) return r; }
    const rows = (msg.buttons || []).map((b) => [b.url ? { text: b.title, url: b.url } : { text: b.title, callback_data: b.payload.slice(0, 64) }]);
    return api(account.token, 'sendMessage', { chat_id: chat, text: msg.text || '👇', ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {}) });
  },
  async replyToComment(account, ev, text) {
    return api(account.token, 'sendMessage', { chat_id: ev.ref.chatId, text, reply_to_message_id: ev.ref.messageId });
  },
  // لا يستطيع البوت مراسلة شخص إلا إذا بدأ المحادثة معه أولاً
  async privateReply(account, ev, text) {
    return api(account.token, 'sendMessage', { chat_id: ev.userId, text });
  },
  async sendMessage(account, ev, text) {
    return api(account.token, 'sendMessage', { chat_id: ev.ref?.chatId ?? ev.userId, text });
  },
};
