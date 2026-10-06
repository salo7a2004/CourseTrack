/* =====================================================================
   COURSETRACK — STUDENT PORTAL LOGIC
   Public, read-only. Every search fetches the latest data straight from
   the Google Sheets bridge (google-apps-script.gs) — nothing is cached
   in localStorage, so students always see whatever the Admin last
   uploaded, with no redeploy needed.

   Column detection (Meeting/Task/Notes/Final) is 100% structural:
   nothing here ever hardcodes "M1", "T1", a column name, or a week
   number — it keeps working unmodified at Week 30, 50, or beyond.
   ===================================================================== */

(() => {
  'use strict';

  const CONFIG = window.APP_CONFIG || {};

  /* -------------------------------------------------------------------
     0. CONSTANTS
     ------------------------------------------------------------------- */
  const STORAGE_KEYS = { THEME: 'coursetrack_theme' };

  const KEYWORDS = {
    positive: ['present', 'attended', 'yes', 'pass', 'passed', 'eligible', 'completed', 'complete', 'done', 'excellent', 'good', 'success', 'active'],
    negative: ['absent', 'no', 'fail', 'failed', 'not eligible', 'ineligible', 'missing', 'incomplete', 'inactive', 'not submitted', 'rejected'],
  };

  const IDENTITY_FIELDS = [
    { key: 'code', pattern: /code|كود|رقم\s*الطالب|\bid\b/i },
    { key: 'email', pattern: /e-?mail|بريد/i },
    { key: 'name', pattern: /name|اسم/i },
  ];

  const SESSION_LABELS = { meeting: 'Meeting Grade', task: 'Task Grade', notes: 'Instructor Notes' };
  const NOT_PUBLISHED_LABEL = 'Not Published Yet';
  const NO_NOTES_LABEL = 'No notes for this session';

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

    dom.headerCourseName.textContent = CONFIG.courseName || 'CourseTrack';
    dom.headerCourseSubtitle.textContent = CONFIG.courseSubtitle || 'Student Portal';
    dom.courseLogoPlaceholder.textContent = (CONFIG.courseName || 'C').trim().charAt(0).toUpperCase();

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

    const footer = CONFIG.footerText || {};
    if (footer.poweredBy) dom.footerPowered.textContent = footer.poweredBy;
    if (footer.collaboration) dom.footerCollab.textContent = footer.collaboration;
    if (footer.developedBy) {
      const name = footer.developedBy.replace(/^Developed by\s*/i, '');
      dom.footerDeveloped.innerHTML = `Developed by <strong>${escapeHtml(name)}</strong>`;
    }
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
     5. GOOGLE SHEETS DATA FETCH — always the latest, never cached
     ===================================================================== */

  /**
   * Fetches the current sheet contents from the Apps Script bridge and
   * converts the raw {headers, rows} grid into row objects, exactly
   * like SheetJS's sheet_to_json — so the rest of the app never has to
   * care whether data came from a live Sheet or a local file.
   */
  async function fetchCourseData() {
    const endpoint = CONFIG.sheetsApi && CONFIG.sheetsApi.endpoint;
    if (!endpoint || endpoint.startsWith('PASTE_')) {
      throw new Error('The course data source is not configured yet. Ask your instructor to finish the Google Sheets setup.');
    }

    let response;
    try {
      response = await fetch(endpoint, { method: 'GET', cache: 'no-store' });
    } catch (err) {
      throw new Error('Could not reach the course data source. Check your internet connection and try again.');
    }

    if (!response.ok) {
      throw new Error('The course data source returned an error. Please try again shortly.');
    }

    let payload;
    try {
      payload = await response.json();
    } catch (err) {
      throw new Error('The course data source returned an unreadable response.');
    }

    if (!payload || payload.success === false) {
      throw new Error((payload && payload.error) || 'The course data source reported an error.');
    }

    const headers = payload.headers || [];
    const rawRows = payload.rows || [];

    if (!headers.length) {
      throw new Error('No course data has been uploaded yet. Please check back later.');
    }

    const rows = rawRows.map((rowArray) => {
      const row = {};
      headers.forEach((header, i) => { row[header] = rowArray[i] !== undefined ? rowArray[i] : ''; });
      return row;
    });

    const columns = detectColumns(headers);
    const students = rows
      .filter((row) => columns.code && String(row[columns.code]).trim() !== '')
      .map((row) => ({ code: String(row[columns.code]).trim(), raw: row }));

    console.group('%cCourseTrack — Google Sheets fetch debug', 'color:#2f98e0;font-weight:700;');
    console.log('Detected column headers:', headers);
    console.log('Code column:', columns.code, '| Name column:', columns.name, '| Email column:', columns.email);
    console.log('Meeting columns:', columns.meetings);
    console.log('Task columns:', columns.tasks);
    console.log('Notes columns:', columns.notes);
    console.log('Final result columns:', columns.final);
    console.log(`Parsed ${students.length} student row(s). Last updated:`, payload.lastUpdate);
    console.groupEnd();

    return { columns, students, lastUpdate: payload.lastUpdate };
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
    el.textContent = text;
    el.setAttribute('dir', 'auto');
  }

  function setViewState({ loading = false, error = false, results = false }) {
    dom.searchLoading.hidden = !loading;
    dom.errorState.hidden = !error;
    dom.results.hidden = !results;
  }

  function buildFieldCard(label, displayed, statusClass, iconSvg) {
    const field = document.createElement('div');
    field.className = 'tl-field';

    const icon = document.createElement('div');
    icon.className = `tl-field__icon tl-field__icon--${statusClass.iconKind}`;
    icon.innerHTML = iconSvg;

    const text = document.createElement('div');
    text.className = 'tl-field__text';

    const labelEl = document.createElement('span');
    labelEl.className = 'tl-field__label';
    labelEl.textContent = label;

    const valueEl = document.createElement('span');
    valueEl.className = `tl-field__value status-${statusClass.status}`;
    setAutoText(valueEl, displayed);

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
    title.textContent = `Week ${week.num}`;
    header.appendChild(title);
    item.appendChild(header);

    const body = document.createElement('div');
    body.className = 'timeline-item__body';

    if (week.meetingKey) {
      const value = row[week.meetingKey];
      const displayed = displayValue(value, NOT_PUBLISHED_LABEL);
      const status = isEmptyCell(value) ? 'pending' : classifyValue(value);
      body.appendChild(buildFieldCard(SESSION_LABELS.meeting, displayed, { status, iconKind: 'meeting' }, ICONS.meeting));
    }
    if (week.taskKey) {
      const value = row[week.taskKey];
      const displayed = displayValue(value, NOT_PUBLISHED_LABEL);
      const status = isEmptyCell(value) ? 'pending' : classifyValue(value);
      body.appendChild(buildFieldCard(SESSION_LABELS.task, displayed, { status, iconKind: 'task' }, ICONS.task));
    }
    if (week.notesKey) {
      const value = row[week.notesKey];
      const displayed = displayValue(value, NO_NOTES_LABEL);
      const status = isEmptyCell(value) ? 'pending' : 'neutral';
      body.appendChild(buildFieldCard(SESSION_LABELS.notes, displayed, { status, iconKind: 'notes' }, ICONS.notes));
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
    setAutoText(dom.studentName, columns.name ? displayValue(student.raw[columns.name], 'Student') : 'Student');
    setAutoText(dom.studentCodeDisplay, student.code);

    if (columns.email) {
      const email = displayValue(student.raw[columns.email], '');
      dom.studentEmailWrap.hidden = !email;
      setAutoText(dom.studentEmail, email);
    } else {
      dom.studentEmailWrap.hidden = true;
    }
  }

  function renderStudent(columns, student) {
    renderProfile(columns, student);
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
        dom.errorTitle.textContent = '❌ Student Code Not Found';
        dom.errorMessage.textContent = "We couldn't match that code to any record. Double-check it and try again.";
        setViewState({ error: true });
        return;
      }

      console.log('%cCourseTrack — matched student object:', 'color:#16a34a;font-weight:700;', student);
      renderStudent(columns, student);
    } catch (err) {
      console.error('CourseTrack — search error:', err);
      dom.errorTitle.textContent = '❌ Something Went Wrong';
      dom.errorMessage.textContent = (err && err.message) || 'An unexpected error occurred while searching. Please try again.';
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
     Uses html2pdf.js (loaded via <script> in index.html). Captures a
     detached, off-screen CLONE of #results — never the live element
     itself — built with simple, fixed, print-only styling (see
     #pdf-clone-container in style.css). See downloadReportCardPdf's own
     doc comment below for the full rationale.
     ===================================================================== */

  /**
   * Waits a couple of animation frames plus a short buffer so the
   * browser has actually laid out/painted a just-inserted DOM subtree
   * before html2canvas captures it.
   */
  function waitForLayoutToSettle(delayMs) {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(resolve, delayMs)));
    });
  }

  /**
   * "Cloned Print Wrapper" strategy — REPLACES the previous approach of
   * toggling override classes onto the live #results element. That kept
   * surfacing new symptoms round after round (vanishing content, mid-
   * card page breaks, and finally a horizontal offset from a
   * `windowWidth` option disagreeing with the live page's actual
   * rendered width). The live page's responsive/glassmorphism styling
   * was simply never going to be a reliable source for a fixed-size,
   * paginated A4 document.
   *
   * Instead: clone #results, strip the one element that shouldn't be in
   * a PDF (the Download button itself), drop the clone into a detached,
   * off-screen, fixed-width container (#pdf-clone-container in
   * style.css — print-only styling lives there, scoped so it can never
   * affect the live page), capture THAT, then always remove it — the
   * live DOM is never modified, so none of the earlier failure modes
   * are even possible anymore.
   */
  async function downloadReportCardPdf() {
    if (typeof html2pdf === 'undefined') {
      console.error('CourseTrack — html2pdf.js did not load; check the <script> tag/network.');
      alert('PDF export is temporarily unavailable. Please check your connection and try again.');
      return;
    }

    const safeCode = (dom.studentCodeDisplay.textContent || 'student').trim().replace(/[^\w-]+/g, '_');
    const fileName = `CourseTrack_Report_${safeCode}.pdf`;

    dom.downloadPdfBtn.disabled = true; // prevent double-clicks while generating

    // Build the clone: a standalone copy of #results that the student
    // never sees, so capturing it can never visibly affect the live page.
    const clone = dom.results.cloneNode(true);
    const cloneToolbar = clone.querySelector('.results-toolbar');
    if (cloneToolbar) cloneToolbar.remove(); // never show the Download button in its own PDF

    const wrapper = document.createElement('div');
    wrapper.id = 'pdf-clone-container';
    // Positioning is set inline (not via CSS) so it is guaranteed to
    // apply the instant the element exists, keeping it fully off the
    // visible page the whole time it's attached.
    wrapper.style.position = 'absolute';
    wrapper.style.left = '-9999px';
    wrapper.style.top = '0';
    wrapper.style.width = '794px'; // standard A4 width at 96 DPI
    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);

    try {
      await waitForLayoutToSettle(150);

      const options = {
        margin: 10,
        filename: fileName,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
          scrollX: 0,
          scrollY: 0,
          backgroundColor: '#ffffff',
          // NOTE: no `windowWidth` here — that option was what caused
          // the previous horizontal-offset bug. The clone already has
          // an explicit, fixed width, so there is nothing to simulate.
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: {
          mode: ['css', 'legacy'],
          avoid: ['.timeline-item', '.tl-field', '.final-item', '.profile-card'],
        },
      };

      await html2pdf().set(options).from(wrapper).save();
    } catch (err) {
      console.error('CourseTrack — PDF export failed:', err);
      alert('Something went wrong generating the PDF. Please try again.');
    } finally {
      wrapper.remove(); // always clean up, success or failure — the clone must never linger in the live DOM
      dom.downloadPdfBtn.disabled = false;
    }
  }

  function initDownloadPdf() {
    if (!dom.downloadPdfBtn) return; // safe no-op if the button isn't on the page
    dom.downloadPdfBtn.addEventListener('click', downloadReportCardPdf);
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
