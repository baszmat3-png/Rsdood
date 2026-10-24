// قوالب جاهزة للمسارات. الأزرار التي تشير إلى نموذج تكتب «@اسم» ويُنشأ النموذج تلقائياً عند اعتماد القالب.
const msg = (text, buttons = [], extra = {}) => ({ type: 'message', text, image: '', buttons, next: '', flow: null, form: null, ...extra });
const go = (title, to) => ({ title, kind: 'node', to });
const back = go('القائمة الرئيسية', 'start');
const human = { type: 'handoff', text: 'تم تحويلك إلى فريقنا، سيرد عليك أحد المختصين قريباً 🌷', image: '', buttons: [], next: '', flow: null, form: null };

const bookingForm = { name: 'حجز موعد', kind: 'booking', triggers: 'حجز, موعد, احجز', intro: '', done_text: '', fields: [
  { label: 'ما اسمك الكامل؟', type: 'text' }, { label: 'رقم هاتفك؟', type: 'phone' }, { label: 'أي يوم يناسبك؟', type: 'date' },
  { label: 'أي وقت يناسبك؟', type: 'time' }, { label: 'ملاحظات', type: 'text', optional: true }] };
const orderForm = { name: 'طلب منتج', kind: 'order', triggers: 'اطلب, طلب, شراء', intro: '', done_text: '', fields: [
  { label: 'ما اسمك الكامل؟', type: 'text' }, { label: 'رقم هاتفك؟', type: 'phone' }, { label: 'ما المنتج المطلوب؟', type: 'text' },
  { label: 'الكمية؟', type: 'number' }, { label: 'المحافظة والعنوان؟', type: 'text' }, { label: 'ملاحظات', type: 'text', optional: true }] };
const regForm = { name: 'تسجيل طالب', kind: 'booking', triggers: 'تسجيل, سجلني', intro: '', done_text: '', fields: [
  { label: 'ما اسمك الكامل؟', type: 'text' }, { label: 'رقم هاتفك؟', type: 'phone' }, { label: 'المحافظة؟', type: 'text' },
  { label: 'القسم المطلوب؟', type: 'choice', options: ['القسم الأول', 'القسم الثاني', 'القسم الثالث'] }] };

export const TEMPLATES = [
  { id: 'main-menu', name: 'قائمة رئيسية', desc: 'ترحيب بأزرار: الخدمات، الأسعار، العنوان، موظف.', forms: {}, flow: {
    name: 'القائمة الرئيسية', start: 'start', nodes: {
      start: msg('أهلاً {name} 👋 وسهلاً بك. كيف نخدمك؟', [go('خدماتنا', 'services'), go('الأسعار', 'prices'), go('العنوان والدوام', 'address'), go('التحدث مع موظف', 'human')]),
      services: msg('خدماتنا:\n• الخدمة الأولى\n• الخدمة الثانية\n• الخدمة الثالثة\n\n(عدّل هذا النص)', [go('الأسعار', 'prices'), back]),
      prices: msg('الأسعار:\n• الخدمة الأولى: 00 ألف\n• الخدمة الثانية: 00 ألف\n\n(عدّل هذا النص)', [go('خدماتنا', 'services'), back]),
      address: msg('📍 العنوان: اكتب عنوانك هنا\n🕘 الدوام: من 9 صباحاً إلى 5 مساءً', [{ title: 'الموقع على الخريطة', kind: 'url', to: 'https://maps.google.com' }, back]),
      human } } },
  { id: 'faq', name: 'أسئلة شائعة', desc: 'قائمة أسئلة وأجوبة مع رجوع للقائمة.', forms: {}, flow: {
    name: 'الأسئلة الشائعة', start: 'start', nodes: {
      start: msg('اختر السؤال الذي يهمك 👇', [go('كيف أطلب؟', 'q1'), go('مدة التوصيل؟', 'q2'), go('طرق الدفع؟', 'q3'), go('الإرجاع والاستبدال', 'q4')]),
      q1: msg('لتقديم طلب اكتب «اطلب» وسنسألك عن التفاصيل.', [go('رجوع', 'start')]),
      q2: msg('التوصيل خلال 2–4 أيام لكل المحافظات.', [go('رجوع', 'start')]),
      q3: msg('الدفع عند الاستلام أو تحويل مصرفي.', [go('رجوع', 'start')]),
      q4: msg('الاستبدال خلال 3 أيام من الاستلام بشرط سلامة المنتج.', [go('رجوع', 'start')]) } } },
  { id: 'booking', name: 'حجز موعد', desc: 'قائمة قصيرة تنتهي بنموذج حجز يُصدَّر إلى Excel.', forms: { booking: bookingForm }, flow: {
    name: 'حجز المواعيد', start: 'start', nodes: {
      start: msg('أهلاً {name} 🌷 يمكنك حجز موعد أو معرفة تفاصيل خدماتنا.', [{ title: 'احجز موعداً', kind: 'form', to: '@booking' }, go('الخدمات والأسعار', 'services'), go('العنوان والدوام', 'address')]),
      services: msg('الخدمات والأسعار:\n• كشف: 00 ألف\n• متابعة: 00 ألف\n\n(عدّل هذا النص)', [{ title: 'احجز موعداً', kind: 'form', to: '@booking' }, back]),
      address: msg('📍 العنوان: اكتب عنوانك هنا\n🕘 الدوام: من 9 صباحاً إلى 5 مساءً', [back]) } } },
  { id: 'shop', name: 'متجر: تصفح وطلب', desc: 'أقسام المنتجات، تفاصيل، ثم زر «اطلب الآن» لنموذج طلب.', forms: { order: orderForm }, flow: {
    name: 'المتجر', start: 'start', nodes: {
      start: msg('أهلاً {name} 🛍️ تصفّح منتجاتنا:', [go('القسم الأول', 'cat1'), go('القسم الثاني', 'cat2'), go('التوصيل والدفع', 'ship'), go('التحدث مع موظف', 'human')]),
      cat1: msg('القسم الأول:\n• المنتج أ — 00 ألف\n• المنتج ب — 00 ألف\n\n(عدّل هذا النص، ويمكنك إضافة صورة)', [{ title: 'اطلب الآن', kind: 'form', to: '@order' }, back]),
      cat2: msg('القسم الثاني:\n• المنتج ج — 00 ألف\n• المنتج د — 00 ألف', [{ title: 'اطلب الآن', kind: 'form', to: '@order' }, back]),
      ship: msg('التوصيل لكل المحافظات خلال 2–4 أيام. الدفع عند الاستلام.', [{ title: 'اطلب الآن', kind: 'form', to: '@order' }, back]),
      human } } },
  { id: 'education', name: 'كلية / معهد', desc: 'الأقسام، التسجيل، الرسوم، العنوان، الأسئلة الشائعة، موظف.', forms: { reg: regForm }, flow: {
    name: 'الكلية', start: 'start', nodes: {
      start: msg('أهلاً {name} 🎓 اختر من القائمة:', [go('الأقسام', 'sections'), { title: 'التسجيل', kind: 'form', to: '@reg' }, go('الرسوم والدفعات', 'fees'), go('العنوان', 'address'), go('أسئلة شائعة', 'faq'), go('التحدث مع موظف', 'human')]),
      sections: msg('الأقسام المتاحة:\n1- القسم الأول\n2- القسم الثاني\n3- القسم الثالث\n\n(عدّل هذا النص)', [{ title: 'التسجيل', kind: 'form', to: '@reg' }, back]),
      fees: msg('الرسوم الدراسية:\n• القسم الأول: 00 ألف\n• القسم الثاني: 00 ألف\nالدفع بدفعات (عدّل هذا النص).', [back]),
      address: msg('📍 عنوان الكلية: اكتب العنوان هنا', [back]),
      faq: msg('الأسئلة الشائعة:\n• متى يبدأ التسجيل؟ ...\n• ما شروط القبول؟ ...\n(عدّل هذا النص)', [{ title: 'التسجيل', kind: 'form', to: '@reg' }, back]),
      human } } },
];
