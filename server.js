import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { all, get, run, getSetting, setSetting } from './src/db.js';
import { processComment, processMessage } from './src/engine.js';
import { aiConfigured } from './src/ai.js';
import { parseMeta, verifySignature } from './src/channels/meta.js';
import { parseTelegram, setWebhook } from './src/channels/telegram.js';
import { parseTikTok } from './src/channels/tiktok.js';
import { CHANNELS } from './src/channels/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);
const TZ = Number(process.env.TZ_OFFSET_HOURS ?? 3) * 3600_000;

/* ---------- تهيئة أولية ---------- */

if (!getSetting('verify_token')) setSetting('verify_token', crypto.randomBytes(16).toString('hex'));

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
function checkHash(pw, stored) {
  const [salt, hex] = String(stored).split(':');
  if (!salt || !hex) return false;
  const a = Buffer.from(hex, 'hex');
  const b = crypto.scryptSync(pw, salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
if (!process.env.ADMIN_PASSWORD && !getSetting('admin_hash')) {
  const pw = crypto.randomBytes(9).toString('base64url');
  setSetting('admin_hash', hashPassword(pw));
  console.log('\n==============================================');
  console.log(' كلمة مرور لوحة التحكم (تظهر مرة واحدة فقط):');
  console.log(' ' + pw);
  console.log('==============================================\n');
}
function passwordOk(pw) {
  if (process.env.ADMIN_PASSWORD) return safeEqual(pw, process.env.ADMIN_PASSWORD);
  return checkHash(pw, getSetting('admin_hash'));
}

/* ---------- الجلسات وتحديد المحاولات ---------- */

const sessions = new Map();
const attempts = new Map();
const SESSION_MS = 12 * 3600_000;

function newSession() {
  const t = crypto.randomBytes(32).toString('hex');
  sessions.set(t, Date.now() + SESSION_MS);
  return t;
}
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, v.join('=')]));
}
function authed(req) {
  const t = cookies(req).sid;
  const exp = t && sessions.get(t);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(t); return false; }
  return true;
}

/* ---------- أدوات HTTP ---------- */

const SECURITY = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY, ...headers });
  res.end(body);
}
function json(res, status, obj, headers = {}) {
  send(res, status, JSON.stringify(obj), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
}
function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('الحمولة كبيرة جداً'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const parseJson = (buf) => { try { return JSON.parse(buf.toString('utf8') || '{}'); } catch { return null; } };

const baseUrl = () => (process.env.PUBLIC_URL || getSetting('public_url') || `http://localhost:${PORT}`).replace(/\/$/, '');
const SECRET_KEYS = ['ai_key', 'app_secret'];
const SETTING_KEYS = [
  'business_name', 'business_about', 'business_details', 'tone', 'handoff_words', 'handoff_reply', 'fallback_reply',
  'ai_provider', 'ai_model', 'ai_base', 'delay_min', 'delay_max', 'hourly_cap', 'public_url', ...SECRET_KEYS,
];
const DEFAULTS = {
  tone: 'ودّي ومهني', ai_provider: 'anthropic', ai_model: 'claude-sonnet-5-5', delay_min: '3', delay_max: '12', hourly_cap: '200',
  handoff_words: 'موظف, شخص حقيقي, مدير, شكوى, اتصل بي',
  handoff_reply: 'تم تحويل رسالتك إلى فريقنا وسيتواصل معك أحد المختصين في أقرب وقت 🌷',
};

/* ---------- تحويل الصفوف للواجهة ---------- */

function publicAccount(a) {
  let extra = {};
  try { extra = JSON.parse(a.extra || '{}'); } catch { /* تجاهل */ }
  const b = baseUrl();
  const webhook = a.channel === 'telegram' ? `${b}/webhook/telegram/${a.id}` : a.channel === 'tiktok' ? `${b}/webhook/tiktok/${a.id}` : `${b}/webhook/meta`;
  return {
    id: a.id, channel: a.channel, name: a.name, external_id: a.external_id, active: !!a.active, hasToken: !!a.token,
    outbound_url: extra.outbound_url || '', hasOutboundSecret: !!extra.outbound_secret,
    inboundSecret: a.channel === 'tiktok' ? extra.secret : undefined, webhook,
  };
}
const publicCampaign = (c) => ({ ...c, active: !!c.active, once_per_user: !!c.once_per_user });

function validateCampaign(b) {
  const errs = [];
  const name = String(b.name || '').trim();
  if (!name) errs.push('اسم الحملة مطلوب');
  const channel = b.channel === 'any' || CHANNELS[b.channel] ? b.channel : 'any';
  const scope = b.scope === 'post' ? 'post' : 'all';
  const post_id = String(b.post_id || '').trim();
  if (scope === 'post' && !post_id) errs.push('معرّف المنشور مطلوب عند اختيار منشور محدد');
  const mode = (v) => (['off', 'template', 'ai'].includes(v) ? v : 'ai');
  const public_mode = mode(b.public_mode);
  const dm_mode = mode(b.dm_mode);
  if (public_mode === 'off' && dm_mode === 'off') errs.push('فعّل الرد العلني أو الرسالة الخاصة على الأقل');
  const account_id = b.account_id ? Number(b.account_id) : null;
  return {
    errs,
    v: {
      name, channel, account_id, scope, post_id: scope === 'post' ? post_id : '', keywords: String(b.keywords || '').trim(),
      public_mode, public_text: String(b.public_text || '').trim(), dm_mode, dm_text: String(b.dm_text || '').trim(),
      dm_details: String(b.dm_details || '').trim(), once_per_user: b.once_per_user === false ? 0 : 1, active: b.active === false ? 0 : 1,
    },
  };
}

/* ---------- معالجة الأحداث الواردة (ويب هوك) ---------- */

function dispatch(ev, account) {
  const full = { ...ev, account };
  const p = ev.kind === 'comment' ? processComment(full) : processMessage(full);
  p.catch((e) => console.error('[engine]', e));
}

/* ---------- المسارات ---------- */

async function handleWebhooks(req, res, url) {
  if (url.pathname === '/webhook/meta') {
    if (req.method === 'GET') {
      const ok = url.searchParams.get('hub.mode') === 'subscribe' && safeEqual(url.searchParams.get('hub.verify_token') || '', getSetting('verify_token'));
      return ok ? send(res, 200, url.searchParams.get('hub.challenge') || '') : send(res, 403, 'forbidden');
    }
    if (req.method === 'POST') {
      const raw = await readBody(req);
      const secret = process.env.APP_SECRET || getSetting('app_secret');
      if (!verifySignature(raw, req.headers['x-hub-signature-256'], secret)) return send(res, 401, 'bad signature');
      const body = parseJson(raw);
      send(res, 200, 'EVENT_RECEIVED');
      if (!body) return;
      for (const ev of parseMeta(body)) {
        const account = get('SELECT * FROM accounts WHERE channel = ? AND external_id = ? AND active = 1', ev.channel, String(ev.externalId));
        if (account) dispatch(ev, account);
      }
      return;
    }
  }
  let m = url.pathname.match(/^\/webhook\/(telegram|tiktok)\/(\d+)$/);
  if (m && req.method === 'POST') {
    const account = get('SELECT * FROM accounts WHERE id = ? AND channel = ? AND active = 1', Number(m[2]), m[1]);
    if (!account) return send(res, 404, 'not found');
    let extra = {};
    try { extra = JSON.parse(account.extra || '{}'); } catch { /* تجاهل */ }
    const given = m[1] === 'telegram' ? req.headers['x-telegram-bot-api-secret-token'] : req.headers['x-webhook-secret'];
    if (!extra.secret || !safeEqual(given || '', extra.secret)) return send(res, 401, 'unauthorized');
    const body = parseJson(await readBody(req));
    send(res, 200, 'ok');
    if (!body) return;
    const events = m[1] === 'telegram' ? parseTelegram(body) : parseTikTok(body);
    for (const ev of events) dispatch(ev, account);
    return;
  }
  return send(res, 404, 'not found');
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method;

  if (p === '/api/login' && method === 'POST') {
    const ip = req.socket.remoteAddress || '';
    const a = attempts.get(ip) || { n: 0, until: 0 };
    if (a.until > Date.now()) return json(res, 429, { error: 'محاولات كثيرة. حاول بعد قليل.' });
    const body = parseJson(await readBody(req)) || {};
    if (!passwordOk(String(body.password || ''))) {
      a.n += 1;
      if (a.n >= 5) { a.until = Date.now() + 5 * 60_000; a.n = 0; }
      attempts.set(ip, a);
      return json(res, 401, { error: 'كلمة المرور غير صحيحة' });
    }
    attempts.delete(ip);
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return json(res, 200, { ok: true }, { 'set-cookie': `sid=${newSession()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}` });
  }
  if (p === '/api/logout' && method === 'POST') {
    sessions.delete(cookies(req).sid);
    return json(res, 200, { ok: true }, { 'set-cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  if (!authed(req)) return json(res, 401, { error: 'يلزم تسجيل الدخول' });

  if (method !== 'GET' && !String(req.headers['content-type'] || '').includes('application/json')) {
    return json(res, 415, { error: 'نوع المحتوى غير مدعوم' });
  }
  const body = method === 'GET' || method === 'DELETE' ? {} : parseJson(await readBody(req));
  if (body === null) return json(res, 400, { error: 'JSON غير صالح' });

  if (p === '/api/info' && method === 'GET') {
    return json(res, 200, {
      baseUrl: baseUrl(), metaWebhook: `${baseUrl()}/webhook/meta`, verifyToken: getSetting('verify_token'),
      aiConfigured: aiConfigured(), appSecretSet: !!(process.env.APP_SECRET || getSetting('app_secret')),
      passwordFromEnv: !!process.env.ADMIN_PASSWORD, channels: CHANNELS,
    });
  }

  if (p === '/api/overview' && method === 'GET') {
    const since = Date.now() - 14 * 86400_000;
    const rows = all('SELECT ts, kind, status, public_status, dm_status FROM events WHERE simulated = 0 AND ts > ?', since);
    const day = (ts) => Math.floor((ts + TZ) / 86400_000);
    const today = day(Date.now());
    const days = [];
    for (let i = 13; i >= 0; i--) days.push({ d: today - i, comments: 0, messages: 0 });
    const idx = new Map(days.map((x, i) => [x.d, i]));
    const k = { comments: 0, messages: 0, publicSent: 0, dmSent: 0, failed: 0, handoff: 0 };
    for (const r of rows) {
      const i = idx.get(day(r.ts));
      if (i !== undefined) days[i][r.kind === 'comment' ? 'comments' : 'messages'] += 1;
      if (r.ts > Date.now() - 7 * 86400_000) {
        if (r.kind === 'comment') k.comments += 1; else k.messages += 1;
        if (r.public_status === 'sent') k.publicSent += 1;
        if (r.dm_status === 'sent') k.dmSent += 1;
        if (r.status === 'failed') k.failed += 1;
        if (r.status === 'handoff') k.handoff += 1;
      }
    }
    const recent = all(`SELECT e.*, c.name AS campaign_name FROM events e LEFT JOIN campaigns c ON c.id = e.campaign_id WHERE e.simulated = 0 ORDER BY e.id DESC LIMIT 6`);
    const counts = {
      campaigns: get('SELECT COUNT(*) n FROM campaigns WHERE active = 1').n,
      accounts: get('SELECT COUNT(*) n FROM accounts WHERE active = 1').n,
    };
    return json(res, 200, {
      kpi: k, counts, days: days.map((x) => ({ date: new Date(x.d * 86400_000).toISOString().slice(5, 10), comments: x.comments, messages: x.messages })),
      recent, aiConfigured: aiConfigured(), businessReady: !!getSetting('business_name') && !!getSetting('business_details'),
    });
  }

  /* الحملات */
  if (p === '/api/campaigns' && method === 'GET') return json(res, 200, all('SELECT * FROM campaigns ORDER BY id DESC').map(publicCampaign));
  if (p === '/api/campaigns' && method === 'POST') {
    const { errs, v } = validateCampaign(body);
    if (errs.length) return json(res, 400, { error: errs.join('، ') });
    const r = run(
      `INSERT INTO campaigns(name,channel,account_id,scope,post_id,keywords,public_mode,public_text,dm_mode,dm_text,dm_details,once_per_user,active,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      v.name, v.channel, v.account_id, v.scope, v.post_id, v.keywords, v.public_mode, v.public_text, v.dm_mode, v.dm_text, v.dm_details, v.once_per_user, v.active, Date.now(),
    );
    return json(res, 201, publicCampaign(get('SELECT * FROM campaigns WHERE id = ?', r.lastInsertRowid)));
  }
  let m = p.match(/^\/api\/campaigns\/(\d+)$/);
  if (m) {
    const id = Number(m[1]);
    if (!get('SELECT 1 x FROM campaigns WHERE id = ?', id)) return json(res, 404, { error: 'الحملة غير موجودة' });
    if (method === 'DELETE') { run('DELETE FROM campaigns WHERE id = ?', id); return json(res, 200, { ok: true }); }
    if (method === 'PUT') {
      const cur = get('SELECT * FROM campaigns WHERE id = ?', id);
      const { errs, v } = validateCampaign({ ...cur, ...body });
      if (errs.length) return json(res, 400, { error: errs.join('، ') });
      run(
        `UPDATE campaigns SET name=?,channel=?,account_id=?,scope=?,post_id=?,keywords=?,public_mode=?,public_text=?,dm_mode=?,dm_text=?,dm_details=?,once_per_user=?,active=? WHERE id=?`,
        v.name, v.channel, v.account_id, v.scope, v.post_id, v.keywords, v.public_mode, v.public_text, v.dm_mode, v.dm_text, v.dm_details, v.once_per_user, v.active, id,
      );
      return json(res, 200, publicCampaign(get('SELECT * FROM campaigns WHERE id = ?', id)));
    }
  }

  /* الحسابات */
  if (p === '/api/accounts' && method === 'GET') return json(res, 200, all('SELECT * FROM accounts ORDER BY id DESC').map(publicAccount));
  if (p === '/api/accounts' && method === 'POST') {
    if (!CHANNELS[body.channel]) return json(res, 400, { error: 'قناة غير معروفة' });
    const name = String(body.name || '').trim();
    if (!name) return json(res, 400, { error: 'اسم الحساب مطلوب' });
    const extra = { secret: crypto.randomBytes(24).toString('hex') };
    if (body.channel === 'tiktok') {
      extra.outbound_url = String(body.outbound_url || '').trim();
      if (body.outbound_secret) extra.outbound_secret = String(body.outbound_secret);
    }
    const r = run('INSERT INTO accounts(channel,name,external_id,token,extra,active,created_at) VALUES(?,?,?,?,?,1,?)', body.channel, name, String(body.external_id || '').trim(), String(body.token || '').trim(), JSON.stringify(extra), Date.now());
    return json(res, 201, publicAccount(get('SELECT * FROM accounts WHERE id = ?', r.lastInsertRowid)));
  }
  m = p.match(/^\/api\/accounts\/(\d+)(\/telegram-webhook)?$/);
  if (m) {
    const id = Number(m[1]);
    const acc = get('SELECT * FROM accounts WHERE id = ?', id);
    if (!acc) return json(res, 404, { error: 'الحساب غير موجود' });
    if (m[2] && method === 'POST') {
      if (acc.channel !== 'telegram') return json(res, 400, { error: 'هذا الإجراء لحسابات تيليغرام فقط' });
      if (!acc.token) return json(res, 400, { error: 'أدخل توكن البوت أولاً' });
      if (!baseUrl().startsWith('https://')) return json(res, 400, { error: 'تيليغرام يتطلب عنوان HTTPS عاماً. اضبط PUBLIC_URL أو "العنوان العام" في الإعدادات.' });
      const extra = JSON.parse(acc.extra || '{}');
      const r = await setWebhook(acc.token, `${baseUrl()}/webhook/telegram/${id}`, extra.secret);
      return r.ok ? json(res, 200, { ok: true }) : json(res, 502, { error: `رفض تيليغرام الطلب: ${r.error}` });
    }
    if (method === 'DELETE') { run('DELETE FROM accounts WHERE id = ?', id); return json(res, 200, { ok: true }); }
    if (method === 'PUT') {
      const extra = JSON.parse(acc.extra || '{}');
      if (acc.channel === 'tiktok') {
        if (body.outbound_url !== undefined) extra.outbound_url = String(body.outbound_url).trim();
        if (body.outbound_secret) extra.outbound_secret = String(body.outbound_secret);
      }
      run('UPDATE accounts SET name=?, external_id=?, token=?, extra=?, active=? WHERE id=?',
        String(body.name ?? acc.name).trim() || acc.name,
        body.external_id !== undefined ? String(body.external_id).trim() : acc.external_id,
        body.token ? String(body.token).trim() : acc.token,
        JSON.stringify(extra), body.active === false ? 0 : 1, id);
      return json(res, 200, publicAccount(get('SELECT * FROM accounts WHERE id = ?', id)));
    }
  }

  /* الإعدادات */
  if (p === '/api/settings' && method === 'GET') {
    const out = {};
    for (const k of SETTING_KEYS) {
      if (SECRET_KEYS.includes(k)) out[`${k}_set`] = !!getSetting(k);
      else out[k] = getSetting(k, DEFAULTS[k] ?? '');
    }
    return json(res, 200, out);
  }
  if (p === '/api/settings' && method === 'PUT') {
    for (const k of SETTING_KEYS) {
      if (body[k] === undefined) continue;
      if (SECRET_KEYS.includes(k) && body[k] === '') continue; // الحقل الفارغ = لا تغيير
      setSetting(k, String(body[k]).slice(0, 8000));
    }
    if (body.clear_ai_key) setSetting('ai_key', '');
    return json(res, 200, { ok: true });
  }
  if (p === '/api/password' && method === 'PUT') {
    if (process.env.ADMIN_PASSWORD) return json(res, 400, { error: 'كلمة المرور مضبوطة من متغير البيئة ADMIN_PASSWORD' });
    if (!passwordOk(String(body.current || ''))) return json(res, 401, { error: 'كلمة المرور الحالية غير صحيحة' });
    const next = String(body.next || '');
    if (next.length < 8) return json(res, 400, { error: 'كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف' });
    setSetting('admin_hash', hashPassword(next));
    return json(res, 200, { ok: true });
  }

  /* السجل */
  if (p === '/api/events' && method === 'GET') {
    const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);
    const where = [];
    const params = [];
    const kind = url.searchParams.get('kind');
    const status = url.searchParams.get('status');
    if (kind === 'comment' || kind === 'message') { where.push('e.kind = ?'); params.push(kind); }
    if (status) { where.push('e.status = ?'); params.push(status); }
    const rows = all(
      `SELECT e.*, c.name AS campaign_name, a.name AS account_name FROM events e
       LEFT JOIN campaigns c ON c.id = e.campaign_id LEFT JOIN accounts a ON a.id = e.account_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.id DESC LIMIT ?`, ...params, limit);
    return json(res, 200, rows);
  }

  /* المحاكاة */
  if (p === '/api/simulate' && method === 'POST') {
    const text = String(body.text || '').trim();
    if (!text) return json(res, 400, { error: 'اكتب نص التعليق أو الرسالة' });
    const ev = {
      channel: CHANNELS[body.channel] ? body.channel : 'facebook', postId: String(body.post_id || '').trim(), commentId: '',
      userId: `sim-${crypto.randomBytes(4).toString('hex')}`, userName: String(body.user_name || 'أحمد').trim(), text, account: null,
    };
    const result = body.kind === 'message' ? await processMessage(ev, { simulate: true }) : await processComment(ev, { simulate: true });
    return json(res, 200, { ...result, aiConfigured: aiConfigured() });
  }

  return json(res, 404, { error: 'غير موجود' });
}

/* ---------- الملفات الثابتة ---------- */

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'not found');
  send(res, 200, fs.readFileSync(file), { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
}

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/webhook/')) return await handleWebhooks(req, res, url);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET') return send(res, 405, 'method not allowed');
    return serveStatic(req, res, url);
  } catch (e) {
    console.error('[server]', e);
    if (!res.headersSent) json(res, e.status || 500, { error: e.status === 413 ? e.message : 'خطأ داخلي في الخادم' });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => console.log(`ReplyFlow يعمل على المنفذ ${PORT} — ${baseUrl()}`));
}
