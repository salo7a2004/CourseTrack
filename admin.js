/* =====================================================================
   COURSETRACK — ADMIN DASHBOARD LOGIC
   Private page. This is the ONLY place data can be written — it parses
   the uploaded .xlsx client-side with SheetJS, then POSTs the resulting
   grid to the Google Sheets bridge (google-apps-script.gs), which is
   the single source of truth the Student Portal reads from.
   ===================================================================== */

(() => {
  'use strict';

  const CONFIG = window.APP_CONFIG || {};

  const PREFERRED_SHEET_NAME = 'form responses 1';
  const ERRORS = {
    UNSUPPORTED_FILE: 'Unsupported file.',
    INVALID_EXCEL: 'Invalid Excel file.',
    SHEET_NOT_FOUND: 'Sheet "Form Responses 1" not found.',
    CODE_NOT_FOUND: 'Code column not found.',
  };

  const dom = {
    loadingScreen: document.getElementById('loading-screen'),
    themeToggle: document.getElementById('theme-toggle'),

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
    dom.headerCourseName.textContent = CONFIG.courseName || 'CourseTrack';
    dom.courseLogoPlaceholder.textContent = (CONFIG.courseName || 'C').trim().charAt(0).toUpperCase();

    const logos = CONFIG.logos || {};
    applyLogo(dom.courseLogoImg, dom.courseLogoPlaceholder, logos.course);
    applyLogo(dom.orgLogoPrimary, dom.orgPlaceholderPrimary, logos.primaryOrg);
    applyLogo(dom.orgLogoPartner, dom.orgPlaceholderPartner, logos.partnerOrg);

    const orgs = CONFIG.organizations || {};
    if (orgs.primary && orgs.primary.name) { dom.orgNamePrimary.textContent = orgs.primary.name; dom.orgPlaceholderPrimary.textContent = orgs.primary.name; }
    if (orgs.partner && orgs.partner.name) { dom.orgNamePartner.textContent = orgs.partner.name; dom.orgPlaceholderPartner.textContent = orgs.partner.name; }

    const footer = CONFIG.footerText || {};
    if (footer.poweredBy) dom.footerPowered.textContent = footer.poweredBy;
    if (footer.collaboration) dom.footerCollab.textContent = footer.collaboration;
    if (footer.developedBy) {
      const name = footer.developedBy.replace(/^Developed by\s*/i, '');
      dom.footerDeveloped.innerHTML = `Developed by <strong>${escapeHtml(name)}</strong>`;
    }

    dom.infoCourseName.textContent = CONFIG.courseName || '—';
    dom.infoInstructorName.textContent = CONFIG.instructorName || '—';
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

  function findSheetWithCodeColumn(workbook) {
    return workbook.SheetNames.find((name) => {
      const headerRow = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, range: 0 })[0] || [];
      return headerRow.some((cell) => /code/i.test(String(cell)));
    });
  }

  function pickSheetName(workbook) {
    const preferred = workbook.SheetNames.find((name) => name.trim().toLowerCase() === PREFERRED_SHEET_NAME);
    if (preferred) return preferred;
    const fallback = findSheetWithCodeColumn(workbook);
    if (fallback) return fallback;
    throw new Error(ERRORS.SHEET_NOT_FOUND);
  }

  function parseExcelFile(file) {
    return new Promise((resolve, reject) => {
      if (typeof XLSX === 'undefined') {
        reject(new Error('The Excel engine (SheetJS) failed to load. Check your internet connection and reload the page.'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(ERRORS.INVALID_EXCEL));
      reader.onload = (event) => {
        let workbook;
        try {
          workbook = XLSX.read(new Uint8Array(event.target.result), { type: 'array' });
        } catch (err) {
          reject(new Error(ERRORS.INVALID_EXCEL));
          return;
        }
        if (!workbook.SheetNames.length) { reject(new Error(ERRORS.INVALID_EXCEL)); return; }

        try {
          const sheetName = pickSheetName(workbook);
          const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', header: 1 });
          if (!rows.length) { reject(new Error(`The sheet "${sheetName}" is empty — add student rows and try again.`)); return; }

          const headers = rows[0].map((h) => String(h));

          // Google Sheets' setValues() requires every row to have EXACTLY
          // headers.length columns, or the write fails outright. A raw
          // .xlsx can occasionally have a stray value in a column past the
          // header row's last column (or a short row) — pad/truncate every
          // row here so the payload sent to Apps Script is always
          // rectangular, regardless of what the source file looked like.
          const dataRows = rows.slice(1).map((row) => {
            const normalized = row.slice(0, headers.length);
            while (normalized.length < headers.length) normalized.push('');
            return normalized;
          });

          if (!headers.some((h) => /code/i.test(h.trim()))) {
            reject(new Error(ERRORS.CODE_NOT_FOUND));
            return;
          }

          resolve({ sheetName, headers, rows: dataRows });
        } catch (err) {
          reject(err instanceof Error ? err : new Error(ERRORS.INVALID_EXCEL));
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
    return headers.filter((h) => /^notes?\s*\d/i.test(String(h).trim())).length;
  }

  /* =====================================================================
     GOOGLE SHEETS SYNC
     ===================================================================== */

  function getEndpoint() {
    const endpoint = CONFIG.sheetsApi && CONFIG.sheetsApi.endpoint;
    if (!endpoint || endpoint.startsWith('PASTE_')) {
      throw new Error('Google Sheets endpoint is not configured yet — set sheetsApi.endpoint in config.js.');
    }
    return endpoint;
  }

  async function pushToSheets(headers, rows) {
    const endpoint = getEndpoint();
    const token = (CONFIG.sheetsApi && CONFIG.sheetsApi.adminToken) || '';

    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        // text/plain avoids a CORS preflight that Apps Script Web Apps
        // don't handle — the script still parses this body as JSON.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token, headers, rows }),
      });
    } catch (err) {
      throw new Error('Could not reach the Google Sheets endpoint. Check your internet connection and try again.');
    }

    let payload;
    try {
      payload = await response.json();
    } catch (err) {
      throw new Error('The Google Sheets endpoint returned an unreadable response.');
    }

    if (!payload || payload.success === false) {
      throw new Error((payload && payload.error) || 'The Google Sheets endpoint reported an error.');
    }

    return payload;
  }

  async function fetchCurrentStats() {
    const endpoint = getEndpoint();
    const response = await fetch(endpoint, { method: 'GET', cache: 'no-store' });
    const payload = await response.json();
    if (!payload || payload.success === false) throw new Error((payload && payload.error) || 'Could not load current stats.');
    return payload;
  }

  /* =====================================================================
     UI HELPERS
     ===================================================================== */

  function formatDateTime(isoString) {
    if (!isoString) return '—';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function resetBanners() {
    dom.uploadSuccess.hidden = true;
    dom.uploadError.hidden = true;
  }

  function showSuccessBanner(message) {
    resetBanners();
    dom.uploadSuccessText.textContent = message || '✅ Course sheet uploaded successfully.';
    dom.uploadSuccess.hidden = false;
  }

  function showErrorBanner(message) {
    resetBanners();
    dom.uploadErrorText.textContent = `❌ ${message}`;
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

  function updateStatsDisplay({ fileName, headers, students, lastUpdate, status }) {
    if (fileName !== undefined) dom.statFile.textContent = fileName || 'No file uploaded yet';
    if (students !== undefined) dom.statStudents.textContent = students;
    if (headers) {
      dom.statWeeks.textContent = countWeeks(headers);
      dom.statTasks.textContent = countPrefixed(headers, 't');
      dom.statNotes.textContent = countNotes(headers);
    }
    if (lastUpdate !== undefined) dom.statUpdated.textContent = formatDateTime(lastUpdate);
    if (status !== undefined) dom.statStatus.textContent = status;
  }

  /* =====================================================================
     UPLOAD FLOW
     ===================================================================== */

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function handleFile(file) {
    resetBanners();
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      showErrorBanner(ERRORS.UNSUPPORTED_FILE);
      return;
    }

    dom.uploadSteps.hidden = false;
    markStepsUpTo('upload');

    try {
      await wait(150);
      markStepsUpTo('read');
      const { headers, rows } = await parseExcelFile(file);

      markStepsUpTo('process');
      await wait(150);
      updateStatsDisplay({ fileName: file.name, headers, students: rows.length, status: 'Processing…' });

      markStepsUpTo('sync');
      const result = await pushToSheets(headers, rows);

      markStepsUpTo('done');
      setStep('done', 'done');

      updateStatsDisplay({
        fileName: file.name,
        headers,
        students: result.studentsWritten,
        lastUpdate: result.lastUpdate,
        status: 'Active',
      });

      showSuccessBanner('✅ Course sheet uploaded successfully.');
    } catch (err) {
      updateStatsDisplay({ status: 'Failed' });
      showErrorBanner((err && err.message) || ERRORS.INVALID_EXCEL);
    } finally {
      dom.fileInput.value = '';
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
        status: headers.length ? 'Active' : 'No data yet',
      });
    } catch (err) {
      console.warn('CourseTrack Admin — could not load current stats:', err.message);
      updateStatsDisplay({ status: 'Not connected' });
    }
  }

  function init() {
    window.setTimeout(hideLoadingScreen, 700);
    window.addEventListener('load', () => window.setTimeout(hideLoadingScreen, 1100));

    try {
      applyBranding();
      initTheme();
      initUpload();
      dom.themeToggle.addEventListener('click', toggleTheme);
      loadInitialStats();
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
