/* =====================================================================
   COURSETRACK — ADMIN DASHBOARD LOGIC
   Private page. This is the ONLY place data can be written — it parses
   the uploaded .xlsx client-side with SheetJS, then PUTs the resulting
   records to the Firebase Realtime Database REST endpoint, which is the
   single source of truth the Student Portal reads from.
   ===================================================================== */

(() => {
  'use strict';

  const CONFIG = window.APP_CONFIG || {};
  const I18N = window.I18N; // i18n.js MUST be loaded before this file (see admin.html)

  // ISO timestamp of the last upload, kept so the "Last Update" tile can be
  // re-formatted in the new language when the language is switched.
  let lastUpdateIso = null;

  // Longest any single Firebase request may take before it is aborted
  // and reported as an error (writes carry the whole dataset).
  const FIREBASE_TIMEOUT_MS = 30000;

  // Dictionary KEYS (see i18n.js) — not display strings — so every error
  // is shown in the current language and re-translates if the language
  // is switched while it is on screen.
  const ERRORS = {
    UNSUPPORTED_FILE: 'err.unsupportedFile',
    INVALID_EXCEL: 'err.invalidExcel',
    SHEET_NOT_FOUND: 'err.sheetNotFound',
    CODE_NOT_FOUND: 'err.codeNotFound',
  };

  const dom = {
    loadingScreen: document.getElementById('loading-screen'),
    themeToggle: document.getElementById('theme-toggle'),

    dashboard: document.getElementById('admin-dashboard'),
    authForm: document.getElementById('auth-form'),
    authInput: document.getElementById('auth-passcode'),
    authToggle: document.getElementById('auth-toggle'),
    authError: document.getElementById('auth-error'),
    authSubmit: document.getElementById('auth-submit'),
    authSubmitLabel: document.getElementById('auth-submit-label'),
    logoutBtn: document.getElementById('logout-btn'),

    headerCourseName: document.getElementById('header-course-name'),
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

    infoCourseName: document.getElementById('info-course-name'),
    infoInstructorName: document.getElementById('info-instructor-name'),
    infoVersion: document.getElementById('info-version'),

    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('file-input'),
    uploadSteps: document.getElementById('upload-steps'),
    uploadSuccess: document.getElementById('upload-success'),
    uploadSuccessText: document.getElementById('upload-success-text'),
    uploadError: document.getElementById('upload-error'),
    uploadErrorText: document.getElementById('upload-error-text'),

    statFile: document.getElementById('stat-file'),
    statStudents: document.getElementById('stat-students'),
    statWeeks: document.getElementById('stat-weeks'),
    statTasks: document.getElementById('stat-tasks'),
    statNotes: document.getElementById('stat-notes'),
    statUpdated: document.getElementById('stat-updated'),
    statStatus: document.getElementById('stat-status'),
  };

  /* =====================================================================
     BRANDING (identical small setup to student.js — page-specific glue
     code, not shared business logic, so it's kept local to each page)
     ===================================================================== */

  function applyBrandColors() {
    const { colors } = CONFIG;
    if (!colors) return;
    const root = document.documentElement.style;
    if (colors.primary) root.setProperty('--color-primary', colors.primary);
    if (colors.secondary) root.setProperty('--color-accent', colors.secondary);
  }

  function applyLogo(imgEl, placeholderEl, path) {
    if (!imgEl) return;
    imgEl.hidden = true;
    if (placeholderEl) placeholderEl.hidden = false;
    if (!path) return;
    imgEl.onload = () => { imgEl.hidden = false; if (placeholderEl) placeholderEl.hidden = true; };
    imgEl.onerror = () => { imgEl.hidden = true; imgEl.removeAttribute('src'); if (placeholderEl) placeholderEl.hidden = false; };
    imgEl.src = path;
  }

  function applyBranding() {
    applyBrandColors();

    const logos = CONFIG.logos || {};
    applyLogo(dom.courseLogoImg, dom.courseLogoPlaceholder, logos.course);
    applyLogo(dom.orgLogoPrimary, dom.orgPlaceholderPrimary, logos.primaryOrg);
    applyLogo(dom.orgLogoPartner, dom.orgPlaceholderPartner, logos.partnerOrg);

    const orgs = CONFIG.organizations || {};
    if (orgs.primary && orgs.primary.name) { dom.orgNamePrimary.textContent = orgs.primary.name; dom.orgPlaceholderPrimary.textContent = orgs.primary.name; }
    if (orgs.partner && orgs.partner.name) { dom.orgNamePartner.textContent = orgs.partner.name; dom.orgPlaceholderPartner.textContent = orgs.partner.name; }

    applyBrandText();
  }

  /** Language-dependent branding text. Runs at startup and again on every
   *  language switch (logos stay in applyBranding so they don't reload). */
  function applyBrandText() {
    const courseName = I18N.cfgOr('courseName', null) || 'CourseTrack';
    dom.headerCourseName.textContent = courseName;
    dom.courseLogoPlaceholder.textContent = courseName.trim().charAt(0).toUpperCase();

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

    dom.infoCourseName.textContent = courseName;
    dom.infoInstructorName.textContent = I18N.cfgOr('instructorName', null) || '—';
    dom.infoVersion.textContent = CONFIG.appVersion || '—';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* =====================================================================
     THEME
     ===================================================================== */

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('coursetrack_theme', theme); } catch (err) { /* non-fatal */ }
  }

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('coursetrack_theme'); } catch (err) { /* non-fatal */ }
    applyTheme(saved === 'dark' ? 'dark' : 'light');
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }

  /* =====================================================================
     EXCEL PARSING (mirrors the same sheet-selection rules the rest of
     the project has always used — kept here since only Admin ever
     touches a raw .xlsx file)
     ===================================================================== */

  // How many leading rows to scan, per sheet, looking for the real
  // header row. Generous enough to clear a title block + stat summary
  // (e.g. "Executive Performance Summary" has its header at row 8) but
  // bounded so a sheet with no header at all fails fast.
  const MAX_HEADER_SCAN_ROWS = 25;

  /**
   * Scans a single sheet's leading rows for the one that is actually a
   * header row — identified by containing a cell whose text matches
   * "code" (the one column every CourseTrack sheet must have). Returns
   * the row's 0-based index plus which column matched, within SheetJS's
   * `header:1` grid — or null if no such row exists in this sheet at
   * all. This is what lets a sheet ship with any number of title/report
   * rows above the real table, from 0 (data starts at row 1) upward.
   */
  function findHeaderRow(sheet) {
    const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 0, blankrows: false });
    const limit = Math.min(grid.length, MAX_HEADER_SCAN_ROWS);
    for (let i = 0; i < limit; i++) {
      const row = grid[i] || [];
      const codeColIndex = row.findIndex((cell) => /code/i.test(String(cell == null ? '' : cell).trim()));
      if (codeColIndex !== -1) {
        return { grid, rowIndex: i, codeColIndex };
      }
    }
    return null;
  }

  /**
   * Picks which sheet to read. No sheet name is ever hardcoded —
   * "Form Responses 1", "Sheet1", "Executive Performance Summary",
   * anything goes.
   *
   * IMPORTANT: this deliberately does NOT stop at the first sheet with
   * a Code-like header. A raw Google Form export tab often has its own
   * "Code" column that is almost entirely empty (only a stray row or
   * two filled in), while the real, complete gradebook sits in a later
   * tab. Stopping at the first match would silently ingest that mostly
   * empty sheet instead — which is exactly what produced "0 students /
   * 0 weeks / 0 tasks" on the Statistics dashboard before this fix: the
   * wrong sheet was selected, so the week/task/notes detectors (which
   * were never broken) correctly found nothing to detect.
   *
   * Instead, every sheet with a Code-like header is scored by how many
   * rows under it actually have a non-empty Code value, and the
   * highest-scoring sheet wins. The sheet with real student records —
   * whatever it's named, wherever it sits in the tab order — is the
   * one that gets used.
   */
  function pickSheet(workbook) {
    let best = null;

    for (const name of workbook.SheetNames) {
      const found = findHeaderRow(workbook.Sheets[name]);
      if (!found) continue;

      const { grid, rowIndex, codeColIndex } = found;
      let validRecordCount = 0;
      for (let r = rowIndex + 1; r < grid.length; r++) {
        const value = (grid[r] || [])[codeColIndex];
        if (value !== undefined && value !== null && String(value).trim() !== '') validRecordCount++;
      }

      if (!best || validRecordCount > best.validRecordCount) {
        best = { sheetName: name, headerRowIndex: rowIndex, validRecordCount };
      }
    }

    if (!best || best.validRecordCount === 0) {
      throw I18N.error(ERRORS.SHEET_NOT_FOUND);
    }

    return { sheetName: best.sheetName, headerRowIndex: best.headerRowIndex };
  }

  function parseExcelFile(file) {
    return new Promise((resolve, reject) => {
      if (typeof XLSX === 'undefined') {
        reject(I18N.error('err.sheetJsFailed'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(I18N.error(ERRORS.INVALID_EXCEL));
      reader.onload = (event) => {
        let workbook;
        try {
          workbook = XLSX.read(new Uint8Array(event.target.result), { type: 'array' });
        } catch (err) {
          reject(I18N.error(ERRORS.INVALID_EXCEL));
          return;
        }
        if (!workbook.SheetNames.length) { reject(I18N.error(ERRORS.INVALID_EXCEL)); return; }

        try {
          const { sheetName, headerRowIndex } = pickSheet(workbook);
          const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', header: 1 });
          if (!rows.length) { reject(I18N.error('err.sheetEmpty', { sheet: sheetName })); return; }

          // Header row is wherever pickSheet actually found it — not
          // assumed to be row 1 — so any report/title rows above it
          // (merged banners, stat summaries, blank spacer rows) are
          // simply skipped rather than misread as data.
          const headers = rows[headerRowIndex].map((h) => String(h == null ? '' : h).trim());

          // A raw .xlsx can occasionally have a stray value in a column
          // past the header row's last column (or a short row). Pad/
          // truncate every row to exactly headers.length cells so that
          // zipping each row into a { header: value } record (see
          // pushToFirebase) always yields the same keys for every
          // student, regardless of what the source file looked like.
          const dataRows = rows.slice(headerRowIndex + 1).map((row) => {
            const normalized = row.slice(0, headers.length);
            while (normalized.length < headers.length) normalized.push('');
            return normalized;
          });

          if (!headers.some((h) => /code/i.test(h.trim()))) {
            reject(I18N.error(ERRORS.CODE_NOT_FOUND));
            return;
          }

          resolve({ sheetName, headers, rows: dataRows });
        } catch (err) {
          reject(err instanceof Error ? err : I18N.error(ERRORS.INVALID_EXCEL));
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  /* Lightweight column counters — just for the Statistics tiles, not
     full rendering, so this stays a few lines rather than duplicating
     the Student Portal's detection/rendering logic. */
  function countWeeks(headers) {
    const nums = new Set();
    headers.forEach((h) => {
      const clean = String(h).trim();
      if (/^[mt]/i.test(clean)) {
        const match = clean.match(/(\d+)/);
        if (match) nums.add(parseInt(match[1], 10));
      }
    });
    return nums.size;
  }
  function countPrefixed(headers, letter) {
    return headers.filter((h) => {
      const clean = String(h).trim();
      return clean.charAt(0).toLowerCase() === letter && /\d/.test(clean);
    }).length;
  }
  function countNotes(headers) {
    // Counts both a general "Notes" column and week-specific ones
    // ("Notes5", "Notes 5", ...) so the Statistics tile reflects
    // whatever the uploaded sheet actually has, instead of only
    // numbered Notes columns.
    return headers.filter((h) => /^notes?(\s*\d+)?\s*$/i.test(String(h).trim())).length;
  }

  /* =====================================================================
     FIREBASE REALTIME DATABASE SYNC
     ===================================================================== */

  /** Builds the two REST endpoints this app ever talks to, from the
   *  single configured project root. */
  function getFirebaseUrls() {
    const databaseURL = CONFIG.firebase && CONFIG.firebase.databaseURL;
    if (!databaseURL || /PASTE_|YOUR_/i.test(databaseURL)) {
      throw I18N.error('err.fbNotConfigured');
    }
    const root = databaseURL.replace(/\/+$/, ''); // strip any trailing slash
    return { studentsUrl: `${root}/students.json`, metaUrl: `${root}/meta.json` };
  }

  function appendAuthParam(url) {
    const secret = CONFIG.firebase && CONFIG.firebase.databaseSecret;
    if (!secret) return url;
    return `${url}${url.includes('?') ? '&' : '?'}auth=${encodeURIComponent(secret)}`;
  }

  /**
   * One small helper for every Firebase REST call (GET/PUT), with
   * consistent network/permission error handling so neither call site
   * below has to repeat it.
   */
  async function firebaseRequest(url, method, body) {
    // Every request is guaranteed to settle: a stalled connection would
    // otherwise leave the upload steps (and the locked dropzone) hanging
    // forever, since `finally` only runs once the request settles.
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), FIREBASE_TIMEOUT_MS);

    let response;
    let data = null;
    try {
      try {
        response = await fetch(appendAuthParam(url), {
          method,
          headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
      } catch (err) {
        throw I18N.error(err && err.name === 'AbortError' ? 'err.fbTimeout' : 'err.fbNetwork');
      }

      try {
        data = await response.json();
      } catch (err) {
        if (err && err.name === 'AbortError') throw I18N.error('err.fbTimeout');
        /* otherwise: a successful PUT can legitimately return an empty/non-JSON body */
      }
    } finally {
      window.clearTimeout(timeoutId);
    }

    if (!response.ok || (data && data.error)) {
      const reason = (data && data.error) || `HTTP ${response.status}`;
      if (response.status === 401 || response.status === 403 || /permission/i.test(reason)) {
        throw I18N.error('err.fbDenied');
      }
      throw I18N.error('err.fbFailed', { reason });
    }

    return data;
  }

  /** Firebase RTDB keys may not contain . $ # [ ] / or ASCII control
   *  characters, and must not be empty. */
  function sanitizeFirebaseKey(rawKey) {
    const cleaned = String(rawKey).trim().replace(/[.#$[\]/\x00-\x1F\x7F]/g, '_');
    return cleaned || `row_${Math.random().toString(36).slice(2, 10)}`;
  }

  /**
   * Replaces the Firebase `/students` node wholesale with the freshly
   * parsed workbook — a full overwrite, exactly matching the project's
   * established "an Admin upload replaces everything" behavior.
   *
   * Written as an OBJECT keyed by each student's (sanitized) code, not
   * a plain array: Firebase's own documentation specifically recommends
   * against storing arrays in the Realtime Database (they're internally
   * re-encoded in ways that get awkward with sparse/non-sequential
   * data). Keying by code also means re-uploading the same student
   * cleanly overwrites their one record instead of ever appending a
   * duplicate.
   */
  async function pushToFirebase(headers, rows) {
    const { studentsUrl, metaUrl } = getFirebaseUrls();

    const codeColIndex = headers.findIndex((h) => /code/i.test(String(h).trim()));
    if (codeColIndex === -1) throw I18N.error(ERRORS.CODE_NOT_FOUND);

    const payload = {};
    rows.forEach((row) => {
      const code = String(row[codeColIndex] || '').trim();
      if (!code) return; // parseExcelFile already guarantees the sheet has a Code column; an individual row can still be blank
      const rowObject = {};
      headers.forEach((header, c) => { rowObject[header] = row[c]; });
      payload[sanitizeFirebaseKey(code)] = rowObject;
    });

    const studentsWritten = Object.keys(payload).length;
    if (!studentsWritten) throw I18N.error(ERRORS.CODE_NOT_FOUND);

    await firebaseRequest(studentsUrl, 'PUT', payload);

    const lastUpdate = new Date().toISOString();
    await firebaseRequest(metaUrl, 'PUT', { lastUpdate, studentsWritten });

    return { lastUpdate, studentsWritten };
  }

  /** Reads the current /students and /meta nodes for the Statistics
   *  panel shown when the Admin Dashboard first loads. */
  async function fetchCurrentStats() {
    const { studentsUrl, metaUrl } = getFirebaseUrls();
    const [studentsData, metaData] = await Promise.all([
      firebaseRequest(studentsUrl, 'GET'),
      firebaseRequest(metaUrl, 'GET'),
    ]);

    const rows = studentsData ? Object.values(studentsData) : [];
    const headerSet = new Set();
    rows.forEach((row) => Object.keys(row).forEach((k) => headerSet.add(k)));

    return {
      headers: Array.from(headerSet),
      rows,
      lastUpdate: metaData ? metaData.lastUpdate : null,
    };
  }

  /* =====================================================================
     UI HELPERS
     ===================================================================== */

  function formatDateTime(isoString) {
    if (!isoString) return '—';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(I18N.locale(), { dateStyle: 'medium', timeStyle: 'short' });
  }

  function resetBanners() {
    dom.uploadSuccess.hidden = true;
    dom.uploadError.hidden = true;
  }

  function showSuccessBanner() {
    resetBanners();
    I18N.setText(dom.uploadSuccessText, 'upload.success');
    dom.uploadSuccess.hidden = false;
  }

  /** Accepts an Error (keyed errors stay translatable, raw ones are shown
   *  verbatim) or a dictionary key such as ERRORS.UNSUPPORTED_FILE. The
   *  "❌ " prefix comes from data-i18n-prefix on #upload-error-text. */
  function showErrorBanner(errOrKey) {
    resetBanners();
    I18N.setErrorText(dom.uploadErrorText, errOrKey, 'err.invalidExcel');
    dom.uploadError.hidden = false;
  }

  /** Walks the visible step list one at a time so the admin can see
   *  exactly where the upload is: Uploading → Reading → Processing →
   *  Syncing → Finished. */
  function setStep(stepName, state) {
    const steps = dom.uploadSteps.querySelectorAll('.upload-step');
    steps.forEach((el) => {
      if (el.dataset.step !== stepName) return;
      el.classList.toggle('is-active', state === 'active');
      el.classList.toggle('is-done', state === 'done');
    });
  }

  function markStepsUpTo(stepName) {
    const order = ['upload', 'read', 'process', 'sync', 'done'];
    const targetIndex = order.indexOf(stepName);
    order.forEach((name, i) => {
      if (i < targetIndex) setStep(name, 'done');
      else if (i === targetIndex) setStep(name, 'active');
      else setStep(name, '');
    });
  }

  /** `status` is a dictionary key (status.*), not display text. */
  function updateStatsDisplay({ fileName, headers, students, lastUpdate, status }) {
    if (fileName !== undefined) {
      if (fileName) I18N.setRaw(dom.statFile, fileName);        // real file name — never re-translated
      else I18N.setText(dom.statFile, 'stat.noFile');
    }
    if (students !== undefined) dom.statStudents.textContent = students;
    if (headers) {
      dom.statWeeks.textContent = countWeeks(headers);
      dom.statTasks.textContent = countPrefixed(headers, 't');
      dom.statNotes.textContent = countNotes(headers);
    }
    if (lastUpdate !== undefined) {
      lastUpdateIso = lastUpdate;
      dom.statUpdated.textContent = formatDateTime(lastUpdate);
    }
    if (status !== undefined) I18N.setText(dom.statStatus, status);
  }

  /* =====================================================================
     UPLOAD FLOW
     ===================================================================== */

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function handleFile(file) {
    // Drag-and-drop calls this directly (bypassing the disabled <input>),
    // so an in-flight upload has to be guarded against here too.
    if (dom.dropzone.classList.contains('is-uploading')) return;

    resetBanners();
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      showErrorBanner(ERRORS.UNSUPPORTED_FILE);
      return;
    }

    dom.uploadSteps.hidden = false;
    markStepsUpTo('upload');

    // The dropzone is the only upload trigger on this page, so locking
    // it is the equivalent of disabling an "Upload" button: it stops a
    // second file being dropped mid-upload and visibly signals work in
    // progress. Restored unconditionally in `finally` below.
    dom.dropzone.classList.add('is-uploading');
    dom.fileInput.disabled = true;

    try {
      await wait(150);
      markStepsUpTo('read');
      const { headers, rows } = await parseExcelFile(file);

      markStepsUpTo('process');
      await wait(150);
      updateStatsDisplay({ fileName: file.name, headers, students: rows.length, status: 'status.processing' });

      markStepsUpTo('sync');
      const result = await pushToFirebase(headers, rows);

      markStepsUpTo('done');
      setStep('done', 'done');

      updateStatsDisplay({
        fileName: file.name,
        headers,
        students: result.studentsWritten,
        lastUpdate: result.lastUpdate,
        status: 'status.active',
      });

      showSuccessBanner();
    } catch (err) {
      updateStatsDisplay({ status: 'status.failed' });
      showErrorBanner(err);
    } finally {
      dom.fileInput.value = '';
      dom.fileInput.disabled = false;
      dom.dropzone.classList.remove('is-uploading');
    }
  }

  function initUpload() {
    dom.fileInput.addEventListener('change', (event) => {
      handleFile(event.target.files && event.target.files[0]);
    });

    ['dragenter', 'dragover'].forEach((eventName) => {
      dom.dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
        dom.dropzone.classList.add('is-dragover');
      });
    });
    ['dragleave', 'drop'].forEach((eventName) => {
      dom.dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
        dom.dropzone.classList.remove('is-dragover');
      });
    });
    dom.dropzone.addEventListener('drop', (event) => {
      handleFile(event.dataTransfer.files && event.dataTransfer.files[0]);
    });
  }

  /* =====================================================================
     INITIALIZATION
     ===================================================================== */

  function hideLoadingScreen() {
    if (!dom.loadingScreen || dom.loadingScreen.style.display === 'none') return;
    dom.loadingScreen.classList.add('is-hidden');
    window.setTimeout(() => { dom.loadingScreen.style.display = 'none'; }, 650);
  }

  async function loadInitialStats() {
    try {
      const payload = await fetchCurrentStats();
      const headers = payload.headers || [];
      updateStatsDisplay({
        headers,
        students: payload.rows ? payload.rows.length : 0,
        lastUpdate: payload.lastUpdate,
        status: headers.length ? 'status.active' : 'status.noData',
      });
    } catch (err) {
      console.warn('CourseTrack Admin — could not load current stats:', err.message);
      updateStatsDisplay({ status: 'status.notConnected' });
    }
  }

  /* =====================================================================
     ADMIN AUTHENTICATION GATE
     ---------------------------------------------------------------------
     What this is: a UI gate. admin.html is locked in its own markup
     (<body class="auth-locked">, <main inert>); checkAuth() unlocks it
     after a correct passcode, and remembers that in sessionStorage so the
     admin stays signed in until the tab is closed.

     What this is NOT: access control. config.js and this script are public
     files, so a determined visitor can read or bypass any browser-side
     check. Firebase rules are what protect the data — see SETUP.md.

     Hardening that IS possible client-side, all implemented here:
       • the passcode is never stored — config.js holds a salted PBKDF2
         hash (generate it with make-admin-passcode.html);
       • comparisons are constant-time;
       • the session marker is bound to the configured credential, so
         changing the passcode signs every old session out;
       • repeated wrong attempts trigger a growing lockout (kept in
         sessionStorage, so a reload doesn't reset it — a new tab does,
         which is why this is friction, not a security boundary);
       • nothing that touches Firebase or the upload pipeline is started
         until the gate has opened (see startDashboard()).
     ===================================================================== */

  const AUTH_SESSION_KEY = 'coursetrack_admin_session';
  const AUTH_ATTEMPTS_KEY = 'coursetrack_admin_attempts';
  const AUTH_MAX_ATTEMPTS = 5;                 // wrong tries before a lockout
  const AUTH_BASE_LOCK_MS = 30 * 1000;         // first lockout; doubles each time
  const AUTH_MAX_LOCK_MS = 15 * 60 * 1000;
  const AUTH_HASH_PREFIX = 'pbkdf2-sha256';    // format: pbkdf2-sha256$<iterations>$<saltHex>$<hashHex>

  function bytesToHex(bytes) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  /** Constant-time string comparison (no early exit on the first mismatch). */
  function safeEqual(a, b) {
    const x = String(a);
    const y = String(b);
    let diff = x.length ^ y.length;
    const len = Math.max(x.length, y.length);
    for (let i = 0; i < len; i += 1) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
    return diff === 0;
  }

  async function sha256Hex(text) {
    const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return bytesToHex(new Uint8Array(digest));
  }

  /** Reads the configured credential. Priority: adminPasscodeHash (recommended)
   *  -> adminPasscode (plain text) -> firebase.databaseSecret (plain text).
   *  Returns null when nothing is configured, { kind: 'invalid' } when the
   *  hash string is malformed. `fingerprint` binds sessions to the credential. */
  function readAdminCredential() {
    const hash = typeof CONFIG.adminPasscodeHash === 'string' ? CONFIG.adminPasscodeHash.trim() : '';
    if (hash) {
      const parts = hash.split('$');
      const iterations = parseInt(parts[1], 10);
      const valid = parts.length === 4
        && parts[0] === AUTH_HASH_PREFIX
        && iterations >= 10000 && iterations <= 5000000
        && /^[0-9a-f]{16,}$/i.test(parts[2]) && parts[2].length % 2 === 0
        && /^[0-9a-f]{64}$/i.test(parts[3]);
      if (!valid) return { kind: 'invalid' };
      return { kind: 'pbkdf2', iterations, salt: hexToBytes(parts[2]), hash: parts[3].toLowerCase(), fingerprint: hash };
    }
    const plain = typeof CONFIG.adminPasscode === 'string' && CONFIG.adminPasscode
      ? CONFIG.adminPasscode
      : (CONFIG.firebase && typeof CONFIG.firebase.databaseSecret === 'string' ? CONFIG.firebase.databaseSecret : '');
    if (plain) return { kind: 'plain', secret: plain, fingerprint: 'plain|' + plain };
    return null;
  }

  async function verifyPasscode(input, credential) {
    if (credential.kind === 'plain') return safeEqual(input, credential.secret);
    const key = await window.crypto.subtle.importKey('raw', new TextEncoder().encode(input), 'PBKDF2', false, ['deriveBits']);
    const bits = await window.crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: credential.salt, iterations: credential.iterations }, key, 256);
    return safeEqual(bytesToHex(new Uint8Array(bits)), credential.hash);
  }

  /* ---- session (sessionStorage: cleared automatically when the tab closes) ---- */
  async function sessionProof(credential) {
    return sha256Hex('coursetrack-admin-session|' + credential.fingerprint);
  }

  async function hasValidSession(credential) {
    try {
      const stored = window.sessionStorage.getItem(AUTH_SESSION_KEY);
      return !!stored && safeEqual(stored, await sessionProof(credential));
    } catch (err) { return false; }
  }

  async function startSession(credential) {
    try { window.sessionStorage.setItem(AUTH_SESSION_KEY, await sessionProof(credential)); } catch (err) { /* storage blocked: re-prompt on reload */ }
  }

  function endSession() {
    try {
      window.sessionStorage.removeItem(AUTH_SESSION_KEY);
      window.sessionStorage.removeItem(AUTH_ATTEMPTS_KEY);
    } catch (err) { /* nothing to clear */ }
  }

  /* ---- failed-attempt throttling ---- */
  function readAttempts() {
    try {
      const a = JSON.parse(window.sessionStorage.getItem(AUTH_ATTEMPTS_KEY) || '{}');
      return { count: Number(a.count) || 0, level: Number(a.level) || 0, lockUntil: Number(a.lockUntil) || 0 };
    } catch (err) { return { count: 0, level: 0, lockUntil: 0 }; }
  }

  function writeAttempts(state) {
    try { window.sessionStorage.setItem(AUTH_ATTEMPTS_KEY, JSON.stringify(state)); } catch (err) { /* non-fatal */ }
  }

  function formatLockTime(ms) {
    const total = Math.max(1, Math.ceil(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  /* ---- gate UI ---- */
  function lockDashboard() {
    document.body.classList.add('auth-locked');
    dom.dashboard.setAttribute('inert', '');
    dom.dashboard.setAttribute('aria-hidden', 'true');
    dom.logoutBtn.hidden = true;
  }

  function unlockDashboard() {
    document.body.classList.remove('auth-locked');
    dom.dashboard.removeAttribute('inert');
    dom.dashboard.removeAttribute('aria-hidden');
    dom.logoutBtn.hidden = false;
    dom.dashboard.setAttribute('tabindex', '-1');
    dom.dashboard.focus({ preventScroll: true });   // the gate (and its focused input) just disappeared
  }

  function showAuthMessage(key, vars, shake) {
    I18N.setText(dom.authError, key, vars);         // keyed, so it re-translates on a language switch
    dom.authError.hidden = false;
    dom.authError.classList.remove('is-shaking');
    if (shake) { void dom.authError.offsetWidth; dom.authError.classList.add('is-shaking'); }
  }

  function clearAuthMessage() {
    dom.authError.hidden = true;
    dom.authError.removeAttribute('data-i18n');
    dom.authError.removeAttribute('data-i18n-vars');
    dom.authError.textContent = '';
  }

  function setFormEnabled(enabled) {
    dom.authInput.disabled = !enabled;
    dom.authSubmit.disabled = !enabled;     // the show/hide-passcode button stays usable
  }

  /**
   * checkAuth() — the gate. Returns a Promise:
   *   • resolves true  as soon as the admin is authenticated (a valid
   *     session already exists, or the correct passcode is entered);
   *   • resolves false when the page can never unlock (passcode not
   *     configured / malformed, or no Web Crypto) — it stays locked;
   *   • otherwise stays pending while the modal waits for the passcode.
   * Callers start the dashboard ONLY in the `true` branch.
   */
  function checkAuth() {
    return new Promise((resolve) => {
      const credential = readAdminCredential();
      const cryptoAvailable = !!(window.crypto && window.crypto.subtle);
      let lockTimer = null;
      let busy = false;

      lockDashboard();                              // fail closed, whatever happens next
      clearAuthMessage();

      // Language switch while locked: re-translate the eye-button label too.
      dom.authToggle.addEventListener('click', () => {
        const reveal = dom.authInput.type === 'password';
        dom.authInput.type = reveal ? 'text' : 'password';
        dom.authToggle.setAttribute('aria-pressed', String(reveal));
        dom.authToggle.setAttribute('data-i18n-aria', reveal ? 'auth.hide' : 'auth.show');
        I18N.apply(dom.authToggle);
        dom.authInput.focus();
      });

      dom.logoutBtn.addEventListener('click', () => {
        endSession();
        window.location.reload();                   // simplest way to drop all dashboard state
      });

      // ---- states that can never unlock ----
      if (!credential) { setFormEnabled(false); showAuthMessage('auth.notConfigured'); resolve(false); return; }
      if (credential.kind === 'invalid') { setFormEnabled(false); showAuthMessage('auth.badConfig'); resolve(false); return; }
      if (!cryptoAvailable) { setFormEnabled(false); showAuthMessage('auth.insecureContext'); resolve(false); return; }

      const finishUnlock = async () => {
        window.clearInterval(lockTimer);
        dom.authInput.value = '';
        try { window.sessionStorage.removeItem(AUTH_ATTEMPTS_KEY); } catch (err) { /* non-fatal */ }
        await startSession(credential);
        unlockDashboard();
        resolve(true);
      };

      // ---- lockout countdown (also restores a lockout after a reload) ----
      const renderLockState = () => {
        const remaining = readAttempts().lockUntil - Date.now();
        if (remaining > 0) {
          setFormEnabled(false);
          showAuthMessage('auth.locked', { time: formatLockTime(remaining) });
          return true;
        }
        if (dom.authInput.disabled && !busy) {
          setFormEnabled(true);
          clearAuthMessage();
          dom.authInput.focus();
        }
        return false;
      };
      const startLockTimer = () => {
        window.clearInterval(lockTimer);
        lockTimer = window.setInterval(() => { if (!renderLockState()) window.clearInterval(lockTimer); }, 1000);
      };

      dom.authForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (busy) return;
        if (renderLockState()) return;              // still locked out

        const entered = dom.authInput.value;
        if (!entered) { showAuthMessage('auth.empty', null, true); dom.authInput.focus(); return; }

        busy = true;
        dom.authSubmit.disabled = true;
        I18N.setText(dom.authSubmitLabel, 'auth.checking');

        let ok = false;
        try { ok = await verifyPasscode(entered, credential); } catch (err) { console.error('CourseTrack Admin — passcode check failed:', err); }

        busy = false;
        I18N.setText(dom.authSubmitLabel, 'auth.submit');
        dom.authSubmit.disabled = false;

        if (ok) { await finishUnlock(); return; }

        dom.authInput.value = '';
        const state = readAttempts();
        state.count += 1;
        if (state.count >= AUTH_MAX_ATTEMPTS) {
          state.level += 1;
          state.count = 0;
          state.lockUntil = Date.now() + Math.min(AUTH_BASE_LOCK_MS * Math.pow(2, state.level - 1), AUTH_MAX_LOCK_MS);
          writeAttempts(state);
          renderLockState();
          startLockTimer();
        } else {
          writeAttempts(state);
          showAuthMessage('auth.wrongLeft', { left: AUTH_MAX_ATTEMPTS - state.count }, true);
          dom.authInput.focus();
        }
      });

      // ---- start: valid session -> straight in; otherwise show the modal ----
      hasValidSession(credential).then((valid) => {
        if (valid) {
          unlockDashboard();
          resolve(true);
          return;
        }
        if (renderLockState()) startLockTimer();    // a lockout survives a page reload
        else dom.authInput.focus();
      });
    });
  }

  let dashboardStarted = false;

  /** Everything that touches Firebase or the upload/SheetJS pipeline starts
   *  here — and is only ever called after checkAuth() resolves true. The
   *  functions inside are unchanged; they are simply no longer started on
   *  page load. */
  function startDashboard() {
    if (dashboardStarted) return;
    dashboardStarted = true;
    initUpload();
    loadInitialStats();
  }

  function init() {
    window.setTimeout(hideLoadingScreen, 700);
    window.addEventListener('load', () => window.setTimeout(hideLoadingScreen, 1100));

    try {
      applyBranding();
      initTheme();
      I18N.onChange(() => {
        applyBrandText();
        dom.statUpdated.textContent = formatDateTime(lastUpdateIso);   // re-localise the date
      });
      dom.themeToggle.addEventListener('click', toggleTheme);

      // Branding, theme and language run first (the modal needs them);
      // the dashboard itself starts only once the admin has authenticated.
      checkAuth()
        .then((authenticated) => { if (authenticated) startDashboard(); })
        .catch((err) => console.error('CourseTrack Admin — authentication error (dashboard stays locked):', err));
    } catch (err) {
      console.error('CourseTrack Admin — initialization error:', err);
      hideLoadingScreen();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
