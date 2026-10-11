/* =====================================================================
   COURSETRACK — DUAL-LANGUAGE ENGINE (English / Arabic RTL)
   ---------------------------------------------------------------------
   Load order on BOTH pages (before the page's own script):
       <script src="config.js"></script>
       <script src="i18n.js"></script>      <-- this file
       <script src="student.js"></script>   (or admin.js)

   What this file touches: UI wording only.
   What it never touches: Firebase keys/JSON, student codes, Excel
   column headers, or any cell value coming from the database. Those are
   written to the DOM by student.js/admin.js with textContent and carry no
   data-i18n attribute, so a language switch can never overwrite them.

   Markup API (all optional, combine freely):
     data-i18n="key"              -> element.textContent
     data-i18n-html="key"         -> element.innerHTML (dictionary is trusted;
                                     {vars} are HTML-escaped)
     data-i18n-vars='{"n":3}'     -> values for {n} placeholders
     data-i18n-prefix="❌ "       -> static text put before the translation
     data-i18n-placeholder="key"  -> placeholder attribute
     data-i18n-aria="key"         -> aria-label attribute
     data-i18n-title="key"        -> title attribute
     data-i18n-alt="key"          -> alt attribute
     data-i18n-content="key"      -> content attribute (<meta name="description">)

   RULE: never put data-i18n on an element that also contains an <svg> or
   other child markup you want to keep — it replaces the element's whole
   text. Wrap the words in their own <span data-i18n="...">.
   ===================================================================== */

(() => {
  'use strict';

  const STORAGE_KEY = 'coursetrack_lang';   // shared by index.html + admin.html
  const DEFAULT_LANG = 'en';
  const SUPPORTED = ['en', 'ar'];

  const META = {
    en: { dir: 'ltr', locale: 'en' },
    ar: { dir: 'rtl', locale: 'ar-EG' },     // used ONLY for date formatting
  };

  /* -------------------------------------------------------------------
     TRANSLATION DICTIONARY
     Flat "dot.keys". Keep the SAME key set in both languages (the
     parity check at the bottom of the integration guide verifies this).
     {name} = placeholder filled at runtime.
     ------------------------------------------------------------------- */
  const DICT = {
    en: {
      /* ---- shared ---- */
      'lang.switchAria': 'Switch language to Arabic',
      'theme.toggle': 'Toggle dark mode',
      'theme.toggleTitle': 'Toggle theme',
      'org.managedBy': 'Officially Managed by',
      'org.collab': 'In Collaboration With',
      'org.primaryLogoAlt': 'Primary organization logo',
      'org.partnerLogoAlt': 'Partner organization logo',
      'footer.poweredBy': 'Powered by {org}',
      'footer.collab': 'In Collaboration With {org}',
      'footer.developedBy': 'Developed by',

      /* ---- student portal: static ---- */
      'page.studentTitle': 'CourseTrack | Student Portal',
      'page.studentDesc': 'Search your student code to view your weekly results and final course result.',
      'loading.portal': 'Preparing your portal…',
      'header.subtitle': 'Student Portal',
      'search.title': 'Check your results',
      'search.subtitle': 'Enter your student code to view your profile, weekly results and final course result.',
      'search.placeholder': 'e.g. STU-2045',
      'search.inputAria': 'Student code',
      'search.button': 'Search',
      'search.remember': 'Remember my code on this device',
      'search.hint': 'Results are fetched live — search your code any time to see the latest data.',
      'search.loading': 'Searching student records…',
      'results.downloadPdf': 'Download Report Card (PDF)',
      'profile.title': 'Student Profile',
      'profile.name': 'Student Name',
      'profile.code': 'Student Code',
      'profile.email': 'Email Address',
      'profile.badge': 'Record found',
      'profile.fallbackName': 'Student',
      'weekly.title': 'Weekly Results',
      'final.title': 'Final Result',

      /* ---- student portal: dynamic ---- */
      'week.title': 'Week {n}',
      'session.meeting': 'Meeting Grade',
      'session.task': 'Task Grade',
      'session.notes': 'Instructor Notes',
      'session.notPublished': 'Not Published Yet',
      'session.noNotes': 'No notes for this session',

      /* ---- student portal: error states ---- */
      'err.notFound.title': '❌ Student Code Not Found',
      'err.notFound.msg': "We couldn't match that code to any record. Double-check it and try again.",
      'err.generic.title': '❌ Something Went Wrong',
      'err.generic.msg': 'An unexpected error occurred while searching. Please try again.',
      'err.notConfigured': 'The course data source is not configured yet. Ask your instructor to finish the Firebase setup.',
      'err.timeout': 'The course data source took too long to respond. Please try again.',
      'err.network': 'Could not reach the course data source. Check your internet connection and try again.',
      'err.denied': 'Access to the course data source was denied. Ask your instructor to check the database configuration.',
      'err.serverError': 'The course data source returned an error. Please try again shortly.',
      'err.unreadable': 'The course data source returned an unreadable response.',
      'err.noData': 'No course data has been uploaded yet. Please check back later.',

      /* ---- PDF report card ---- */
      'print.docTitle': 'CourseTrack Report - {code}',
      'print.title': 'CourseTrack — Student Academic Report',
      'print.subtitle': '{course} · Generated automatically via Student Portal',
      'print.footerOrg': 'This is an official computer-generated academic document, issued by {org}.',
      'print.footer': 'This is an official computer-generated academic document.',

      /* ---- admin dashboard: static ---- */
      'page.adminTitle': 'CourseTrack | Admin Dashboard',
      'loading.admin': 'Preparing Admin Dashboard…',
      'admin.badge': 'Admin Only',
      'admin.studentPortal': 'Student Portal',
      'info.title': 'Course Information',
      'info.courseName': 'Course Name',
      'info.instructor': 'Instructor Name',
      'info.version': 'Current Version',
      'info.hint': 'Course Name and Instructor Name are set in config.js and cannot be edited here or by students.',
      'upload.title': 'Upload Course Sheet',
      'upload.subtitle': 'Upload the <strong><bdi dir="ltr">.xlsx</bdi></strong> file. It will be parsed here, then saved to the Firebase database — every student sees it immediately.',
      'dropzone.title': 'Drag &amp; drop your <bdi dir="ltr">.xlsx</bdi> file here',
      'dropzone.sub': 'or click to browse',
      'step.upload': 'Uploading…',
      'step.read': 'Reading workbook…',
      'step.process': 'Processing students…',
      'step.sync': 'Syncing to Firebase…',
      'step.done': 'Finished.',
      'stats.title': 'Statistics',
      'stat.file': 'Current File',
      'stat.students': 'Number of Students',
      'stat.weeks': 'Weeks Detected',
      'stat.tasks': 'Tasks Detected',
      'stat.notes': 'Notes Columns',
      'stat.updated': 'Last Update',
      'stat.status': 'Upload Status',
      'stat.noFile': 'No file uploaded yet',

      /* ---- admin dashboard: dynamic ---- */
      'status.noData': 'No data yet',
      'status.active': 'Active',
      'status.failed': 'Failed',
      'status.processing': 'Processing…',
      'status.notConnected': 'Not connected',
      'upload.success': '✅ Course sheet uploaded successfully.',
      'err.unsupportedFile': 'Unsupported file.',
      'err.invalidExcel': 'Invalid Excel file.',
      'err.sheetNotFound': 'No worksheet with actual student Code values was found in this workbook.',
      'err.codeNotFound': 'Code column not found.',
      'err.sheetJsFailed': 'The Excel engine (SheetJS) failed to load. Check your internet connection and reload the page.',
      'err.sheetEmpty': 'The sheet "{sheet}" is empty — add student rows and try again.',
      'err.fbNotConfigured': 'Firebase database URL is not configured yet — set firebase.databaseURL in config.js.',
      'err.fbNetwork': 'Could not reach the Firebase database. Check your internet connection and try again.',
      'err.fbTimeout': 'Firebase took too long to respond. Please try again.',
      'err.fbDenied': 'Firebase denied this request — check firebase.databaseSecret in config.js and your database rules.',
      'err.fbFailed': 'Firebase request failed: {reason}',
    },

    ar: {
      /* ---- shared ---- */
      'lang.switchAria': 'التبديل إلى اللغة الإنجليزية',
      'theme.toggle': 'تبديل الوضع الداكن',
      'theme.toggleTitle': 'تبديل المظهر',
      'org.managedBy': 'تُدار رسميًا بواسطة',
      'org.collab': 'بالتعاون مع',
      'org.primaryLogoAlt': 'شعار الجهة الأساسية',
      'org.partnerLogoAlt': 'شعار الجهة الشريكة',
      'footer.poweredBy': 'بدعم من {org}',
      'footer.collab': 'بالتعاون مع {org}',
      'footer.developedBy': 'تطوير',

      /* ---- student portal: static ---- */
      'page.studentTitle': 'CourseTrack | بوابة الطالب',
      'page.studentDesc': 'ابحث بكود الطالب الخاص بك لعرض نتائجك الأسبوعية والنتيجة النهائية للدورة.',
      'loading.portal': 'جارٍ تجهيز البوابة…',
      'header.subtitle': 'بوابة الطالب',
      'search.title': 'اطّلع على نتائجك',
      'search.subtitle': 'أدخل كود الطالب الخاص بك لعرض ملفك الشخصي ونتائجك الأسبوعية والنتيجة النهائية للدورة.',
      'search.placeholder': 'مثال: STU-2045',
      'search.inputAria': 'كود الطالب',
      'search.button': 'بحث',
      'search.remember': 'تذكّر الكود الخاص بي على هذا الجهاز',
      'search.hint': 'يتم جلب النتائج مباشرة — ابحث بكودك في أي وقت لعرض أحدث البيانات.',
      'search.loading': 'جارٍ البحث في سجلات الطلاب…',
      'results.downloadPdf': 'تحميل بطاقة النتائج (PDF)',
      'profile.title': 'الملف الشخصي للطالب',
      'profile.name': 'اسم الطالب',
      'profile.code': 'كود الطالب',
      'profile.email': 'البريد الإلكتروني',
      'profile.badge': 'تم العثور على السجل',
      'profile.fallbackName': 'طالب',
      'weekly.title': 'النتائج الأسبوعية',
      'final.title': 'النتيجة النهائية',

      /* ---- student portal: dynamic ---- */
      'week.title': 'الأسبوع {n}',
      'session.meeting': 'درجة الاجتماع',
      'session.task': 'درجة المهمة',
      'session.notes': 'ملاحظات المحاضر',
      'session.notPublished': 'لم تُنشر بعد',
      'session.noNotes': 'لا توجد ملاحظات لهذه الجلسة',

      /* ---- student portal: error states ---- */
      'err.notFound.title': '❌ كود الطالب غير موجود',
      'err.notFound.msg': 'تعذّر مطابقة هذا الكود مع أي سجل. تأكد من الكود وحاول مرة أخرى.',
      'err.generic.title': '❌ حدث خطأ ما',
      'err.generic.msg': 'حدث خطأ غير متوقع أثناء البحث. يُرجى المحاولة مرة أخرى.',
      'err.notConfigured': 'مصدر بيانات الدورة لم يتم إعداده بعد. اطلب من المحاضر إكمال إعداد Firebase.',
      'err.timeout': 'استغرق مصدر بيانات الدورة وقتًا طويلًا للرد. يُرجى المحاولة مرة أخرى.',
      'err.network': 'تعذّر الوصول إلى مصدر بيانات الدورة. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.',
      'err.denied': 'تم رفض الوصول إلى مصدر بيانات الدورة. اطلب من المحاضر مراجعة إعدادات قاعدة البيانات.',
      'err.serverError': 'أعاد مصدر بيانات الدورة خطأً. يُرجى المحاولة بعد قليل.',
      'err.unreadable': 'أعاد مصدر بيانات الدورة استجابة غير مقروءة.',
      'err.noData': 'لم يتم رفع أي بيانات للدورة بعد. يُرجى المراجعة لاحقًا.',

      /* ---- PDF report card ---- */
      'print.docTitle': 'تقرير CourseTrack - {code}',
      'print.title': 'CourseTrack — التقرير الأكاديمي للطالب',
      'print.subtitle': '{course} · تم إنشاؤه تلقائيًا عبر بوابة الطالب',
      'print.footerOrg': 'هذه وثيقة أكاديمية رسمية صادرة إلكترونيًا من {org}.',
      'print.footer': 'هذه وثيقة أكاديمية رسمية صادرة إلكترونيًا.',

      /* ---- admin dashboard: static ---- */
      'page.adminTitle': 'CourseTrack | لوحة الإدارة',
      'loading.admin': 'جارٍ تجهيز لوحة الإدارة…',
      'admin.badge': 'للمسؤول فقط',
      'admin.studentPortal': 'بوابة الطالب',
      'info.title': 'معلومات الدورة',
      'info.courseName': 'اسم الدورة',
      'info.instructor': 'اسم المحاضر',
      'info.version': 'الإصدار الحالي',
      'info.hint': 'يتم تحديد اسم الدورة واسم المحاضر في ملف config.js ولا يمكن تعديلهما من هنا أو من قِبل الطلاب.',
      'upload.title': 'رفع ملف الدورة',
      'upload.subtitle': 'ارفع ملف <strong><bdi dir="ltr">.xlsx</bdi></strong>. ستتم معالجته هنا ثم حفظه في قاعدة بيانات Firebase — ويراه كل طالب فورًا.',
      'dropzone.title': 'اسحب ملف <bdi dir="ltr">.xlsx</bdi> وأفلته هنا',
      'dropzone.sub': 'أو اضغط للاستعراض',
      'step.upload': 'جارٍ الرفع…',
      'step.read': 'جارٍ قراءة ملف Excel…',
      'step.process': 'جارٍ معالجة بيانات الطلاب…',
      'step.sync': 'جارٍ المزامنة مع Firebase…',
      'step.done': 'اكتمل.',
      'stats.title': 'الإحصائيات',
      'stat.file': 'الملف الحالي',
      'stat.students': 'عدد الطلاب',
      'stat.weeks': 'الأسابيع المكتشفة',
      'stat.tasks': 'المهام المكتشفة',
      'stat.notes': 'أعمدة الملاحظات',
      'stat.updated': 'آخر تحديث',
      'stat.status': 'حالة الرفع',
      'stat.noFile': 'لم يتم رفع أي ملف بعد',

      /* ---- admin dashboard: dynamic ---- */
      'status.noData': 'لا توجد بيانات بعد',
      'status.active': 'نشط',
      'status.failed': 'فشل',
      'status.processing': 'جارٍ المعالجة…',
      'status.notConnected': 'غير متصل',
      'upload.success': '✅ تم رفع ملف الدورة بنجاح.',
      'err.unsupportedFile': 'نوع الملف غير مدعوم.',
      'err.invalidExcel': 'ملف Excel غير صالح.',
      'err.sheetNotFound': 'لم يتم العثور على ورقة عمل تحتوي على قيم كود الطلاب في هذا الملف.',
      'err.codeNotFound': 'لم يتم العثور على عمود الكود.',
      'err.sheetJsFailed': 'تعذّر تحميل محرك Excel (SheetJS). تحقق من اتصالك بالإنترنت وأعد تحميل الصفحة.',
      'err.sheetEmpty': 'ورقة العمل "{sheet}" فارغة — أضف صفوف الطلاب وحاول مرة أخرى.',
      'err.fbNotConfigured': 'لم يتم إعداد رابط قاعدة بيانات Firebase بعد — حدّد firebase.databaseURL في ملف config.js.',
      'err.fbNetwork': 'تعذّر الوصول إلى قاعدة بيانات Firebase. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.',
      'err.fbTimeout': 'استغرق Firebase وقتًا طويلًا للرد. يُرجى المحاولة مرة أخرى.',
      'err.fbDenied': 'رفض Firebase هذا الطلب — تحقق من firebase.databaseSecret في ملف config.js ومن قواعد قاعدة البيانات.',
      'err.fbFailed': 'فشل طلب Firebase: {reason}',
    },
  };

  /* -------------------------------------------------------------------
     INTERNALS
     ------------------------------------------------------------------- */
  let current = DEFAULT_LANG;
  const listeners = [];
  const warned = new Set();

  function readStored() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return SUPPORTED.indexOf(value) !== -1 ? value : null;
    } catch (err) { return null; } // storage blocked (private mode etc.) — non-fatal
  }

  function writeStored(lang) {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (err) { /* non-fatal */ }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Translate `key` into the current language, falling back to English,
   *  then to the key itself (so a missing key is visible, never blank). */
  function t(key, vars, escapeVars) {
    let str = DICT[current] && DICT[current][key];
    if (str === undefined) {
      str = DICT.en[key];
      if (!warned.has(key)) { warned.add(key); console.warn('CourseTrack i18n — missing "' + current + '" translation for key:', key); }
    }
    if (str === undefined) return key;
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, (match, name) => {
      if (vars[name] === undefined || vars[name] === null) return match;
      return escapeVars ? escapeHtml(vars[name]) : String(vars[name]);
    });
  }

  function has(key) { return Object.prototype.hasOwnProperty.call(DICT.en, key); }

  function readVars(el) {
    const raw = el.getAttribute('data-i18n-vars');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (err) { return null; }
  }

  /** Re-translate every marked element inside `root` (default: whole page).
   *  Safe to call repeatedly, and safe on dynamically created nodes. */
  function apply(root) {
    const scope = root || document;
    const each = (selector, fn) => {
      if (scope.matches && scope.matches(selector)) fn(scope);
      scope.querySelectorAll(selector).forEach(fn);
    };

    each('[data-i18n]', (el) => {
      el.textContent = (el.getAttribute('data-i18n-prefix') || '') + t(el.getAttribute('data-i18n'), readVars(el));
    });
    each('[data-i18n-html]', (el) => {
      el.innerHTML = t(el.getAttribute('data-i18n-html'), readVars(el), true);
    });
    each('[data-i18n-placeholder]', (el) => el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder'))));
    each('[data-i18n-aria]', (el) => el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))));
    each('[data-i18n-title]', (el) => el.setAttribute('title', t(el.getAttribute('data-i18n-title'))));
    each('[data-i18n-alt]', (el) => el.setAttribute('alt', t(el.getAttribute('data-i18n-alt'))));
    each('[data-i18n-content]', (el) => el.setAttribute('content', t(el.getAttribute('data-i18n-content'))));
  }

  /* ---- helpers for JS-generated text (keeps it re-translatable) ---- */

  /** Show translated text AND remember the key, so a later language
   *  switch re-translates this element automatically. */
  function setText(el, key, vars) {
    el.setAttribute('data-i18n', key);
    if (vars) el.setAttribute('data-i18n-vars', JSON.stringify(vars));
    else el.removeAttribute('data-i18n-vars');
    el.textContent = (el.getAttribute('data-i18n-prefix') || '') + t(key, vars);
  }

  /** Show database/user-supplied text and DETACH any translation key,
   *  so a language switch can never overwrite real data. */
  function setRaw(el, text) {
    el.removeAttribute('data-i18n');
    el.removeAttribute('data-i18n-vars');
    el.textContent = text;
  }

  /** An Error whose message is translated now AND carries its key, so
   *  the UI can re-translate it if the language is switched while the
   *  error is still on screen. */
  function error(key, vars) {
    const err = new Error(t(key, vars));
    err.i18nKey = key;
    err.i18nVars = vars || null;
    return err;
  }

  /** Render an error into `el`: our own keyed errors stay translatable;
   *  anything else (e.g. a raw server message) is shown verbatim;
   *  otherwise `fallbackKey` is used. Accepts a dictionary key string too. */
  function setErrorText(el, errOrKey, fallbackKey) {
    if (typeof errOrKey === 'string' && has(errOrKey)) return setText(el, errOrKey);
    if (errOrKey && errOrKey.i18nKey) return setText(el, errOrKey.i18nKey, errOrKey.i18nVars);
    if (errOrKey && errOrKey.message) return setRaw(el, errOrKey.message);
    return setText(el, fallbackKey);
  }

  /** Branding text from config.js with optional Arabic overrides:
   *    cfgOr('courseName', null)            -> courseNameAr (ar) / courseName
   *    cfgOr('courseSubtitle','header.subtitle')
   *  Arabic with no override falls back to the dictionary (if a dictKey
   *  was given) or to the English config value. */
  function cfgOr(configKey, dictKey) {
    const C = window.APP_CONFIG || {};
    if (current === 'ar') {
      if (C[configKey + 'Ar']) return C[configKey + 'Ar'];
      if (dictKey) return t(dictKey);
    }
    if (C[configKey]) return C[configKey];
    return dictKey ? t(dictKey) : '';
  }

  /* ---- language switching ---- */

  function syncToggle() {
    const btn = document.getElementById('lang-toggle');
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(current === 'ar'));
    btn.querySelectorAll('[data-lang-opt]').forEach((opt) => {
      opt.classList.toggle('is-active', opt.getAttribute('data-lang-opt') === current);
    });
  }

  function setLang(lang, options) {
    const persist = !options || options.persist !== false;
    if (SUPPORTED.indexOf(lang) === -1) lang = DEFAULT_LANG;
    current = lang;

    const root = document.documentElement;
    root.setAttribute('lang', lang);
    root.setAttribute('dir', META[lang].dir);
    if (persist) writeStored(lang);

    apply(document);
    syncToggle();
    listeners.slice().forEach((fn) => {
      try { fn(lang); } catch (err) { console.error('CourseTrack i18n — onChange handler failed:', err); }
    });
    return lang;
  }

  function toggle() { return setLang(current === 'ar' ? 'en' : 'ar'); }

  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }

  function init() {
    setLang(readStored() || DEFAULT_LANG, { persist: false });

    const btn = document.getElementById('lang-toggle');
    if (btn) btn.addEventListener('click', toggle);

    // Keep an open Admin tab and an open Student tab in step.
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY && SUPPORTED.indexOf(event.newValue) !== -1 && event.newValue !== current) {
        setLang(event.newValue, { persist: false });
      }
    });
  }

  /* -------------------------------------------------------------------
     PUBLIC API
     ------------------------------------------------------------------- */
  window.I18N = {
    t, has, apply, setLang, toggle, onChange,
    setText, setRaw, error, setErrorText, cfgOr,
    getLang: () => current,
    getDir: () => META[current].dir,
    locale: () => META[current].locale,
    supported: SUPPORTED.slice(),
    dict: DICT, // exposed so a 3rd language can be added/checked easily
  };

  // Language/direction are set synchronously (this script sits at the end
  // of <body>, so the markup above it already exists); the page's own
  // script runs next and can rely on I18N.getLang() immediately.
  current = readStored() || DEFAULT_LANG;
  document.documentElement.setAttribute('lang', current);
  document.documentElement.setAttribute('dir', META[current].dir);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
