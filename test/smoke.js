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

// خادم Graph وهمي لاختبار الربط بفيسبوك
import http from 'node:http';
const subs = [];
const graphMock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('content-type', 'application/json');
  if (u.pathname.endsWith('/oauth/access_token')) return res.end(JSON.stringify({ access_token: 'USERTOKEN' }));
  if (u.pathname.endsWith('/me/accounts')) return res.end(JSON.stringify({ data: [{ id: 'P1', name: 'صفحة الندى', access_token: 'PAGETOKEN', instagram_business_account: { id: 'IG1', username: 'nada' } }] }));
  if (u.pathname.endsWith('/subscribed_apps')) { subs.push(u.pathname); return res.end('{"success":true}'); }
  res.statusCode = 404; res.end('{}');
});
await new Promise((r) => graphMock.listen(0, r));
process.env.GRAPH_HOST = `http://127.0.0.1:${graphMock.address().port}`;

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

// الربط بفيسبوك
assert.equal((await api('POST', '/api/meta/connect')).status, 400); ok('الربط بفيسبوك يتطلب App ID');
await api('PUT', '/api/settings', { fb_app_id: '123456' });
const cb = await fetch(base + '/auth/meta/callback?state=bad&code=x').then((r) => r.text());
assert.ok(cb.includes('meta_error')); ok('رفض state غير صالح في العودة من فيسبوك');
assert.equal((await api('POST', '/api/meta/connect')).status, 400); // الموقع محلي وليس HTTPS
await api('PUT', '/api/settings', { public_url: 'https://example.com' });
const c2 = await api('POST', '/api/meta/connect');
assert.equal(c2.status, 200);
const au = new URL(c2.data.url);
assert.equal(au.searchParams.get('client_id'), '123456');
assert.equal(au.searchParams.get('redirect_uri'), 'https://example.com/auth/meta/callback');
const okPage = await fetch(base + '/auth/meta/callback?code=abc&state=' + au.searchParams.get('state')).then((r) => r.text());
const tok = /meta_pick=([a-f0-9]+)/.exec(okPage)?.[1]; assert.ok(tok, okPage);
const pend = (await api('GET', '/api/meta/pending?token=' + tok)).data;
assert.equal(pend.channel, 'facebook'); assert.ok(pend.items.length >= 1 && pend.items.every((i) => i.channel === 'facebook'));
assert.equal((await api('GET', '/api/accounts')).data.length, 0); // لا ربط قبل الاختيار
const pk = await api('POST', '/api/meta/pick', { token: tok, keys: pend.items.map((i) => i.key) });
assert.equal(pk.status, 200); assert.equal(pk.data.connected, 1); assert.equal(subs.length, 1);
const c3 = await api('POST', '/api/meta/connect', { channel: 'instagram' });
const st3 = new URL(c3.data.url).searchParams.get('state');
const tok2 = /meta_pick=([a-f0-9]+)/.exec(await fetch(base + '/auth/meta/callback?code=abc&state=' + st3).then((r) => r.text()))[1];
const pend2 = (await api('GET', '/api/meta/pending?token=' + tok2)).data;
assert.ok(pend2.items.length === 1 && pend2.items[0].channel === 'instagram');
await api('POST', '/api/meta/pick', { token: tok2, keys: pend2.items.map((i) => i.key) });
const accs = (await api('GET', '/api/accounts')).data;
assert.deepEqual(accs.map((a) => a.channel).sort(), ['facebook', 'instagram']);
assert.ok(accs.every((a) => a.hasToken));
assert.equal((await api('POST', '/api/meta/pick', { token: tok, keys: [] })).status, 404); // لا إعادة استخدام
const replay = await fetch(base + '/auth/meta/callback?code=abc&state=' + au.searchParams.get('state')).then((r) => r.text());
assert.ok(replay.includes('meta_error')); ok('الربط: تسجيل الدخول ثم اختيار الحسابات لكل قناة ومنع إعادة الاستخدام');
await api('PUT', '/api/settings', { public_url: '' });

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

// نماذج الحجز والطلبات + تصدير Excel
const fres = await api('POST', '/api/forms', { name: 'حجز', kind: 'booking', triggers: 'حجز, موعد', fields: [
  { label: 'ما اسمك الكامل؟', type: 'text' }, { label: 'رقم هاتفك؟', type: 'phone' }, { label: 'أي يوم؟', type: 'date' },
  { label: 'نوع الخدمة؟', type: 'choice', options: ['كشف', 'متابعة'] }, { label: 'ملاحظات', type: 'text', optional: true }] });
assert.equal(fres.status, 201); ok('إنشاء نموذج حجز');
assert.equal((await api('POST', '/api/forms', { name: 'x', fields: [{ label: 'q', type: 'choice', options: ['a'] }] })).status, 400); ok('رفض نموذج غير صالح');
const { handleFormTurn } = await import('../src/forms.js');
const U = { channel: 'facebook', userId: 'u-form-1', userName: 'سارة', account: null };
const turn = (text) => handleFormTurn({ ...U, text }, false)?.reply;
assert.match(turn('أريد حجز'), /ما اسمك الكامل/);
assert.match(turn('سارة علي'), /رقم هاتفك/);
assert.match(turn('abc'), /الرقم غير صحيح/);
assert.match(turn('٠٧٧٠١٢٣٤٥٦٧'), /أي يوم/);
assert.match(turn('غداً'), /نوع الخدمة/);
assert.match(turn('9'), /اختر رقماً/);
assert.match(turn('2'), /ملاحظات/);
const doneMsg = turn('تخطي');
assert.match(doneMsg, /تم تسجيل طلبك رقم 1/); assert.match(doneMsg, /07701234567/);
assert.equal(handleFormTurn({ ...U, text: 'مرحبا' }, false), null); ok('محادثة الحجز كاملة مع التحقق من الأجوبة');
const subList = (await api('GET', '/api/submissions')).data;
assert.equal(subList.length, 1); assert.equal(subList[0].answers['رقم هاتفك'], '07701234567'); assert.equal(subList[0].answers['نوع الخدمة'], 'متابعة'); ok('حفظ الطلب');
assert.equal((await api('PUT', '/api/submissions/1', { status: 'confirmed' })).status, 200);
const xr = await fetch(base + '/api/submissions.xlsx?form_id=1', { headers: { cookie } });
const xb = Buffer.from(await xr.arrayBuffer());
assert.equal(xr.status, 200); assert.equal(xb.subarray(0, 2).toString(), 'PK'); fs.writeFileSync(path.join(tmp, 'out.xlsx'), xb);
ok('تصدير Excel');
assert.equal((await api('POST', '/api/simulate', { kind: 'message', text: 'حجز', sim_user: 'zz', channel: 'facebook' })).data.dmReply.includes('ما اسمك'), true); ok('التجربة تبدأ النموذج');

// المسارات والأزرار والكلمات المفتاحية والقوالب
const tpls = (await api('GET', '/api/flow-templates')).data;
assert.ok(tpls.length >= 5); ok('قوالب المسارات متاحة');
const tf = await api('POST', '/api/flows/from-template', { template: 'booking' });
assert.equal(tf.status, 201); const flowId = tf.data.id;
const formsNow = (await api('GET', '/api/forms')).data;
assert.ok(formsNow.some((f) => f.name === 'حجز موعد' && f.id > 1)); ok('اعتماد قالب ينشئ المسار والنموذج');
assert.equal((await api('POST', '/api/flows', { name: 'x', nodes: { a: { type: 'message', text: 'hi', buttons: [{ title: 'b', kind: 'node', to: 'nope' }] } } })).status, 400); ok('رفض زر يشير إلى عقدة غير موجودة');
assert.equal((await api('POST', '/api/keywords', { match: 'contains', words: 'قائمة, menu', flow_id: flowId })).status, 201);
const sim = async (body) => (await api('POST', '/api/simulate', { kind: 'message', channel: 'facebook', sim_user: 'flowu', ...body })).data;
let fr = await sim({ text: 'عندي سؤال، افتح القائمة' });
assert.ok(fr.replies[0].buttons.length === 3 && fr.replies[0].buttons[0].payload.startsWith('fm:')); ok('الكلمة المفتاحية تشغّل المسار بأزرار');
const svc = fr.replies[0].buttons.find((b) => b.title.includes('الخدمات'));
fr = await sim({ text: svc.title, payload: svc.payload });
assert.match(fr.replies[0].text, /الخدمات والأسعار/); ok('زر ينتقل إلى عقدة');
const bk = fr.replies[0].buttons.find((b) => b.payload.startsWith('fm:'));
fr = await sim({ text: bk.title, payload: bk.payload });
assert.match(fr.dmReply, /ما اسمك الكامل/); ok('زر يبدأ نموذج الحجز');
// كلمة ساخنة تقطع النموذج
await api('POST', '/api/keywords', { match: 'is', words: 'ايقاف', reply: 'تم الإيقاف', hotword: true });
fr = await sim({ text: 'إيقاف' });
assert.equal(fr.dmReply, 'تم الإيقاف'); ok('الكلمة الساخنة لها الأولوية');
// عقدة تحويل لموظف تُوقف البوت حتى كلمة الاستئناف
const hf = await api('POST', '/api/flows', { name: 'موظف', start: 'h', nodes: { h: { type: 'handoff', text: 'سيرد عليك موظف' } } });
await api('POST', '/api/keywords', { match: 'is', words: 'موظف الان', flow_id: hf.data.id });
await api('POST', '/api/keywords', { match: 'resume', words: 'ابدأ', reply: 'عدنا' });
fr = await sim({ text: 'موظف الان', sim_user: 'pz' }); assert.equal(fr.paused, true);
fr = await sim({ text: 'مرحبا', sim_user: 'pz' }); assert.equal(fr.status, 'skipped'); ok('عقدة التحويل توقف البوت');
fr = await sim({ text: 'ابدأ', sim_user: 'pz' }); assert.equal(fr.dmReply, 'عدنا'); ok('كلمة الاستئناف');
// إجابة برقم عندما لا تدعم القناة الأزرار
const fl = await import('../src/flows.js');
const NU = { channel: 'tiktok', userId: 'n1', userName: 'x' };
fl.saveMenu(NU, [{ title: 'أ', payload: `f:${flowId}:services` }, { title: 'ب', payload: `f:${flowId}:address` }]);
const nr = fl.flowKeywords({ ...NU, text: '٢', type: 'text' });
assert.match(nr.msgs[0].text, /العنوان/); ok('الإجابة برقم الخيار');
assert.match(fl.numberedText({ text: 'اختر', buttons: [{ title: 'أ', payload: 'x' }, { title: 'رابط', url: 'https://a.b' }] }), /1- أ[\s\S]*رابط: https:\/\/a\.b/);
// تحويل أحداث ميتا: الأزرار والأنواع
const { parseMeta } = await import('../src/channels/meta.js');
const pm = parseMeta({ object: 'page', entry: [{ id: 'P', messaging: [{ sender: { id: 'u' }, postback: { title: 'خدمات', payload: 'f:1:services' } }, { sender: { id: 'u' }, message: { text: 'خدمات', quick_reply: { payload: 'f:1:prices' } } }, { sender: { id: 'u' }, message: { sticker_id: 5 } }] }] });
assert.deepEqual(pm.map((e) => [e.payload, e.type]), [['f:1:services', 'text'], ['f:1:prices', 'text'], ['', 'sticker']]);
const wm = parseMeta({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: 'W' }, messages: [{ from: '9647', type: 'interactive', interactive: { button_reply: { id: 'f:1:x', title: 'زر' } } }, { from: '9647', type: 'image' }] } }] }] });
assert.deepEqual(wm.map((e) => [e.payload || '', e.type]), [['f:1:x', 'text'], ['', 'image']]); ok('تحليل أزرار ماسنجر وإنستغرام وواتساب والأنواع');

console.log('\nنجحت كل الاختبارات');
server.close();
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(0);
