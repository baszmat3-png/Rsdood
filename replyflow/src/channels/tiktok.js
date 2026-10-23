import crypto from 'node:crypto';

/**
 * تيك توك: لا توجد واجهة عامة مفتوحة للرد على التعليقات والرسائل لكل الحسابات.
 * لذلك تعمل المنصة هنا بأسلوب "جسر" مرن:
 *  - الاستقبال: أي نظام معتمد لديك (واجهة شريك رسمية، أو أداة أتمتة) يرسل الأحداث إلى
 *    POST /webhook/tiktok/:accountId بصيغة JSON موحّدة.
 *  - الإرسال: تُرسل المنصة أمر الرد إلى عنوان (outbound_url) تحدده في إعدادات الحساب،
 *    ليُنفّذه نظامك المعتمد.
 */

export function parseTikTok(body) {
  const list = Array.isArray(body.events) ? body.events : [body];
  return list
    .filter((e) => e && e.text && e.user_id && (e.kind === 'comment' || e.kind === 'message'))
    .map((e) => ({
      kind: e.kind, channel: 'tiktok', postId: e.post_id ? String(e.post_id) : '', commentId: e.comment_id ? String(e.comment_id) : '',
      userId: String(e.user_id), userName: e.user_name || '', text: String(e.text),
    }));
}

async function push(account, payload) {
  let extra = {};
  try { extra = JSON.parse(account.extra || '{}'); } catch { /* تجاهل */ }
  if (!extra.outbound_url) return { ok: false, error: 'لم يُحدَّد عنوان الإرسال (outbound_url) لحساب تيك توك' };
  const body = JSON.stringify(payload);
  const headers = { 'content-type': 'application/json' };
  if (extra.outbound_secret) headers['x-signature'] = crypto.createHmac('sha256', extra.outbound_secret).update(body).digest('hex');
  const r = await fetch(extra.outbound_url, { method: 'POST', headers, body, signal: AbortSignal.timeout(20000) });
  return r.ok ? { ok: true } : { ok: false, error: `HTTP ${r.status}` };
}

export const tiktok = {
  replyToComment: (account, ev, text) => push(account, { action: 'reply_comment', post_id: ev.postId, comment_id: ev.commentId, text }),
  privateReply: (account, ev, text) => push(account, { action: 'private_message', user_id: ev.userId, comment_id: ev.commentId, text }),
  sendMessage: (account, ev, text) => push(account, { action: 'private_message', user_id: ev.userId, text }),
};
