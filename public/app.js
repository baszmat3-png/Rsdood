/* صدى — لوحة التحكم (JavaScript بلا اعتماديات) */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const root = $('#root');

const CHANNELS = { facebook: 'فيسبوك', instagram: 'إنستغرام', whatsapp: 'واتساب', telegram: 'تيليغرام', tiktok: 'تيك توك' };
const STATUS = { done: ['تمت المعالجة', 'teal'], no_match: ['بلا حملة مطابقة', ''], failed: ['فشل الإرسال', 'coral'], skipped: ['تم تخطيه', 'saffron'], handoff: ['محوّل لموظف', 'saffron'], processing: ['قيد المعالجة', ''] };
const SEND = { sent: 'أُرسل', simulated: 'تسجيل فقط', failed: 'فشل', '': '' };

const ICONS = {
  home: '<path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/>',
  flow: '<path d="M4 6h9a4 4 0 010 8H8a4 4 0 000 8h12M17 18l3 4-3 0"/><circle cx="4" cy="6" r="1.6"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3A4 4 0 0011 18.7l1-1"/>',
  book: '<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2V5zM4 19a2 2 0 012-2h13"/>',
  flask: '<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 001.3 2.2h12.4a1.5 1.5 0 001.3-2.2L14 9V3M7.5 15h9"/>',
  form: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM8.5 12h7M8.5 16h5"/>',
  tree: '<rect x="3" y="3" width="7" height="5" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="8.5" y="16" width="7" height="5" rx="1"/><path d="M6.5 8v3h11V8M12 11v5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

/* ---------- أدوات ---------- */

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await r.json(); } catch { /* فارغ */ }
  if (r.status === 401 && url !== '/api/login') { showLogin(); throw new Error('يلزم تسجيل الدخول'); }
  if (!r.ok) throw new Error(data?.error || 'حدث خطأ غير متوقع');
  return data;
}
function toast(msg, bad = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), bad ? 6000 : 3200);
}
async function guarded(btn, fn) {
  const label = btn?.innerHTML;
  if (btn) { btn.disabled = true; }
  try { return await fn(); } catch (e) { toast(e.message, true); } finally { if (btn) { btn.disabled = false; btn.innerHTML = label; } }
}
const fmtTime = (ts) => new Date(ts).toLocaleString('ar-IQ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const chan = (c) => CHANNELS[c] || c;
const clipTxt = (s, n = 70) => (s.length > n ? s.slice(0, n) + '…' : s);

/* ---------- مسار المحادثة ---------- */

function thread(e) {
  const inLabel = e.kind === 'comment' ? 'تعليق' : 'رسالة';
  const failed = e.status === 'failed';
  let html = `<div class="thread">
    <div class="node"><div class="bubble"><div class="who">${esc(e.user_name || 'مستخدم')} · ${inLabel} على ${esc(chan(e.channel))}${e.post_id ? ` · منشور <span class="ltr">${esc(e.post_id)}</span>` : ''}</div><div class="txt">${esc(e.text)}</div></div></div>`;
  if (e.kind === 'comment') {
    if (e.public_reply) html += `<div class="node pub${e.public_status === 'failed' ? ' fail' : ''}"><div class="bubble"><div class="who">رد علني <span class="chip ${e.public_status === 'failed' ? 'coral' : 'teal'}">${SEND[e.public_status] ?? ''}</span></div><div class="txt">${esc(e.public_reply)}</div></div></div>`;
    if (e.dm_reply) html += `<div class="node dm${e.dm_status === 'failed' ? ' fail' : ''}"><div class="bubble"><div class="who">رسالة خاصة <span class="chip ${e.dm_status === 'failed' ? 'coral' : 'saffron'}">${SEND[e.dm_status] ?? ''}</span></div><div class="txt">${esc(e.dm_reply)}</div></div></div>`;
  } else if (e.dm_reply) {
    html += `<div class="node dm${failed ? ' fail' : ''}"><div class="bubble"><div class="who">الرد <span class="chip ${failed ? 'coral' : 'saffron'}">${SEND[e.dm_status] ?? ''}</span></div><div class="txt">${esc(e.dm_reply)}</div></div></div>`;
  }
  html += '</div>';
  if (e.error) html += `<div class="err">${esc(e.error)}</div>`;
  return html;
}
const statusChip = (e) => { const [t, c] = STATUS[e.status] || [e.status, '']; return `<span class="chip ${c}">${t}</span>`; };

/* ---------- الهيكل العام ---------- */

const PAGES = [
  ['overview', 'نظرة عامة', 'home'], ['campaigns', 'الحملات', 'flow'], ['accounts', 'الحسابات', 'link'],
  ['flows', 'المسارات والأزرار', 'tree'], ['keywords', 'الكلمات المفتاحية', 'key'], ['forms', 'نماذج الحجز والطلب', 'form'], ['submissions', 'الطلبات والحجوزات', 'table'],
  ['business', 'معلومات النشاط', 'book'], ['playground', 'التجربة', 'flask'], ['log', 'السجل', 'list'], ['settings', 'الإعدادات', 'gear'],
];
const brandMark = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#2B3E63"/><g fill="none" stroke-linecap="round" stroke-width="2.6"><path d="M21 9.5a8 8 0 0 1 0 13" stroke="#E39B0B"/><path d="M16.5 12a4.6 4.6 0 0 1 0 8" stroke="#2CC9B5"/></g><circle cx="11.5" cy="16" r="2.6" fill="#fff"/></svg>';

function showLogin() {
  root.innerHTML = `<div class="login"><form class="box" id="login">
    <div class="brand">${brandMark}<span>صدى</span></div>
    <p>سجّل الدخول لإدارة الردود الذكية.</p>
    <div class="field"><label class="lbl" for="pw">كلمة المرور</label><input id="pw" type="password" autocomplete="current-password" required autofocus></div>
    <button class="btn primary" style="width:100%;justify-content:center">دخول</button></form></div>`;
  $('#login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await guarded($('button', ev.target), async () => { await api('POST', '/api/login', { password: $('#pw').value }); start(); });
  });
}

let info = {};
async function start() {
  try { info = await api('GET', '/api/info'); } catch { return; }
  root.innerHTML = `<div class="app"><aside class="side">
    <div class="brand">${brandMark}<span>صدى</span></div>
    <nav class="nav" aria-label="الأقسام">${PAGES.map(([id, t, i]) => `<a href="#/${id}" data-p="${id}">${icon(i)}<span>${t}</span></a>`).join('')}</nav>
    <div class="side-foot">
      <div class="status-line"><span class="dot ${info.aiConfigured ? 'on' : 'off'}"></span><span>${info.aiConfigured ? 'الذكاء الاصطناعي يعمل' : 'الذكاء الاصطناعي غير مُفعّل'}</span></div>
      <button class="linklike" id="logout">تسجيل الخروج</button>
    </div></aside><main class="main" id="view"></main></div>`;
  $('#logout').addEventListener('click', async () => { await api('POST', '/api/logout').catch(() => {}); showLogin(); });
  window.removeEventListener('hashchange', route);
  window.addEventListener('hashchange', route);
  route();
  const qs = new URLSearchParams(location.search);
  if (qs.has('meta_pick')) {
    const t = qs.get('meta_pick'); history.replaceState(null, '', location.pathname + '#/accounts');
    pickDialog(t);
  } else if (qs.has('meta') || qs.has('meta_error')) {
    if (qs.has('meta_error')) toast(qs.get('meta_error'), true);
    else toast(`تم ربط ${qs.get('meta')} حساب بنجاح ✅` + (qs.get('meta_failed') ? ` (تعذّر ${qs.get('meta_failed')})` : ''));
    history.replaceState(null, '', location.pathname + location.hash);
  }
}

async function route() {
  const id = (location.hash.match(/^#\/(\w+)/) || [])[1] || 'overview';
  const page = PAGES.find((p) => p[0] === id) ? id : 'overview';
  $$('.nav a').forEach((a) => (a.dataset.p === page ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  const view = $('#view');
  view.innerHTML = '<p class="muted">جارٍ التحميل…</p>';
  try { await VIEWS[page](view); } catch (e) { if (e.message !== 'يلزم تسجيل الدخول') view.innerHTML = `<div class="panel panel-pad"><h2>تعذّر تحميل الصفحة</h2><p class="muted">${esc(e.message)}</p></div>`; }
  document.title = `${PAGES.find((p) => p[0] === page)[1]} — صدى`;
  window.scrollTo(0, 0);
}

const head = (title, sub, actions = '') => `<div class="page-head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div>${actions}</div></div>`;

/* ---------- نظرة عامة ---------- */

function chartSvg(days) {
  const W = 700, H = 190, padB = 24, padT = 8;
  const max = Math.max(4, ...days.map((d) => d.comments + d.messages));
  const bw = W / days.length;
  const y = (v) => padT + (H - padB - padT) * (1 - v / max);
  let g = '';
  [0, 0.5, 1].forEach((f) => { const yy = y(max * f); g += `<line class="grid" x1="0" x2="${W}" y1="${yy}" y2="${yy}"/><text x="${W - 2}" y="${yy - 3}" text-anchor="end">${Math.round(max * f)}</text>`; });
  days.forEach((d, i) => {
    const x = W - (i + 1) * bw + bw * 0.2, w = bw * 0.6;
    const hc = (H - padB - padT) * (d.comments / max), hm = (H - padB - padT) * (d.messages / max);
    g += `<rect class="bar-c" x="${x}" y="${H - padB - hc}" width="${w}" height="${hc}" rx="3"><title>${d.date}: ${d.comments} تعليق</title></rect>`;
    g += `<rect class="bar-m" x="${x}" y="${H - padB - hc - hm}" width="${w}" height="${hm}" rx="3"><title>${d.date}: ${d.messages} رسالة</title></rect>`;
    if (i % 2 === 0) g += `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${d.date.slice(3)}/${d.date.slice(0, 2)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="عدد التعليقات والرسائل خلال آخر 14 يوماً">${g}</svg>`;
}

const VIEWS = {};
VIEWS.overview = async (v) => {
  const o = await api('GET', '/api/overview');
  const steps = [
    ['business', 'أضف معلومات نشاطك', o.businessReady], ['settings', 'فعّل الذكاء الاصطناعي', o.aiConfigured],
    ['accounts', 'اربط حساباً', o.counts.accounts > 0], ['campaigns', 'أنشئ أول حملة', o.counts.campaigns > 0],
  ];
  const incomplete = steps.some((s) => !s[2]);
  const k = o.kpi;
  v.innerHTML = head('نظرة عامة', 'ما جرى في حساباتك خلال آخر 7 أيام.') +
    `<div class="stack">
    ${incomplete ? `<ul class="steps">${steps.map(([p, t, d]) => `<li class="${d ? 'done' : ''}"><a href="#/${p}"><span class="tick"></span>${t}</a></li>`).join('')}</ul>` : ''}
    <div class="strip">
      <div><div class="v num">${k.comments}</div><div class="l">تعليقات وصلت</div></div>
      <div><div class="v num">${k.publicSent}</div><div class="l">ردود علنية أُرسلت</div></div>
      <div><div class="v num">${k.dmSent}</div><div class="l">رسائل خاصة أُرسلت</div></div>
      <div><div class="v num">${k.messages}</div><div class="l">رسائل خاصة وصلت</div></div>
    </div>
    ${k.failed || k.handoff ? `<div class="panel panel-pad" style="display:flex;gap:18px;flex-wrap:wrap;align-items:center">${k.failed ? `<span class="chip coral">${k.failed} فشل في الإرسال</span>` : ''}${k.handoff ? `<span class="chip saffron">${k.handoff} محادثة طلبت موظفاً</span>` : ''}<a href="#/log">راجع السجل</a></div>` : ''}
    <div class="grid-2">
      <section class="panel panel-pad"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h2>النشاط اليومي</h2>
        <div class="legend"><span><i style="background:var(--ink-3)"></i>تعليقات</span><span><i style="background:var(--teal-bright)"></i>رسائل</span></div></div>${chartSvg(o.days)}</section>
      <section class="panel"><div class="panel-head"><h2>آخر النشاط</h2><a href="#/log" class="small">عرض الكل</a></div>
        ${o.recent.length ? `<div class="feed">${o.recent.map((e) => `<article><div class="meta">${statusChip(e)}<span>${fmtTime(e.ts)}</span>${e.campaign_name ? `<span>· ${esc(e.campaign_name)}</span>` : ''}</div>${thread(e)}</article>`).join('')}</div>`
          : '<div class="empty"><h3>لا نشاط بعد</h3><p>عند وصول أول تعليق أو رسالة ستظهر هنا مع الرد الذي أُرسل.</p></div>'}</section>
    </div></div>`;
};

/* ---------- الحملات ---------- */

let accountsCache = [];
const modeName = { ai: 'ذكاء اصطناعي', template: 'نص ثابت', off: 'بدون' };

VIEWS.campaigns = async (v) => {
  const [list, accs] = await Promise.all([api('GET', '/api/campaigns'), api('GET', '/api/accounts')]);
  accountsCache = accs;
  v.innerHTML = head('الحملات', 'كل حملة تحدد أين تعمل، وما الذي يُرد به علناً، وما الذي يُرسل على الخاص.', '<button class="btn primary" id="newc">+ حملة جديدة</button>') +
    `<section class="panel">${list.length ? `<div class="rows">${list.map((c) => `
      <div class="row ${c.active ? '' : 'off'}">
        <div><h3>${esc(c.name)}</h3><div class="tags">
          <span class="chip ink">${c.channel === 'any' ? 'كل القنوات' : chan(c.channel)}</span>
          <span class="chip">${c.scope === 'post' ? `منشور محدد: <span class="ltr">${esc(c.post_id)}</span>` : 'كل المنشورات'}</span>
          <span class="chip">${c.keywords ? `كلمات: ${esc(clipTxt(c.keywords, 40))}` : 'أي تعليق'}</span>
          <span class="chip teal">علني: ${modeName[c.public_mode]}</span><span class="chip saffron">خاص: ${modeName[c.dm_mode]}</span></div></div>
        <div class="acts"><label class="switch" title="تفعيل الحملة"><input type="checkbox" data-toggle="${c.id}" ${c.active ? 'checked' : ''} aria-label="تفعيل ${esc(c.name)}"><span></span></label>
          <button class="btn sm" data-edit="${c.id}">تعديل</button><button class="btn sm danger" data-del="${c.id}">حذف</button></div>
      </div>`).join('')}</div>`
      : '<div class="empty"><h3>لا توجد حملات بعد</h3><p>أنشئ حملة ليبدأ الرد على التعليقات وإرسال التفاصيل على الخاص.</p><button class="btn primary" id="newc2">+ أنشئ أول حملة</button></div>'}</section>`;
  const open = (c) => campaignDialog(c);
  $('#newc')?.addEventListener('click', () => open(null));
  $('#newc2')?.addEventListener('click', () => open(null));
  $$('[data-edit]', v).forEach((b) => b.addEventListener('click', () => open(list.find((c) => c.id == b.dataset.edit))));
  $$('[data-del]', v).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('حذف هذه الحملة نهائياً؟')) return;
    await guarded(b, async () => { await api('DELETE', `/api/campaigns/${b.dataset.del}`); toast('تم حذف الحملة'); route(); });
  }));
  $$('[data-toggle]', v).forEach((i) => i.addEventListener('change', async () => {
    try { await api('PUT', `/api/campaigns/${i.dataset.toggle}`, { active: i.checked }); toast(i.checked ? 'تم تفعيل الحملة' : 'تم إيقاف الحملة'); route(); } catch (e) { toast(e.message, true); i.checked = !i.checked; }
  }));
};

function dialog(title, body, saveLabel, onSave) {
  const d = document.createElement('dialog');
  d.innerHTML = `<form method="dialog" id="dform"><div class="d-head"><h2>${title}</h2><button type="button" class="x" aria-label="إغلاق" data-close>×</button></div>
    <div class="d-body">${body}</div><div class="d-foot"><button class="btn primary" id="dsave" type="submit">${saveLabel}</button><button class="btn" type="button" data-close>إلغاء</button></div></form>`;
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  $$('[data-close]', d).forEach((b) => b.addEventListener('click', () => d.close()));
  $('#dform', d).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = $('#dsave', d);
    await guarded(btn, async () => { await onSave(new FormData(ev.target), d); });
  });
  d.showModal();
  return d;
}
const opts = (obj, sel) => Object.entries(obj).map(([k, t]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${t}</option>`).join('');

function campaignDialog(c) {
  const x = c || { name: '', channel: 'any', account_id: '', scope: 'all', post_id: '', keywords: '', public_mode: 'ai', public_text: '', dm_mode: 'ai', dm_text: '', dm_details: '', once_per_user: true, active: true };
  const body = `
  <div class="field"><label class="lbl" for="f-name">اسم الحملة</label><input id="f-name" name="name" type="text" required value="${esc(x.name)}" placeholder="مثال: استفسارات الأسعار"></div>
  <fieldset class="fieldset"><legend>أين تعمل</legend>
    <div class="cols"><div class="field"><label class="lbl" for="f-ch">القناة</label><select id="f-ch" name="channel"><option value="any">كل القنوات</option>${opts(CHANNELS, x.channel)}</select></div>
    <div class="field"><label class="lbl" for="f-acc">الحساب</label><select id="f-acc" name="account_id"><option value="">كل الحسابات</option>${accountsCache.map((a) => `<option value="${a.id}" ${a.id == x.account_id ? 'selected' : ''}>${esc(a.name)} (${chan(a.channel)})</option>`).join('')}</select></div></div>
    <div class="field"><span class="lbl">المنشورات</span><div class="seg" role="radiogroup" aria-label="نطاق المنشورات"><label><input type="radio" name="scope" value="all" ${x.scope !== 'post' ? 'checked' : ''}><span>كل المنشورات</span></label><label><input type="radio" name="scope" value="post" ${x.scope === 'post' ? 'checked' : ''}><span>منشور محدد</span></label></div></div>
    <div class="field" id="postbox" ${x.scope === 'post' ? '' : 'hidden'}><label class="lbl" for="f-post">معرّف المنشور</label><input id="f-post" name="post_id" type="text" class="ltr" value="${esc(x.post_id)}" placeholder="123456789_987654321"><span class="hint">تجده في سجل الحملات بعد وصول أول تعليق على المنشور، أو من رابط المنشور. الحملة المخصّصة لمنشور تتقدّم دائماً على الحملات العامة.</span></div>
    <div class="field"><label class="lbl" for="f-kw">الكلمات المفتاحية</label><textarea id="f-kw" name="keywords" style="min-height:60px" placeholder="سعر، كم، تفاصيل، متوفر">${esc(x.keywords)}</textarea><span class="hint">افصل بينها بفاصلة. اتركها فارغة للرد على كل تعليق. يتجاهل التطابق التشكيل والهمزات (سعر = السِّعر).</span></div>
  </fieldset>
  <fieldset class="fieldset"><legend><span class="chip teal">١</span> الرد العلني تحت التعليق</legend>
    <div class="field"><label class="lbl" for="f-pm">طريقة الرد</label><select id="f-pm" name="public_mode">${opts(modeName, x.public_mode)}</select></div>
    <div class="field" data-for="public"><label class="lbl" for="f-pt" id="l-pt">نص الرد</label><textarea id="f-pt" name="public_text" style="min-height:76px">${esc(x.public_text)}</textarea><span class="hint" id="h-pt"></span></div>
  </fieldset>
  <fieldset class="fieldset"><legend><span class="chip saffron">٢</span> الرسالة الخاصة بالتفاصيل</legend>
    <div class="field"><label class="lbl" for="f-dm">طريقة الإرسال</label><select id="f-dm" name="dm_mode">${opts(modeName, x.dm_mode)}</select></div>
    <div data-for="dm"><div class="field"><label class="lbl" for="f-dt" id="l-dt">نص الرسالة</label><textarea id="f-dt" name="dm_text" style="min-height:76px">${esc(x.dm_text)}</textarea><span class="hint" id="h-dt"></span></div>
    <div class="field"><label class="lbl" for="f-dd">التفاصيل المطلوب إرسالها</label><textarea id="f-dd" name="dm_details" placeholder="الأسعار، المواصفات، رابط الطلب، ساعات العمل…">${esc(x.dm_details)}</textarea><span class="hint">الأرقام والروابط هنا تُرسل كما هي، ولا يضيف الذكاء الاصطناعي غيرها.</span></div>
    <label class="check"><input type="checkbox" name="once_per_user" ${x.once_per_user ? 'checked' : ''}>أرسل الرسالة الخاصة مرة واحدة فقط لكل شخص</label></div>
  </fieldset>
  <label class="check"><input type="checkbox" name="active" ${x.active ? 'checked' : ''}>الحملة مفعّلة</label>`;
  const d = dialog(c ? 'تعديل الحملة' : 'حملة جديدة', body, c ? 'حفظ التعديلات' : 'إنشاء الحملة', async (fd) => {
    const p = Object.fromEntries(fd);
    p.once_per_user = fd.has('once_per_user'); p.active = fd.has('active');
    await api(c ? 'PUT' : 'POST', c ? `/api/campaigns/${c.id}` : '/api/campaigns', p);
    toast(c ? 'تم حفظ الحملة' : 'تم إنشاء الحملة'); d.close(); route();
  });
  const sync = () => {
    $('#postbox', d).hidden = d.querySelector('[name=scope]:checked').value !== 'post';
    for (const [sel, grp, lbl, hint] of [['#f-pm', 'public', '#l-pt', '#h-pt'], ['#f-dm', 'dm', '#l-dt', '#h-dt']]) {
      const m = $(sel, d).value;
      $(`[data-for=${grp}]`, d).hidden = m === 'off';
      $(lbl, d).textContent = m === 'ai' ? 'توجيه للذكاء الاصطناعي (اختياري)' : grp === 'dm' ? 'نص الرسالة' : 'نص الرد';
      $(hint, d).textContent = m === 'ai' ? 'مثال: كن مختصراً وشجّع على الطلب اليوم.' : 'استخدم {name} لاسم الشخص' + (grp === 'dm' ? ' و{details} لموضع التفاصيل' : '') + '. لعدة صيغ تتبدّل عشوائياً، افصل بينها بسطر فارغ.';
    }
  };
  d.addEventListener('change', sync); sync();
}

/* ---------- الحسابات ---------- */

const copyBtn = (t) => `<button type="button" class="btn sm" data-copy="${esc(t)}">نسخ</button>`;
function wireCopy(scope) {
  $$('[data-copy]', scope).forEach((b) => b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('تم النسخ'); } catch { toast('تعذّر النسخ تلقائياً', true); } }));
}

VIEWS.accounts = async (v) => {
  const list = await api('GET', '/api/accounts');
  accountsCache = list;
  v.innerHTML = head('الحسابات', 'اربط صفحاتك وبوتاتك ليتمكّن النظام من استقبال التعليقات والرسائل والرد عليها.', '<button class="btn primary" id="newa">+ ربط حساب</button>') +
    `<div class="stack">
    <section class="panel panel-pad"><h2 style="margin-bottom:6px">ربط القنوات</h2>
      <p class="muted small" style="margin:0 0 12px">اضغط على القناة، سجّل الدخول بفيسبوك، ثم اختر الصفحات أو الحسابات التي تريد ربطها. يمكنك إلغاء الربط في أي وقت.</p>
      <div class="cols" style="margin-bottom:12px">${['facebook', 'instagram', 'whatsapp'].map((c) => {
        const n = list.filter((a) => a.channel === c).length;
        return `<div style="border:1px solid var(--line);border-radius:12px;padding:12px"><h3>${chan(c)} ${n ? `<span class="chip teal">${n} مربوط</span>` : ''}</h3>
        <button class="btn primary sm" data-ch="${c}" style="margin-top:8px">${c === 'whatsapp' ? 'ربط واتساب' : 'إدارة الحسابات / ربط جديد'}</button>
        ${n ? `<button class="btn sm danger" data-unlink="${c}" style="margin-top:8px">إلغاء الارتباط</button>` : ''}</div>`;
      }).join('')}</div>
      ${info.metaConnect.ready ? '' : `<form id="fbf" class="cols"><div class="field"><label class="lbl" for="m1">App ID</label><input id="m1" type="text" name="fb_app_id" class="ltr" value="${esc(info.metaConnect.appId)}" required></div><div class="field"><label class="lbl" for="m2">App Secret</label><input id="m2" type="password" name="app_secret" autocomplete="off" required></div><div><button class="btn primary">حفظ وتفعيل الأزرار</button></div></form><p class="hint">من Meta for Developers ← إعدادات التطبيق ← أساسي.</p>`}
      <div class="kv"><span>Valid OAuth Redirect URI</span><code class="ltr">${esc(info.metaConnect.redirect)}</code>${copyBtn(info.metaConnect.redirect)}</div>
      <p class="hint">ضع هذا الرابط في Meta ← Facebook Login ← Settings ← Valid OAuth Redirect URIs. قبل اجتياز مراجعة التطبيق يعمل الربط لحسابات المطورين والمختبرين فقط.</p></section>
    <section class="panel panel-pad"><h2 style="margin-bottom:6px">ويب هوك ميتا (فيسبوك وإنستغرام وواتساب)</h2>
      <p class="muted small" style="margin:0 0 4px">الصق هذين القيمتين في إعدادات Webhooks داخل تطبيقك في Meta for Developers، واشترك في أحداث: <span class="ltr">feed</span> للصفحات، <span class="ltr">comments</span> و<span class="ltr">messages</span> لإنستغرام، و<span class="ltr">messages</span> لواتساب.</p>
      <div class="kv"><span>عنوان الاستدعاء</span><code class="ltr">${esc(info.metaWebhook)}</code>${copyBtn(info.metaWebhook)}<span>رمز التحقق</span><code class="ltr">${esc(info.verifyToken)}</code>${copyBtn(info.verifyToken)}</div>
      ${info.baseUrl.startsWith('http://localhost') ? '<p class="err">العنوان الحالي محلي. ضع العنوان العام (HTTPS) في الإعدادات أو في PUBLIC_URL ليظهر الرابط الصحيح.</p>' : ''}
      ${info.appSecretSet ? '' : '<p class="err">لم يُضبط App Secret بعد: يُقبل أي طلب على الويب هوك دون توقيع. أضفه من الإعدادات قبل الإنتاج.</p>'}</section>
    <section class="panel">${list.length ? `<div class="rows">${list.map((a) => `
      <div class="row ${a.active ? '' : 'off'}"><div><h3>${esc(a.name)} <span class="chip ink">${chan(a.channel)}</span> ${a.hasToken ? '<span class="chip teal">التوكن محفوظ</span>' : '<span class="chip saffron">بلا توكن (تسجيل فقط)</span>'}</h3>
        <div class="small muted">${a.external_id ? `المعرّف: <span class="ltr">${esc(a.external_id)}</span>` : 'لم يُحدَّد المعرّف'}</div>
        ${a.channel === 'telegram' || a.channel === 'tiktok' ? `<div class="kv"><span>ويب هوك</span><code class="ltr">${esc(a.webhook)}</code>${copyBtn(a.webhook)}${a.inboundSecret ? `<span>السر (x-webhook-secret)</span><code class="ltr">${esc(a.inboundSecret)}</code>${copyBtn(a.inboundSecret)}` : ''}</div>` : ''}
        </div><div class="acts">${a.channel === 'telegram' ? `<button class="btn sm" data-tg="${a.id}">تفعيل الويب هوك</button>` : ''}<button class="btn sm" data-edit="${a.id}">تعديل</button><button class="btn sm danger" data-del="${a.id}">حذف</button></div></div>`).join('')}</div>`
      : '<div class="empty"><h3>لا توجد حسابات مربوطة</h3><p>اربط صفحة فيسبوك أو حساب إنستغرام أو بوت تيليغرام للبدء.</p></div>'}</section></div>`;
  wireCopy(v);
  $$('[data-ch]', v).forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.ch === 'whatsapp') return waDialog();
    if (!info.metaConnect.ready) return toast('أدخل App ID و App Secret أولاً', true);
    guarded(b, async () => { const r = await api('POST', '/api/meta/connect', { channel: b.dataset.ch }); location.href = r.url; });
  }));
  $$('[data-unlink]', v).forEach((b) => b.addEventListener('click', () => unlinkDialog(b.dataset.unlink, list)));
  $('#fbf')?.addEventListener('submit', async (ev) => { ev.preventDefault(); await guarded($('button', ev.target), async () => { await saveSettings(ev.target); info = await api('GET', '/api/info'); toast('تم الحفظ'); route(); }); });
  $('#newa').addEventListener('click', () => accountDialog(null));
  $$('[data-edit]', v).forEach((b) => b.addEventListener('click', () => accountDialog(list.find((a) => a.id == b.dataset.edit))));
  $$('[data-del]', v).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('حذف هذا الحساب؟ ستبقى سجلاته.')) return;
    await guarded(b, async () => { await api('DELETE', `/api/accounts/${b.dataset.del}`); toast('تم حذف الحساب'); route(); });
  }));
  $$('[data-tg]', v).forEach((b) => b.addEventListener('click', () => guarded(b, async () => { await api('POST', `/api/accounts/${b.dataset.tg}/telegram-webhook`); toast('تم ربط الويب هوك مع تيليغرام'); })));
};

async function pickDialog(token) {
  let r;
  try { r = await api('GET', `/api/meta/pending?token=${encodeURIComponent(token)}`); } catch (e) { return toast(e.message, true); }
  if (!r.items.length) return toast(r.channel === 'instagram' ? 'لا توجد حسابات إنستغرام مهنية مرتبطة بصفحاتك' : 'لم تُمنح صلاحية أي صفحة. أعد الربط واختر صفحتك', true);
  const d = dialog(`اختر حسابات ${chan(r.channel)} للربط`, `<div class="rows">${r.items.map((i) => `<label class="check" style="padding:10px 0"><input type="checkbox" name="k" value="${esc(i.key)}" ${i.linked ? '' : 'checked'}><span>${esc(i.name)} <span class="muted small ltr">${esc(i.id)}</span> ${i.linked ? '<span class="chip teal">مربوط</span>' : ''}</span></label>`).join('')}</div>`, 'ربط المحدد', async (fd) => {
    const keys = fd.getAll('k'); if (!keys.length) throw new Error('اختر حساباً واحداً على الأقل');
    const x = await api('POST', '/api/meta/pick', { token, keys });
    toast(`تم ربط ${x.connected} حساب ✅` + (x.failed ? ` (تعذّر ${x.failed})` : '')); d.close(); route();
  });
}
function unlinkDialog(channel, list) {
  const mine = list.filter((a) => a.channel === channel);
  const d = dialog(`إلغاء ارتباط ${chan(channel)}`, `<p class="muted small" style="margin:0 0 8px">اختر ما تريد فصله. تبقى السجلات والحملات، ويتوقف الرد على هذا الحساب.</p><div class="rows">${mine.map((a) => `<label class="check" style="padding:10px 0"><input type="checkbox" name="u" value="${a.id}"><span>${esc(a.name)} <span class="muted small ltr">${esc(a.external_id || '')}</span></span></label>`).join('')}</div>`, 'إلغاء الارتباط', async (fd) => {
    const ids = fd.getAll('u'); if (!ids.length) throw new Error('اختر حساباً');
    for (const id of ids) await api('DELETE', `/api/accounts/${id}`);
    toast('تم إلغاء الارتباط'); d.close(); route();
  });
}
function waDialog() {
  const d = dialog('ربط واتساب', `<p class="muted small" style="margin:0 0 10px">واتساب يتطلب رقماً مسجلاً في WhatsApp Cloud API. انسخ <b>Phone Number ID</b> و<b>التوكن الدائم</b> من Meta for Developers ← WhatsApp ← API Setup (أنشئ توكناً دائماً من System User في Business Settings).</p>
    <div class="field"><label class="lbl" for="w-n">اسم تعريفي</label><input id="w-n" name="name" type="text" required placeholder="واتساب المتجر"></div>
    <div class="field"><label class="lbl" for="w-i">Phone Number ID</label><input id="w-i" name="external_id" type="text" class="ltr" required></div>
    <div class="field"><label class="lbl" for="w-t">التوكن الدائم</label><input id="w-t" name="token" type="password" autocomplete="off" required></div>
    <p class="hint">ويب هوك واتساب نفسه ويب هوك ميتا الظاهر أدناه؛ اشترك في حقل <span class="ltr">messages</span>.</p>`, 'ربط الرقم', async (fd) => {
    await api('POST', '/api/accounts', { ...Object.fromEntries(fd), channel: 'whatsapp' }); toast('تم ربط واتساب ✅'); d.close(); route();
  });
}

const ID_HELP = {
  facebook: ['معرّف الصفحة (Page ID)', 'توكن الصفحة (Page Access Token)', 'الصلاحيات المطلوبة: pages_messaging و pages_manage_engagement و pages_read_engagement.'],
  instagram: ['معرّف حساب إنستغرام المهني', 'التوكن', 'الصلاحيات المطلوبة: instagram_basic و instagram_manage_comments و instagram_manage_messages.'],
  whatsapp: ['معرّف رقم الهاتف (Phone Number ID)', 'التوكن الدائم', 'من WhatsApp Cloud API في تطبيق Meta.'],
  telegram: ['(غير مطلوب)', 'توكن البوت من BotFather', 'أضف البوت إلى مجموعة النقاش المرتبطة بقناتك لتُعامل الرسائل هناك كتعليقات. لا يستطيع البوت مراسلة شخص على الخاص قبل أن يبدأ هو المحادثة.'],
  tiktok: ['(اختياري)', '(غير مطلوب)', 'تيك توك لا يتيح واجهة عامة للرد؛ استخدم عنوان إرسال لنظام معتمد لديك (انظر الدليل).'],
};
function accountDialog(a) {
  const x = a || { channel: 'facebook', name: '', external_id: '', outbound_url: '' };
  const body = `<div class="field"><label class="lbl" for="a-ch">القناة</label><select id="a-ch" name="channel" ${a ? 'disabled' : ''}>${opts(CHANNELS, x.channel)}</select></div>
  <div class="field"><label class="lbl" for="a-name">اسم تعريفي</label><input id="a-name" name="name" type="text" required value="${esc(x.name)}" placeholder="مثال: صفحة المتجر"></div>
  <div class="field"><label class="lbl" for="a-id" id="l-id"></label><input id="a-id" name="external_id" type="text" class="ltr" value="${esc(x.external_id)}"></div>
  <div class="field"><label class="lbl" for="a-tok" id="l-tok"></label><input id="a-tok" name="token" type="password" autocomplete="off" placeholder="${a?.hasToken ? 'محفوظ — اتركه فارغاً دون تغيير' : ''}"><span class="hint" id="a-help"></span></div>
  <div id="tt" hidden><div class="field"><label class="lbl" for="a-ou">عنوان الإرسال (outbound_url)</label><input id="a-ou" name="outbound_url" type="url" class="ltr" value="${esc(x.outbound_url)}" placeholder="https://"></div>
  <div class="field"><label class="lbl" for="a-os">سر توقيع الإرسال (اختياري)</label><input id="a-os" name="outbound_secret" type="password" autocomplete="off"><span class="hint">يُرسل توقيع HMAC-SHA256 في ترويسة x-signature.</span></div></div>
  ${a ? `<label class="check"><input type="checkbox" name="active" ${x.active ? 'checked' : ''}>الحساب مفعّل</label>` : ''}`;
  const d = dialog(a ? 'تعديل الحساب' : 'ربط حساب', body, a ? 'حفظ' : 'ربط الحساب', async (fd) => {
    const p = Object.fromEntries(fd);
    if (a) { p.active = fd.has('active'); } else { p.channel = $('#a-ch', d).value; }
    await api(a ? 'PUT' : 'POST', a ? `/api/accounts/${a.id}` : '/api/accounts', p);
    toast(a ? 'تم الحفظ' : 'تم ربط الحساب'); d.close(); route();
  });
  const sync = () => {
    const ch = $('#a-ch', d).value; const [i, t, h] = ID_HELP[ch];
    $('#l-id', d).textContent = i; $('#l-tok', d).textContent = t; $('#a-help', d).textContent = h; $('#tt', d).hidden = ch !== 'tiktok';
  };
  d.addEventListener('change', sync); sync();
}

/* ---------- معلومات النشاط والإعدادات ---------- */

const saveSettings = (form, extra = {}) => api('PUT', '/api/settings', { ...Object.fromEntries(new FormData(form)), ...extra });

VIEWS.business = async (v) => {
  const s = await api('GET', '/api/settings');
  v.innerHTML = head('معلومات النشاط', 'هذه هي المعرفة التي يعتمد عليها الذكاء الاصطناعي. كلما كانت أدق، كانت الردود أصدق.') +
    `<form class="panel panel-pad" id="bf" style="max-width:780px">
    <div class="field"><label class="lbl" for="b1">اسم النشاط</label><input id="b1" type="text" name="business_name" value="${esc(s.business_name)}" required></div>
    <div class="field"><label class="lbl" for="b2">نبذة عن النشاط</label><textarea id="b2" name="business_about" style="min-height:80px">${esc(s.business_about)}</textarea></div>
    <div class="field"><label class="lbl" for="b3">المعلومات المعتمدة</label><textarea id="b3" name="business_details" style="min-height:190px" placeholder="المنتجات والأسعار، مناطق التوصيل، ساعات العمل، طرق الدفع، سياسة الإرجاع، أرقام وروابط التواصل…">${esc(s.business_details)}</textarea><span class="hint">لن يذكر الذكاء الاصطناعي سعراً أو رقماً أو رابطاً غير موجود هنا.</span></div>
    <div class="field"><label class="lbl" for="b4">أسلوب الكتابة</label><input id="b4" type="text" name="tone" value="${esc(s.tone)}"></div>
    <div class="cols"><div class="field"><label class="lbl" for="b5">كلمات طلب التحدث مع موظف</label><input id="b5" type="text" name="handoff_words" value="${esc(s.handoff_words)}"><span class="hint">عند ورودها في رسالة خاصة لا يجيب الذكاء الاصطناعي، بل يُرسل رد التحويل.</span></div>
    <div class="field"><label class="lbl" for="b6">رد التحويل</label><textarea id="b6" name="handoff_reply" style="min-height:70px">${esc(s.handoff_reply)}</textarea></div></div>
    <button class="btn primary">حفظ المعلومات</button></form>`;
  $('#bf').addEventListener('submit', async (ev) => { ev.preventDefault(); await guarded($('button', ev.target), async () => { await saveSettings(ev.target); toast('تم حفظ معلومات النشاط'); }); });
};

VIEWS.settings = async (v) => {
  const s = await api('GET', '/api/settings');
  v.innerHTML = head('الإعدادات', '') + `<div class="stack" style="max-width:780px">
  <form class="panel panel-pad" id="sf"><h2 style="margin-bottom:14px">الذكاء الاصطناعي</h2>
    <div class="cols"><div class="field"><label class="lbl" for="s1">المزوّد</label><select id="s1" name="ai_provider"><option value="anthropic" ${s.ai_provider === 'anthropic' ? 'selected' : ''}>Anthropic (Claude)</option><option value="openai" ${s.ai_provider === 'openai' ? 'selected' : ''}>متوافق مع OpenAI</option></select></div>
    <div class="field"><label class="lbl" for="s2">النموذج</label><input id="s2" type="text" class="ltr" name="ai_model" value="${esc(s.ai_model)}"></div></div>
    <div class="field"><label class="lbl" for="s3">مفتاح API</label><input id="s3" type="password" name="ai_key" autocomplete="off" placeholder="${s.ai_key_set ? 'محفوظ — اتركه فارغاً دون تغيير' : 'sk-…'}"></div>
    <div class="field"><label class="lbl" for="s4">عنوان API (للمزوّد المتوافق مع OpenAI فقط)</label><input id="s4" type="url" class="ltr" name="ai_base" value="${esc(s.ai_base)}" placeholder="https://api.openai.com/v1"></div>
    <h2 style="margin:22px 0 14px">السرعة والحماية</h2>
    <div class="cols"><div class="field"><label class="lbl" for="s5">أقل تأخير قبل الرد (ثوانٍ)</label><input id="s5" type="number" min="0" name="delay_min" value="${esc(s.delay_min)}"></div>
    <div class="field"><label class="lbl" for="s6">أطول تأخير (ثوانٍ)</label><input id="s6" type="number" min="0" name="delay_max" value="${esc(s.delay_max)}"></div></div>
    <div class="field"><label class="lbl" for="s7">الحد الأقصى للردود في الساعة لكل حساب</label><input id="s7" type="number" min="1" name="hourly_cap" value="${esc(s.hourly_cap)}"><span class="hint">التأخير العشوائي والحد الأقصى يجعلان السلوك طبيعياً ويحميان حسابك من قيود المنصات.</span></div>
    <h2 style="margin:22px 0 14px">الاتصال</h2>
    <div class="field"><label class="lbl" for="s8">العنوان العام للمنصة</label><input id="s8" type="url" class="ltr" name="public_url" value="${esc(s.public_url)}" placeholder="https://example.com"></div>
    <div class="field"><label class="lbl" for="s9">Meta App Secret</label><input id="s9" type="password" name="app_secret" autocomplete="off" placeholder="${s.app_secret_set ? 'محفوظ — اتركه فارغاً دون تغيير' : ''}"><span class="hint">للتحقق من توقيع طلبات ميتا. موصى به بشدة.</span></div>
    <button class="btn primary">حفظ الإعدادات</button></form>
  ${info.passwordFromEnv ? '' : `<form class="panel panel-pad" id="pf"><h2 style="margin-bottom:14px">كلمة المرور</h2>
    <div class="cols"><div class="field"><label class="lbl" for="p1">الحالية</label><input id="p1" type="password" name="current" autocomplete="current-password" required></div>
    <div class="field"><label class="lbl" for="p2">الجديدة (8 أحرف على الأقل)</label><input id="p2" type="password" name="next" autocomplete="new-password" minlength="8" required></div></div>
    <button class="btn">تغيير كلمة المرور</button></form>`}</div>`;
  $('#sf').addEventListener('submit', async (ev) => { ev.preventDefault(); await guarded($('button', ev.target), async () => { await saveSettings(ev.target); toast('تم حفظ الإعدادات'); info = await api('GET', '/api/info'); const sl = $('.side-foot .status-line'); if (sl) sl.innerHTML = `<span class="dot ${info.aiConfigured ? 'on' : 'off'}"></span><span>${info.aiConfigured ? 'الذكاء الاصطناعي يعمل' : 'الذكاء الاصطناعي غير مُفعّل'}</span>`; }); });
  $('#pf')?.addEventListener('submit', async (ev) => { ev.preventDefault(); await guarded($('button', ev.target), async () => { await api('PUT', '/api/password', Object.fromEntries(new FormData(ev.target))); ev.target.reset(); toast('تم تغيير كلمة المرور'); }); });
};

/* ---------- التجربة ---------- */

VIEWS.playground = async (v) => {
  const camps = await api('GET', '/api/campaigns');
  v.innerHTML = head('التجربة', 'جرّب كيف سيرد النظام قبل أن يصل إليك تعليق حقيقي. لا يُرسل شيء إلى أي منصة.') + `
  <div class="grid-2"><form class="panel panel-pad" id="pg"><div class="field"><span class="lbl">النوع</span><div class="seg" role="radiogroup"><label><input type="radio" name="kind" value="comment" checked><span>تعليق</span></label><label><input type="radio" name="kind" value="message"><span>رسالة خاصة</span></label></div></div>
    <div class="cols"><div class="field"><label class="lbl" for="g1">القناة</label><select id="g1" name="channel">${opts(CHANNELS, 'facebook')}</select></div>
    <div class="field"><label class="lbl" for="g2">اسم الشخص</label><input id="g2" type="text" name="user_name" value="أحمد"></div></div>
    <div class="field" id="g-post"><label class="lbl" for="g3">معرّف المنشور (اختياري)</label><input id="g3" type="text" class="ltr" name="post_id" placeholder="لاختبار حملة منشور محدد"></div>
    <div class="field"><label class="lbl" for="g4">النص</label><textarea id="g4" name="text" required placeholder="بكم السعر؟ وهل التوصيل متوفر؟"></textarea></div>
    <button class="btn primary" id="gs">جرّب الرد</button>
    ${camps.length ? '' : '<p class="small muted" style="margin-top:12px">لا توجد حملات. التعليقات لن تجد حملة مطابقة؛ أنشئ حملة أولاً.</p>'}</form>
    <section class="panel panel-pad" id="gout"><div class="empty" style="padding:30px 10px"><h3>النتيجة تظهر هنا</h3><p>اكتب تعليقاً تجريبياً واضغط «جرّب الرد».</p></div></section></div>`;
  const form = $('#pg');
  form.addEventListener('change', () => { $('#g-post').hidden = form.kind.value !== 'comment'; });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await guarded($('#gs'), async () => {
      $('#gout').innerHTML = '<p class="muted" style="display:flex;gap:10px;align-items:center"><span class="spin"></span>جارٍ توليد الرد…</p>';
      const r = await api('POST', '/api/simulate', Object.fromEntries(new FormData(form)));
      const fake = { kind: form.kind.value, channel: form.channel.value, post_id: form.post_id.value, user_name: form.user_name.value, text: form.text.value, public_reply: r.publicReply || '', dm_reply: r.dmReply || '', public_status: r.publicStatus, dm_status: r.dmStatus, status: r.status, error: r.error };
      const st = STATUS[r.status] || [r.status, ''];
      $('#gout').innerHTML = `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px"><h2>النتيجة</h2><span class="chip ${st[1]}">${st[0]}</span>${r.campaign ? `<span class="chip ink">${esc(r.campaign.name)}</span>` : ''}</div>
        ${r.status === 'no_match' ? '<p class="muted">لم تطابق أي حملة مفعّلة هذا التعليق (القناة أو المنشور أو الكلمات المفتاحية). لن يُرد عليه.</p>' : thread(fake)}
        ${r.aiConfigured ? '' : '<p class="err">الذكاء الاصطناعي غير مفعّل: استُخدمت النصوص الثابتة. أضف مفتاح API من الإعدادات.</p>'}`;
    });
  });
};

/* ---------- السجل ---------- */

VIEWS.log = async (v) => {
  v.innerHTML = head('السجل', 'كل تعليق ورسالة وصلت، وما الذي أُرسل ردّاً عليها.') +
    `<div class="tools"><select id="lk" aria-label="النوع"><option value="">كل الأنواع</option><option value="comment">التعليقات</option><option value="message">الرسائل</option></select>
    <select id="ls" aria-label="الحالة"><option value="">كل الحالات</option>${Object.entries(STATUS).map(([k, [t]]) => `<option value="${k}">${t}</option>`).join('')}</select></div>
    <section class="panel" id="lbox"></section>`;
  const load = async () => {
    const q = new URLSearchParams({ limit: 150 });
    if ($('#lk').value) q.set('kind', $('#lk').value);
    if ($('#ls').value) q.set('status', $('#ls').value);
    const rows = await api('GET', `/api/events?${q}`);
    $('#lbox').innerHTML = rows.length ? rows.map((e) => `<details class="ev"><summary>
      <span class="small muted num">${fmtTime(e.ts)}</span><span class="hide-sm">${statusChip(e)}</span>
      <span class="trunc"><b>${esc(e.user_name || 'مستخدم')}</b> · ${esc(clipTxt(e.text))}</span><span>${e.simulated ? '<span class="chip">تجربة</span>' : `<span class="chip ink">${chan(e.channel)}</span>`}</span></summary>
      <div class="body"><div class="meta small muted" style="margin-bottom:8px">${e.campaign_name ? `الحملة: ${esc(e.campaign_name)}` : 'بلا حملة'}${e.account_name ? ` · الحساب: ${esc(e.account_name)}` : ''}</div>${thread(e)}</div></details>`).join('')
      : '<div class="empty"><h3>لا توجد سجلات</h3><p>ستظهر هنا التعليقات والرسائل فور وصولها.</p></div>';
  };
  $('#lk').addEventListener('change', load); $('#ls').addEventListener('change', load);
  await load();
};


/* ---------- نماذج الحجز والطلبات + الطلبات المستلمة ---------- */

const FT = { text: 'نص', phone: 'هاتف', number: 'رقم', date: 'تاريخ', time: 'وقت', choice: 'اختيار' };
const FT_BY_NAME = Object.fromEntries(Object.entries(FT).map(([k, v]) => [v, k]));
const SUB_STATUS = { new: ['جديد', 'saffron'], confirmed: ['مؤكد', 'teal'], done: ['منجز', 'ink'], cancelled: ['ملغي', 'coral'] };
const SAMPLE = {
  booking: { name: 'حجز موعد', kind: 'booking', triggers: 'حجز, موعد, احجز', intro: '', done_text: '',
    fields: [{ label: 'ما اسمك الكامل؟', type: 'text' }, { label: 'رقم هاتفك؟', type: 'phone' }, { label: 'أي يوم يناسبك؟', type: 'date' }, { label: 'أي وقت يناسبك؟', type: 'time' }, { label: 'نوع الخدمة؟', type: 'choice', options: ['كشف', 'متابعة', 'استشارة'] }, { label: 'ملاحظات', type: 'text', optional: true }] },
  order: { name: 'طلب منتج', kind: 'order', triggers: 'اطلب, طلب, شراء, اريد اشتري', intro: '', done_text: '',
    fields: [{ label: 'ما اسمك الكامل؟', type: 'text' }, { label: 'رقم هاتفك؟', type: 'phone' }, { label: 'ما المنتج المطلوب؟', type: 'text' }, { label: 'الكمية؟', type: 'number' }, { label: 'المحافظة والعنوان؟', type: 'text' }, { label: 'ملاحظات', type: 'text', optional: true }] },
};
const fieldsToText = (fs) => fs.map((f) => [f.label + (f.optional ? ' (اختياري)' : ''), FT[f.type] || 'نص', ...(f.type === 'choice' ? [f.options.join('، ')] : [])].join(' | ')).join('\n');
function textToFields(txt) {
  return txt.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [a, b, c] = l.split('|').map((x) => x.trim());
    const optional = /\(اختياري\)\s*$/.test(a);
    const type = FT_BY_NAME[b] || (b && Object.keys(FT).includes(b) ? b : 'text');
    return { label: a.replace(/\(اختياري\)\s*$/, '').trim(), type, optional, options: type === 'choice' ? String(c || '').split(/[,،]/).map((x) => x.trim()).filter(Boolean) : [] };
  });
}

VIEWS.forms = async (v) => {
  const list = await api('GET', '/api/forms');
  v.innerHTML = head('نماذج الحجز والطلب', 'يسأل البوت العميل سؤالاً سؤالاً في الرسائل الخاصة، يتحقق من الأجوبة، ثم يحفظ الطلب لتراه وتصدّره إلى Excel.',
    '<button class="btn primary" id="nb">+ نموذج حجز</button> <button class="btn" id="no">+ نموذج طلب</button>') +
    `<section class="panel">${list.length ? `<div class="rows">${list.map((f) => `
      <div class="row ${f.active ? '' : 'off'}"><div><h3>${esc(f.name)} <span class="chip ${f.kind === 'order' ? 'saffron' : 'teal'}">${f.kind === 'order' ? 'طلب' : 'حجز'}</span></h3>
        <div class="tags"><span class="chip">${f.fields.length} أسئلة</span><span class="chip">تبدأ بكلمات: ${esc(clipTxt(f.triggers || '— لا شيء —', 40))}</span><span class="chip ink">${f.count} مستلَم</span></div></div>
        <div class="acts"><label class="switch" title="تفعيل"><input type="checkbox" data-toggle="${f.id}" ${f.active ? 'checked' : ''} aria-label="تفعيل ${esc(f.name)}"><span></span></label>
        <button class="btn sm" data-test="${f.id}">جرّب</button><button class="btn sm" data-edit="${f.id}">تعديل</button><button class="btn sm danger" data-del="${f.id}">حذف</button></div></div>`).join('')}</div>`
      : '<div class="empty"><h3>لا توجد نماذج</h3><p>أنشئ نموذج حجز أو طلب، وعندما يكتب العميل «حجز» أو «اطلب» يبدأ البوت بالأسئلة.</p></div>'}</section>
    <p class="muted small" style="margin-top:12px">يعمل النموذج في الرسائل الخاصة (فيسبوك، إنستغرام، واتساب، تيليغرام). ويمكن توجيه العميل إليه من رسالة الحملة: «اكتب حجز لتبدأ».</p>`;
  $('#nb').addEventListener('click', () => formDialog(null, 'booking'));
  $('#no').addEventListener('click', () => formDialog(null, 'order'));
  $$('[data-edit]', v).forEach((b) => b.addEventListener('click', () => formDialog(list.find((f) => f.id == b.dataset.edit))));
  $$('[data-test]', v).forEach((b) => b.addEventListener('click', () => formTest(list.find((f) => f.id == b.dataset.test))));
  $$('[data-del]', v).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('حذف النموذج؟ تبقى الطلبات المستلمة محفوظة.')) return;
    await guarded(b, async () => { await api('DELETE', `/api/forms/${b.dataset.del}`); toast('تم الحذف'); route(); });
  }));
  $$('[data-toggle]', v).forEach((i) => i.addEventListener('change', async () => {
    try { await api('PUT', `/api/forms/${i.dataset.toggle}`, { active: i.checked }); route(); } catch (e) { toast(e.message, true); i.checked = !i.checked; }
  }));
};

function formDialog(f, kind = 'booking') {
  const x = f || SAMPLE[kind];
  const body = `
  <div class="field"><label class="lbl" for="g-name">اسم النموذج</label><input id="g-name" name="name" type="text" required value="${esc(x.name)}"></div>
  <div class="cols"><div class="field"><label class="lbl" for="g-kind">النوع</label><select id="g-kind" name="kind"><option value="booking" ${x.kind !== 'order' ? 'selected' : ''}>حجز موعد</option><option value="order" ${x.kind === 'order' ? 'selected' : ''}>طلب منتج</option></select></div>
  <div class="field"><label class="lbl" for="g-tr">كلمات تبدأ النموذج</label><input id="g-tr" name="triggers" type="text" value="${esc(x.triggers)}"><span class="hint">إذا احتوت رسالة العميل إحداها يبدأ البوت بالأسئلة. افصل بفاصلة.</span></div></div>
  <div class="field"><label class="lbl" for="g-fields">الأسئلة (سطر لكل سؤال)</label><textarea id="g-fields" name="fields_text" style="min-height:180px" required>${esc(fieldsToText(x.fields))}</textarea>
    <span class="hint">الصيغة: <span class="ltr">السؤال | النوع | الخيارات</span>. الأنواع: نص، هاتف، رقم، تاريخ، وقت، اختيار. مثال: <span class="ltr">نوع الخدمة؟ | اختيار | كشف، متابعة</span>. أضف <b>(اختياري)</b> بعد السؤال ليستطيع العميل تخطيه. عنوان عمود Excel = نص السؤال.</span></div>
  <div class="field"><label class="lbl" for="g-intro">رسالة البداية (اختياري)</label><textarea id="g-intro" name="intro" style="min-height:60px" placeholder="أهلاً {name} 🌷 سأسجّل طلبك الآن...">${esc(x.intro)}</textarea></div>
  <div class="field"><label class="lbl" for="g-done">رسالة التأكيد (اختياري)</label><textarea id="g-done" name="done_text" style="min-height:70px" placeholder="شكراً {name}! تم تسجيل طلبك رقم {id} ✅&#10;{summary}">${esc(x.done_text)}</textarea><span class="hint">المتغيرات: {name} الاسم، {id} رقم الطلب، {summary} ملخص الأجوبة.</span></div>
  ${f ? `<label class="check"><input type="checkbox" name="active" ${f.active ? 'checked' : ''}>النموذج مفعّل</label>` : ''}`;
  const d = dialog(f ? 'تعديل النموذج' : (kind === 'order' ? 'نموذج طلب جديد' : 'نموذج حجز جديد'), body, f ? 'حفظ' : 'إنشاء النموذج', async (fd) => {
    const p = Object.fromEntries(fd);
    p.fields = textToFields(p.fields_text); delete p.fields_text;
    if (f) p.active = fd.has('active');
    await api(f ? 'PUT' : 'POST', f ? `/api/forms/${f.id}` : '/api/forms', p);
    toast('تم الحفظ'); d.close(); route();
  });
}

function botTest(title, hint) {
  const sim = Math.random().toString(36).slice(2, 10);
  const d = dialog(title, `<p class="muted small" style="margin:0 0 10px">${hint} التجربة لا ترسل شيئاً فعلياً ولا تحفظ طلبات.</p>
    <div class="field"><label class="lbl" for="tch">القناة</label><select id="tch">${opts({ facebook: 'ماسنجر', instagram: 'إنستغرام', whatsapp: 'واتساب', telegram: 'تيليغرام' }, 'facebook')}</select></div>
    <div id="tlog" class="stack" style="max-height:360px;overflow:auto;margin-bottom:10px"></div>
    <div class="field"><input id="tin" type="text" placeholder="اكتب رسالتك…" autocomplete="off"></div>`, 'إرسال', async () => {
    const inp = $('#tin', d); const text = inp.value.trim(); if (!text) return;
    inp.value = ''; await send(text, '');
  });
  const log = $('#tlog', d);
  const bubble = (who, inner, bg) => log.insertAdjacentHTML('beforeend', `<div class="bubble" ${bg ? `style="background:${bg}"` : ''}><div class="who">${who}</div>${inner}</div>`);
  async function send(text, payload) {
    bubble('العميل', `<div class="txt">${esc(text)}</div>`);
    const r = await api('POST', '/api/simulate', { kind: 'message', channel: $('#tch', d).value, text, payload, sim_user: sim, user_name: 'أحمد' });
    const msgs = r.replies || (r.dmReply ? [{ text: r.dmReply }] : []);
    if (!msgs.length) bubble('البوت', `<div class="txt muted">${r.status === 'skipped' ? '(البوت متوقف لهذا الشخص بانتظار موظف)' : '(لا يوجد رد)'}</div>`, 'var(--saffron-soft)');
    for (const m of msgs) {
      const btns = (m.buttons || []).map((b) => (b.url ? `<a class="btn sm" href="${esc(b.url)}" target="_blank" rel="noopener">🔗 ${esc(b.title)}</a>` : `<button type="button" class="btn sm" data-p="${esc(b.payload)}" data-t="${esc(b.title)}">${esc(b.title)}</button>`)).join(' ');
      bubble('البوت', `${m.image ? `<div class="small"><a href="${esc(m.image)}" target="_blank" rel="noopener">🖼 صورة</a></div>` : ''}<div class="txt">${esc(m.text || '')}</div>${btns ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${btns}</div>` : ''}`, 'var(--saffron-soft)');
    }
    if (r.paused) bubble('النظام', '<div class="txt muted">تم تحويلك لموظف وأُوقف البوت لهذا الشخص.</div>');
    log.scrollTop = log.scrollHeight;
  }
  log.addEventListener('click', (ev) => { const b = ev.target.closest('[data-p]'); if (b) guarded(b, () => send(b.dataset.t, b.dataset.p)); });
  $('#tin', d).focus();
}
const formTest = (f) => botTest(`تجربة: ${esc(f.name)}`, `اكتب إحدى كلمات البدء (مثلاً «${esc((f.triggers.split(/[,،]/)[0] || 'حجز').trim())}») وأجب عن الأسئلة.`);

let SUBF = { form: '', status: '' };
VIEWS.submissions = async (v) => {
  const [forms, rows] = await Promise.all([api('GET', '/api/forms'), api('GET', `/api/submissions?form_id=${SUBF.form}&status=${SUBF.status}`)]);
  const q = `form_id=${SUBF.form}&status=${SUBF.status}`;
  v.innerHTML = head('الطلبات والحجوزات', 'كل ما أجاب عنه العملاء، مرتّباً. حدّث الحالة، أو حمّله ملف Excel.',
    `<a class="btn primary" href="/api/submissions.xlsx?${q}" download>⬇ تحميل Excel</a>`) +
    `<section class="panel panel-pad" style="margin-bottom:14px"><div class="cols"><div class="field"><label class="lbl" for="sf1">النموذج</label><select id="sf1"><option value="">كل النماذج</option>${forms.map((f) => `<option value="${f.id}" ${SUBF.form == f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>
    <div class="field"><label class="lbl" for="sf2">الحالة</label><select id="sf2"><option value="">كل الحالات</option>${Object.entries(SUB_STATUS).map(([k, [t]]) => `<option value="${k}" ${SUBF.status == k ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div></section>
    <section class="panel">${rows.length ? `<div class="rows">${rows.map((r) => `
      <div class="row"><div><h3>#${r.id} · ${esc(r.answers[Object.keys(r.answers)[0]] || r.user_name || 'عميل')} <span class="chip ink">${chan(r.channel)}</span> <span class="chip">${esc(r.form_name || '')}</span></h3>
        <div class="small" style="line-height:1.9">${Object.entries(r.answers).filter(([, a]) => a).map(([k, a]) => `<span class="muted">${esc(k)}:</span> <b>${esc(a)}</b>`).join(' &nbsp;·&nbsp; ')}</div>
        <div class="small muted" style="margin-top:4px">${fmtTime(r.created_at)}</div></div>
        <div class="acts"><select data-st="${r.id}" aria-label="حالة الطلب ${r.id}">${Object.entries(SUB_STATUS).map(([k, [t]]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${t}</option>`).join('')}</select><button class="btn sm danger" data-del="${r.id}">حذف</button></div></div>`).join('')}</div>`
      : '<div class="empty"><h3>لا توجد طلبات بعد</h3><p>ستظهر هنا فور أن يُكمل أحد العملاء أسئلة النموذج.</p></div>'}</section>`;
  $('#sf1').addEventListener('change', (e) => { SUBF.form = e.target.value; route(); });
  $('#sf2').addEventListener('change', (e) => { SUBF.status = e.target.value; route(); });
  $$('[data-st]', v).forEach((sel) => sel.addEventListener('change', async () => { try { await api('PUT', `/api/submissions/${sel.dataset.st}`, { status: sel.value }); toast('تم تحديث الحالة'); } catch (e) { toast(e.message, true); } }));
  $$('[data-del]', v).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('حذف هذا الطلب نهائياً؟')) return;
    await guarded(b, async () => { await api('DELETE', `/api/submissions/${b.dataset.del}`); toast('تم الحذف'); route(); });
  }));
};


/* ---------- المسارات والأزرار + الكلمات المفتاحية + القوالب ---------- */

const MATCH_LABEL = { is: 'الرسالة تساوي', contains: 'تحتوي على', word: 'تحتوي كلمة', starts: 'تبدأ بـ', resume: 'كلمة استئناف البوت', image: 'الرسالة صورة', sticker: 'الرسالة ملصق', audio: 'الرسالة صوت' };
const NODE_LABEL = { message: 'رسالة', goto: 'الانتقال لمسار آخر', form: 'بدء نموذج (حجز/طلب)', handoff: 'تحويل لموظف (إيقاف البوت)' };
const parseBtns = (txt) => txt.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const [t, ...r] = l.split('=>'); const title = t.trim(); const to = r.join('=>').trim();
  if (/^https?:\/\//i.test(to)) return { title, kind: 'url', to };
  let m = /^#(\d+)$/.exec(to); if (m) return { title, kind: 'flow', to: m[1] };
  m = /^form:(\d+)$/i.exec(to); if (m) return { title, kind: 'form', to: m[1] };
  return { title, kind: 'node', to };
}).filter((b) => b.title && b.to);
const btnsToText = (bs) => (bs || []).map((b) => `${b.title} => ${b.kind === 'flow' ? '#' + b.to : b.kind === 'form' ? 'form:' + b.to : b.to}`).join('\n');

VIEWS.flows = async (v) => {
  const [list, set] = await Promise.all([api('GET', '/api/flows'), api('GET', '/api/settings')]);
  v.innerHTML = head('المسارات والأزرار', 'ابنِ قوائم بأزرار ينتقل بينها العميل في ماسنجر وإنستغرام وواتساب وتيليغرام (وقائمة مرقّمة في بقية القنوات).',
    '<button class="btn primary" id="nf">+ مسار جديد</button> <button class="btn" id="tp">+ من قالب جاهز</button>') +
    `<section class="panel panel-pad" style="margin-bottom:14px"><div class="field" style="margin:0"><label class="lbl" for="dfl">الرد الافتراضي عند عدم وجود كلمة مطابقة</label>
      <select id="dfl"><option value="">الذكاء الاصطناعي يجيب</option>${list.map((f) => `<option value="${f.id}" ${set.default_flow_id == f.id ? 'selected' : ''}>عرض المسار: ${esc(f.name)}</option>`).join('')}</select>
      <span class="hint">اختر مساراً (مثل القائمة الرئيسية) ليظهر لأي رسالة لا تطابق كلمة أو نموذجاً.</span></div></section>
    <section class="panel">${list.length ? `<div class="rows">${list.map((f) => `
      <div class="row ${f.active ? '' : 'off'}"><div><h3>${esc(f.name)} <span class="chip">#${f.id}</span></h3>
        <div class="tags"><span class="chip ink">${Object.keys(f.nodes).length} عقدة</span><span class="chip">البداية: <span class="ltr">${esc(f.start)}</span></span></div></div>
        <div class="acts"><label class="switch" title="تفعيل"><input type="checkbox" data-toggle="${f.id}" ${f.active ? 'checked' : ''} aria-label="تفعيل ${esc(f.name)}"><span></span></label>
        <button class="btn sm" data-test="${f.id}">جرّب</button><button class="btn sm" data-edit="${f.id}">تعديل</button><button class="btn sm danger" data-del="${f.id}">حذف</button></div></div>`).join('')}</div>`
      : '<div class="empty"><h3>لا توجد مسارات</h3><p>ابدأ من قالب جاهز (قائمة رئيسية، متجر، حجز، كلية…) ثم عدّل نصوصه.</p><button class="btn primary" id="tp2">+ من قالب جاهز</button></div>'}</section>
    <p class="muted small" style="margin-top:12px">لتشغيل مسار: أنشئ كلمة مفتاحية في صفحة «الكلمات المفتاحية» تشير إليه (مثل «قائمة»)، أو اجعله الرد الافتراضي أعلاه.</p>`;
  $('#dfl').addEventListener('change', async (e) => { await guarded(e.target, async () => { await api('PUT', '/api/settings', { default_flow_id: e.target.value }); toast('تم الحفظ'); }); });
  $('#nf').addEventListener('click', () => flowDialog(null));
  const tp = () => templatesDialog();
  $('#tp').addEventListener('click', tp); $('#tp2')?.addEventListener('click', tp);
  $$('[data-edit]', v).forEach((b) => b.addEventListener('click', () => flowDialog(list.find((f) => f.id == b.dataset.edit))));
  $$('[data-test]', v).forEach((b) => b.addEventListener('click', async () => {
    await api('PUT', '/api/settings', { default_flow_id: String(b.dataset.test) }).catch(() => {});
    toast('تم تعيينه كرد افتراضي للتجربة'); botTest('تجربة المسار', 'اكتب أي رسالة (مثل «مرحبا») ليظهر المسار، ثم اضغط الأزرار.'); route();
  }));
  $$('[data-del]', v).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('حذف المسار؟ ستتوقف الكلمات المفتاحية المرتبطة به عن تشغيله.')) return;
    await guarded(b, async () => { await api('DELETE', `/api/flows/${b.dataset.del}`); toast('تم الحذف'); route(); });
  }));
  $$('[data-toggle]', v).forEach((i) => i.addEventListener('change', async () => {
    try { await api('PUT', `/api/flows/${i.dataset.toggle}`, { active: i.checked }); route(); } catch (e) { toast(e.message, true); i.checked = !i.checked; }
  }));
};

async function templatesDialog() {
  const tpls = await api('GET', '/api/flow-templates');
  const d = dialog('قوالب جاهزة', `<p class="muted small" style="margin:0 0 10px">اختر قالباً: يُنشأ المسار (وأي نموذج مرتبط به) فتعدّل النصوص كما تريد.</p>
    <div class="rows">${tpls.map((t) => `<div class="row" style="padding:12px 0"><div><h3>${esc(t.name)}</h3><div class="small muted">${esc(t.desc)}</div><div class="tags" style="margin-top:6px"><span class="chip">${t.nodes} عقدة</span>${t.forms ? `<span class="chip saffron">+ ${t.forms} نموذج</span>` : ''}</div></div><div class="acts"><button type="button" class="btn sm primary" data-use="${t.id}">استخدم</button></div></div>`).join('')}</div>`, 'إغلاق', async () => d.close());
  $$('[data-use]', d).forEach((b) => b.addEventListener('click', () => guarded(b, async () => { await api('POST', '/api/flows/from-template', { template: b.dataset.use }); toast('تم إنشاء المسار من القالب ✅'); d.close(); route(); })));
}

async function flowDialog(f) {
  const [flows, forms] = await Promise.all([api('GET', '/api/flows'), api('GET', '/api/forms')]);
  const st = f ? JSON.parse(JSON.stringify(f)) : { name: '', start: 'start', nodes: { start: { type: 'message', text: 'أهلاً {name} 👋 اختر من القائمة:', image: '', buttons: [], next: '', flow: null, form: null } } };
  const collect = () => {
    const nodes = {};
    $$('.fnode', d).forEach((c) => {
      const id = c.dataset.id; const g = (sel) => (c.querySelector(sel)?.value ?? '').trim();
      nodes[id] = { type: g('.n-type') || 'message', text: c.querySelector('.n-text')?.value ?? '', image: g('.n-img'), buttons: parseBtns(c.querySelector('.n-btns')?.value ?? ''), next: g('.n-next'), flow: g('.n-flow') ? Number(g('.n-flow')) : null, form: g('.n-form') ? Number(g('.n-form')) : null };
    });
    st.nodes = nodes; st.name = $('#fl-name', d).value.trim(); st.start = $('#fl-start', d).value || st.start;
  };
  const outline = () => {
    const seen = new Set(); const lines = [];
    const walk = (id, depth) => {
      if (seen.has(id) || !st.nodes[id] || depth > 6) return; seen.add(id);
      const n = st.nodes[id];
      lines.push(`${'    '.repeat(depth)}● ${id} — ${NODE_LABEL[n.type]}${n.type === 'message' ? `: ${(n.text || '').split('\n')[0].slice(0, 30)}` : ''}`);
      for (const b of n.buttons || []) {
        lines.push(`${'    '.repeat(depth + 1)}[${b.title}] → ${b.kind === 'node' ? b.to : b.kind === 'flow' ? 'مسار #' + b.to : b.kind === 'form' ? 'نموذج ' + b.to : 'رابط'}`);
        if (b.kind === 'node') walk(b.to, depth + 2);
      }
      if (n.next) { lines.push(`${'    '.repeat(depth + 1)}↓ ثم → ${n.next}`); walk(n.next, depth + 2); }
    };
    walk(st.start, 0);
    return lines.join('\n');
  };
  const nodeCard = ([id, n]) => `<div class="card-n fnode" data-id="${esc(id)}" style="border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:10px">
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><b class="ltr" style="flex:1">${esc(id)}</b>
      <select class="n-type" style="max-width:220px">${opts(NODE_LABEL, n.type)}</select><button type="button" class="btn sm danger" data-rm="${esc(id)}">حذف</button></div>
    ${n.type === 'message' || n.type === 'handoff' ? `<div class="field"><label class="lbl">${n.type === 'handoff' ? 'رسالة التحويل' : 'نص الرسالة'} <span class="muted small">({name} = اسم الشخص)</span></label><textarea class="n-text" style="min-height:90px">${esc(n.text)}</textarea></div>` : ''}
    ${n.type === 'message' ? `<div class="field"><label class="lbl">رابط صورة (اختياري)</label><input class="n-img ltr" value="${esc(n.image)}" placeholder="https://…/image.jpg"></div>
      <div class="field"><label class="lbl">الأزرار (سطر لكل زر)</label><textarea class="n-btns ltr" style="min-height:70px;text-align:right" placeholder="الأقسام => sections&#10;الموقع => https://maps.google.com&#10;سجّل الآن => form:1">${esc(btnsToText(n.buttons))}</textarea></div>
      <div class="field"><label class="lbl">بعدها تلقائياً (إن لم تكن هناك أزرار)</label><select class="n-next"><option value="">—</option>${Object.keys(st.nodes).filter((k) => k !== id).map((k) => `<option value="${esc(k)}" ${n.next === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></div>` : ''}
    ${n.type === 'goto' ? `<div class="field"><label class="lbl">المسار</label><select class="n-flow"><option value="">اختر…</option>${flows.filter((x) => !f || x.id !== f.id).map((x) => `<option value="${x.id}" ${n.flow == x.id ? 'selected' : ''}>#${x.id} ${esc(x.name)}</option>`).join('')}</select></div>` : ''}
    ${n.type === 'form' ? `<div class="field"><label class="lbl">النموذج</label><select class="n-form"><option value="">اختر…</option>${forms.map((x) => `<option value="${x.id}" ${n.form == x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>` : ''}</div>`;
  const body = () => `
  <div class="cols"><div class="field"><label class="lbl" for="fl-name">اسم المسار</label><input id="fl-name" type="text" required value="${esc(st.name)}"></div>
  <div class="field"><label class="lbl" for="fl-start">عقدة البداية</label><select id="fl-start">${Object.keys(st.nodes).map((k) => `<option value="${esc(k)}" ${st.start === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></div></div>
  <div id="fl-nodes">${Object.entries(st.nodes).map(nodeCard).join('')}</div>
  <button type="button" class="btn" id="fl-add">+ عقدة جديدة</button>
  <details style="margin-top:14px"><summary class="lbl" style="cursor:pointer">خريطة المسار</summary><pre class="small ltr" id="fl-map" style="white-space:pre;overflow:auto;direction:rtl;text-align:right;background:#F0F3F8;border-radius:8px;padding:10px">${esc(outline())}</pre></details>
  <details style="margin-top:10px"><summary class="lbl" style="cursor:pointer">دليل صيغة الأزرار والمراجع</summary><div class="small muted" style="line-height:1.9;margin-top:6px">
    <span class="ltr">العنوان => معرّف_عقدة</span> ينتقل لعقدة في هذا المسار · <span class="ltr">العنوان => #رقم_المسار</span> ينتقل لمسار آخر · <span class="ltr">العنوان => form:رقم</span> يبدأ نموذجاً · <span class="ltr">العنوان => https://…</span> يفتح رابطاً.<br>
    عنوان الزر حتى 20 حرفاً. معرّف العقدة بحروف إنكليزية. واتساب: حتى 3 أزرار (أو قائمة حتى 10).<br>
    المسارات: ${flows.map((x) => `<span class="ltr">#${x.id}</span> ${esc(x.name)}`).join(' · ') || '—'}<br>النماذج: ${forms.map((x) => `<span class="ltr">form:${x.id}</span> ${esc(x.name)}`).join(' · ') || '—'}</div></details>`;
  const d = dialog(f ? 'تعديل المسار' : 'مسار جديد', body(), f ? 'حفظ' : 'إنشاء المسار', async () => {
    collect();
    await api(f ? 'PUT' : 'POST', f ? `/api/flows/${f.id}` : '/api/flows', { name: st.name, start: st.start, nodes: st.nodes });
    toast('تم حفظ المسار'); d.close(); route();
  });
  const rerender = () => { collect(); $('.d-body', d).innerHTML = body(); wire(); };
  function wire() {
    $('#fl-add', d).addEventListener('click', () => {
      collect();
      const id = (prompt('معرّف العقدة (إنكليزي بدون مسافات، مثل: prices)') || '').trim();
      if (!id) return;
      if (!/^[A-Za-z0-9_-]{1,30}$/.test(id) || st.nodes[id]) return toast('المعرّف غير صالح أو مكرر', true);
      st.nodes[id] = { type: 'message', text: '', image: '', buttons: [], next: '', flow: null, form: null };
      $('.d-body', d).innerHTML = body(); wire();
    });
    $$('[data-rm]', d).forEach((b) => b.addEventListener('click', () => {
      collect();
      if (Object.keys(st.nodes).length < 2) return toast('يجب أن تبقى عقدة واحدة', true);
      delete st.nodes[b.dataset.rm]; if (st.start === b.dataset.rm) st.start = Object.keys(st.nodes)[0];
      $('.d-body', d).innerHTML = body(); wire();
    }));
    $$('.n-type', d).forEach((sel) => sel.addEventListener('change', rerender));
    $('.d-body', d).addEventListener('change', (e) => { if (e.target.matches('.n-btns,.n-next,.n-text,#fl-start')) { collect(); const m = $('#fl-map', d); if (m) m.textContent = outline(); } });
  }
  wire();
}

VIEWS.keywords = async (v) => {
  const [list, flows] = await Promise.all([api('GET', '/api/keywords'), api('GET', '/api/flows')]);
  v.innerHTML = head('الكلمات المفتاحية', 'عندما تطابق رسالة العميل كلمة، يرد البوت بنص أو يشغّل مساراً بأزرار.', '<button class="btn primary" id="nk">+ كلمة مفتاحية</button>') +
    `<section class="panel">${list.length ? `<div class="rows">${list.map((k) => `
      <div class="row ${k.active ? '' : 'off'}"><div><h3>${esc(k.name || clipTxt(k.words || MATCH_LABEL[k.match], 40))} <span class="chip ink">${MATCH_LABEL[k.match]}</span>${k.hotword ? ' <span class="chip coral">ساخنة</span>' : ''}</h3>
        <div class="tags">${k.words ? `<span class="chip">${esc(clipTxt(k.words, 50))}</span>` : ''}<span class="chip">${k.channel === 'any' ? 'كل القنوات' : chan(k.channel)}</span>
        ${k.flow_id ? `<span class="chip teal">مسار: ${esc((flows.find((f) => f.id == k.flow_id) || {}).name || '#' + k.flow_id)}</span>` : ''}${k.reply ? `<span class="chip saffron">رد: ${esc(clipTxt(k.reply, 40))}</span>` : ''}</div></div>
        <div class="acts"><label class="switch" title="تفعيل"><input type="checkbox" data-toggle="${k.id}" ${k.active ? 'checked' : ''} aria-label="تفعيل"><span></span></label>
        <button class="btn sm" data-edit="${k.id}">تعديل</button><button class="btn sm danger" data-del="${k.id}">حذف</button></div></div>`).join('')}</div>`
      : '<div class="empty"><h3>لا توجد كلمات مفتاحية</h3><p>أضف كلمة مثل «قائمة» أو «مرحبا» تشغّل مساراً بأزرار.</p></div>'}</section>
    <p class="muted small" style="margin-top:12px">الكلمة <b>الساخنة</b> لها الأولوية على كل شيء (حتى على أسئلة النموذج)، مناسبة لكلمات مثل «إلغاء» أو «القائمة».</p>`;
  $('#nk').addEventListener('click', () => kwDialog(null, flows));
  $$('[data-edit]', v).forEach((b) => b.addEventListener('click', () => kwDialog(list.find((k) => k.id == b.dataset.edit), flows)));
  $$('[data-del]', v).forEach((b) => b.addEventListener('click', async () => { if (!confirm('حذف الكلمة؟')) return; await guarded(b, async () => { await api('DELETE', `/api/keywords/${b.dataset.del}`); toast('تم الحذف'); route(); }); }));
  $$('[data-toggle]', v).forEach((i) => i.addEventListener('change', async () => { try { await api('PUT', `/api/keywords/${i.dataset.toggle}`, { active: i.checked }); route(); } catch (e) { toast(e.message, true); i.checked = !i.checked; } }));
};

function kwDialog(k, flows) {
  const x = k || { name: '', match: 'contains', words: '', reply: '', flow_id: '', node: '', hotword: false, channel: 'any', active: true };
  const body = `
  <div class="field"><label class="lbl" for="k-name">الاسم (اختياري)</label><input id="k-name" name="name" type="text" value="${esc(x.name)}"></div>
  <div class="cols"><div class="field"><label class="lbl" for="k-m">الشرط</label><select id="k-m" name="match">${opts(MATCH_LABEL, x.match)}</select></div>
  <div class="field"><label class="lbl" for="k-ch">القناة</label><select id="k-ch" name="channel"><option value="any">كل القنوات</option>${opts(CHANNELS, x.channel)}</select></div></div>
  <div class="field" id="k-w"><label class="lbl" for="k-words">الكلمات (افصل بفاصلة)</label><input id="k-words" name="words" type="text" value="${esc(x.words)}" placeholder="قائمة, menu, مرحبا"><span class="hint">يتجاهل التشكيل والهمزات.</span></div>
  <div class="field"><label class="lbl" for="k-r">نص الرد (اختياري)</label><textarea id="k-r" name="reply" style="min-height:80px">${esc(x.reply)}</textarea><span class="hint">لعدة صيغ تتبدّل عشوائياً افصل بينها بسطر فيه <span class="ltr">---</span>. استخدم {name} لاسم الشخص.</span></div>
  <div class="cols"><div class="field"><label class="lbl" for="k-f">تشغيل مسار (اختياري)</label><select id="k-f" name="flow_id"><option value="">بدون</option>${flows.map((f) => `<option value="${f.id}" ${x.flow_id == f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>
  <div class="field"><label class="lbl" for="k-n">عقدة البداية (اختياري)</label><input id="k-n" name="node" type="text" class="ltr" value="${esc(x.node)}" placeholder="الافتراضي: بداية المسار"></div></div>
  <label class="check"><input type="checkbox" name="hotword" ${x.hotword ? 'checked' : ''}>كلمة ساخنة (أولوية قصوى)</label>
  <label class="check"><input type="checkbox" name="active" ${x.active ? 'checked' : ''}>مفعّلة</label>`;
  const d = dialog(k ? 'تعديل الكلمة' : 'كلمة مفتاحية جديدة', body, k ? 'حفظ' : 'إضافة', async (fd) => {
    const p = Object.fromEntries(fd); p.hotword = fd.has('hotword'); p.active = fd.has('active');
    await api(k ? 'PUT' : 'POST', k ? `/api/keywords/${k.id}` : '/api/keywords', p);
    toast('تم الحفظ'); d.close(); route();
  });
  const sync = () => { $('#k-w', d).hidden = ['image', 'sticker', 'audio'].includes($('#k-m', d).value); };
  d.addEventListener('change', sync); sync();
}

/* ---------- الإقلاع ---------- */

api('GET', '/api/info').then(start).catch(showLogin);
