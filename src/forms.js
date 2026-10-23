// نماذج الحجز والطلبات عبر المحادثة: يسأل البوت سؤالاً سؤالاً، يتحقق من الجواب، ثم يحفظ الطلب لتصديره إلى Excel.
import { all, get, run, getSetting } from './db.js';
import { norm, splitKeywords } from './engine.js';

export const FIELD_TYPES = ['text', 'phone', 'number', 'date', 'time', 'choice'];
const SESSION_MS = 24 * 3600_000;
const CANCEL = ['الغاء', 'إلغاء', 'cancel', 'توقف', 'ايقاف', 'وقف'].map(norm);
const SKIP = ['تخطي', 'skip', 'لا يوجد', 'لا شي', 'لا شيء'].map(norm);
const DEFAULT_INTRO = 'أهلاً {name} 🌷 سأسجّل طلبك الآن، أجبني على الأسئلة التالية (اكتب «إلغاء» في أي وقت للإيقاف).';
const DEFAULT_DONE = 'شكراً {name}! تم تسجيل طلبك رقم {id} ✅\n{summary}\nسيتواصل معك فريقنا للتأكيد.';

const digits = (s) => String(s).replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0);

export function parseForm(row) {
  if (!row) return null;
  let fields = [];
  try { fields = JSON.parse(row.fields || '[]'); } catch { /* تجاهل */ }
  return { ...row, active: !!row.active, fields };
}

/** تحقق وتنظيف حمولة النموذج القادمة من الواجهة. يعيد { error } أو { value }. */
export function cleanForm(b) {
  const name = String(b.name || '').trim();
  if (!name) return { error: 'اسم النموذج مطلوب' };
  const fields = Array.isArray(b.fields) ? b.fields : [];
  if (!fields.length) return { error: 'أضف سؤالاً واحداً على الأقل' };
  if (fields.length > 25) return { error: 'الحد الأقصى 25 سؤالاً' };
  const out = [];
  for (const f of fields) {
    const label = String(f.label || '').trim().slice(0, 200);
    if (!label) return { error: 'يوجد سؤال فارغ' };
    const type = FIELD_TYPES.includes(f.type) ? f.type : 'text';
    const options = type === 'choice' ? (Array.isArray(f.options) ? f.options : []).map((o) => String(o).trim()).filter(Boolean).slice(0, 12) : [];
    if (type === 'choice' && options.length < 2) return { error: `السؤال «${label}» من نوع اختيار ويحتاج خيارين على الأقل` };
    out.push({ label, type, options, optional: !!f.optional });
  }
  return {
    value: {
      name: name.slice(0, 120), kind: b.kind === 'order' ? 'order' : 'booking',
      triggers: String(b.triggers || '').slice(0, 1000), intro: String(b.intro || '').slice(0, 1000),
      done_text: String(b.done_text || '').slice(0, 1500), fields: JSON.stringify(out), active: b.active === false ? 0 : 1,
    },
  };
}

export const headerOf = (f) => f.label.replace(/[؟?:：]+\s*$/, '').trim();

function question(form, i) {
  const f = form.fields[i];
  let q = `(${i + 1}/${form.fields.length}) ${f.label}`;
  if (f.type === 'choice') q += '\n' + f.options.map((o, k) => `${k + 1}- ${o}`).join('\n') + '\nاكتب رقم الخيار.';
  if (f.type === 'date') q += '\nمثال: 25/10 أو «غداً».';
  if (f.optional) q += '\n(اختياري، اكتب «تخطي» للتجاوز)';
  return q;
}

/** يعيد { value } أو { error: رسالة تُعرض للمستخدم }. */
export function validate(f, raw) {
  const text = digits(String(raw || '')).trim().slice(0, 500);
  if (f.optional && SKIP.includes(norm(text))) return { value: '' };
  if (!text) return { error: 'لم أفهم، أعد الإجابة من فضلك.' };
  if (f.type === 'phone') {
    const d = text.replace(/[\s\-+().]/g, '');
    if (!/^\d{7,15}$/.test(d)) return { error: 'الرقم غير صحيح، اكتب رقم هاتف صحيحاً (7 إلى 15 رقماً).' };
    return { value: d };
  }
  if (f.type === 'number') {
    if (!/^\d+(\.\d+)?$/.test(text)) return { error: 'اكتب رقماً فقط من فضلك.' };
    return { value: text };
  }
  if (f.type === 'date') {
    const rel = ['اليوم', 'غدا', 'بكرا', 'بعد غد', 'السبت', 'الاحد', 'الاثنين', 'الثلاثاء', 'الاربعاء', 'الخميس', 'الجمعة'].map(norm);
    if (!/\d/.test(text) && !rel.some((r) => norm(text).includes(r))) return { error: 'اكتب التاريخ مثل 25/10 أو «غداً».' };
    return { value: text };
  }
  if (f.type === 'time') {
    if (!/\d/.test(text)) return { error: 'اكتب الوقت مثل 5 مساءً أو 17:30.' };
    return { value: text };
  }
  if (f.type === 'choice') {
    const n = Number(text);
    if (Number.isInteger(n) && n >= 1 && n <= f.options.length) return { value: f.options[n - 1] };
    const hit = f.options.find((o) => norm(o) === norm(text)) || f.options.find((o) => norm(text).length > 1 && norm(o).includes(norm(text)));
    if (hit) return { value: hit };
    return { error: `اختر رقماً من 1 إلى ${f.options.length}.` };
  }
  return { value: text };
}

const fillText = (tpl, ctx) => String(tpl)
  .replaceAll('{name}', ctx.name || 'عزيزي').replaceAll('{id}', ctx.id ?? '').replaceAll('{summary}', ctx.summary ?? '')
  .replaceAll('{business}', getSetting('business_name', '')).trim();

function findSession(ev) {
  const s = get('SELECT * FROM form_sessions WHERE channel = ? AND user_id = ?', ev.channel, String(ev.userId));
  if (!s) return null;
  if (s.updated_at < Date.now() - SESSION_MS) { clearFormSession(ev); return null; }
  return s;
}
export function clearFormSession(ev) {
  run('DELETE FROM form_sessions WHERE channel = ? AND user_id = ?', ev.channel, String(ev.userId));
}

function matchForm(ev) {
  const t = ` ${norm(ev.text)} `;
  for (const row of all('SELECT * FROM forms WHERE active = 1 ORDER BY id')) {
    const words = splitKeywords(row.triggers);
    if (words.some((w) => t.includes(` ${w} `) || t.includes(w))) {
      const f = parseForm(row);
      if (f.fields.length) return f;
    }
  }
  return null;
}

/** يعالج رسالة ضمن نموذج. يعيد { reply } إن كانت الرسالة تخص نموذجاً، وإلا null. */
export function handleFormTurn(ev, simulate = false) {
  const sess = findSession(ev);
  if (!sess) {
    const form = matchForm(ev);
    if (!form) return null;
    run('INSERT OR REPLACE INTO form_sessions(channel,user_id,form_id,step,answers,updated_at) VALUES(?,?,?,?,?,?)',
      ev.channel, String(ev.userId), form.id, 0, '{}', Date.now());
    return { reply: `${fillText(form.intro || DEFAULT_INTRO, { name: ev.userName })}\n\n${question(form, 0)}` };
  }
  const form = parseForm(get('SELECT * FROM forms WHERE id = ?', sess.form_id));
  if (!form || !form.active) { clearFormSession(ev); return null; }
  if (CANCEL.includes(norm(ev.text))) {
    clearFormSession(ev);
    return { reply: 'تم إلغاء الطلب. اكتب كلمة الطلب متى شئت لنبدأ من جديد 🌷' };
  }
  const f = form.fields[sess.step];
  const r = validate(f, ev.text);
  if (r.error) return { reply: `${r.error}\n\n${question(form, sess.step)}` };
  const answers = { ...JSON.parse(sess.answers || '{}'), [sess.step]: r.value };
  const next = sess.step + 1;
  if (next < form.fields.length) {
    run('UPDATE form_sessions SET step = ?, answers = ?, updated_at = ? WHERE channel = ? AND user_id = ?',
      next, JSON.stringify(answers), Date.now(), ev.channel, String(ev.userId));
    return { reply: question(form, next) };
  }
  const byLabel = Object.fromEntries(form.fields.map((fl, i) => [headerOf(fl), answers[i] ?? '']));
  const id = run(
    'INSERT INTO submissions(form_id,channel,account_id,user_id,user_name,answers,created_at,simulated) VALUES(?,?,?,?,?,?,?,?)',
    form.id, ev.channel, ev.account?.id ?? null, String(ev.userId), ev.userName || '', JSON.stringify(byLabel), Date.now(), simulate ? 1 : 0,
  ).lastInsertRowid;
  clearFormSession(ev);
  const summary = Object.entries(byLabel).filter(([, v]) => v).map(([k, v]) => `• ${k}: ${v}`).join('\n');
  return { reply: fillText(form.done_text || DEFAULT_DONE, { name: ev.userName, id, summary }), submissionId: id };
}
