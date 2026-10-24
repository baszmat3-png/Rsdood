// مسارات المحادثة: عقد برسائل وأزرار وتنقّل، وكلمات مفتاحية تشغّل مساراً أو ترد مباشرة.
import { all, get, run, getSetting } from './db.js';
import { norm, splitKeywords } from './engine.js';
import { startFormById, clearFormSession } from './forms.js';

export const NODE_TYPES = ['message', 'goto', 'form', 'handoff'];
export const BTN_KINDS = ['node', 'flow', 'form', 'url'];
export const MATCH_TYPES = ['is', 'contains', 'word', 'starts', 'resume', 'image', 'sticker', 'audio'];
const PAUSE_MS = 12 * 3600_000;
const MENU_MS = 3600_000;

const safeJson = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const digits = (s) => String(s).replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const fill = (t, ev) => String(t || '').replaceAll('{name}', ev.userName || 'عزيزي').replaceAll('{business}', getSetting('business_name', '')).trim();
const variants = (t) => String(t || '').split(/\n-{3,}\n/).map((v) => v.trim()).filter(Boolean);

export const parseFlow = (row) => (row ? { ...row, active: !!row.active, nodes: safeJson(row.nodes, {}) } : null);
const getFlow = (id) => parseFlow(get('SELECT * FROM flows WHERE id = ? AND active = 1', Number(id)));

/** تحقق وتنظيف حمولة المسار. يعيد { error } أو { value }. */
export function cleanFlow(b) {
  const name = String(b.name || '').trim();
  if (!name) return { error: 'اسم المسار مطلوب' };
  const nodes = b.nodes && typeof b.nodes === 'object' ? b.nodes : {};
  const ids = Object.keys(nodes);
  if (!ids.length) return { error: 'أضف عقدة واحدة على الأقل' };
  if (ids.length > 60) return { error: 'الحد الأقصى 60 عقدة في المسار' };
  const out = {};
  for (const id of ids) {
    if (!/^[A-Za-z0-9_-]{1,30}$/.test(id)) return { error: `معرّف العقدة «${id}» غير صالح (حروف إنكليزية وأرقام وشرطة فقط)` };
    const n = nodes[id] || {};
    const type = NODE_TYPES.includes(n.type) ? n.type : 'message';
    const buttons = (Array.isArray(n.buttons) ? n.buttons : []).slice(0, 13).map((x) => ({
      title: String(x.title || '').trim().slice(0, 20), kind: BTN_KINDS.includes(x.kind) ? x.kind : 'node', to: String(x.to || '').trim().slice(0, 500),
    })).filter((x) => x.title && x.to);
    out[id] = {
      type, text: String(n.text || '').slice(0, 1900), image: String(n.image || '').trim().slice(0, 500), buttons,
      next: String(n.next || '').trim(), flow: n.flow ? Number(n.flow) : null, form: n.form ? Number(n.form) : null,
    };
  }
  for (const [id, n] of Object.entries(out)) {
    if (n.next && !out[n.next]) return { error: `العقدة «${id}»: الخطوة التالية «${n.next}» غير موجودة` };
    if (n.type === 'message' && !n.text && !n.image) return { error: `العقدة «${id}» فارغة: اكتب نصاً أو ضع صورة` };
    if (n.type === 'goto' && !n.flow) return { error: `العقدة «${id}»: اختر المسار المراد الانتقال إليه` };
    if (n.type === 'form' && !n.form) return { error: `العقدة «${id}»: اختر النموذج` };
    for (const x of n.buttons) {
      if (x.kind === 'node' && !out[x.to]) return { error: `العقدة «${id}»: الزر «${x.title}» يشير إلى عقدة غير موجودة «${x.to}»` };
      if (x.kind === 'url' && !/^https?:\/\//i.test(x.to)) return { error: `العقدة «${id}»: رابط الزر «${x.title}» يجب أن يبدأ بـ http` };
      if ((x.kind === 'flow' || x.kind === 'form') && !/^\d+$/.test(x.to)) return { error: `العقدة «${id}»: الزر «${x.title}» يحتاج رقماً` };
    }
  }
  return { value: { name: name.slice(0, 120), start: ids.includes(b.start) ? b.start : ids[0], nodes: JSON.stringify(out), active: b.active === false ? 0 : 1 } };
}

/* ---------- بناء الرسائل ---------- */

function toBtn(flow, b) {
  if (b.kind === 'url') return { title: b.title, url: b.to };
  if (b.kind === 'form') return { title: b.title, payload: `fm:${b.to}` };
  if (b.kind === 'flow') return { title: b.title, payload: `f:${b.to}:` };
  return { title: b.title, payload: `f:${flow.id}:${b.to}` };
}

function buildChain(flow, nodeId, ev) {
  const msgs = [];
  let pause = false;
  let cur = flow;
  let id = nodeId || flow.start;
  for (let i = 0; i < 8 && id; i++) {
    const n = cur.nodes[id];
    if (!n) break;
    if (n.type === 'goto') { const f = getFlow(n.flow); if (!f) break; cur = f; id = f.start; continue; }
    if (n.type === 'form') { const r = startFormById(ev, n.form); if (r) msgs.push({ text: r.reply }); break; }
    if (n.type === 'handoff') {
      msgs.push({ text: fill(n.text, ev) || getSetting('handoff_reply', 'تم تحويل رسالتك إلى فريقنا وسيتواصل معك أحد المختصين 🌷') });
      pause = true; break;
    }
    msgs.push({ text: fill(n.text, ev), image: n.image || '', buttons: n.buttons.map((b) => toBtn(cur, b)) });
    if (!n.buttons.length && n.next) { id = n.next; continue; }
    break;
  }
  return msgs.length ? { msgs, pause } : null;
}

function navigate(ev, payload) {
  let m = /^f:(\d+):(.*)$/u.exec(payload);
  if (m) {
    const flow = getFlow(m[1]);
    if (!flow) return null;
    clearFormSession(ev);
    return buildChain(flow, m[2] || flow.start, ev);
  }
  m = /^fm:(\d+)$/.exec(payload);
  if (m) {
    const r = startFormById(ev, m[1]);
    return r ? { msgs: [{ text: r.reply }], pause: false } : null;
  }
  return null;
}

/* ---------- الكلمات المفتاحية ---------- */

function kwMatches(k, ev) {
  const m = k.match;
  if (['image', 'sticker', 'audio'].includes(m)) return ev.type === m;
  if (ev.type && ev.type !== 'text') return false;
  const t = ` ${norm(ev.text)} `;
  return splitKeywords(k.words).some((w) => {
    if (m === 'is' || m === 'resume') return t.trim() === w;
    if (m === 'contains') return t.includes(w);
    if (m === 'word') return t.includes(` ${w} `);
    if (m === 'starts') return t.trim().startsWith(w);
    return false;
  });
}
const keywordRows = (ev, hot) => all('SELECT * FROM keywords WHERE active = 1 AND hotword = ? AND match <> ? ORDER BY id', hot ? 1 : 0, 'resume')
  .filter((k) => (k.channel === 'any' || k.channel === ev.channel) && kwMatches(k, ev));

function runKeyword(k, ev) {
  const msgs = [];
  let pause = false;
  const v = variants(k.reply);
  if (v.length) msgs.push({ text: fill(pick(v), ev) });
  if (k.flow_id) {
    const f = getFlow(k.flow_id);
    if (f) { clearFormSession(ev); const c = buildChain(f, k.node || f.start, ev); if (c) { msgs.push(...c.msgs); pause = c.pause; } }
  }
  return msgs.length ? { msgs, pause } : null;
}

/* ---------- الحالة (إيقاف البوت، قائمة الأرقام) ---------- */

const state = (ev) => get('SELECT * FROM flow_state WHERE channel = ? AND user_id = ?', ev.channel, String(ev.userId));
export function setPaused(ev, on) {
  run(`INSERT INTO flow_state(channel,user_id,paused) VALUES(?,?,?) ON CONFLICT(channel,user_id) DO UPDATE SET paused = excluded.paused`,
    ev.channel, String(ev.userId), on ? Date.now() : 0);
}
export function isPaused(ev) {
  const s = state(ev);
  if (!s || !s.paused) return false;
  if (s.paused < Date.now() - PAUSE_MS) { setPaused(ev, false); return false; }
  return true;
}
export function findResume(ev) {
  return all('SELECT * FROM keywords WHERE active = 1 AND match = ? ORDER BY id', 'resume')
    .find((k) => (k.channel === 'any' || k.channel === ev.channel) && kwMatches(k, ev)) || null;
}
export function resumeBot(ev) {
  const k = findResume(ev);
  if (!k) return null;
  setPaused(ev, false);
  return runKeyword(k, ev) || { msgs: [{ text: 'تم استئناف الرد الآلي ✅' }], pause: false };
}
/** يحفظ خيارات القائمة لتعمل الإجابة برقم عندما لا تدعم القناة الأزرار. */
export function saveMenu(ev, buttons) {
  const list = (buttons || []).filter((b) => b.payload).slice(0, 10).map((b) => b.payload);
  run(`INSERT INTO flow_state(channel,user_id,menu,menu_at) VALUES(?,?,?,?) ON CONFLICT(channel,user_id) DO UPDATE SET menu = excluded.menu, menu_at = excluded.menu_at`,
    ev.channel, String(ev.userId), JSON.stringify(list), Date.now());
}

/* ---------- نقاط الدخول من المحرّك ---------- */

/** أزرار (payload) والكلمات الساخنة: لها الأولوية على كل شيء. */
export function flowPrelude(ev) {
  if (ev.payload) { const r = navigate(ev, ev.payload); if (r) return r; }
  for (const k of keywordRows(ev, true)) { const r = runKeyword(k, ev); if (r) return r; }
  return null;
}
/** الكلمات المفتاحية العادية وإجابة القائمة برقم. */
export function flowKeywords(ev) {
  if (!ev.type || ev.type === 'text') {
    const n = digits(ev.text || '').trim();
    if (/^\d{1,2}$/.test(n)) {
      const s = state(ev);
      const list = s ? safeJson(s.menu, []) : [];
      if (list.length && s.menu_at > Date.now() - MENU_MS && list[Number(n) - 1]) {
        const r = navigate(ev, list[Number(n) - 1]);
        if (r) return r;
      }
    }
  }
  for (const k of keywordRows(ev, false)) { const r = runKeyword(k, ev); if (r) return r; }
  return null;
}
/** مسار الرد الافتراضي (اختياري) بدلاً من الذكاء الاصطناعي. */
export function flowDefault(ev) {
  const id = getSetting('default_flow_id', '');
  if (!id || (ev.type && ev.type !== 'text')) return null;
  const f = getFlow(id);
  return f ? buildChain(f, f.start, ev) : null;
}

/** نص بديل مرقّم للقنوات التي لا تدعم الأزرار. */
export function numberedText(msg) {
  const pl = (msg.buttons || []).filter((b) => b.payload).slice(0, 10);
  const urls = (msg.buttons || []).filter((b) => b.url);
  let t = msg.text || '';
  if (pl.length) t += `\n\n${pl.map((b, i) => `${i + 1}- ${b.title}`).join('\n')}\n\nاكتب رقم الخيار.`;
  if (urls.length) t += `\n\n${urls.map((b) => `${b.title}: ${b.url}`).join('\n')}`;
  if (msg.image) t = `${msg.image}\n${t}`;
  return t.trim();
}
