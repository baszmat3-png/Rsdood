const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');

const E = process.env;
const G = 'https://graph.facebook.com/v21.0';
const pool = new Pool({ connectionString: E.DATABASE_URL, ssl: E.DATABASE_URL && !E.DATABASE_URL.includes('localhost') ? { rejectUnauthorized: false } : false });
const q = (sql, p) => pool.query(sql, p).then(r => r.rows);
const app = express();
app.set('trust proxy', 1);
app.get('/health', (req, res) => res.send('ok'));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DEFAULTS = {
  commentReply: 'شكراً لتعليقك 🌹 راسلناك على الخاص',
  notifyWhatsApp: '',
  autoLike: true, autoPublicReply: true, autoPrivateReply: true
};

async function init() {
  await q(`CREATE TABLE IF NOT EXISTS harvest(id SERIAL PRIMARY KEY, channel TEXT, post_id TEXT, comment_id TEXT, user_id TEXT, name TEXT, text TEXT, commented_at TIMESTAMPTZ, sent BOOLEAN DEFAULT false, UNIQUE(channel, comment_id))`);
  await q(`CREATE TABLE IF NOT EXISTS plans(id SERIAL PRIMARY KEY, name TEXT, price NUMERIC DEFAULT 0, days INT DEFAULT 30)`);
  await q(`CREATE TABLE IF NOT EXISTS subs(id SERIAL PRIMARY KEY, channel TEXT, contact TEXT, name TEXT, plan_id INT, plan_name TEXT, price NUMERIC DEFAULT 0, start_at TIMESTAMPTZ, end_at TIMESTAMPTZ, status TEXT DEFAULT 'active', ts TIMESTAMPTZ DEFAULT now())`);
  await q(`CREATE TABLE IF NOT EXISTS bot_users(channel TEXT, contact TEXT, name TEXT, phone TEXT, last_seen TIMESTAMPTZ, created TIMESTAMPTZ DEFAULT now(), PRIMARY KEY(channel, contact))`);
  await q(`CREATE TABLE IF NOT EXISTS broadcasts(id SERIAL PRIMARY KEY, name TEXT, channel TEXT, node TEXT, template TEXT, total INT DEFAULT 0, sent INT DEFAULT 0, failed INT DEFAULT 0, status TEXT, ts TIMESTAMPTZ DEFAULT now())`);
  await q(`CREATE TABLE IF NOT EXISTS admins(username TEXT PRIMARY KEY, pass TEXT, role TEXT)`);
  await q(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS perms JSONB`).catch(() => {});
  await q(`CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v JSONB)`);
  await q(`CREATE TABLE IF NOT EXISTS messages(id SERIAL PRIMARY KEY, channel TEXT, contact TEXT, name TEXT, dir TEXT, text TEXT, ts TIMESTAMPTZ DEFAULT now())`);
  await q(`CREATE TABLE IF NOT EXISTS bot_sessions(channel TEXT, contact TEXT, name TEXT, node TEXT, data JSONB DEFAULT '{}', paused BOOLEAN DEFAULT false, PRIMARY KEY(channel, contact))`);
  await q(`CREATE TABLE IF NOT EXISTS leads(id SERIAL PRIMARY KEY, channel TEXT, contact TEXT, name TEXT, answers JSONB, ts TIMESTAMPTZ DEFAULT now())`);
}
const getSettings = async () => {
  const r = await q(`SELECT v FROM settings WHERE k='main'`);
  return { ...DEFAULTS, ...(r[0] ? r[0].v : {}) };
};

// ---------- Meta API ----------
async function api(url, body, token) {
  const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}access_token=${token}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) console.error('API error', url, JSON.stringify(j));
  j.__ok = r.ok;
  return j;
}
async function log(channel, contact, name, dir, text) {
  await q(`INSERT INTO messages(channel,contact,name,dir,text) VALUES($1,$2,$3,$4,$5)`, [channel, contact, name || '', dir, text]);
}
// send a DM. opts.commentId => private reply to a comment
async function send(channel, to, text, name, opts = {}) {
  if (channel === 'fb') {
    await api(`${G}/me/messages`, { recipient: opts.commentId ? { comment_id: opts.commentId } : { id: to }, messaging_type: 'RESPONSE', message: { text } }, E.FB_PAGE_TOKEN);
  } else if (channel === 'ig') {
    await api(`${G}/${E.IG_USER_ID}/messages`, { recipient: opts.commentId ? { comment_id: opts.commentId } : { id: to }, message: { text } }, E.FB_PAGE_TOKEN);
  } else if (channel === 'wa') {
    await api(`${G}/${E.WA_PHONE_ID}/messages`, { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }, E.WA_TOKEN);
  }
  await log(channel, to, name, 'out', text);
}

// ---------- Flow engine ----------
const SEED = {
  start: 'start',
  fallback: 'start',
  keywords: [{ match: 'contains', word: 'تسجيل', node: 'reg1' }, { match: 'contains', word: 'عنوان', node: 'address' }, { match: 'resume', word: 'ابدأ,start', node: 'start' }],
  nodes: {
    start: { type: 'msg', text: 'أهلاً {name} 👋 وسهلاً بك! اختر من القائمة:', buttons: [{ title: 'الأقسام', to: 'sections' }, { title: 'عنوان الكلية', to: 'address' }, { title: 'التسجيل', to: 'reg1' }] },
    sections: { type: 'msg', text: 'الأقسام المتوفرة:\n1- قسم أ\n2- قسم ب', next: '', buttons: [{ title: 'رجوع', to: 'start' }] },
    address: { type: 'msg', text: 'عنوان الكلية: اكتب العنوان هنا', buttons: [{ title: 'رجوع', to: 'start' }] },
    reg1: { type: 'ask', text: 'ما اسمك الكامل؟', key: 'الاسم', next: 'reg2' },
    reg2: { type: 'ask', text: 'ما رقم هاتفك؟', key: 'الهاتف', next: 'reg3' },
    reg3: { type: 'ask', text: 'ما المحافظة؟', key: 'المحافظة', next: 'done' },
    done: { type: 'end', text: 'شكراً لك! استلمنا معلوماتك وراح نتواصل وياك قريباً ✅' }
  }
};
const getFlow = async () => { const r = await q(`SELECT v FROM settings WHERE k='flow'`); return r[0] ? r[0].v : SEED; };
const getSes = async (ch, c) => (await q(`SELECT * FROM bot_sessions WHERE channel=$1 AND contact=$2`, [ch, c]))[0] || { data: {}, node: null, paused: false };
const setSes = (ch, c, name, node, data, paused) => q(
  `INSERT INTO bot_sessions(channel,contact,name,node,data,paused) VALUES($1,$2,$3,$4,$5,$6)
   ON CONFLICT(channel,contact) DO UPDATE SET name=COALESCE(NULLIF($3,''),bot_sessions.name), node=$4, data=$5, paused=$6`,
  [ch, c, name || '', node, JSON.stringify(data), !!paused]);

async function raw(ch, to, message, opts = {}) {
  const recipient = opts.commentId ? { comment_id: opts.commentId } : { id: to };
  const url = ch === 'fb' ? `${G}/me/messages` : `${G}/${E.IG_USER_ID}/messages`;
  const body = ch === 'fb' ? { recipient, messaging_type: 'RESPONSE', message } : { recipient, message };
  const r = await api(url, body, E.FB_PAGE_TOKEN);
  if (opts.t && r.__ok === false) opts.t.fail = true;
  return r;
}
async function sendNode(ch, to, node, name, opts = {}) {
  const text = (node.text || '').replace(/\{name\}/g, name || '').trim() || '.';
  const btns = node.buttons || [], pb = btns.filter(b => !b.url), ub = btns.filter(b => b.url);
  const urlTxt = ub.length ? '\n' + ub.map(b => `${b.title}: ${b.url}`).join('\n') : '';
  if (ch === 'wa') {
    const send1 = async m => { const r = await api(`${G}/${E.WA_PHONE_ID}/messages`, { messaging_product: 'whatsapp', to, ...m }, E.WA_TOKEN); if (opts.t && r.__ok === false) opts.t.fail = true; return r; };
    if (node.image && (pb.length || !text)) await send1({ type: 'image', image: { link: node.image } });
    if (pb.length && pb.length <= 3) await send1({ type: 'interactive', interactive: { type: 'button', body: { text: text + urlTxt }, action: { buttons: pb.map(b => ({ type: 'reply', reply: { id: 'go:' + b.to, title: b.title.slice(0, 20) } })) } } });
    else if (pb.length) await send1({ type: 'interactive', interactive: { type: 'list', body: { text: text + urlTxt }, action: { button: 'اختر', sections: [{ title: 'القائمة', rows: pb.slice(0, 10).map(b => ({ id: 'go:' + b.to, title: b.title.slice(0, 24) })) }] } } });
    else if (node.image) await send1({ type: 'image', image: { link: node.image, caption: text + urlTxt } });
    else await send1({ type: 'text', text: { body: text + urlTxt } });
  } else {
    const img = () => node.image && raw(ch, to, { attachment: { type: 'image', payload: { url: node.image } } }, { t: opts.t });
    let msg;
    if (ch === 'fb' && ub.length && !pb.length) msg = { attachment: { type: 'template', payload: { template_type: 'button', text: text.slice(0, 640), buttons: ub.slice(0, 3).map(b => ({ type: 'web_url', url: b.url, title: b.title.slice(0, 20) })) } } };
    else { msg = { text: text + urlTxt }; if (pb.length) msg.quick_replies = pb.slice(0, 13).map(b => ({ content_type: 'text', title: b.title.slice(0, 20), payload: 'go:' + b.to })); }
    if (!opts.commentId) await img();
    await raw(ch, to, msg, opts);
    if (opts.commentId) await img();
  }
  await log(ch, to, name, 'out', text);
  return !(opts.t && opts.t.fail);
}
async function goNode(ch, c, name, id, opts = {}, depth = 0) {
  const flow = await getFlow(), node = flow.nodes[id];
  if (!node) return;
  const ses = await getSes(ch, c);
  await sendNode(ch, c, node, name, opts);
  if (node.type === 'ask') return setSes(ch, c, name, id, ses.data, false);
  if (node.type === 'handoff') return setSes(ch, c, name, null, ses.data, true);
  await setSes(ch, c, name, null, ses.data, false);
  if (node.type === 'end') {
    const s = await getSettings();
    await q(`INSERT INTO leads(channel,contact,name,answers) VALUES($1,$2,$3,$4)`, [ch, c, name || ses.name, JSON.stringify(ses.data)]);
    await setSes(ch, c, name, null, {}, false);
    if (s.notifyWhatsApp && E.WA_TOKEN) {
      const body = `📥 عميل جديد (${ch}) ${name || ''}\n` + Object.entries(ses.data).map(([k, v]) => `${k}: ${v}`).join('\n');
      await sendNode('wa', s.notifyWhatsApp, { text: body }, 'مدير');
    }
  } else if (node.next && !(node.buttons || []).length && depth < 10) await goNode(ch, c, name, node.next, {}, depth + 1);
}
const norm = x => (x || '').toLowerCase().trim();
function kwMatch(k, text, type) {
  const m = k.match || 'contains';
  if (['image', 'sticker', 'audio'].includes(m)) return type === m;
  const t = norm(text), words = (k.word || '').split(/[,،]/).map(norm).filter(Boolean);
  return words.some(w => m === 'is' || m === 'resume' ? t === w : m === 'contains' ? t.includes(w) : m === 'word' ? t.split(/[\s،,.!?؟]+/).includes(w) : m === 'starts' ? t.startsWith(w) : false);
}
async function handleIncoming(ch, c, name, text, payload, type = 'text') {
  await log(ch, c, name, 'in', text || payload || `[${type}]`);
  await q(`INSERT INTO bot_users(channel,contact,name,phone,last_seen) VALUES($1,$2,$3,$4,now())
           ON CONFLICT(channel,contact) DO UPDATE SET name=COALESCE(NULLIF($3,''),bot_users.name), last_seen=now()`, [ch, c, name || '', ch === 'wa' ? c : '']);
  const flow = await getFlow(), ses = await getSes(ch, c);
  if (payload && payload.startsWith('go:')) return goNode(ch, c, name, payload.slice(3));
  const kws = (flow.keywords || []).filter(k => kwMatch(k, text, type));
  if (ses.paused) {
    const r = kws.find(k => k.match === 'resume');
    if (!r && !/^(\/start|ابدأ|start)$/i.test(text || '')) return;
    await setSes(ch, c, name, null, ses.data, false);
    return goNode(ch, c, name, (r && r.node) || flow.start);
  }
  const n = ses.node && flow.nodes[ses.node];
  if (n && n.type === 'ask' && type === 'text') {
    await setSes(ch, c, name, null, { ...ses.data, [n.key || n.id]: text }, false);
    return n.next ? goNode(ch, c, name, n.next) : undefined;
  }
  const kw = kws.find(k => k.match !== 'resume');
  if (kw) return goNode(ch, c, name, kw.node || flow.start);
  if (type === 'text') return goNode(ch, c, name, flow.fallback || flow.start);
}
async function handleComment(ch, commentId, userId, name, text) {
  const s = await getSettings();
  await log(ch, userId, name, 'in', `💬 تعليق: ${text}`);
  if (ch === 'fb') {
    if (s.autoLike) await api(`${G}/${commentId}/likes`, {}, E.FB_PAGE_TOKEN);
    if (s.autoPublicReply) await api(`${G}/${commentId}/comments`, { message: s.commentReply }, E.FB_PAGE_TOKEN);
  } else if (s.autoPublicReply) await api(`${G}/${commentId}/replies`, { message: s.commentReply }, E.FB_PAGE_TOKEN);
  if (s.autoPrivateReply) { const f = await getFlow(); await setSes(ch, userId, name, null, {}, false); await goNode(ch, userId, name, f.start, { commentId }); }
}
async function sendManual(ch, to, text) { await sendNode(ch, to, { text }, ''); await setSes(ch, to, '', null, (await getSes(ch, to)).data, true); }

// ---------- Webhook ----------
app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === E.VERIFY_TOKEN) return res.send(req.query['hub.challenge']);
  res.sendStatus(403);
});
app.post('/webhook', (req, res) => {
  res.sendStatus(200);
  const b = req.body;
  (async () => {
    for (const en of b.entry || []) {
      if (b.object === 'page' || b.object === 'instagram') {
        const ch = b.object === 'page' ? 'fb' : 'ig';
        for (const m of en.messaging || []) {
          if (m.postback) await handleIncoming(ch, m.sender.id, '', m.postback.title, m.postback.payload);
          else if (m.message && !m.message.is_echo) {
            const at = m.message.attachments && m.message.attachments[0];
            const type = m.message.sticker_id ? 'sticker' : at && ['image', 'audio'].includes(at.type) ? at.type : 'text';
            await handleIncoming(ch, m.sender.id, '', m.message.text || '', m.message.quick_reply && m.message.quick_reply.payload, type);
          }
        }
        for (const c of en.changes || []) {
          const v = c.value || {};
          if (ch === 'fb' && c.field === 'feed' && v.item === 'comment' && v.verb === 'add' && v.from && v.from.id !== en.id)
            await handleComment('fb', v.comment_id, v.from.id, v.from.name, v.message || '');
          if (ch === 'ig' && c.field === 'comments' && v.from && v.from.id !== en.id)
            await handleComment('ig', v.id, v.from.id, v.from.username, v.text || '');
        }
      } else if (b.object === 'whatsapp_business_account') {
        for (const c of en.changes || []) {
          const v = c.value || {};
          const nm = (v.contacts && v.contacts[0] && v.contacts[0].profile && v.contacts[0].profile.name) || '';
          for (const m of v.messages || []) {
            if (m.type === 'text') await handleIncoming('wa', m.from, nm, m.text.body);
            else if (['image', 'sticker', 'audio'].includes(m.type)) await handleIncoming('wa', m.from, nm, '', null, m.type);
            else if (m.type === 'interactive') { const r = m.interactive.button_reply || m.interactive.list_reply || {}; await handleIncoming('wa', m.from, nm, r.title, r.id); }
          }
        }
      }
    }
  })().catch(e => console.error(e));
});

// ---------- Admin API ----------
const sign = d => crypto.createHmac('sha256', E.SECRET || 'x').update(d).digest('hex');
const mkToken = (u, r) => { const p = Buffer.from(JSON.stringify({ u, r, e: Date.now() + 7 * 864e5 })).toString('base64url'); return p + '.' + sign(p); };
function readToken(t) {
  if (!t) return null; const [p, sg] = t.split('.');
  if (!sg || sign(p) !== sg) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url')); return o.e > Date.now() ? o : null; } catch (e) { return null; }
}
const PERMS = ['inbox', 'users', 'leads', 'stats', 'subs', 'flow', 'broadcast', 'settings', 'admins'];
const DEFAULT_AGENT = ['inbox', 'users', 'leads'];
const auth = async (req, res, next) => {
  try {
    const u = readToken(req.headers['x-token'] || req.query.t); if (!u) return res.sendStatus(401);
    req.user = u; req.perms = PERMS;
    if (u.u !== 'admin' || u.r !== 'owner') {
      const a = (await q(`SELECT role, perms FROM admins WHERE username=$1`, [u.u]))[0];
      if (!a) return res.sendStatus(401);
      req.user.r = a.role; req.perms = a.role === 'owner' ? PERMS : (a.perms || DEFAULT_AGENT);
    }
    next();
  } catch (e) { res.sendStatus(500); }
};
const can = p => (req, res, next) => req.perms.includes(p) ? next() : res.sendStatus(403);
const wrap = f => (req, res) => f(req, res).catch(e => { console.error(e); res.status(500).json({ error: e.message }); });
const hash = (pw, salt = crypto.randomBytes(8).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
const fails = new Map();
const tsEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
app.post('/api/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const f = fails.get(req.ip) || { n: 0, t: Date.now() };
  if (Date.now() - f.t > 15 * 60e3) { f.n = 0; f.t = Date.now(); }
  if (f.n >= 10) return res.status(429).json({ error: 'محاولات كثيرة، حاول بعد 15 دقيقة' });
  const bad = () => { f.n++; fails.set(req.ip, f); res.status(401).json({ error: 'bad login' }); };
  if (E.ADMIN_PASSWORD && (username || 'admin') === 'admin' && tsEq(password || '', E.ADMIN_PASSWORD)) return res.json({ token: mkToken('admin', 'owner'), role: 'owner', perms: PERMS });
  const a = (await q(`SELECT * FROM admins WHERE username=$1`, [username || '']))[0];
  if (a && tsEq(hash(password || '', a.pass.split(':')[0]), a.pass)) return res.json({ token: mkToken(a.username, a.role), role: a.role, perms: a.role === 'owner' ? PERMS : (a.perms || DEFAULT_AGENT) });
  bad();
}));
app.get('/api/admins', auth, can('admins'), wrap(async (req, res) => res.json((await q(`SELECT username, role, perms FROM admins ORDER BY username`)).map(a => ({ ...a, perms: a.role === 'owner' ? PERMS : (a.perms || DEFAULT_AGENT) })))));
app.post('/api/admins', auth, can('admins'), wrap(async (req, res) => {
  const { username, password, role } = req.body;
  const perms = (req.body.perms || []).filter(p => PERMS.includes(p));
  const r = role === 'owner' ? 'owner' : 'agent';
  if (!username || username === 'admin') return res.status(400).json({ error: 'اسم مستخدم غير صالح (admin محجوز للمدير الأساسي)' });
  const ex = (await q(`SELECT 1 FROM admins WHERE username=$1`, [username]))[0];
  if (!password && ex) { await q(`UPDATE admins SET role=$2, perms=$3 WHERE username=$1`, [username, r, JSON.stringify(perms)]); return res.json({ ok: true }); }
  if (!password || password.length < 6) return res.status(400).json({ error: 'كلمة المرور 6 أحرف فأكثر' });
  await q(`INSERT INTO admins(username,pass,role,perms) VALUES($1,$2,$3,$4) ON CONFLICT(username) DO UPDATE SET pass=$2, role=$3, perms=$4`, [username, hash(password), r, JSON.stringify(perms)]);
  res.json({ ok: true });
}));
app.delete('/api/admins/:u', auth, can('admins'), wrap(async (req, res) => { await q(`DELETE FROM admins WHERE username=$1`, [req.params.u]); res.json({ ok: true }); }));

app.get('/api/conversations', auth, can('inbox'), wrap(async (req, res) => {
  res.json(await q(`SELECT DISTINCT ON (channel,contact) channel, contact, name, text, dir, ts FROM messages ORDER BY channel, contact, ts DESC`)
    .then(r => r.sort((a, b) => new Date(b.ts) - new Date(a.ts))));
}));
app.get('/api/messages', auth, can('inbox'), wrap(async (req, res) => {
  res.json(await q(`SELECT dir,text,ts FROM messages WHERE channel=$1 AND contact=$2 ORDER BY ts`, [req.query.channel, req.query.contact]));
}));
app.post('/api/send', auth, can('inbox'), wrap(async (req, res) => {
  const { channel, contact, text } = req.body;
  await sendManual(channel, contact, text);
  res.json({ ok: true });
}));
app.get('/api/settings', auth, can('settings'), wrap(async (req, res) => res.json(await getSettings())));
app.put('/api/settings', auth, can('settings'), wrap(async (req, res) => {
  await q(`INSERT INTO settings(k,v) VALUES('main',$1) ON CONFLICT(k) DO UPDATE SET v=$1`, [JSON.stringify({
    commentReply: String(req.body.commentReply || DEFAULTS.commentReply).slice(0, 500),
    notifyWhatsApp: String(req.body.notifyWhatsApp || '').replace(/\D/g, ''),
    autoLike: !!req.body.autoLike, autoPublicReply: !!req.body.autoPublicReply, autoPrivateReply: !!req.body.autoPrivateReply })]);
  res.json({ ok: true });
}));
app.get('/api/flow', auth, can('flow'), wrap(async (req, res) => res.json(await getFlow())));
app.put('/api/flow', auth, can('flow'), wrap(async (req, res) => {
  await q(`INSERT INTO settings(k,v) VALUES('flow',$1) ON CONFLICT(k) DO UPDATE SET v=$1`, [JSON.stringify(req.body)]);
  res.json({ ok: true });
}));
app.post('/api/resume', auth, can('inbox'), wrap(async (req, res) => {
  await q(`UPDATE bot_sessions SET paused=false WHERE channel=$1 AND contact=$2`, [req.body.channel, req.body.contact]);
  res.json({ ok: true });
}));
app.get('/api/leads', auth, can('leads'), wrap(async (req, res) => res.json(await q(`SELECT * FROM leads ORDER BY ts DESC`))));
app.get('/api/export.xlsx', auth, can('leads'), wrap(async (req, res) => {
  const leads = await q(`SELECT * FROM leads ORDER BY ts DESC`);
  const keys = [...new Set(leads.flatMap(l => Object.keys(l.answers || {})))];
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Leads', { views: [{ rightToLeft: true }] });
  ws.columns = [{ header: 'التاريخ', width: 20 }, { header: 'القناة', width: 10 }, { header: 'الاسم', width: 20 }, ...keys.map(k => ({ header: k, width: 25 }))];
  ws.getRow(1).font = { bold: true };
  leads.forEach(l => ws.addRow([new Date(l.ts).toLocaleString('en-GB'), l.channel, l.name, ...keys.map(k => (l.answers || {})[k] || '')]));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=leads.xlsx');
  await wb.xlsx.write(res); res.end();
}));

// ---------- Bot users ----------
app.get('/api/users', auth, can('users'), wrap(async (req, res) => {
  const page = Math.max(1, +req.query.page || 1), s = `%${req.query.search || ''}%`, ch = ['fb', 'ig', 'wa'].includes(req.query.channel) ? req.query.channel : '';
  const W = `(name ILIKE $1 OR phone ILIKE $1 OR contact ILIKE $1) AND ($2='' OR channel=$2)`;
  const rows = await q(`SELECT channel,contact,name,phone,last_seen FROM bot_users WHERE ${W} ORDER BY last_seen DESC NULLS LAST, created DESC LIMIT 20 OFFSET $3`, [s, ch, (page - 1) * 20]);
  const t = await q(`SELECT count(*)::int n FROM bot_users WHERE ${W}`, [s, ch]);
  res.json({ rows, total: t[0].n });
}));
app.post('/api/users/import', auth, can('users'), wrap(async (req, res) => {
  const us = (req.body.users || []).map(u => ({ ch: ['fb', 'ig', 'wa'].includes(u.channel) ? u.channel : 'wa', n: String(u.name || ''), p: String(u.phone || '').replace(/\D/g, '') })).filter(u => u.p);
  if (us.length) await q(`INSERT INTO bot_users(channel,contact,name,phone) SELECT * FROM unnest($1::text[],$2::text[],$3::text[],$4::text[]) ON CONFLICT(channel,contact) DO UPDATE SET name=COALESCE(NULLIF(EXCLUDED.name,''),bot_users.name)`,
    [us.map(u => u.ch), us.map(u => u.p), us.map(u => u.n), us.map(u => u.p)]);
  res.json({ imported: us.length });
}));
app.delete('/api/users/:ch/:contact', auth, can('users'), wrap(async (req, res) => {
  const a = [req.params.ch, req.params.contact];
  for (const t of ['bot_users', 'bot_sessions', 'messages']) await q(`DELETE FROM ${t} WHERE channel=$1 AND contact=$2`, a);
  res.json({ ok: true });
}));
app.get('/api/users.csv', auth, can('users'), wrap(async (req, res) => {
  const rows = await q(`SELECT name,phone,channel,contact,last_seen FROM bot_users ORDER BY created`);
  const c = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
  res.send('\ufeffname,phone,channel,contact,last_seen\n' + rows.map(r => [r.name, r.phone, r.channel, r.contact, r.last_seen].map(c).join(',')).join('\n'));
}));

// ---------- Broadcasts ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function runBroadcast(id, b) {
  try {
    const flow = await getFlow(), node = flow.nodes[b.node];
    const tpl = b.channel === 'wa' && b.template;
    const users = await q(`SELECT contact,name FROM bot_users WHERE channel=$1 ${tpl ? '' : "AND last_seen > now() - interval '24 hours'"}`, [b.channel]);
    await q(`UPDATE broadcasts SET total=$2 WHERE id=$1`, [id, users.length]);
    let sent = 0, failed = 0;
    for (const u of users) {
      let ok = false;
      try {
        if (tpl) { const r = await api(`${G}/${E.WA_PHONE_ID}/messages`, { messaging_product: 'whatsapp', to: u.contact, type: 'template', template: { name: b.template, language: { code: b.lang || 'ar' } } }, E.WA_TOKEN); ok = r.__ok; if (ok) await log('wa', u.contact, u.name, 'out', `📢 قالب: ${b.template}`); }
        else if (node) ok = await sendNode(b.channel, u.contact, node, u.name, { t: {} });
      } catch (e) { ok = false; }
      ok ? sent++ : failed++;
      if ((sent + failed) % 20 === 0) await q(`UPDATE broadcasts SET sent=$2, failed=$3 WHERE id=$1`, [id, sent, failed]);
      await sleep(60);
    }
    await q(`UPDATE broadcasts SET sent=$2, failed=$3, status='done' WHERE id=$1`, [id, sent, failed]);
  } catch (e) { console.error(e); await q(`UPDATE broadcasts SET status='error' WHERE id=$1`, [id]); }
}
app.get('/api/broadcasts', auth, can('broadcast'), wrap(async (req, res) => res.json(await q(`SELECT * FROM broadcasts ORDER BY id DESC LIMIT 30`))));
app.post('/api/broadcast', auth, can('broadcast'), wrap(async (req, res) => {
  const b = req.body;
  if (!['fb', 'ig', 'wa'].includes(b.channel) || (!b.node && !b.template)) return res.status(400).json({ error: 'بيانات ناقصة' });
  const r = await q(`INSERT INTO broadcasts(name,channel,node,template,status) VALUES($1,$2,$3,$4,'running') RETURNING id`, [b.name || 'بث', b.channel, b.node || '', b.template || '']);
  runBroadcast(r[0].id, b);
  res.json({ id: r[0].id });
}));

// ---------- Statistics ----------
app.get('/api/stats', auth, can('stats'), wrap(async (req, res) => {
  const one = async (sql, p) => (await q(sql, p))[0];
  const days = `generate_series(current_date - 13, current_date, '1 day')::date`;
  const [u, byCh, msgs, newU, leadsD, leadsT, subs, rev, bc] = await Promise.all([
    one(`SELECT count(*)::int total, count(*) FILTER (WHERE last_seen > now() - interval '24 hours')::int d1, count(*) FILTER (WHERE last_seen > now() - interval '7 days')::int d7, count(*) FILTER (WHERE last_seen > now() - interval '30 days')::int d30 FROM bot_users`),
    q(`SELECT channel, count(*)::int n FROM bot_users GROUP BY channel`),
    q(`SELECT d::text day, count(m.*) FILTER (WHERE dir='in')::int inn, count(m.*) FILTER (WHERE dir='out')::int out FROM ${days} d LEFT JOIN messages m ON m.ts::date = d GROUP BY d ORDER BY d`),
    q(`SELECT d::text day, count(b.*)::int n FROM ${days} d LEFT JOIN bot_users b ON b.created::date = d GROUP BY d ORDER BY d`),
    q(`SELECT d::text day, count(l.*)::int n FROM ${days} d LEFT JOIN leads l ON l.ts::date = d GROUP BY d ORDER BY d`),
    one(`SELECT count(*)::int total FROM leads`),
    one(`WITH last AS (SELECT DISTINCT ON (channel,contact) * FROM subs ORDER BY channel, contact, end_at DESC)
         SELECT count(*) FILTER (WHERE status<>'cancelled' AND end_at > now())::int active,
                count(*) FILTER (WHERE status<>'cancelled' AND end_at > now() AND end_at < now() + interval '7 days')::int expiring,
                count(*) FILTER (WHERE status<>'cancelled' AND end_at <= now())::int expired FROM last`),
    one(`SELECT COALESCE(sum(price) FILTER (WHERE status<>'cancelled' AND start_at >= date_trunc('month', now())),0)::float month, COALESCE(sum(price) FILTER (WHERE status<>'cancelled'),0)::float total FROM subs`),
    one(`SELECT count(*)::int n, COALESCE(sum(sent),0)::int sent FROM broadcasts`)
  ]);
  res.json({ users: u, byChannel: byCh, messages: msgs, newUsers: newU, leadsPerDay: leadsD, leads: leadsT.total, subs, revenue: rev, broadcasts: bc });
}));

// ---------- Subscriptions ----------
app.get('/api/plans', auth, can('subs'), wrap(async (req, res) => res.json(await q(`SELECT * FROM plans ORDER BY id`))));
app.post('/api/plans', auth, can('subs'), wrap(async (req, res) => {
  const { id, name, price, days } = req.body;
  if (!name || !(+days > 0)) return res.status(400).json({ error: 'الاسم والمدة مطلوبان' });
  if (id) await q(`UPDATE plans SET name=$2, price=$3, days=$4 WHERE id=$1`, [id, name, +price || 0, +days]);
  else await q(`INSERT INTO plans(name,price,days) VALUES($1,$2,$3)`, [name, +price || 0, +days]);
  res.json({ ok: true });
}));
app.delete('/api/plans/:id', auth, can('subs'), wrap(async (req, res) => { await q(`DELETE FROM plans WHERE id=$1`, [req.params.id]); res.json({ ok: true }); }));
app.get('/api/subs', auth, can('subs'), wrap(async (req, res) => {
  const f = req.query.filter || 'all', s = `%${req.query.search || ''}%`;
  const rows = await q(`SELECT * FROM (
      SELECT DISTINCT ON (channel,contact) id, channel, contact, name, plan_name, price, start_at, end_at,
        CASE WHEN status='cancelled' THEN 'cancelled' WHEN end_at < now() THEN 'expired' WHEN end_at < now() + interval '7 days' THEN 'expiring' ELSE 'active' END st
      FROM subs WHERE name ILIKE $1 OR contact ILIKE $1 ORDER BY channel, contact, end_at DESC) t
    WHERE ($2='all' OR st=$2) ORDER BY end_at LIMIT 100`, [s, f]);
  res.json(rows);
}));
app.post('/api/subs', auth, can('subs'), wrap(async (req, res) => {
  const channel = ['fb', 'ig', 'wa'].includes(req.body.channel) ? req.body.channel : 'wa';
  const contact = String(req.body.phone || req.body.contact || '').replace(channel === 'wa' ? /\D/g : /\s/g, '');
  const plan = (await q(`SELECT * FROM plans WHERE id=$1`, [req.body.planId]))[0];
  if (!contact || !plan) return res.status(400).json({ error: 'الرقم والباقة مطلوبان' });
  const u = (await q(`SELECT name FROM bot_users WHERE channel=$1 AND contact=$2`, [channel, contact]))[0];
  const name = (u && u.name) || req.body.name || '';
  if (!u) await q(`INSERT INTO bot_users(channel,contact,name,phone) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [channel, contact, name, channel === 'wa' ? contact : '']);
  const last = (await q(`SELECT end_at FROM subs WHERE channel=$1 AND contact=$2 AND status<>'cancelled' ORDER BY end_at DESC LIMIT 1`, [channel, contact]))[0];
  const start = last && new Date(last.end_at) > new Date() ? new Date(last.end_at) : new Date();
  const end = new Date(start.getTime() + (+req.body.days || plan.days) * 864e5);
  await q(`INSERT INTO subs(channel,contact,name,plan_id,plan_name,price,start_at,end_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [channel, contact, name, plan.id, plan.name, plan.price, start, end]);
  res.json({ ok: true, end });
}));
app.post('/api/subs/:id/cancel', auth, can('subs'), wrap(async (req, res) => { await q(`UPDATE subs SET status='cancelled' WHERE id=$1`, [req.params.id]); res.json({ ok: true }); }));

// ---------- Post commenters (official API, own page/account only) ----------
const gget = async (url, token) => {
  const r = await fetch(url + (url.includes('access_token=') ? '' : (url.includes('?') ? '&' : '?') + 'access_token=' + token));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || 'Graph error');
  return j;
};
app.get('/api/posts', auth, can('broadcast'), wrap(async (req, res) => {
  const ig = req.query.channel === 'ig';
  const j = await gget(ig ? `${G}/${E.IG_USER_ID}/media?fields=id,caption,timestamp&limit=20` : `${G}/me/posts?fields=id,message,created_time&limit=20`, E.FB_PAGE_TOKEN);
  res.json((j.data || []).map(p => ({ id: p.id, text: (p.message || p.caption || '').slice(0, 80), ts: p.created_time || p.timestamp })));
}));
app.post('/api/harvest', auth, can('broadcast'), wrap(async (req, res) => {
  const { channel, postId } = req.body, ig = channel === 'ig';
  let url = ig ? `${G}/${postId}/comments?fields=id,text,username,from,timestamp&limit=100` : `${G}/${postId}/comments?fields=id,message,from{id,name},created_time&limit=100`, n = 0;
  for (let i = 0; i < 50 && url; i++) {
    const j = await gget(url, E.FB_PAGE_TOKEN);
    for (const c of j.data || []) {
      const uid = c.from && c.from.id; if (!uid) continue;
      const name = ig ? (c.username || c.from.username || '') : c.from.name;
      await q(`INSERT INTO harvest(channel,post_id,comment_id,user_id,name,text,commented_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(channel,comment_id) DO NOTHING`,
        [channel, postId, c.id, uid, name || '', (c.message || c.text || '').slice(0, 500), c.created_time || c.timestamp]);
      await q(`INSERT INTO bot_users(channel,contact,name,phone) VALUES($1,$2,$3,'') ON CONFLICT DO NOTHING`, [channel, uid, name || '']);
      n++;
    }
    url = j.paging && j.paging.next;
  }
  res.json({ collected: n });
}));
app.get('/api/harvest', auth, can('broadcast'), wrap(async (req, res) => res.json(await q(`SELECT name,user_id,text,sent,commented_at FROM harvest WHERE channel=$1 AND post_id=$2 ORDER BY commented_at DESC`, [req.query.channel, req.query.postId]))));
app.get('/api/harvest.csv', auth, can('broadcast'), wrap(async (req, res) => {
  const rows = await q(`SELECT name,user_id,text,commented_at FROM harvest WHERE channel=$1 AND post_id=$2 ORDER BY commented_at`, [req.query.channel, req.query.postId]);
  const c = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename=commenters.csv');
  res.send('\ufeffname,user_id,comment,date\n' + rows.map(r => [r.name, r.user_id, r.text, r.commented_at].map(c).join(',')).join('\n'));
}));
// one private reply per comment, only comments younger than 7 days (Meta's rule)
app.post('/api/harvest/send', auth, can('broadcast'), wrap(async (req, res) => {
  const { channel, postId, node } = req.body, flow = await getFlow(), nd = flow.nodes[node];
  if (!nd) return res.status(400).json({ error: 'العقدة غير موجودة' });
  const rows = await q(`SELECT id,comment_id,user_id,name FROM harvest WHERE channel=$1 AND post_id=$2 AND NOT sent AND commented_at > now() - interval '7 days'`, [channel, postId]);
  res.json({ queued: rows.length });
  (async () => {
    for (const r of rows) {
      try {
        if (await sendNode(channel, r.user_id, nd, r.name, { commentId: r.comment_id, t: {} })) {
          await q(`UPDATE harvest SET sent=true WHERE id=$1`, [r.id]);
          if (nd.type === 'ask') await setSes(channel, r.user_id, r.name, node, {}, false);
        }
      } catch (e) { console.error(e); }
      await sleep(150);
    }
  })();
}));

init().then(() => app.listen(E.PORT || 3000, () => console.log('running'))).catch(e => { console.error('init failed', e); process.exit(1); });
