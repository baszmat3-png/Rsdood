import { all, get, run, getSetting } from './db.js';
import { complete, baseSystem, aiConfigured } from './ai.js';
import { adapters } from './channels/index.js';
import { handleFormTurn, clearFormSession, hasFormSession } from './forms.js';
import { flowPrelude, flowKeywords, flowDefault, isPaused, resumeBot, setPaused, saveMenu, numberedText } from './flows.js';

/* ---------- أدوات النصوص ---------- */

export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitKeywords(s) {
  return String(s || '')
    .split(/[,\n،؛;]+/)
    .map((k) => norm(k))
    .filter(Boolean);
}

function keywordMatch(keywords, text) {
  const list = splitKeywords(keywords);
  if (!list.length) return true;
  const t = ` ${norm(text)} `;
  return list.some((k) => t.includes(k));
}

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function fill(tpl, ctx) {
  return String(tpl)
    .replaceAll('{name}', ctx.userName || 'عزيزي')
    .replaceAll('{business}', getSetting('business_name', ''))
    .replaceAll('{details}', ctx.details || '')
    .trim();
}

/** قالب بعدة صيغ: كل سطر صيغة، يُختار أحدها عشوائياً لتجنب التكرار الآلي. */
function templateReply(tpl, ctx) {
  const variants = String(tpl).split(/\n{2,}|\n---\n/).map((v) => v.trim()).filter(Boolean);
  if (!variants.length) return '';
  return fill(pick(variants), ctx);
}

/* ---------- اختيار الحملة ---------- */

export function pickCampaign(ev, account) {
  const rows = all('SELECT * FROM campaigns WHERE active = 1');
  let best = null;
  let bestScore = -1;
  for (const c of rows) {
    if (c.channel !== 'any' && c.channel !== ev.channel) continue;
    if (c.account_id && (!account || c.account_id !== account.id)) continue;
    if (c.scope === 'post' && String(c.post_id).trim() !== String(ev.postId || '').trim()) continue;
    if (!keywordMatch(c.keywords, ev.text)) continue;
    let score = 0;
    if (c.scope === 'post') score += 4;
    if (splitKeywords(c.keywords).length) score += 2;
    if (c.account_id) score += 1;
    if (c.channel !== 'any') score += 0.5;
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

/* ---------- توليد الردود ---------- */

async function aiPublicReply(campaign, ev) {
  const hint = campaign.dm_mode !== 'off' ? '\nأخبره بلطف أنك أرسلت له التفاصيل في الرسائل الخاصة.' : '';
  const guide = campaign.public_text ? `\nتوجيه لهذا الرد: ${campaign.public_text}` : '';
  return complete({
    system: `${baseSystem()}\n\nالمهمة: اكتب رداً علنياً قصيراً (جملة إلى ثلاث) على تعليق تحت منشور.${guide}${hint}`,
    messages: [{ role: 'user', content: `اسم صاحب التعليق: ${ev.userName || 'غير معروف'}\n<customer>${ev.text}</customer>` }],
    maxTokens: 220,
  });
}

async function aiDm(campaign, ev) {
  const guide = campaign.dm_text ? `\nتوجيه لهذه الرسالة: ${campaign.dm_text}` : '';
  const facts = campaign.dm_details ? `\n\nتفاصيل يجب إرسالها (استخدمها كما هي دون تحريف الأرقام):\n${campaign.dm_details}` : '';
  return complete({
    system: `${baseSystem()}\n\nالمهمة: اكتب رسالة خاصة ترحيبية لشخص علّق على منشور، تتضمن التفاصيل التي يريدها وتنتهي بخطوة تالية واضحة.${guide}${facts}`,
    messages: [{ role: 'user', content: `اسم الشخص: ${ev.userName || 'غير معروف'}\n<customer>${ev.text}</customer>` }],
    maxTokens: 500,
  });
}

async function buildPublic(campaign, ev) {
  if (campaign.public_mode === 'off') return '';
  if (campaign.public_mode === 'ai') {
    const t = await aiPublicReply(campaign, ev);
    if (t) return clip(t, 900);
  }
  const fallback = campaign.public_text || 'شكراً لتعليقك {name} 🌷 أرسلنا لك التفاصيل على الخاص.';
  return clip(templateReply(fallback, { userName: ev.userName }), 900);
}

async function buildDm(campaign, ev) {
  if (campaign.dm_mode === 'off') return '';
  if (campaign.dm_mode === 'ai') {
    const t = await aiDm(campaign, ev);
    if (t) return clip(t, 1900);
  }
  const base = campaign.dm_text || 'أهلاً {name}، شكراً لاهتمامك. هذه التفاصيل:\n{details}';
  return clip(templateReply(base, { userName: ev.userName, details: campaign.dm_details }), 1900);
}

/* ---------- تسجيل الأحداث ---------- */

function insertEvent(ev, extra = {}) {
  return run(
    `INSERT INTO events(ts, channel, kind, account_id, post_id, comment_id, user_id, user_name, text, campaign_id, status, simulated)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    Date.now(), ev.channel, ev.kind, ev.account?.id ?? null, String(ev.postId || ''), String(ev.commentId || ''),
    String(ev.userId || ''), ev.userName || '', clip(ev.text || '', 2000), extra.campaignId ?? null,
    'processing', extra.simulated ? 1 : 0,
  ).lastInsertRowid;
}

function updateEvent(id, fields) {
  const keys = Object.keys(fields);
  run(`UPDATE events SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => fields[k]), id);
}

function hourlyCapReached(account) {
  if (!account) return false;
  const cap = Number(getSetting('hourly_cap', '200')) || 200;
  const r = get(
    `SELECT COUNT(*) n FROM events WHERE account_id = ? AND ts > ? AND (public_status = 'sent' OR dm_status = 'sent')`,
    account.id, Date.now() - 3600_000,
  );
  return r.n >= cap;
}

async function humanDelay(simulate) {
  if (simulate) return;
  const min = Number(getSetting('delay_min', '3')) || 0;
  const max = Math.max(min, Number(getSetting('delay_max', '12')) || 0);
  await sleep((min + Math.random() * (max - min)) * 1000);
}

async function deliver(kind, ev, text, simulate) {
  if (!text) return { status: '' };
  if (simulate) return { status: 'simulated' };
  const adapter = adapters[ev.channel];
  const account = ev.account;
  if (!adapter || !account || !account.token) return { status: 'simulated', note: 'لا يوجد حساب مربوط بتوكن؛ تم التسجيل فقط' };
  try {
    const res = await adapter[kind](account, ev, text);
    if (res.ok) return { status: 'sent' };
    return { status: 'failed', error: String(res.error || 'خطأ غير معروف') };
  } catch (e) {
    return { status: 'failed', error: e.message };
  }
}

/* ---------- معالجة التعليقات ---------- */

export async function processComment(ev, opts = {}) {
  const simulate = !!opts.simulate;
  ev = { ...ev, kind: 'comment' };
  const campaign = pickCampaign(ev, ev.account);

  let id;
  try {
    id = insertEvent(ev, { campaignId: campaign?.id, simulated: simulate });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return { skipped: 'duplicate' };
    throw e;
  }

  if (!campaign) {
    updateEvent(id, { status: 'no_match' });
    return { id, status: 'no_match' };
  }
  if (!simulate && hourlyCapReached(ev.account)) {
    updateEvent(id, { status: 'skipped', error: 'تم بلوغ الحد الأقصى للردود في الساعة' });
    return { id, status: 'skipped', error: 'hourly_cap' };
  }

  const skipDm =
    !simulate && campaign.once_per_user && ev.userId &&
    get(`SELECT 1 x FROM events WHERE campaign_id = ? AND user_id = ? AND dm_status = 'sent' AND id <> ?`, campaign.id, String(ev.userId), id);

  const [publicText, dmText] = await Promise.all([
    buildPublic(campaign, ev),
    skipDm ? '' : buildDm(campaign, ev),
  ]);

  await humanDelay(simulate);
  const pub = await deliver('replyToComment', ev, publicText, simulate);
  const dm = await deliver('privateReply', ev, dmText, simulate);

  const failed = pub.status === 'failed' || dm.status === 'failed';
  const status = failed ? 'failed' : 'done';
  const error = [pub.error && `الرد العلني: ${pub.error}`, dm.error && `الرسالة الخاصة: ${dm.error}`, skipDm && 'تم تخطي الرسالة الخاصة: سبق إرسالها لهذا الشخص'].filter(Boolean).join(' | ');
  updateEvent(id, {
    public_reply: publicText, dm_reply: dmText,
    public_status: pub.status, dm_status: dm.status, status, error,
  });
  return { id, status, campaign: { id: campaign.id, name: campaign.name }, publicReply: publicText, dmReply: dmText, publicStatus: pub.status, dmStatus: dm.status, error };
}

/* ---------- معالجة الرسائل الخاصة ---------- */

function history(channel, userId, limit = 10) {
  return all('SELECT role, text FROM messages WHERE channel = ? AND user_id = ? ORDER BY ts DESC, id DESC LIMIT ?', channel, String(userId), limit).reverse();
}
function remember(channel, userId, role, text) {
  run('INSERT INTO messages(channel, user_id, role, text, ts) VALUES(?,?,?,?,?)', channel, String(userId), role, clip(text, 2000), Date.now());
}

/** يرسل رسالة واحدة (نص أو نص بأزرار/صورة). القنوات بلا أزرار تُرسل قائمة مرقّمة. */
async function deliverMsg(ev, m, simulate) {
  const hasUi = (m.buttons && m.buttons.length) || m.image;
  if (!hasUi) return deliver('sendMessage', ev, m.text, simulate);
  const adapter = adapters[ev.channel];
  if (adapter?.sendMenu) {
    if (simulate) return { status: 'simulated' };
    if (!ev.account?.token) return { status: 'simulated' };
    try {
      const r = await adapter.sendMenu(ev.account, ev, m);
      return r.ok ? { status: 'sent' } : { status: 'failed', error: String(r.error || 'خطأ غير معروف') };
    } catch (e) { return { status: 'failed', error: e.message }; }
  }
  if (!simulate) saveMenu(ev, m.buttons);
  return deliver('sendMessage', ev, numberedText(m), simulate);
}

export async function processMessage(ev, opts = {}) {
  const simulate = !!opts.simulate;
  ev = { ...ev, kind: 'message', commentId: '', type: ev.type || 'text' };
  if (!ev.text && ev.type !== 'text') ev.text = `[${ev.type}]`;
  const id = insertEvent(ev, { simulated: simulate });

  // حماية من الحلقات والإغراق: حد أقصى للردود الآلية لكل شخص في الساعة
  const perUser = get(
    `SELECT COUNT(*) n FROM events WHERE channel = ? AND user_id = ? AND kind = 'message' AND ts > ? AND simulated = 0 AND id <> ?`,
    ev.channel, String(ev.userId), Date.now() - 3600_000, id,
  ).n;
  if (!simulate && perUser >= 30) {
    updateEvent(id, { status: 'skipped', error: 'تجاوز الحد الأقصى للرسائل من هذا الشخص في الساعة' });
    return { id, status: 'skipped' };
  }
  if (!simulate && hourlyCapReached(ev.account)) {
    updateEvent(id, { status: 'skipped', error: 'تم بلوغ الحد الأقصى للردود في الساعة' });
    return { id, status: 'skipped' };
  }

  let msgs = null;
  let status = 'done';
  let pause = false;
  const take = (r) => { if (r) { msgs = r.msgs; pause = !!r.pause; } return !!r; };

  if (isPaused(ev)) {
    const r = resumeBot(ev);
    const p = r ? null : (ev.payload ? flowPrelude(ev) : null);
    if (!r && !p) {
      updateEvent(id, { status: 'skipped', error: 'البوت متوقف لهذا الشخص بانتظار موظف (يُستأنف بكلمة الاستئناف أو بعد 12 ساعة)' });
      return { id, status: 'skipped' };
    }
    if (p) setPaused(ev, false);
    take(r || p);
  } else {
    take(flowPrelude(ev));
  }

  const nonText = ev.type !== 'text';
  const handoffWords = splitKeywords(getSetting('handoff_words', 'موظف, شخص حقيقي, مدير, شكوى, اتصل بي'));
  const wantsHuman = !nonText && handoffWords.some((w) => ` ${norm(ev.text)} `.includes(w));
  // 1) جواب سؤال داخل نموذج جارٍ  2) الكلمات المفتاحية  3) طلب موظف  4) بدء نموذج
  if (!msgs && !nonText && !wantsHuman && hasFormSession(ev)) {
    const ft = handleFormTurn(ev, simulate);
    if (ft) msgs = [{ text: clip(ft.reply, 1900) }];
  }
  if (!msgs) take(flowKeywords(ev));
  if (!msgs && !nonText) {
    if (wantsHuman) {
      clearFormSession(ev);
      msgs = [{ text: getSetting('handoff_reply', 'تم تحويل رسالتك إلى فريقنا وسيتواصل معك أحد المختصين في أقرب وقت 🌷') }];
      status = 'handoff';
    } else {
      const ft = handleFormTurn(ev, simulate);
      if (ft) msgs = [{ text: clip(ft.reply, 1900) }];
    }
  }
  if (!msgs && nonText) {
    updateEvent(id, { status: 'no_match' });
    return { id, status: 'no_match' };
  }
  if (!msgs) take(flowDefault(ev));

  if (!msgs) {
    const past = history(ev.channel, ev.userId);
    const hist = [...past.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', text: m.text }))];
    // يجب أن تبدأ المحادثة برسالة من العميل وتتناوب الأدوار
    while (hist.length && hist[0].role !== 'user') hist.shift();
    const merged = [];
    for (const m of hist) {
      const last = merged[merged.length - 1];
      if (last && last.role === m.role) last.content += `\n${m.text}`;
      else merged.push({ role: m.role, content: m.text });
    }
    const lastIsUser = merged.length && merged[merged.length - 1].role === 'user';
    const current = `<customer>${ev.text}</customer>`;
    if (lastIsUser) merged[merged.length - 1].content += `\n${current}`;
    else merged.push({ role: 'user', content: current });
    for (const m of merged) if (m.role === 'user' && !m.content.includes('<customer>')) m.content = `<customer>${m.content}</customer>`;

    let reply = await complete({
      system: `${baseSystem()}\n\nالمهمة: أجب عن رسالة خاصة من عميل. إن طلب أمراً لا تملك معلوماته فأخبره أن الفريق سيتواصل معه.`,
      messages: merged,
      maxTokens: 450,
    });
    if (!reply) {
      reply = aiConfigured()
        ? 'شكراً لتواصلك، وصلتنا رسالتك وسنرد عليك قريباً 🌷'
        : getSetting('fallback_reply', 'أهلاً بك! وصلتنا رسالتك وسيرد عليك فريقنا قريباً 🌷');
    }
    msgs = [{ text: clip(reply, 1900) }];
  }

  const plain = msgs.map((m) => m.text).filter(Boolean).join('\n\n');
  if (!simulate) remember(ev.channel, ev.userId, 'user', ev.text);
  await humanDelay(simulate);
  let sentStatus = '';
  let error = '';
  for (let i = 0; i < msgs.length; i++) {
    const r = await deliverMsg(ev, msgs[i], simulate);
    if (r.status === 'failed') { sentStatus = 'failed'; error = r.error || ''; break; }
    if (sentStatus !== 'sent') sentStatus = r.status;
    if (i < msgs.length - 1 && !simulate) await sleep(600);
  }
  if (pause && sentStatus !== 'failed') setPaused(ev, true);
  if (!simulate && sentStatus !== 'failed') remember(ev.channel, ev.userId, 'assistant', plain);

  const finalStatus = sentStatus === 'failed' ? 'failed' : status;
  updateEvent(id, { dm_reply: plain, dm_status: sentStatus, status: finalStatus, error });
  return { id, status: finalStatus, dmReply: plain, replies: msgs, paused: pause, dmStatus: sentStatus, error };
}
