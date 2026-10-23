// اختبار شامل سريع: يشغّل الخادم على قاعدة مؤقتة ويتحقق من المسارات الأساسية.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'replyflow-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.ADMIN_PASSWORD = 'test-pass-123';
process.env.APP_SECRET = 'appsecret';
delete process.env.ANTHROPIC_API_KEY;

const { server } = await import('../server.js');
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
let cookie = '';
const api = async (method, url, body, headers = {}) => {
  const r = await fetch(base + url, {
    method, headers: { 'content-type': 'application/json', cookie, ...headers }, body: body ? JSON.stringify(body) : undefined,
  });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
};
const ok = (name) => console.log('  ✓', name);

// المصادقة
assert.equal((await api('GET', '/api/overview')).status, 401); ok('الواجهة محمية');
assert.equal((await api('POST', '/api/login', { password: 'x' })).status, 401); ok('رفض كلمة مرور خاطئة');
assert.equal((await api('POST', '/api/login', { password: 'test-pass-123' })).status, 200); ok('تسجيل الدخول');

// الإعدادات
await api('PUT', '/api/settings', { business_name: 'متجر الندى', business_details: 'عباية سوداء 45 ألف دينار. التوصيل لكل المحافظات.' });
const st = (await api('GET', '/api/settings')).data;
assert.equal(st.business_name, 'متجر الندى');
assert.equal(st.ai_key, undefined); ok('الإعدادات (المفاتيح لا تُعاد)');

// حملتان: عامة ومنشور محدد
const general = (await api('POST', '/api/campaigns', { name: 'كل المنشورات', scope: 'all', keywords: 'سعر, كم, تفاصيل', public_mode: 'template', public_text: 'أهلاً {name}، أرسلنا لك التفاصيل 🌷', dm_mode: 'template', dm_text: 'مرحباً {name}\n{details}', dm_details: 'السعر 45 ألف' })).data;
const post = (await api('POST', '/api/campaigns', { name: 'منشور العباية', scope: 'post', post_id: 'POST_1', keywords: 'سعر', public_mode: 'template', public_text: 'خاص العباية {name}', dm_mode: 'template', dm_text: 'تفاصيل العباية: {details}', dm_details: 'عباية 45 ألف' })).data;
assert.ok(general.id && post.id); ok('إنشاء الحملات');
assert.equal((await api('POST', '/api/campaigns', { name: 'x', scope: 'post' })).status, 400); ok('التحقق من صحة الحملة');

// المحاكاة: الحملة المحددة بمنشور تتغلب على العامة، وتطبيع العربية (السِّعر / سعر)
let s = (await api('POST', '/api/simulate', { kind: 'comment', channel: 'facebook', post_id: 'POST_1', user_name: 'سارة', text: 'كم السِّعر؟' })).data;
assert.equal(s.campaign.id, post.id); assert.match(s.publicReply, /سارة/); assert.match(s.dmReply, /عباية 45/); ok('أولوية حملة المنشور + تطبيع النص');
s = (await api('POST', '/api/simulate', { kind: 'comment', channel: 'facebook', post_id: 'OTHER', text: 'بكم؟ تفاصيل' })).data;
assert.equal(s.campaign.id, general.id); ok('الحملة العامة لبقية المنشورات');
s = (await api('POST', '/api/simulate', { kind: 'comment', channel: 'facebook', post_id: 'OTHER', text: 'منشور جميل' })).data;
assert.equal(s.status, 'no_match'); ok('تجاهل التعليقات غير المطابقة');
s = (await api('POST', '/api/simulate', { kind: 'message', channel: 'telegram', text: 'أريد التحدث مع موظف' })).data;
assert.equal(s.status, 'handoff'); ok('التحويل إلى موظف بشري');

// ويب هوك ميتا: توقيع + تحقق + منع التكرار
const acc = (await api('POST', '/api/accounts', { channel: 'facebook', name: 'صفحة الندى', external_id: 'PAGE1', token: '' })).data;
assert.ok(acc.id);
const hook = (cid) => JSON.stringify({ object: 'page', entry: [{ id: 'PAGE1', changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: cid, post_id: 'POST_1', parent_id: 'POST_1', from: { id: 'U1', name: 'علي' }, message: 'السعر؟' } }] }] });
const sign = (b) => 'sha256=' + crypto.createHmac('sha256', 'appsecret').update(b).digest('hex');
let b = hook('C1');
let r = await fetch(base + '/webhook/meta', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=bad' }, body: b });
assert.equal(r.status, 401); ok('رفض توقيع ميتا غير صحيح');
for (let i = 0; i < 2; i++) {
  r = await fetch(base + '/webhook/meta', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(b) }, body: b });
  assert.equal(r.status, 200);
}
const sets = (await api('GET', '/api/settings')).data;
await api('PUT', '/api/settings', { delay_min: '0', delay_max: '0' });
await new Promise((r2) => setTimeout(r2, 400));
const ev = (await api('GET', '/api/events?limit=50')).data.filter((e) => !e.simulated && e.comment_id === 'C1');
assert.equal(ev.length, 1); ok('معالجة ويب هوك مرة واحدة فقط (منع التكرار)');
const verify = (await api('GET', '/api/info')).data.verifyToken;
r = await fetch(`${base}/webhook/meta?hub.mode=subscribe&hub.verify_token=${verify}&hub.challenge=777`);
assert.equal(await r.text(), '777'); ok('التحقق من ويب هوك ميتا');
r = await fetch(`${base}/webhook/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=777`);
assert.equal(r.status, 403); ok('رفض رمز تحقق خاطئ');

const ov = (await api('GET', '/api/overview')).data;
assert.equal(ov.days.length, 14); ok('نظرة عامة');
r = await fetch(base + '/../../etc/passwd'); assert.notEqual(r.status, 200);
r = await fetch(base + '/%2e%2e/server.js'); assert.equal(r.status, 404); ok('حماية مسارات الملفات');

console.log('\nنجحت كل الاختبارات');
server.close();
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(0);
