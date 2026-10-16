/* =====================================================================
   COURSETRACK — STUDENT PORTAL LOGIC
   Public, read-only. Every search fetches the latest data straight from
   the Firebase Realtime Database REST endpoint — nothing is cached in
   localStorage, so students always see whatever the Admin last
   uploaded, with no redeploy needed.

   Column detection (Meeting/Task/Notes/Final) is 100% structural:
   nothing here ever hardcodes "M1", "T1", a column name, or a week
   number — it keeps working unmodified at Week 30, 50, or beyond.
   ===================================================================== */

(() => {
  'use strict';

  const CONFIG = window.APP_CONFIG || {};
  const I18N = window.I18N; // i18n.js MUST be loaded before this file (see index.html)

  /* -------------------------------------------------------------------
     0. CONSTANTS
     ------------------------------------------------------------------- */
  const STORAGE_KEYS = { THEME: 'coursetrack_theme' };

  // Longest a search is allowed to wait on Firebase before giving up
  // with an error instead of spinning indefinitely.
  const FETCH_TIMEOUT_MS = 15000;

  const KEYWORDS = {
    positive: ['present', 'attended', 'yes', 'pass', 'passed', 'eligible', 'completed', 'complete', 'done', 'excellent', 'good', 'success', 'active'],
    negative: ['absent', 'no', 'fail', 'failed', 'not eligible', 'ineligible', 'missing', 'incomplete', 'inactive', 'not submitted', 'rejected'],
  };

  const IDENTITY_FIELDS = [
    { key: 'code', pattern: /code|كود|رقم\s*الطالب|\bid\b/i },
    { key: 'email', pattern: /e-?mail|بريد/i },
    { key: 'name', pattern: /name|اسم/i },
  ];

  // Session labels and fallback texts ("Not Published Yet", ...) now live
  // in i18n.js's dictionary (keys: session.*), so they follow the UI language.

  const ICONS = {
    meeting: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 2v4M16 2v4M3 9h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg>',
    task: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    notes: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 20l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  };

  /* -------------------------------------------------------------------
     1. DOM REFERENCES
     ------------------------------------------------------------------- */
  const dom = {
    loadingScreen: document.getElementById('loading-screen'),
    themeToggle: document.getElementById('theme-toggle'),

    headerCourseName: document.getElementById('header-course-name'),
    headerCourseSubtitle: document.getElementById('header-course-subtitle'),
    courseLogoImg: document.getElementById('course-logo-img'),
    courseLogoPlaceholder: document.getElementById('course-logo-placeholder'),
    orgLogoPrimary: document.getElementById('org-logo-primary'),
    orgLogoPartner: document.getElementById('org-logo-partner'),
    orgPlaceholderPrimary: document.getElementById('org-placeholder-primary'),
    orgPlaceholderPartner: document.getElementById('org-placeholder-partner'),
    orgNamePrimary: document.getElementById('org-name-primary'),
    orgNamePartner: document.getElementById('org-name-partner'),
    footerPowered: document.getElementById('footer-powered'),
    footerCollab: document.getElementById('footer-collab'),
    footerDeveloped: document.getElementById('footer-developed'),

    searchForm: document.getElementById('search-form'),
    codeInput: document.getElementById('student-code-input'),
    searchBtn: document.getElementById('search-btn'),
    noDataHint: document.getElementById('no-data-hint'),

    searchLoading: document.getElementById('search-loading'),
    errorState: document.getElementById('error-state'),
    errorTitle: document.getElementById('error-title'),
    errorMessage: document.getElementById('error-message'),
    results: document.getElementById('results'),

    studentName: document.getElementById('student-name'),
    studentCodeDisplay: document.getElementById('student-code-display'),
    studentEmailWrap: document.getElementById('student-email-wrap'),
    studentEmail: document.getElementById('student-email'),

    timelineSection: document.getElementById('timeline-section'),
    timeline: document.getElementById('timeline'),
    finalSection: document.getElementById('final-section'),
    finalResults: document.getElementById('final-results'),

    // NEW FEATURE refs — additive only
    rememberCheckbox: document.getElementById('remember-code-checkbox'),
    downloadPdfBtn: document.getElementById('download-pdf-btn'),
  };

  /* =====================================================================
     2. BRANDING (config.js drives everything — no HTML edits needed)
     ===================================================================== */

  function applyBrandColors() {
    const { colors } = CONFIG;
    if (!colors) return;
    const root = document.documentElement.style;
    if (colors.primary) root.setProperty('--color-primary', colors.primary);
    if (colors.secondary) root.setProperty('--color-accent', colors.secondary);
  }

  /** Only ever reveals a logo <img> once it has actually finished
   *  loading; a missing path or a failed load leaves the clean text
   *  placeholder visible instead of a broken-image icon. */
  function applyLogo(imgEl, placeholderEl, path) {
    if (!imgEl) return;
    imgEl.hidden = true;
    if (placeholderEl) placeholderEl.hidden = false;
    if (!path) return;

    imgEl.onload = () => { imgEl.hidden = false; if (placeholderEl) placeholderEl.hidden = true; };
    imgEl.onerror = () => {
      console.warn(`CourseTrack — logo failed to load from "${path}"; showing placeholder instead.`);
      imgEl.hidden = true;
      imgEl.removeAttribute('src');
      if (placeholderEl) placeholderEl.hidden = false;
    };
    imgEl.src = path;
  }

  function applyBranding() {
    applyBrandColors();

    const logos = CONFIG.logos || {};
    applyLogo(dom.courseLogoImg, dom.courseLogoPlaceholder, logos.course);
    applyLogo(dom.orgLogoPrimary, dom.orgPlaceholderPrimary, logos.primaryOrg);
    applyLogo(dom.orgLogoPartner, dom.orgPlaceholderPartner, logos.partnerOrg);

    const orgs = CONFIG.organizations || {};
    if (orgs.primary && orgs.primary.name) {
      dom.orgNamePrimary.textContent = orgs.primary.name;
      dom.orgPlaceholderPrimary.textContent = orgs.primary.name;
    }
    if (orgs.partner && orgs.partner.name) {
      dom.orgNamePartner.textContent = orgs.partner.name;
      dom.orgPlaceholderPartner.textContent = orgs.partner.name;
    }

    applyBrandText();
  }

  /** Language-dependent branding text. Runs at startup and again on every
   *  language switch. Logos/colors stay in applyBranding() so they don't
   *  reload (and flicker) when the language changes. */
  function applyBrandText() {
    const courseName = I18N.cfgOr('courseName', null) || 'CourseTrack';
    dom.headerCourseName.textContent = courseName;
    dom.courseLogoPlaceholder.textContent = courseName.trim().charAt(0).toUpperCase();
    dom.headerCourseSubtitle.textContent = I18N.cfgOr('courseSubtitle', 'header.subtitle');

    const orgs = CONFIG.organizations || {};
    const footer = CONFIG.footerText || {};
    const isEn = I18N.getLang() === 'en';
    const primaryName = (orgs.primary && orgs.primary.name) || '';
    const partnerName = (orgs.partner && orgs.partner.name) || '';

    // English keeps exactly what config.js says; Arabic uses the dictionary.
    dom.footerPowered.textContent = isEn && footer.poweredBy
      ? footer.poweredBy
      : I18N.t('footer.poweredBy', { org: primaryName });
    dom.footerCollab.textContent = isEn && footer.collaboration
      ? footer.collaboration
      : I18N.t('footer.collab', { org: partnerName });

    const devName = (footer.developedBy || 'Salah Hossam').replace(/^Developed by\s*/i, '');
    dom.footerDeveloped.innerHTML = `${escapeHtml(I18N.t('footer.developedBy'))} <strong><bdi>${escapeHtml(devName)}</bdi></strong>`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* =====================================================================
     3. THEME — Light Mode is always the default
     ===================================================================== */

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(STORAGE_KEYS.THEME, theme); } catch (err) { /* non-fatal */ }
  }

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem(STORAGE_KEYS.THEME); } catch (err) { /* non-fatal */ }
    applyTheme(saved === 'dark' ? 'dark' : 'light');
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }

  /* =====================================================================
     4. COLUMN DETECTION — never hardcodes a column name or week number
     ===================================================================== */

  function extractNumberedColumn(header, prefixPattern) {
    const clean = String(header).trim();
    if (!clean || !prefixPattern.test(clean)) return null;
    const digits = clean.match(/(\d+)/);
    return digits ? parseInt(digits[1], 10) : null;
  }

  function detectColumns(headers) {
    const columns = { code: null, name: null, email: null, meetings: [], tasks: [], notes: [], final: [] };

    IDENTITY_FIELDS.forEach(({ key, pattern }) => {
      if (columns[key]) return;
      const match = headers.find((header) => pattern.test(String(header).trim()));
      if (match) columns[key] = match;
    });

    headers.forEach((header) => {
      if (header === columns.code || header === columns.name || header === columns.email) return;

      const meetingNum = extractNumberedColumn(header, /^m/i);
      if (meetingNum !== null) { columns.meetings.push({ key: header, num: meetingNum }); return; }

      const taskNum = extractNumberedColumn(header, /^t/i);
      if (taskNum !== null) { columns.tasks.push({ key: header, num: taskNum }); return; }

      const notesNum = extractNumberedColumn(header, /^notes?/i);
      if (notesNum !== null) { columns.notes.push({ key: header, num: notesNum }); return; }

      columns.final.push(header);
    });

    columns.meetings.sort((a, b) => a.num - b.num);
    columns.tasks.sort((a, b) => a.num - b.num);
    columns.notes.sort((a, b) => a.num - b.num);
    return columns;
  }

  function buildWeekList(columns) {
    const weekMap = new Map();
    const ensure = (num) => {
      if (!weekMap.has(num)) weekMap.set(num, { num, meetingKey: null, taskKey: null, notesKey: null });
      return weekMap.get(num);
    };
    columns.meetings.forEach(({ key, num }) => { ensure(num).meetingKey = key; });
    columns.tasks.forEach(({ key, num }) => { ensure(num).taskKey = key; });
    columns.notes.forEach(({ key, num }) => { ensure(num).notesKey = key; });
    return Array.from(weekMap.values()).sort((a, b) => a.num - b.num);
  }

  /* =====================================================================
     5. FIREBASE DATA FETCH — always the latest, never cached
     ===================================================================== */

  /**
   * Builds the /students.json REST endpoint from the single configured
   * project root.
   *
   * Deliberately sends NO credential of any kind. config.js is loaded
   * by this public page, so anything in it is visible to every student
   * — the Student Portal must work purely off database rules that
   * allow public READ of /students (see SETUP.md). The admin-only
   * databaseSecret is never read here.
   */
  function getStudentsUrl() {
    const databaseURL = CONFIG.firebase && CONFIG.firebase.databaseURL;
    if (!databaseURL || /PASTE_|YOUR_/i.test(databaseURL)) {
      throw I18N.error('err.notConfigured');
    }
    return `${databaseURL.replace(/\/+$/, '')}/students.json`;
  }

  /**
   * Fetches every student record straight from Firebase. The admin
   * upload stores them as an OBJECT keyed by student code (never an
   * array), so Object.values() turns that back into a plain list of
   * { header: value } records — the same shape the rest of this file
   * already works with, regardless of where data originally came from.
   */
  async function fetchCourseData() {
    const url = getStudentsUrl();

    // A `finally` block only runs once the request SETTLES — a stalled
    // connection that never answers would otherwise leave the spinner
    // going forever. The timeout guarantees every request settles.
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(url, { method: 'GET', cache: 'no-store', signal: controller.signal });
    } catch (err) {
      window.clearTimeout(timeoutId);
      throw I18N.error(err && err.name === 'AbortError' ? 'err.timeout' : 'err.network');
    }

    // The abort timer stays armed through the body read below too — a
    // response whose body stalls mid-download must also settle.
    let data;
    try {
      if (!response.ok) {
        throw I18N.error(response.status === 401 || response.status === 403 ? 'err.denied' : 'err.serverError');
      }
      data = await response.json();
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw I18N.error('err.timeout');
      }
      if (err instanceof SyntaxError) {
        throw I18N.error('err.unreadable');
      }
      throw err;
    } finally {
      window.clearTimeout(timeoutId);
    }

    if (data && data.error) {
      throw new Error(String(data.error));
    }

    // Firebase returns `null` for an empty node. Records are filtered to
    // plain objects defensively, in case something non-record was ever
    // written under /students by hand.
    const rows = data ? Object.values(data).filter((r) => r && typeof r === 'object') : [];
    if (!rows.length) {
      throw I18N.error('err.noData');
    }

    // Union of every key across every record — not just the first
    // row's — so a record that is missing a column (or has an extra
    // one) can never cause that column to silently go undetected.
    const headerSet = new Set();
    rows.forEach((row) => Object.keys(row).forEach((key) => headerSet.add(key)));
    const headers = Array.from(headerSet);

    const columns = detectColumns(headers);

    // Last-resort fallback only. detectColumns already recognizes any
    // header containing "code", "كود", "رقم الطالب" or "id" — which
    // covers `code`, `student_code`, `الكود` and combined headers like
    // "Student Code (الكود)". This is reached only for data that never
    // went through the Admin upload (e.g. a record typed by hand
    // straight into the Firebase console under an unusual key).
    if (!columns.code) {
      const fallbackNames = ['code', 'student_code', 'studentcode', 'الكود'];
      columns.code = headers.find((h) => fallbackNames.includes(String(h).trim().toLowerCase())) || null;
    }

    // Every identifier is trimmed here, and the search input is trimmed
    // and lower-cased in handleSearch, so stray spaces on either side
    // can never cause a false "not found".
    const students = rows
      .filter((row) => columns.code && String(row[columns.code]).trim() !== '')
      .map((row) => ({ code: String(row[columns.code]).trim(), raw: row }));

    console.group('%cCourseTrack — Firebase fetch debug', 'color:#f59e0b;font-weight:700;');
    console.log('Detected column headers:', headers);
    console.log('Code column:', columns.code, '| Name column:', columns.name, '| Email column:', columns.email);
    console.log('Meeting columns:', columns.meetings);
    console.log('Task columns:', columns.tasks);
    console.log('Notes columns:', columns.notes);
    console.log('Final result columns:', columns.final);
    console.log(`Parsed ${students.length} student record(s).`);
    console.groupEnd();

    return { columns, students };
  }

  /* =====================================================================
     6. SHARED RENDERING HELPERS
     ===================================================================== */

  function classifyValue(rawValue) {
    const value = String(rawValue).trim().toLowerCase();
    if (!value) return 'neutral';
    if (KEYWORDS.negative.some((word) => value.includes(word))) return 'negative';
    if (KEYWORDS.positive.some((word) => value.includes(word))) return 'positive';
    return 'neutral';
  }

  function isEmptyCell(rawValue) {
    return rawValue === undefined || rawValue === null || String(rawValue).trim() === '';
  }

  function displayValue(rawValue, fallback = '—') {
    return isEmptyCell(rawValue) ? fallback : String(rawValue).trim();
  }

  function setAutoText(el, text) {
    // Real data (names, codes, grades, notes...) must never be re-translated
    // or overwritten by a language switch, so any translation key is detached.
    el.removeAttribute('data-i18n');
    el.removeAttribute('data-i18n-vars');
    el.textContent = text;
    el.setAttribute('dir', 'auto');
  }

  function setViewState({ loading = false, error = false, results = false }) {
    dom.searchLoading.hidden = !loading;
    dom.errorState.hidden = !error;
    dom.results.hidden = !results;
  }

  /**
   * labelKey    — dictionary key for the field label (session.*)
   * value       — the RAW cell value from the database
   * fallbackKey — dictionary key shown when the cell is empty
   */
  function buildFieldCard(labelKey, value, fallbackKey, statusClass, iconSvg) {
    const field = document.createElement('div');
    field.className = 'tl-field';

    const icon = document.createElement('div');
    icon.className = `tl-field__icon tl-field__icon--${statusClass.iconKind}`;
    icon.innerHTML = iconSvg;

    const text = document.createElement('div');
    text.className = 'tl-field__text';

    const labelEl = document.createElement('span');
    labelEl.className = 'tl-field__label';
    I18N.setText(labelEl, labelKey);

    const valueEl = document.createElement('span');
    valueEl.className = `tl-field__value status-${statusClass.status}`;
    if (isEmptyCell(value)) {
      I18N.setText(valueEl, fallbackKey);           // "Not Published Yet" etc. — translatable
      valueEl.setAttribute('dir', 'auto');
    } else {
      setAutoText(valueEl, displayValue(value));    // real data — verbatim, never keyed
    }

    text.appendChild(labelEl);
    text.appendChild(valueEl);
    field.appendChild(icon);
    field.appendChild(text);
    return field;
  }

  /* =====================================================================
     7. COURSE PROGRESS (Week timeline) — only real weeks, ever
     ===================================================================== */

  function buildWeekCard(week, index, row) {
    const item = document.createElement('div');
    item.className = 'timeline-item';
    item.style.animationDelay = `${Math.min(index * 70, 700)}ms`;

    const header = document.createElement('div');
    header.className = 'timeline-item__header';
    const title = document.createElement('span');
    title.className = 'timeline-item__title';
    I18N.setText(title, 'week.title', { n: week.num });
    header.appendChild(title);
    item.appendChild(header);

    const body = document.createElement('div');
    body.className = 'timeline-item__body';

    if (week.meetingKey) {
      const value = row[week.meetingKey];
      const status = isEmptyCell(value) ? 'pending' : classifyValue(value);
      body.appendChild(buildFieldCard('session.meeting', value, 'session.notPublished', { status, iconKind: 'meeting' }, ICONS.meeting));
    }
    if (week.taskKey) {
      const value = row[week.taskKey];
      const status = isEmptyCell(value) ? 'pending' : classifyValue(value);
      body.appendChild(buildFieldCard('session.task', value, 'session.notPublished', { status, iconKind: 'task' }, ICONS.task));
    }
    if (week.notesKey) {
      const value = row[week.notesKey];
      const status = isEmptyCell(value) ? 'pending' : 'neutral';
      body.appendChild(buildFieldCard('session.notes', value, 'session.noNotes', { status, iconKind: 'notes' }, ICONS.notes));
    }

    item.appendChild(body);
    return item;
  }

  function renderTimeline(columns, student) {
    const weeks = buildWeekList(columns);
    if (!weeks.length) {
      dom.timelineSection.hidden = true;
      dom.timeline.innerHTML = '';
      return;
    }
    dom.timeline.innerHTML = '';
    weeks.forEach((week, index) => dom.timeline.appendChild(buildWeekCard(week, index, student.raw)));
    dom.timelineSection.hidden = false;
  }

  /* =====================================================================
     8. FINAL RESULT (Course Summary)
     ===================================================================== */

  /**
   * Renders one tile per "final" column — but only for columns THIS
   * student actually has a value in. A column that exists in the sheet
   * (e.g. the admin uploaded a file with "Rank" or "Final Score" headers
   * already in place for a future release) but is still blank for this
   * student is skipped entirely rather than shown as an empty "—" tile.
   * The section itself is hidden only if literally nothing rendered.
   *
   * This is what lets ANY uploaded sheet — a lean weekly file, a
   * rankings-only file, or a wide file with lots of not-yet-filled
   * columns — render cleanly without code changes: the column set is
   * never hardcoded, and emptiness is judged per student, per field,
   * at render time.
   */
  function renderFinalResults(columns, student) {
    dom.finalResults.innerHTML = '';
    let visibleCount = 0;

    columns.final.forEach((key) => {
      const value = student.raw[key];
      if (isEmptyCell(value)) return; // nothing to show yet for this student — skip, don't pad with "—"

      const el = document.createElement('div');
      el.className = 'final-item';
      el.style.animationDelay = `${Math.min(visibleCount * 70, 700)}ms`;

      const label = document.createElement('div');
      label.className = 'final-item__label';
      label.textContent = key;

      const valueEl = document.createElement('div');
      valueEl.className = `final-item__value status-${classifyValue(value)}`;
      setAutoText(valueEl, displayValue(value));

      el.appendChild(label);
      el.appendChild(valueEl);
      dom.finalResults.appendChild(el);
      visibleCount += 1;
    });

    dom.finalSection.hidden = visibleCount === 0;
  }

  /* =====================================================================
     9. STUDENT PROFILE + SEARCH
     ===================================================================== */

  function renderProfile(columns, student) {
    const studentName = columns.name ? displayValue(student.raw[columns.name], '') : '';
    if (studentName) {
      setAutoText(dom.studentName, studentName);
    } else {
      I18N.setText(dom.studentName, 'profile.fallbackName'); // "Student" — translatable fallback
      dom.studentName.setAttribute('dir', 'auto');
    }
    setAutoText(dom.studentCodeDisplay, student.code);

    if (columns.email) {
      const email = displayValue(student.raw[columns.email], '');
      dom.studentEmailWrap.hidden = !email;
      setAutoText(dom.studentEmail, email);
    } else {
      dom.studentEmailWrap.hidden = true;
    }
  }

  /* =====================================================================
     ACHIEVEMENT BADGES
     ---------------------------------------------------------------------
     evaluateBadges(studentData) -> the badges a student has earned (data)
     renderBadges(studentData)   -> those badges as an HTML string (markup)
     renderAchievements(...)     -> injects that markup into the results view

       studentData = { columns, raw, cohort }
         columns : the object detectColumns() returns (meetings / tasks / final)
         raw     : the student's row, exactly as stored in Firebase
         cohort  : every student's row (what the search just fetched) — the
                   pool Top Performer is measured against

     The three rules
       🏆 Top Performer      at or above the average of the ACTIVE submitters — on the final score,
                             or, when the sheet has no final/total column, on any weekly task
       ⚡ 100% Attendance    no absence or negative mark in any recorded meeting
       🔥 Consistent Learner every published task submitted AND passed

     Design decisions (all adjustable in BADGE_RULES below)
       • A BLANK cell means "not published yet" (that is exactly how the
         timeline shows it), so it is never counted as an absence or a miss.
         Badges are judged on what has been published so far.
       • Badges must be EARNED on evidence. Doubt never awards one: an
         unreadable score, a task grade nobody can interpret, or a course with
         nothing published yet earns nothing.
       • Matching is by whole words, in English and Arabic. The card colours
         use a looser substring match (so "no" also matches "note"); a badge
         never contradicts them — it is denied if EITHER method says negative.
       • Top Performer is RELATIVE, not a fixed percentage. The benchmark is
         the average of the ACTIVE submitters only — students who actually
         have a valid numeric grade in the final-score column. Blank cells,
         "N/A", "Absent", "Not submitted" and zeros are left out, so a course
         where 40 of 100 students submitted is measured against those 40. A
         student qualifies at or above that average (BADGE_RULES can raise
         the bar, e.g. average + 0.5 standard deviations). Being relative, it
         never has to assume a maximum score: 10/10, 45/50 and 92/100 all
         work, and a "Total" column is allowed. Columns about attendance,
         rank, status or notes are never mistaken for the score.
       • FALLBACK for sheets without a final/total column (only weekly task
         grades): each task column is its own assessment with its OWN average,
         taken over the students who actually have a grade for THAT task. The
         student earns the badge when they are at or above the average in any
         task (BADGE_RULES.minTasksAtOrAboveAverage raises that). The badge
         says which week it was earned in. Open the portal with ?badgeDebug=1
         to see, in the browser console, why a student did or didn't qualify.
     ===================================================================== */

  const BADGE_RULES = {
    // 🏆 Top Performer — measured against the ACTIVE submitters (see findScoreBenchmark)
    topPerformerMargin: 0,    // 0 = at or above the average of the active submitters (the default rule).
                              // Stricter: 0.5 = average + half a standard deviation,
                              //           1   = average + one standard deviation (about the top sixth).
    minSubmitters: 2,         // active submitters needed before there is anything to compare against
                              // (a lone submitter would just be measured against themselves)
    countZeroScores: false,   // false: a 0 means "did not submit" and is left out of the average
    scoreColumn: null,        // force the column that holds the final score — e.g. 'Final Score', 'Total'
                              // or 'T3'; null = detect it from the headers

    // 🏆 …and the fallback used when NO final/total column can be benchmarked
    minTasksAtOrAboveAverage: 1,  // weekly tasks the student must be at/above the task's average in.
                                  // 1 = "any task" (the default rule). Raise it (2, 3…) so the badge
                                  // reflects consistency across tasks rather than one good week.
    includeMeetingGrades: false,  // also treat numeric meeting columns (M1, M2…) as assessments.
                                  // Off: meetings are attendance, which the ⚡ badge already covers.

    // ⚡ Attendance and 🔥 Consistent Learner
    passPercent: 50,          // a task graded on a known scale (7/10, 70%, 0.7) must reach this to pass
    taskMaxScore: null,       // set e.g. 10 if task grades are bare numbers out of that maximum;
                              // null = a bare task number counts as submitted & passed when above 0
    minRecordedMeetings: 1,   // published meetings needed before attendance can be judged
    minRecordedTasks: 1,      // published tasks needed before consistency can be judged
  };

  const BADGE_VOCAB = {
    positive: [
      'present', 'attended', 'yes', 'pass', 'passed', 'passing', 'eligible', 'complete', 'completed', 'done',
      'excellent', 'good', 'success', 'successful', 'successfully', 'submitted', 'delivered', 'accepted',
      'approved', 'active', 'true', '✓', '✔', '☑', '✅',
      'حاضر', 'حضر', 'نعم', 'ناجح', 'نجح', 'اجتاز', 'مكتمل', 'مكتملة', 'تم', 'تم التسليم', 'سلم', 'مقبول', 'ممتاز', 'جيد',
    ],
    negative: [
      'absent', 'absence', 'no', 'not', 'fail', 'failed', 'failing', 'missing', 'missed', 'incomplete',
      'inactive', 'ineligible', 'rejected', 'false', '✗', '✘', '✖', '❌',
      'غائب', 'غايب', 'غياب', 'لا', 'لم', 'راسب', 'رسب', 'غير', 'ناقص', 'مرفوض',
    ],
  };

  /** Lower-cases and folds the Arabic spellings that vary between typists
   *  (diacritics, tatweel, أ/إ/آ, ى, ة) so one vocabulary entry matches all. */
  function normalizeBadgeText(value) {
    return String(value === undefined || value === null ? '' : value)
      .toLowerCase()
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      .replace(/[\u0623\u0625\u0622]/g, '\u0627')
      .replace(/\u0649/g, '\u064A')
      .replace(/\u0629/g, '\u0647')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** Words match only as whole words ("no" must not match "note" or "normal");
   *  symbols such as ✓ simply match wherever they appear. */
  function compileVocab(words) {
    return words.map((word) => {
      const normalized = normalizeBadgeText(word);
      return /[\p{L}\p{N}]/u.test(normalized)
        ? new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(normalized)}(?![\\p{L}\\p{N}])`, 'u')
        : new RegExp(escapeRegExp(normalized), 'u');
    });
  }
  const POSITIVE_PATTERNS = compileVocab(BADGE_VOCAB.positive);
  const NEGATIVE_PATTERNS = compileVocab(BADGE_VOCAB.negative);

  /** 'positive' | 'negative' | 'neutral' for a text mark. Negative wins. */
  function classifyBadgeText(text) {
    const normalized = normalizeBadgeText(text);
    if (!normalized) return 'neutral';
    if (classifyValue(text) === 'negative') return 'negative';            // same verdict as the card's red colour
    if (NEGATIVE_PATTERNS.some((pattern) => pattern.test(normalized))) return 'negative';
    if (POSITIVE_PATTERNS.some((pattern) => pattern.test(normalized))) return 'positive';
    return 'neutral';
  }

  const MARK_NUMBER = '(-?\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|-?\\d+(?:[.,]\\d+)?)';
  const MARK_PERCENT_RE = new RegExp(`^${MARK_NUMBER}\\s*%$`);
  const MARK_RATIO_RE = new RegExp(`^${MARK_NUMBER}\\s*(?:/|out of|من)\\s*${MARK_NUMBER}$`, 'i');
  const MARK_BARE_RE = new RegExp(`^${MARK_NUMBER}$`);
  const markToNumber = (piece) => (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(piece) ? Number(piece.replace(/,/g, '')) : Number(piece.replace(',', '.')));

  /** Reads a mark as a number, in whichever form Excel/typists produced it:
   *  92 · "92" · "92.5" · "92,5" · "1,000" · "92%" · "46/50" · "46 out of 50"
   *  · "٩٢" (Arabic-Indic digits) · "٩٢٪" · "٤٦ من ٥٠".
   *  Returns { percent } when the value carries its own scale (%, x/y),
   *  { bare } for a plain number, or null when it is not numeric at all. */
  function parseMark(raw) {
    if (typeof raw === 'number') return Number.isFinite(raw) ? { bare: raw } : null;
    let text = String(raw === undefined || raw === null ? '' : raw)
      .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
      .replace(/\u066B/g, '.')
      .replace(/\u066C/g, ',')
      .replace(/\u066A/g, '%')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return null;

    let match = text.match(MARK_PERCENT_RE);
    if (match) return { percent: markToNumber(match[1]) };
    match = text.match(MARK_RATIO_RE);
    if (match) {
      const denominator = markToNumber(match[2]);
      return denominator > 0 ? { percent: (markToNumber(match[1]) / denominator) * 100 } : null;
    }
    match = text.match(MARK_BARE_RE);
    return match ? { bare: markToNumber(match[1]) } : null;
  }

  /* ---- 🏆 Top Performer: relative to the ACTIVE submitters ---- */

  // Columns that can hold the final score, best match first. Because the
  // comparison is relative, the scale (out of 10, 50, 100...) doesn't matter,
  // so a "Total" column is fine. Attendance, rank, status, notes and the like
  // are never candidates.
  const SCORE_COLUMN_EXCLUDE = /attend|حضور|absen|غياب|rank|ترتيب|position|status|حاله|e-?mail|note|ملاحظ|remark|comment|تعليق|date|تاريخ|phone|mobile|هاتف|جوال/;
  const SCORE_COLUMN_TIERS = [
    /final|نهائ|overall|اجمال/,                          // "Final Score", "Overall %", "الدرجة النهائية"
    /total|مجموع/,                                       // "Total", "المجموع"
    /percent|%|نسبه|score|grade|mark|point|result|درجه|نقاط|نتيجه/,   // any other score-like column
  ];

  /** One cell as a usable grade — { value, explicitPercent } — or null when it
   *  isn't one: blank, "N/A", "Absent", "Not submitted", a boolean, or a nested
   *  object. Any scale is accepted (10, 45/50, 92%, "٩٢"). */
  function readScore(cell) {
    if (isEmptyCell(cell) || typeof cell === 'object' || typeof cell === 'boolean') return null;
    const mark = parseMark(cell);
    if (!mark) return null;
    const value = mark.percent !== undefined ? mark.percent : mark.bare;
    return Number.isFinite(value) ? { value, explicitPercent: mark.percent !== undefined } : null;
  }

  /** Is this a real submission? A 0 is read as "did not submit" (it would only
   *  drag the average down), and a negative number is never a grade. */
  function isSubmission(score) {
    return !!score && (score.value > 0 || (BADGE_RULES.countZeroScores && score.value === 0));
  }

  /** The benchmark for one column: the mean (and spread) over ACTIVE
   *  submitters only. Returns null when fewer than minSubmitters exist. */
  function buildScoreBenchmark(cohort, header) {
    const scores = cohort.map((row) => readScore(row && row[header])).filter(isSubmission);
    if (scores.length < BADGE_RULES.minSubmitters) return null;

    // Excel stores 92% as 0.92. When every plain number in the column is <= 1
    // they are fractions: scale them so they line up with typed "92%" values.
    const fractional = scores.some((s) => !s.explicitPercent) && scores.every((s) => s.explicitPercent || s.value <= 1);
    const valueOf = (score) => (fractional && !score.explicitPercent ? score.value * 100 : score.value);

    const values = scores.map(valueOf);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const stdDev = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / values.length);
    return {
      header,
      count: values.length,
      mean,
      stdDev,
      threshold: mean + BADGE_RULES.topPerformerMargin * stdDev,
      valueOf,
      isPercent: fractional || scores.every((s) => s.explicitPercent),
    };
  }

  /** Picks ONE column for the whole cohort (so everyone is compared on the
   *  same thing): the best-matching header that has enough active submitters. */
  function findScoreBenchmark(columns, cohort) {
    if (!Array.isArray(cohort) || !cohort.length) return null;
    const candidates = [];
    if (BADGE_RULES.scoreColumn) {
      candidates.push(BADGE_RULES.scoreColumn);
    } else {
      SCORE_COLUMN_TIERS.forEach((tier) => {
        columns.final.forEach((header) => {
          const label = normalizeBadgeText(header);
          if (!SCORE_COLUMN_EXCLUDE.test(label) && tier.test(label) && candidates.indexOf(header) === -1) candidates.push(header);
        });
      });
    }
    for (let i = 0; i < candidates.length; i += 1) {
      const benchmark = buildScoreBenchmark(cohort, candidates[i]);
      if (benchmark) return benchmark;
    }
    return null;
  }

  function formatScore(value, isPercent) {
    return `${Math.round(value * 100) / 100}${isPercent ? '%' : ''}`;
  }

  /* ---- ⚡ 100% Attendance ---- */

  /** True when a meeting mark records an absence: a negative word, FALSE, or a 0 / negative number. */
  function isAbsence(value) {
    if (value === false) return true;
    const mark = parseMark(value);
    if (mark) return (mark.percent !== undefined ? mark.percent : mark.bare) <= 0;
    return classifyBadgeText(value) === 'negative';
  }

  function evaluateAttendance(columns, raw) {
    let recorded = 0;
    let absences = 0;
    columns.meetings.forEach(({ key }) => {
      if (isEmptyCell(raw[key]) || typeof raw[key] === 'object') return;   // not published yet (or corrupt) — not an absence
      recorded += 1;
      if (isAbsence(raw[key])) absences += 1;
    });
    return { recorded, absences };
  }

  /* ---- 🔥 Consistent Learner ---- */

  /** 'passed' | 'failed' | 'unknown' for one published task mark. */
  function judgeTask(value) {
    if (value === true) return 'passed';
    if (value === false) return 'failed';
    const mark = parseMark(value);
    if (mark) {
      if (mark.percent !== undefined) return mark.percent >= BADGE_RULES.passPercent ? 'passed' : 'failed';
      if (mark.bare <= 0) return 'failed';
      if (mark.bare <= 1) return mark.bare * 100 >= BADGE_RULES.passPercent ? 'passed' : 'failed';
      if (BADGE_RULES.taskMaxScore) return (mark.bare / BADGE_RULES.taskMaxScore) * 100 >= BADGE_RULES.passPercent ? 'passed' : 'failed';
      return 'passed';                     // a bare grade above 0: submitted, and the scale is unknown
    }
    const verdict = classifyBadgeText(value);
    if (verdict === 'negative') return 'failed';
    return verdict === 'positive' ? 'passed' : 'unknown';   // unreadable text is NOT evidence of a pass
  }

  function evaluateTasks(columns, raw) {
    let recorded = 0;
    let passed = 0;
    columns.tasks.forEach(({ key }) => {
      if (isEmptyCell(raw[key]) || typeof raw[key] === 'object') return;   // not published yet (or corrupt)
      recorded += 1;
      if (judgeTask(raw[key]) === 'passed') passed += 1;
    });
    return { recorded, passed };
  }

  /** Does a score meet its benchmark? The 1e-9 keeps floating-point noise
   *  (2.2 against a mean of 2.2000000000000006) from denying an exact match. */
  function meetsBenchmark(value, benchmark) {
    return value > 0 && value >= benchmark.threshold - 1e-9;
  }

  const round2 = (x) => Math.round(x * 100) / 100;

  /** Opt-in diagnostics: open the portal with ?badgeDebug=1 (or set
   *  localStorage coursetrack_badge_debug = 1) and the browser console explains
   *  every Top Performer decision. Off for students. */
  function badgeDebugEnabled() {
    try {
      return /[?&]badgeDebug(=1|=true)?(&|$)/.test(window.location.search) || window.localStorage.getItem('coursetrack_badge_debug') === '1';
    } catch (err) { return false; }
  }

  function logTopPerformerTrace(columns, raw, trace) {
    console.groupCollapsed(`CourseTrack badges — Top Performer decision for ${raw[columns.code] === undefined ? 'this student' : raw[columns.code]}`);
    console.table(trace);
    console.groupEnd();
  }

  /**
   * 🏆 Top Performer. Returns { badge, trace }.
   *   1. An explicit final / total / score column that has enough active
   *      submitters is THE assessment. If it exists the verdict is final.
   *   2. Otherwise (no such column) every weekly task column is an assessment
   *      with its own benchmark — the average of the students who actually have
   *      a grade for THAT task — and the student qualifies when they are at or
   *      above it in at least BADGE_RULES.minTasksAtOrAboveAverage of them.
   */
  function evaluateTopPerformer(columns, raw, cohort) {
    const trace = badgeDebugEnabled() ? [] : null;
    const note = (entry) => { if (trace) trace.push(entry); };

    // 1) explicit final / total column
    const final = findScoreBenchmark(columns, cohort);
    if (final) {
      const own = readScore(raw[final.header]);
      const value = isSubmission(own) ? final.valueOf(own) : null;
      const qualifies = value !== null && meetsBenchmark(value, final);
      note({
        assessment: `final column "${final.header}"`, activeSubmitters: final.count, average: round2(final.mean),
        needs: round2(final.threshold), yourScore: value === null ? null : round2(value),
        verdict: qualifies ? 'QUALIFIES' : (value === null ? 'this student has no valid score here' : 'below the benchmark'),
      });
      return {
        trace,
        badge: qualifies ? {
          id: 'top-performer', icon: '🏆', tone: 'gold', titleKey: 'badge.top.title', descKey: 'badge.top.desc',
          descVars: { score: formatScore(value, final.isPercent), average: formatScore(final.mean, final.isPercent), n: final.count },
        } : null,
      };
    }
    note({ assessment: 'final / total column', verdict: `none with at least ${BADGE_RULES.minSubmitters} active submitters — using the weekly task columns instead` });

    // 2) fallback: each weekly task against its own average
    const assessments = columns.tasks.concat(BADGE_RULES.includeMeetingGrades ? columns.meetings : []);
    const wins = [];
    assessments.forEach(({ key, num }) => {
      const benchmark = buildScoreBenchmark(cohort, key);
      const own = readScore(raw[key]);
      const value = benchmark && isSubmission(own) ? benchmark.valueOf(own) : null;
      const qualifies = value !== null && meetsBenchmark(value, benchmark);
      if (qualifies) wins.push({ num, value, benchmark, z: benchmark.stdDev > 0 ? (value - benchmark.mean) / benchmark.stdDev : 0 });
      if (trace && (benchmark || isSubmission(own))) {
        note({
          assessment: `Week ${num} (${key})`, activeSubmitters: benchmark ? benchmark.count : `fewer than ${BADGE_RULES.minSubmitters}`,
          average: benchmark ? round2(benchmark.mean) : null, needs: benchmark ? round2(benchmark.threshold) : null,
          yourScore: value !== null ? round2(value) : (isSubmission(own) ? own.value : null),
          verdict: qualifies ? 'QUALIFIES' : (!benchmark ? 'not enough active submitters for this task' : (value === null ? 'this student has no valid grade' : 'below this task\'s average')),
        });
      }
    });

    if (wins.length < BADGE_RULES.minTasksAtOrAboveAverage || !wins.length) {
      note({ assessment: 'result', verdict: `at/above the task average in ${wins.length} task(s); ${BADGE_RULES.minTasksAtOrAboveAverage} needed` });
      return { trace, badge: null };
    }
    wins.sort((a, b) => (b.z - a.z) || (b.num - a.num));   // describe the strongest week (latest on a tie)
    const best = wins[0];
    const vars = {
      week: best.num,
      score: formatScore(best.value, best.benchmark.isPercent),
      average: formatScore(best.benchmark.mean, best.benchmark.isPercent),
      n: best.benchmark.count,
    };
    note({ assessment: 'result', verdict: `QUALIFIES — at/above the task average in ${wins.length} task(s)` });
    return {
      trace,
      badge: {
        id: 'top-performer', icon: '🏆', tone: 'gold', titleKey: 'badge.top.title',
        descKey: wins.length > 1 ? 'badge.top.descTasks' : 'badge.top.descTask',
        descVars: wins.length > 1 ? { count: wins.length, week: vars.week, score: vars.score, average: vars.average } : vars,
      },
    };
  }

  /** The badges this student has earned, in display order. Pure: no DOM. */
  function evaluateBadges(studentData) {
    const columns = studentData && studentData.columns;
    const raw = studentData && studentData.raw;
    if (!columns || !raw) return [];

    const earned = [];

    const top = evaluateTopPerformer(columns, raw, studentData.cohort);
    if (top.badge) earned.push(top.badge);
    if (top.trace) logTopPerformerTrace(columns, raw, top.trace);

    const attendance = evaluateAttendance(columns, raw);
    if (attendance.recorded >= BADGE_RULES.minRecordedMeetings && attendance.absences === 0) {
      earned.push({ id: 'full-attendance', icon: '⚡', tone: 'blue', titleKey: 'badge.attendance.title', descKey: 'badge.attendance.desc', descVars: { n: attendance.recorded } });
    }

    const tasks = evaluateTasks(columns, raw);
    if (tasks.recorded >= BADGE_RULES.minRecordedTasks && tasks.passed === tasks.recorded) {
      earned.push({ id: 'consistent-learner', icon: '🔥', tone: 'ember', titleKey: 'badge.consistent.title', descKey: 'badge.consistent.desc', descVars: { n: tasks.recorded } });
    }

    return earned;
  }

  /** The earned badges as HTML (heading + list), or '' when none are earned.
   *  Text is already translated AND carries data-i18n keys, so a language
   *  switch re-translates it live. Every dynamic value is escaped. */
  function renderBadges(studentData) {
    const earned = evaluateBadges(studentData);
    if (!earned.length) return '';

    const items = earned.map((badge, index) => {
      // escapeHtml() leaves quotes alone (fine for text, wrong inside an attribute), so they are escaped here
      const vars = badge.descVars ? ` data-i18n-vars="${escapeHtml(JSON.stringify(badge.descVars)).replace(/"/g, '&quot;')}"` : '';
      return `<li class="badge badge--${badge.tone}" data-badge="${badge.id}" style="animation-delay:${index * 90}ms">
        <span class="badge__icon" aria-hidden="true">${badge.icon}</span>
        <span class="badge__body">
          <strong class="badge__title" data-i18n="${badge.titleKey}">${escapeHtml(I18N.t(badge.titleKey))}</strong>
          <span class="badge__desc" data-i18n="${badge.descKey}"${vars}>${escapeHtml(I18N.t(badge.descKey, badge.descVars))}</span>
        </span>
      </li>`;
    }).join('');

    return `<h4 class="achievements__title" data-i18n="badge.heading">${escapeHtml(I18N.t('badge.heading'))}</h4>`
      + `<ul class="badge-list" role="list">${items}</ul>`;
  }

  let achievementsEl = null; // created on first use, directly under the profile card

  function getAchievementsEl() {
    if (!achievementsEl) {
      achievementsEl = document.createElement('div');
      achievementsEl.id = 'achievements';
      achievementsEl.className = 'achievements';
      achievementsEl.hidden = true;
      const anchor = dom.studentName.closest('.profile-card') || dom.studentName.parentElement;
      anchor.insertAdjacentElement('afterend', achievementsEl);
    }
    return achievementsEl;
  }

  /** Injects the badges into the results. A failure here can never stop the
   *  results from showing: it is logged and the badge area stays hidden. */
  function renderAchievements(columns, student, cohort) {
    try {
      const el = getAchievementsEl();
      const html = renderBadges({ columns, raw: student.raw, cohort: Array.isArray(cohort) ? cohort.map((s) => s.raw) : [] });
      el.innerHTML = html;
      el.hidden = !html;
    } catch (err) {
      console.error('CourseTrack — achievement badges failed (results are unaffected):', err);
      if (achievementsEl) { achievementsEl.innerHTML = ''; achievementsEl.hidden = true; }
    }
  }

  function renderStudent(columns, student, cohort) {
    renderProfile(columns, student);
    renderAchievements(columns, student, cohort);
    renderTimeline(columns, student);
    renderFinalResults(columns, student);
    setViewState({ results: true });

    window.requestAnimationFrame(() => {
      dom.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  async function handleSearch(event) {
    event.preventDefault();
    const code = dom.codeInput.value.trim();
    if (!code) return;

    // NEW LINE (Remember My Code): save/refresh the stored code on every
    // search while the checkbox is checked. Everything else in this
    // function is unchanged.
    if (dom.rememberCheckbox && dom.rememberCheckbox.checked) saveRememberedCode(code);

    dom.searchBtn.classList.add('is-loading');
    dom.searchBtn.disabled = true;
    setViewState({ loading: true });

    // Every branch — found, not found, or a fetch error — reaches the
    // `finally` block below, so the spinner can never get stuck.
    try {
      const { columns, students } = await fetchCourseData();
      const normalized = code.trim().toLowerCase();
      const student = students.find((s) => s.code.toLowerCase() === normalized) || null;

      if (!student) {
        console.warn('CourseTrack — no student matched for code:', code);
        I18N.setText(dom.errorTitle, 'err.notFound.title');
        I18N.setText(dom.errorMessage, 'err.notFound.msg');
        setViewState({ error: true });
        return;
      }

      console.log('%cCourseTrack — matched student object:', 'color:#16a34a;font-weight:700;', student);
      renderStudent(columns, student, students);   // `students` = the whole cohort, for the Top Performer benchmark
    } catch (err) {
      console.error('CourseTrack — search error:', err);
      I18N.setText(dom.errorTitle, 'err.generic.title');
      I18N.setErrorText(dom.errorMessage, err, 'err.generic.msg');
      setViewState({ error: true });
    } finally {
      // Loading state is hidden immediately and unconditionally, no
      // matter which branch above ran — this is what fixes the
      // "spinner never stops" bug.
      dom.searchBtn.classList.remove('is-loading');
      dom.searchBtn.disabled = false;
      dom.searchLoading.hidden = true;
    }
  }

  function initSearch() {
    dom.searchForm.addEventListener('submit', handleSearch);
  }

  /* =====================================================================
     NEW FEATURE 1: "Remember My Code"
     Stores the student's code in localStorage (separate key from the
     existing theme storage, so nothing else is affected) and refills it
     automatically on the next visit. Purely additive: no existing
     function signature changes, only one new line was added inside
     handleSearch above.
     ===================================================================== */

  const REMEMBER_CODE_KEY = 'coursetrack_remembered_code';

  function saveRememberedCode(code) {
    try { localStorage.setItem(REMEMBER_CODE_KEY, code); } catch (err) { /* non-fatal: localStorage may be unavailable */ }
  }

  function clearRememberedCode() {
    try { localStorage.removeItem(REMEMBER_CODE_KEY); } catch (err) { /* non-fatal */ }
  }

  function initRememberCode() {
    if (!dom.rememberCheckbox) return; // safe no-op if the checkbox isn't on the page

    let saved = null;
    try { saved = localStorage.getItem(REMEMBER_CODE_KEY); } catch (err) { /* non-fatal */ }

    if (saved) {
      dom.codeInput.value = saved;
      dom.rememberCheckbox.checked = true;
    }

    // Unchecking the box forgets the code immediately, rather than
    // waiting for the next search.
    dom.rememberCheckbox.addEventListener('change', () => {
      if (!dom.rememberCheckbox.checked) clearRememberedCode();
    });
  }

  /* =====================================================================
     NEW FEATURE 2: "Download Report Card (PDF)"

     HOW IT PRINTS — and why it is built this way
     --------------------------------------------
     The report is assembled as a hidden #print-root element inside the
     LIVE page, and the page's own window.print() is called — synchronously,
     directly inside the click/tap handler. Nothing is awaited, no timer or
     load-event sits between the tap and print().

     The previous version printed from a hidden 0x0 iframe, once its
     stylesheet's `load` event fired. That fails on phones for two reasons:
       1. Mobile browsers (iOS Safari, Android Chrome) only open the print /
          "Save as PDF" sheet when print() runs inside the user's tap. The
          `load` event is asynchronous, so by then the tap's permission has
          lapsed and print() is silently ignored — the button "does nothing".
       2. iOS Safari is unreliable at printing a hidden, zero-size iframe.
     Printing the live page avoids both: the stylesheet and web fonts
     (Cairo for Arabic) are already loaded, so there is nothing to wait for.

     LANGUAGE: #print-root lives in the same document as the portal, so it
     inherits <html lang dir> and the active font automatically — Arabic
     prints right-to-left, in Cairo, with a translated banner and footer.

     ISOLATION: print-only CSS (style.css §22) hides every other element
     while body.printing-report is set, and #print-root is display:none on
     screen, so nothing on the live page is touched or flashes. The
     "printing-report" class is removed again after printing.
     ===================================================================== */

  const PRINT_ROOT_ID = 'print-root';
  let teardownStagedReport = null; // removes the report currently staged for printing, if any

  /** Builds the printable report: banner + a clone of the current results + footer. */
  function buildReportRoot() {
    const root = document.createElement('div');
    root.id = PRINT_ROOT_ID;
    root.setAttribute('aria-hidden', 'true');

    // Clone just the results, minus the toolbar (the Download button must
    // never appear in its own printout). Ids are stripped so the clone
    // can't create duplicate ids on the live page.
    const resultsClone = dom.results.cloneNode(true);
    const toolbarClone = resultsClone.querySelector('.results-toolbar');
    if (toolbarClone) toolbarClone.remove();
    resultsClone.removeAttribute('id');
    resultsClone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    resultsClone.hidden = false;

    // Report banner + footer — built from CONFIG and the dictionary rather
    // than hardcoded, so they follow both the branding and the language.
    const courseName = I18N.cfgOr('courseName', null) || 'Student Academic Report';
    const primaryOrgName = (CONFIG.organizations && CONFIG.organizations.primary && CONFIG.organizations.primary.name) || '';
    const reportDate = new Date().toLocaleDateString(I18N.locale(), { year: 'numeric', month: 'long', day: 'numeric' });

    const header = document.createElement('div');
    header.className = 'print-header';
    header.innerHTML = `
      <div>
        <div class="print-header__title">${escapeHtml(I18N.t('print.title'))}</div>
        <div class="print-header__subtitle">${escapeHtml(I18N.t('print.subtitle', { course: courseName }))}</div>
      </div>
      <div class="print-header__date">${escapeHtml(reportDate)}</div>
    `;

    const footer = document.createElement('div');
    footer.className = 'print-footer';
    footer.textContent = primaryOrgName
      ? I18N.t('print.footerOrg', { org: primaryOrgName })
      : I18N.t('print.footer');

    root.appendChild(header);
    root.appendChild(resultsClone);
    root.appendChild(footer);

    // The report always prints on the light palette (style.css §22), but a
    // customised brand color from config.js must still carry through —
    // mirror the same runtime override applyBrandColors() applies to <html>.
    if (CONFIG.colors) {
      if (CONFIG.colors.primary) root.style.setProperty('--color-primary', CONFIG.colors.primary);
      if (CONFIG.colors.secondary) root.style.setProperty('--color-accent', CONFIG.colors.secondary);
    }
    return root;
  }

  /** Puts the report into the page, switches the page to "print only the
   *  report" mode, and arranges for everything to be undone afterwards. */
  function stageReportForPrint(root, documentTitle) {
    if (teardownStagedReport) teardownStagedReport(); // never keep two reports staged

    document.body.appendChild(root);
    const previousTitle = document.title;
    document.title = documentTitle;                      // browsers use it as the saved-PDF file name
    document.body.classList.add('printing-report');

    const stagedAt = Date.now();
    const printQuery = window.matchMedia ? window.matchMedia('print') : null;
    let finished = false;
    let fallbackTimer = null;

    // Mobile browsers return from print() immediately (the print sheet is
    // asynchronous) and don't all fire the same "finished" signal, so the
    // report is torn down on whichever arrives first.
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(fallbackTimer);
      window.removeEventListener('afterprint', finish);
      document.removeEventListener('pointerdown', onNextTap, true);
      if (printQuery) {
        if (printQuery.removeEventListener) printQuery.removeEventListener('change', onPrintQueryChange);
        else if (printQuery.removeListener) printQuery.removeListener(onPrintQueryChange);
      }
      document.body.classList.remove('printing-report');
      document.title = previousTitle;
      root.remove();
      if (teardownStagedReport === finish) teardownStagedReport = null;
    };
    const onNextTap = () => { if (Date.now() - stagedAt > 1500) finish(); }; // grace period while the sheet is opening
    const onPrintQueryChange = (event) => { if (!event.matches) finish(); };

    window.addEventListener('afterprint', finish);
    document.addEventListener('pointerdown', onNextTap, true);
    if (printQuery) {
      if (printQuery.addEventListener) printQuery.addEventListener('change', onPrintQueryChange);
      else if (printQuery.addListener) printQuery.addListener(onPrintQueryChange);
    }
    fallbackTimer = window.setTimeout(finish, 120000); // last resort: never leave print mode on forever
    teardownStagedReport = finish;
  }

  function initDownloadPdf() {
    if (!dom.downloadPdfBtn) return; // safe no-op if the button isn't on the page

    dom.downloadPdfBtn.addEventListener('click', () => {
      if (!dom.results) return;

      const studentCode = ((dom.studentCodeDisplay && dom.studentCodeDisplay.textContent) || 'Student').trim();
      stageReportForPrint(buildReportRoot(), I18N.t('print.docTitle', { code: studentCode }));

      // MUST stay synchronous inside this handler (see the note above):
      // no await, no setTimeout, no stylesheet-load wait before print().
      try {
        window.print();
      } catch (err) {
        console.error('CourseTrack — print failed:', err);
        if (teardownStagedReport) teardownStagedReport();
      }
    });
  }

  /* =====================================================================
     10. INITIALIZATION
     ===================================================================== */

  function hideLoadingScreen() {
    if (!dom.loadingScreen || dom.loadingScreen.style.display === 'none') return;
    dom.loadingScreen.classList.add('is-hidden');
    window.setTimeout(() => { dom.loadingScreen.style.display = 'none'; }, 650);
  }

  function init() {
    window.setTimeout(hideLoadingScreen, 700);
    window.addEventListener('load', () => window.setTimeout(hideLoadingScreen, 1100));

    try {
      applyBranding();
      initTheme();
      I18N.onChange(applyBrandText);   // re-translate branding text on language switch
      initSearch();
      initRememberCode();   // NEW: Remember My Code
      initDownloadPdf();    // NEW: Download Report Card (PDF)
      dom.themeToggle.addEventListener('click', toggleTheme);
    } catch (err) {
      console.error('CourseTrack — initialization error:', err);
      hideLoadingScreen();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
