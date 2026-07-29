/* =====================================================================
   COURSETRACK — APPLICATION LOGIC
   Pure vanilla JS. No frameworks. Uses SheetJS (window.XLSX) to parse
   .xlsx workbooks entirely on the client, with zero backend/database.

   All branding/colors/theme come from window.APP_CONFIG (config.js) —
   this file never hardcodes a course name, organization, or color.
   Column detection (Meeting/Task/Notes) is 100% structural: nothing
   here ever hardcodes "M1", "T1", or a week number.
   ===================================================================== */

(() => {
  'use strict';

  const CONFIG = window.APP_CONFIG || {};

  /* -------------------------------------------------------------------
     0. CONSTANTS
     ------------------------------------------------------------------- */
  const STORAGE_KEYS = {
    THEME: 'coursetrack_theme',
    COURSE_DATA: 'coursetrack_course_data',
    COURSE_INFO: 'coursetrack_course_info', // instructor-edited overrides for name/instructor
  };

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
  const PREFERRED_SHEET_NAME = 'form responses 1';

  const ERRORS = {
    UNSUPPORTED_FILE: 'Unsupported file.',
    INVALID_EXCEL: 'Invalid Excel file.',
    SHEET_NOT_FOUND: 'Sheet "Form Responses 1" not found.',
    CODE_NOT_FOUND: 'Code column not found.',
  };

  const ICONS = {
    meeting: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 2v4M16 2v4M3 9h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg>',
    task: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    notes: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 20l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
    file: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    sheet: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/></svg>',
    students: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 20c0-3-2.7-5.5-6-5.5S5 17 5 20"/><circle cx="11" cy="8" r="3.6"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 2v4M16 2v4M3 9h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 13l4 4L19 7"/></svg>',
    clock: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
    weight: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v3M7 6h10l3 13H4L7 6z"/></svg>',
    version: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.6 12A8.6 8.6 0 1 1 12 3.4"/><path d="M12 3.4V9l4-3"/></svg>',
  };

  /** Config-driven metric tiles for the post-upload summary — add a row
   *  here to add a tile, never touch the render function itself. */
  const SUMMARY_TILES = [
    { id: 'file', label: 'Current File', icon: ICONS.file, get: (d) => d.meta.fileName || '—' },
    { id: 'sheet', label: 'Detected Sheet', icon: ICONS.sheet, get: (d) => d.sheetName || '—' },
    { id: 'students', label: 'Students', icon: ICONS.students, get: (d) => d.meta.totalStudents },
    { id: 'weeks', label: 'Weeks', icon: ICONS.calendar, get: (d) => d.meta.totalMeetings },
    { id: 'tasks', label: 'Tasks', icon: ICONS.task, get: (d) => d.meta.totalTasks },
    { id: 'notes', label: 'Notes', icon: ICONS.notes, get: (d) => d.meta.totalNotes },
    { id: 'lastUpdate', label: 'Last Update', icon: ICONS.clock, get: (d) => formatDateTime(d.meta.lastUpdate) },
    { id: 'status', label: 'Status', icon: ICONS.check, get: () => 'Active' },
    { id: 'fileSize', label: 'File Size', icon: ICONS.weight, get: (d) => formatFileSize(d.meta.fileSize) },
    { id: 'version', label: 'Current Version', icon: ICONS.version, get: (d) => d.meta.version },
  ];

  /* -------------------------------------------------------------------
     1. DOM REFERENCES
     ------------------------------------------------------------------- */
  const dom = {
    loadingScreen: document.getElementById('loading-screen'),
    themeToggle: document.getElementById('theme-toggle'),

    viewButtons: document.querySelectorAll('.view-switch__btn'),
    studentView: document.getElementById('student-view'),
    uploadView: document.getElementById('upload-view'),

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

    courseNameField: document.getElementById('course-name'),
    instructorNameField: document.getElementById('instructor-name'),
    courseInfoVersion: document.getElementById('course-info-version'),
    courseInfoFile: document.getElementById('course-info-file'),
    courseInfoStudents: document.getElementById('course-info-students'),
    courseInfoUpdated: document.getElementById('course-info-updated'),

    dropzoneState: document.getElementById('upload-dropzone-state'),
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('file-input'),
    progressWrap: document.getElementById('progress-wrap'),
    progressFill: document.getElementById('progress-fill'),
    progressLabel: document.getElementById('progress-label'),
    uploadError: document.getElementById('upload-error'),
    uploadErrorText: document.getElementById('upload-error-text'),

    summaryState: document.getElementById('upload-summary-state'),
    summaryGrid: document.getElementById('upload-summary-grid'),
    replaceFileBtn: document.getElementById('replace-file-btn'),
  };

  /** In-memory representation of the parsed course sheet. */
  let courseData = null;

  /* =====================================================================
     2. CONFIG APPLICATION (branding, colors, theme, footer)
     ===================================================================== */

  /** Pushes config.js colors into CSS custom properties, so re-theming
   *  the whole app only ever requires editing config.js. */
  function applyBrandColors() {
    const { colors } = CONFIG;
    if (!colors) return;
    const root = document.documentElement.style;
    if (colors.primary) root.setProperty('--color-primary', colors.primary);
    if (colors.secondary) root.setProperty('--color-accent', colors.secondary);
  }

  /**
   * Sets an <img>'s source only if a path is configured, and only ever
   * reveals the <img> once it has actually finished loading. If the
   * path is missing, or the file fails to load (404, corrupt, etc.),
   * the clean text placeholder stays visible instead of a broken-image
   * icon — logos "just work" once a real file is dropped in place,
   * with zero HTML changes required.
   */
  function applyLogo(imgEl, placeholderEl, path) {
    if (!imgEl) return;

    // Always start from the safe state: placeholder visible, image hidden.
    imgEl.hidden = true;
    if (placeholderEl) placeholderEl.hidden = false;

    if (!path) return;

    imgEl.onload = () => {
      imgEl.hidden = false;
      if (placeholderEl) placeholderEl.hidden = true;
    };
    imgEl.onerror = () => {
      console.warn(`CourseTrack — logo failed to load from "${path}"; showing placeholder instead.`);
      imgEl.hidden = true;
      imgEl.removeAttribute('src');
      if (placeholderEl) placeholderEl.hidden = false;
    };
    imgEl.src = path;
  }

  /** Updates the course-logo circle's fallback letter from the current
   *  course name (e.g. "Engineering Fundamentals" -> "E"). */
  function updateCourseLogoPlaceholder(courseName) {
    if (!dom.courseLogoPlaceholder) return;
    const trimmed = String(courseName || '').trim();
    dom.courseLogoPlaceholder.textContent = trimmed ? trimmed.charAt(0).toUpperCase() : 'C';
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

    const footer = CONFIG.footerText || {};
    if (dom.footerPowered && footer.poweredBy) dom.footerPowered.textContent = footer.poweredBy;
    if (dom.footerCollab && footer.collaboration) dom.footerCollab.textContent = footer.collaboration;
    if (dom.footerDeveloped && footer.developedBy) {
      dom.footerDeveloped.innerHTML = `Developed by <strong>${escapeHtml(footer.developedBy.replace(/^Developed by\s*/i, ''))}</strong>`;
    }

    if (dom.courseInfoVersion) dom.courseInfoVersion.textContent = CONFIG.appVersion || '—';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* =====================================================================
     3. COURSE INFO (Course Name / Instructor Name) — config default,
        instructor-editable override persisted locally
     ===================================================================== */

  function loadCourseInfoOverrides() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.COURSE_INFO);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      console.warn('Could not load saved course info:', err);
      return {};
    }
  }

  function saveCourseInfoOverrides(overrides) {
    try {
      localStorage.setItem(STORAGE_KEYS.COURSE_INFO, JSON.stringify(overrides));
    } catch (err) {
      console.warn('Could not persist course info:', err);
    }
  }

  function initCourseInfoFields() {
    const overrides = loadCourseInfoOverrides();
    const courseName = overrides.courseName || CONFIG.courseName || 'Untitled Course';
    const instructorName = overrides.instructorName || CONFIG.instructorName || 'Add instructor name';

    dom.courseNameField.textContent = courseName;
    dom.instructorNameField.textContent = instructorName;
    dom.headerCourseName.textContent = courseName;
    updateCourseLogoPlaceholder(courseName);

    const persist = () => {
      const newCourseName = dom.courseNameField.textContent.trim() || 'Untitled Course';
      saveCourseInfoOverrides({
        courseName: newCourseName,
        instructorName: dom.instructorNameField.textContent.trim(),
      });
      dom.headerCourseName.textContent = newCourseName;
      updateCourseLogoPlaceholder(newCourseName);
    };

    dom.courseNameField.addEventListener('blur', persist);
    dom.instructorNameField.addEventListener('blur', persist);
    [dom.courseNameField, dom.instructorNameField].forEach((el) => {
      el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          el.blur();
        }
      });
    });
  }

  /* =====================================================================
     4. THEME (Dark / Light) — Light Mode is always the default
     ===================================================================== */

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(STORAGE_KEYS.THEME, theme);
    } catch (err) {
      console.warn('Unable to persist theme preference:', err);
    }
  }

  function initTheme() {
    let saved = null;
    try {
      saved = localStorage.getItem(STORAGE_KEYS.THEME);
    } catch (err) {
      console.warn('localStorage unavailable, theme will not persist.', err);
    }
    // Light Mode is the required default — only a previously saved,
    // explicit user choice may switch this to dark. OS preference is
    // intentionally ignored here.
    applyTheme(saved === 'dark' ? 'dark' : (CONFIG.theme === 'dark' && saved !== 'light' ? 'dark' : 'light'));
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }

  /* =====================================================================
     5. VIEW SWITCHING
     ===================================================================== */

  function switchView(target) {
    const isStudent = target === 'student';
    dom.studentView.classList.toggle('is-active', isStudent);
    dom.uploadView.classList.toggle('is-active', !isStudent);
    dom.viewButtons.forEach((btn) => {
      const active = btn.dataset.view === target;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    });
  }

  function initViewSwitch() {
    dom.viewButtons.forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });
  }

  /* =====================================================================
     6. COLUMN DETECTION — never hardcodes a column name or week number
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

  /**
   * Detects which "version" of results this workbook represents, purely
   * from its data — never hardcoded. If Course Summary columns exist,
   * this is treated as the Final Results release. Otherwise, the
   * version is the highest week number that has at least one published
   * (non-empty) Meeting or Task value across all students.
   */
  function detectVersion(columns, students) {
    if (columns.final.length > 0) return 'Final Results';

    const weekNumbers = new Set([...columns.meetings.map((c) => c.num), ...columns.tasks.map((c) => c.num)]);
    let latestPublished = 0;

    weekNumbers.forEach((num) => {
      const meetingKey = (columns.meetings.find((c) => c.num === num) || {}).key;
      const taskKey = (columns.tasks.find((c) => c.num === num) || {}).key;
      const hasData = students.some((s) => {
        const meetingVal = meetingKey ? s.raw[meetingKey] : '';
        const taskVal = taskKey ? s.raw[taskKey] : '';
        return !isEmptyCell(meetingVal) || !isEmptyCell(taskVal);
      });
      if (hasData && num > latestPublished) latestPublished = num;
    });

    return latestPublished > 0 ? `Week ${latestPublished} Results` : 'No Data Published Yet';
  }

  /* =====================================================================
     7. EXCEL PARSING (SheetJS)
     ===================================================================== */

  function findSheetWithCodeColumn(workbook) {
    return workbook.SheetNames.find((name) => {
      const headerRow = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, range: 0 })[0] || [];
      return headerRow.some((cell) => /code/i.test(String(cell)));
    });
  }

  /** Prefers "Form Responses 1"; falls back to any sheet with a Code
   *  column; throws a precise error if neither can be resolved. */
  function pickSheetName(workbook) {
    const preferred = workbook.SheetNames.find((name) => name.trim().toLowerCase() === PREFERRED_SHEET_NAME);
    if (preferred) return preferred;

    const fallback = findSheetWithCodeColumn(workbook);
    if (fallback) {
      console.warn(`CourseTrack — ${ERRORS.SHEET_NOT_FOUND} Using "${fallback}" because it contains a Code column.`);
      return fallback;
    }

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

      reader.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 70);
          updateProgress(percent, `Reading file… ${percent}%`);
        }
      };

      reader.onload = (event) => {
        let workbook;
        try {
          updateProgress(80, 'Parsing workbook… 80%');
          workbook = XLSX.read(new Uint8Array(event.target.result), { type: 'array' });
        } catch (err) {
          reject(new Error(ERRORS.INVALID_EXCEL));
          return;
        }

        if (!workbook.SheetNames.length) {
          reject(new Error(ERRORS.INVALID_EXCEL));
          return;
        }

        try {
          const sheetName = pickSheetName(workbook);
          const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
          updateProgress(95, 'Finalizing… 95%');

          if (!rows.length) {
            reject(new Error(`The sheet "${sheetName}" is empty — add student rows and try again.`));
            return;
          }

          resolve({ sheetName, rows });
        } catch (err) {
          reject(err instanceof Error ? err : new Error(ERRORS.INVALID_EXCEL));
        }
      };

      reader.readAsArrayBuffer(file);
    });
  }

  function buildCourseData(sheetName, rows, file) {
    const headers = Object.keys(rows[0]);
    const columns = detectColumns(headers);

    if (!columns.code) {
      throw new Error(ERRORS.CODE_NOT_FOUND);
    }

    const students = rows
      .filter((row) => String(row[columns.code]).trim() !== '')
      .map((row) => ({ code: String(row[columns.code]).trim(), raw: row }));

    if (!students.length) {
      throw new Error(ERRORS.CODE_NOT_FOUND);
    }

    const version = detectVersion(columns, students);

    console.group('%cCourseTrack — Excel import debug', 'color:#2f54eb;font-weight:700;');
    console.log('Detected sheet name:', sheetName);
    console.log('All detected column headers:', headers);
    console.log('Code column:', columns.code, '| Name column:', columns.name, '| Email column:', columns.email);
    console.log('Meeting columns:', columns.meetings);
    console.log('Task columns:', columns.tasks);
    console.log('Notes columns:', columns.notes);
    console.log('Final result columns:', columns.final);
    console.log('Detected version:', version);
    console.log(`Parsed ${students.length} student row(s).`);
    console.groupEnd();

    return {
      sheetName,
      columns,
      students,
      meta: {
        totalStudents: students.length,
        totalMeetings: columns.meetings.length,
        totalTasks: columns.tasks.length,
        totalNotes: columns.notes.length,
        lastUpdate: new Date().toISOString(),
        fileName: file.name,
        fileSize: file.size,
        version,
      },
    };
  }

  /* =====================================================================
     8. PERSISTENCE (localStorage) — auto-reload last upload, no re-upload needed
     ===================================================================== */

  function saveCourseData(data) {
    try {
      localStorage.setItem(STORAGE_KEYS.COURSE_DATA, JSON.stringify(data));
    } catch (err) {
      console.warn('Could not persist course data locally:', err);
    }
  }

  function loadCourseData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.COURSE_DATA);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.warn('Could not load saved course data:', err);
      return null;
    }
  }

  /* =====================================================================
     9. UPLOAD FLOW (dropzone <-> summary, drag & drop, progress, errors)
     ===================================================================== */

  function updateProgress(percent, label) {
    dom.progressWrap.hidden = false;
    dom.progressFill.style.width = `${percent}%`;
    dom.progressLabel.textContent = label;
  }

  function resetUploadFeedback() {
    dom.uploadError.hidden = true;
    dom.progressWrap.hidden = true;
    dom.progressFill.style.width = '0%';
  }

  function showUploadError(message) {
    dom.progressWrap.hidden = true;
    dom.uploadErrorText.textContent = message;
    dom.uploadError.hidden = false;
  }

  function formatFileSize(bytes) {
    if (!bytes && bytes !== 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function formatDateTime(isoString) {
    if (!isoString) return '—';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  /** Builds the 10-tile post-upload summary from SUMMARY_TILES — add a
   *  tile to the config array above and it appears here automatically. */
  function renderUploadSummary(data) {
    dom.summaryGrid.innerHTML = '';
    SUMMARY_TILES.forEach((tile, index) => {
      const el = document.createElement('div');
      el.className = 'upload-summary-tile';
      el.style.animationDelay = `${Math.min(index * 60, 600)}ms`;

      const icon = document.createElement('div');
      icon.className = 'upload-summary-tile__icon';
      icon.innerHTML = tile.icon;

      const label = document.createElement('span');
      label.className = 'upload-summary-tile__label';
      label.textContent = tile.label;

      const value = document.createElement('span');
      value.className = 'upload-summary-tile__value';
      value.setAttribute('dir', 'auto');
      value.textContent = tile.get(data);

      el.appendChild(icon);
      el.appendChild(label);
      el.appendChild(value);
      dom.summaryGrid.appendChild(el);
    });
  }

  function showSummaryState(data) {
    dom.dropzoneState.hidden = true;
    dom.summaryState.hidden = false;
    renderUploadSummary(data);
  }

  function showDropzoneState() {
    dom.summaryState.hidden = true;
    dom.dropzoneState.hidden = false;
    resetUploadFeedback();
  }

  function renderCourseInfoDynamicFields(meta) {
    dom.courseInfoFile.textContent = meta.fileName || 'No file uploaded yet';
    dom.courseInfoStudents.textContent = meta.totalStudents;
    dom.courseInfoUpdated.textContent = formatDateTime(meta.lastUpdate);
  }

  function refreshNoDataHint() {
    dom.noDataHint.hidden = !!(courseData && courseData.students.length);
  }

  async function handleFile(file) {
    resetUploadFeedback();
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      showUploadError(ERRORS.UNSUPPORTED_FILE);
      return;
    }

    updateProgress(5, 'Reading file… 5%');

    try {
      const { sheetName, rows } = await parseExcelFile(file);
      const data = buildCourseData(sheetName, rows, file);

      courseData = data;
      saveCourseData(data);
      updateProgress(100, 'Done! 100%');

      renderCourseInfoDynamicFields(data.meta);
      refreshNoDataHint();
      window.setTimeout(() => showSummaryState(data), 200);
    } catch (err) {
      showUploadError((err && err.message) || ERRORS.INVALID_EXCEL);
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

    dom.replaceFileBtn.addEventListener('click', showDropzoneState);
  }

  /* =====================================================================
     10. SHARED RENDERING HELPERS
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

  function findStudentByCode(code) {
    if (!courseData) return null;
    const normalized = code.trim().toLowerCase();
    return courseData.students.find((student) => student.code.toLowerCase() === normalized) || null;
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
     11. COURSE PROGRESS (Week timeline) — only real weeks, ever
     ===================================================================== */

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

  function renderTimeline(student) {
    const weeks = buildWeekList(courseData.columns);

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
     12. COURSE SUMMARY (Final results)
     ===================================================================== */

  function renderFinalResults(student) {
    const { final } = courseData.columns;

    if (!final.length) {
      dom.finalSection.hidden = true;
      dom.finalResults.innerHTML = '';
      return;
    }

    dom.finalResults.innerHTML = '';
    final.forEach((key, index) => {
      const value = student.raw[key];
      const el = document.createElement('div');
      el.className = 'final-item';
      el.style.animationDelay = `${Math.min(index * 70, 700)}ms`;

      const label = document.createElement('div');
      label.className = 'final-item__label';
      label.textContent = key;

      const valueEl = document.createElement('div');
      valueEl.className = `final-item__value status-${classifyValue(value)}`;
      setAutoText(valueEl, displayValue(value));

      el.appendChild(label);
      el.appendChild(valueEl);
      dom.finalResults.appendChild(el);
    });
    dom.finalSection.hidden = false;
  }

  /* =====================================================================
     13. STUDENT PROFILE + SEARCH
     ===================================================================== */

  function renderProfile(student) {
    const { columns } = courseData;
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

  function renderStudent(student) {
    renderProfile(student);
    renderTimeline(student);
    renderFinalResults(student);
    setViewState({ results: true });

    window.requestAnimationFrame(() => {
      dom.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  async function handleSearch(event) {
    event.preventDefault();
    const code = dom.codeInput.value.trim();
    if (!code) return;

    dom.searchBtn.classList.add('is-loading');
    dom.searchBtn.disabled = true;

    try {
      if (!courseData || !courseData.students.length) {
        dom.errorTitle.textContent = 'No Course Data Uploaded';
        dom.errorMessage.textContent = 'Ask your instructor to upload the Excel sheet from the Instructor Upload tab first.';
        setViewState({ error: true });
        return;
      }

      setViewState({ loading: true });
      await new Promise((resolve) => window.setTimeout(resolve, 400));

      const student = findStudentByCode(code);

      if (!student) {
        console.warn('CourseTrack — no student matched for code:', code);
        dom.errorTitle.textContent = '❌ Student Code Not Found';
        dom.errorMessage.textContent = "We couldn't match that code to any record in the uploaded sheet. Double-check it and try again.";
        setViewState({ error: true });
        return;
      }

      console.log('%cCourseTrack — matched student object:', 'color:#16a34a;font-weight:700;', student);
      renderStudent(student);
    } catch (err) {
      console.error('CourseTrack — unexpected search error:', err);
      dom.errorTitle.textContent = '❌ Something Went Wrong';
      dom.errorMessage.textContent = 'An unexpected error occurred while searching. Please try again.';
      setViewState({ error: true });
    } finally {
      // Loading state is hidden immediately and unconditionally, and the
      // Search button is always re-enabled, no matter which branch ran.
      dom.searchBtn.classList.remove('is-loading');
      dom.searchBtn.disabled = false;
      dom.searchLoading.hidden = true;
    }
  }

  function initSearch() {
    dom.searchForm.addEventListener('submit', handleSearch);
  }

  /* =====================================================================
     14. INITIALIZATION
     ===================================================================== */

  function hideLoadingScreen() {
    if (!dom.loadingScreen || dom.loadingScreen.style.display === 'none') return;
    dom.loadingScreen.classList.add('is-hidden');
    window.setTimeout(() => { dom.loadingScreen.style.display = 'none'; }, 650);
  }

  function restorePreviousSession() {
    courseData = loadCourseData();
    if (!courseData) return;

    renderCourseInfoDynamicFields(courseData.meta);
    showSummaryState(courseData);
    refreshNoDataHint();
  }

  function init() {
    window.setTimeout(hideLoadingScreen, 900);
    window.addEventListener('load', () => window.setTimeout(hideLoadingScreen, 1200));

    try {
      applyBranding();
      initTheme();
      initCourseInfoFields();
      initViewSwitch();
      initUpload();
      initSearch();
      dom.themeToggle.addEventListener('click', toggleTheme);

      restorePreviousSession();
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
