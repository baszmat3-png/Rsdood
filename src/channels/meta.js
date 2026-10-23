import crypto from 'node:crypto';

const HOST = process.env.GRAPH_HOST || 'https://graph.facebook.com';
const VERSION = process.env.GRAPH_VERSION || 'v21.0';

async function graph(path, token, body) {
  const r = await fetch(`${HOST}/${VERSION}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: j.error?.message || `HTTP ${r.status}` };
  return { ok: true, data: j };
}

/** التحقق من توقيع ميتا (X-Hub-Signature-256) باستخدام App Secret. */
export function verifySignature(rawBody, header, appSecret) {
  if (!appSecret) return true;
  if (!header || !header.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const given = header.slice(7);
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** تحويل حمولة ويب هوك ميتا (فيسبوك/إنستغرام/واتساب) إلى أحداث موحّدة. */
export function parseMeta(body) {
  const out = [];
  for (const entry of body.entry || []) {
    if (body.object === 'page') {
      for (const ch of entry.changes || []) {
        const v = ch.value || {};
        if (ch.field !== 'feed' || v.item !== 'comment' || v.verb !== 'add') continue;
        if (v.from?.id === entry.id) continue; // تعليقات الصفحة نفسها
        if (v.parent_id && v.post_id && v.parent_id !== v.post_id) continue; // ردود على ردود
        out.push({ kind: 'comment', channel: 'facebook', externalId: entry.id, postId: v.post_id, commentId: v.comment_id, userId: v.from?.id, userName: v.from?.name, text: v.message || '' });
      }
      for (const m of entry.messaging || []) {
        if (m.message?.text && !m.message.is_echo) out.push({ kind: 'message', channel: 'facebook', externalId: entry.id, userId: m.sender?.id, userName: '', text: m.message.text });
      }
    } else if (body.object === 'instagram') {
      for (const ch of entry.changes || []) {
        const v = ch.value || {};
        if (ch.field !== 'comments') continue;
        if (v.from?.id === entry.id) continue;
        if (v.parent_id) continue;
        out.push({ kind: 'comment', channel: 'instagram', externalId: entry.id, postId: v.media?.id, commentId: v.id, userId: v.from?.id, userName: v.from?.username, text: v.text || '' });
      }
      for (const m of entry.messaging || []) {
        if (m.message?.text && !m.message.is_echo) out.push({ kind: 'message', channel: 'instagram', externalId: entry.id, userId: m.sender?.id, userName: '', text: m.message.text });
      }
    } else if (body.object === 'whatsapp_business_account') {
      for (const ch of entry.changes || []) {
        const v = ch.value || {};
        const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name || '']));
        for (const m of v.messages || []) {
          if (m.type !== 'text') continue;
          out.push({ kind: 'message', channel: 'whatsapp', externalId: v.metadata?.phone_number_id, userId: m.from, userName: names[m.from] || '', text: m.text?.body || '' });
        }
      }
    }
  }
  return out.filter((e) => e.text && e.userId);
}

function makeMetaAdapter(platform) {
  return {
    // رد علني تحت التعليق
    async replyToComment(account, ev, text) {
      const path = platform === 'instagram' ? `${ev.commentId}/replies` : `${ev.commentId}/comments`;
      return graph(path, account.token, { message: text });
    },
    // رد خاص على التعليق (Private Reply): مسموح مرة واحدة لكل تعليق وخلال 7 أيام
    async privateReply(account, ev, text) {
      return graph(`${account.external_id}/messages`, account.token, { recipient: { comment_id: ev.commentId }, message: { text } });
    },
    // رد على رسالة وردت إلى الصندوق
    async sendMessage(account, ev, text) {
      return graph(`${account.external_id}/messages`, account.token, { recipient: { id: ev.userId }, messaging_type: 'RESPONSE', message: { text } });
    },
  };
}

export const facebook = makeMetaAdapter('facebook');
export const instagram = makeMetaAdapter('instagram');

export const whatsapp = {
  async replyToComment() { return { ok: true }; },
  async privateReply() { return { ok: true }; },
  async sendMessage(account, ev, text) {
    return graph(`${account.external_id}/messages`, account.token, { messaging_product: 'whatsapp', to: ev.userId, type: 'text', text: { body: text } });
  },
};
