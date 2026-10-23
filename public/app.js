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
  if (qs.has('meta') || qs.has('meta_error')) {
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
    <section class="panel panel-pad"><h2 style="margin-bottom:6px">المتابعة بحساب فيسبوك</h2>
      <p class="muted small" style="margin:0 0 10px">سجّل الدخول بفيسبوك ووافق على الصلاحيات، فتُربط صفحاتك وحسابات إنستغرام المرتبطة بها تلقائياً ويُفعَّل استقبال التعليقات والرسائل، دون نسخ أي توكن.</p>
      ${info.metaConnect.ready ? '<button class="btn primary" id="fbc">المتابعة بحساب فيسبوك</button>' : `<form id="fbf" class="cols"><div class="field"><label class="lbl" for="m1">App ID</label><input id="m1" type="text" name="fb_app_id" class="ltr" value="${esc(info.metaConnect.appId)}" required></div><div class="field"><label class="lbl" for="m2">App Secret</label><input id="m2" type="password" name="app_secret" autocomplete="off" required></div><div><button class="btn primary">حفظ وتفعيل الزر</button></div></form><p class="hint">من Meta for Developers ← إعدادات التطبيق ← أساسي.</p>`}
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
  $('#fbc')?.addEventListener('click', (ev) => guarded(ev.currentTarget, async () => { const r = await api('POST', '/api/meta/connect'); location.href = r.url; }));
  $('#fbf')?.addEventListener('submit', async (ev) => { ev.preventDefault(); await guarded($('button', ev.target), async () => { await saveSettings(ev.target); info = await api('GET', '/api/info'); toast('تم الحفظ'); route(); }); });
  $('#newa').addEventListener('click', () => accountDialog(null));
  $$('[data-edit]', v).forEach((b) => b.addEventListener('click', () => accountDialog(list.find((a) => a.id == b.dataset.edit))));
  $$('[data-del]', v).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('حذف هذا الحساب؟ ستبقى سجلاته.')) return;
    await guarded(b, async () => { await api('DELETE', `/api/accounts/${b.dataset.del}`); toast('تم حذف الحساب'); route(); });
  }));
  $$('[data-tg]', v).forEach((b) => b.addEventListener('click', () => guarded(b, async () => { await api('POST', `/api/accounts/${b.dataset.tg}/telegram-webhook`); toast('تم ربط الويب هوك مع تيليغرام'); })));
};

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

/* ---------- الإقلاع ---------- */

api('GET', '/api/info').then(start).catch(showLogin);
