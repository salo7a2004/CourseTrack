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
  const I18N = window.I18N;           // i18n.js and common.js MUST load before this file (see admin.html)
  const CT = window.CourseTrack;
  if (!I18N || !CT) {
    // A missed file at deploy time must read as a message, never as a blank page.
    const note = document.createElement('p');
    note.className = 'noscript-note';
    note.textContent = 'CourseTrack could not start: a required file (i18n.js or common.js) did not load. Upload it next to this page, then refresh.';
    document.body.insertBefore(note, document.body.firstChild);
    const loader = document.getElementById('loading-screen');
    if (loader) loader.style.display = 'none';
    return;
  }

  // ISO timestamp of the last upload, kept so the "Last Update" tile can be
  // re-formatted in the new language when the language is switched.
  let lastUpdateIso = null;

  // Base allowance for one Firebase request (the whole response included). The shared
  // client adds a second for every 50 KB being uploaded, so a big write on a slow
  // connection is not cut off while a stalled one still ends in an error.
  const FIREBASE_TIMEOUT_MS = 30000;

  // Characters Firebase forbids in a key. A column header becomes a key in every stored record.
  const UNSAFE_KEY_CHARS = /[.#$[\]\/\u0000-\u001f\u007f]/;

  // How an upload is merged into the database (see buildMergePlan / commitMerge).
  const MERGE_RULES = {
    blankCellOverwrites: false,   // false: a blank cell leaves the stored value alone (safest). true: it clears it.
    fallbackBatchSize: 25,        // only used if the database refuses the single multi-path update (see commitMerge)
  };
  // Shared by every course (like the Code and Name columns), so no course "owns" them.
  const IDENTITY_COLUMN_PATTERN = /e-?mail|بريد/i;
  const GENERIC_SHEET_NAME = /^(sheet|worksheet|ورقة|صفحة)\s*\d*$/i;

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

  // Shared helpers (common.js): ONE implementation for both portals, so they cannot drift apart.
  const { escapeHtml, applyLogo } = CT.ui;
  const applyBrandColors = () => CT.ui.applyBrandColors(CONFIG);
  const hideLoadingScreen = () => CT.ui.hideLoadingScreen(dom.loadingScreen);
  const initTheme = CT.ui.theme.init;
  const toggleTheme = CT.ui.theme.toggle;

  /* =====================================================================
     BRANDING (identical small setup to student.js — page-specific glue
     code, not shared business logic, so it's kept local to each page)
     ===================================================================== */

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

  /* =====================================================================
     THEME
     ===================================================================== */

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

  // Mirrors IDENTITY_FIELDS.name in student.js, so "has a Name column" means
  // exactly what it means to the Student Portal that will display the data.
  const NAME_HEADER_PATTERN = /name|اسم/i;
  const MAX_LISTED_ROWS = 12;      // row numbers quoted per problem in the report
  const MAX_LISTED_ISSUES = 20;    // problems listed in the report (all are in the console log)

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
    // NOTE: these options (range: 0, blankrows: true) are IDENTICAL to the ones
    // parseExcelFile() uses to read the data. Both calls therefore produce the
    // same grid, so `rowIndex` points at the same row in both — and, because
    // `range: 0` starts at the sheet's first row, grid index N is Excel row N+1.
    // That is what lets the validation report quote exact Excel row numbers.
    const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 0, blankrows: true });
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
          const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', header: 1, range: 0, blankrows: true });
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
          // the merge plan) always yields the same keys for every
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

          resolve({ sheetName, headers, rows: dataRows, headerRowIndex });
        } catch (err) {
          reject(err instanceof Error ? err : I18N.error(ERRORS.INVALID_EXCEL));
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  /* =====================================================================
     DATA VALIDATION — runs after parsing and BEFORE anything is sent
     ---------------------------------------------------------------------
     validateStudentData() is a pure function (no DOM, no network) that
     returns a structured result. handleFile() turns a failed result into a
     blocking error banner + report, and prepareMerge() re-checks as a last
     line of defence, so no code path can reach the Firebase PUT with data
     that failed these rules:

       1. mandatory headers — a Code column and a Name column
       2. duplicate Student Codes
       3. rows with an empty Code or an empty Name

     The matching rules deliberately mirror the Student Portal (student.js):
       • the Name column is the first header matching /name|اسم/i;
       • codes are compared trimmed and case-insensitively, because that is
         how a student's search is matched — and the FIRST match wins — so
         "SD-1" and "sd-1" are one student, not two;
       • two different codes that Firebase would store under the SAME key
         (sanitizeFirebaseKey turns . # $ [ ] / into "_") would silently
         overwrite each other, so that is reported as well.
     Fully blank rows (spacers, trailing formatted rows) are ignored.
     ===================================================================== */

  /** Cell -> trimmed text. Also ignores zero-width characters that Excel
   *  exports and copy-paste sometimes leave behind: they look empty but
   *  aren't, and would otherwise slip through as a "code". */
  function cellText(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();
  }

  function formatRowList(rowNumbers) {
    const shown = rowNumbers.slice(0, MAX_LISTED_ROWS).join(', ');
    return rowNumbers.length > MAX_LISTED_ROWS ? `${shown} … (+${rowNumbers.length - MAX_LISTED_ROWS})` : shown;
  }

  /** 0 -> "A", 25 -> "Z", 26 -> "AA": the sheet column a header sits in (assuming the table starts in column A). */
  function columnLabel(index) {
    let n = index + 1;
    let label = '';
    while (n > 0) {
      const r = (n - 1) % 26;
      label = String.fromCharCode(65 + r) + label;
      n = Math.floor((n - 1) / 26);
    }
    return label;
  }

  function formatColumnList(columns) {
    return columns.length > 8 ? `${columns.slice(0, 8).join(', ')} … (+${columns.length - 8})` : columns.join(', ');
  }

  /**
   * @param {{headers: string[], rows: any[][], headerRowIndex?: number, sheetName?: string}} data
   *        `rows` are the data rows below the header; rows[0] is Excel row headerRowIndex + 2.
   * @returns {object} { ok, issues, warnings, ... } — every problem found, not just the first.
   *   issue types:   missingHeader {column} · badHeader {columns} · headlessColumn {columns}
   *                  · missingCode {rows} · missingName {rows} · duplicateCode {code, rows}
   *                  · keyCollision {key, codes, rows}
   *   warning types: duplicateHeader {header, columns}   (does not block the upload)
   */
  function validateStudentData({ headers, rows, headerRowIndex = 0, sheetName = '' }) {
    const issues = [];
    const warnings = [];   // non-blocking: the upload goes ahead and the admin is told
    const codeCol = headers.findIndex((h) => /code/i.test(String(h).trim()));
    const nameCol = headers.findIndex((h, c) => c !== codeCol && NAME_HEADER_PATTERN.test(String(h).trim()));

    // 1. mandatory headers — all missing ones are reported together
    if (codeCol === -1) issues.push({ type: 'missingHeader', column: 'code' });
    if (nameCol === -1) issues.push({ type: 'missingHeader', column: 'name' });

    // 4. column headers that cannot be stored. Every header becomes a key in every record, and Firebase
    //    refuses the WHOLE write if any key is blank or contains . # $ [ ] / — so these are caught here,
    //    in plain words, instead of failing at the database with a cryptic message.
    const badHeaders = [];
    const headlessColumns = [];
    headers.forEach((header, c) => {
      if (header === '') {
        // an empty, header-less column is simply left out of the stored records; one that holds data cannot be
        if (rows.some((row) => cellText(row[c]) !== '')) headlessColumns.push(columnLabel(c));
      } else if (UNSAFE_KEY_CHARS.test(header)) {
        badHeaders.push(`${columnLabel(c)} "${header}"`);
      }
    });
    if (badHeaders.length) issues.push({ type: 'badHeader', columns: badHeaders });
    if (headlessColumns.length) issues.push({ type: 'headlessColumn', columns: headlessColumns });

    // Duplicate headers have always uploaded, so they don't block — but the later column silently
    // overwrites the earlier one in every record, so the admin must be told.
    const headerColumns = new Map();
    headers.forEach((header, c) => {
      if (header === '') return;
      if (!headerColumns.has(header)) headerColumns.set(header, []);
      headerColumns.get(header).push(columnLabel(c));
    });
    headerColumns.forEach((cols, header) => { if (cols.length > 1) warnings.push({ type: 'duplicateHeader', header, columns: cols }); });

    // 2 + 3. row checks (each runs for whichever of the two columns exists)
    const firstDataRowNumber = headerRowIndex + 2; // the header itself is Excel row headerRowIndex + 1
    const missingCode = [];
    const missingName = [];
    const byCode = new Map();      // lower-cased code -> { spellings: Set, rows: [] }
    const keyToCodes = new Map();  // Firebase key     -> Set of lower-cased codes
    let blankRows = 0;

    rows.forEach((row, i) => {
      const rowNumber = firstDataRowNumber + i;
      if (row.every((cell) => cellText(cell) === '')) { blankRows += 1; return; }

      if (codeCol !== -1) {
        const code = cellText(row[codeCol]);
        if (!code) {
          missingCode.push(rowNumber);
        } else {
          const normalized = code.toLowerCase();
          if (!byCode.has(normalized)) byCode.set(normalized, { spellings: new Set(), rows: [] });
          const group = byCode.get(normalized);
          group.spellings.add(code);
          group.rows.push(rowNumber);

          const key = sanitizeFirebaseKey(code);
          if (!keyToCodes.has(key)) keyToCodes.set(key, new Set());
          keyToCodes.get(key).add(normalized);
        }
      }
      if (nameCol !== -1 && cellText(row[nameCol]) === '') missingName.push(rowNumber);
    });

    if (missingCode.length) issues.push({ type: 'missingCode', rows: missingCode });
    if (missingName.length) issues.push({ type: 'missingName', rows: missingName });

    Array.from(byCode.values())
      .filter((group) => group.rows.length > 1)
      .sort((x, y) => x.rows[0] - y.rows[0])
      .forEach((group) => issues.push({ type: 'duplicateCode', code: Array.from(group.spellings).join(' / '), rows: group.rows }));

    keyToCodes.forEach((codes, key) => {
      if (codes.size < 2) return; // one code under one key is fine (a duplicate is reported above)
      const groups = Array.from(codes).map((c) => byCode.get(c));
      issues.push({
        type: 'keyCollision',
        key,
        codes: groups.map((g) => Array.from(g.spellings)[0]).join(' / '),
        rows: groups.reduce((all, g) => all.concat(g.rows), []).sort((x, y) => x - y),
      });
    });

    return {
      ok: issues.length === 0,
      issues,
      warnings,
      sheetName,
      headerRow: headerRowIndex + 1,
      codeColumn: codeCol === -1 ? null : headers[codeCol],
      nameColumn: nameCol === -1 ? null : headers[nameCol],
      totalRows: rows.length,
      studentRows: rows.length - blankRows,
      blankRows,
    };
  }

  /** A failed validation as a keyed Error, so it flows through the existing
   *  catch -> showErrorBanner() path; the structured result rides along. */
  function validationError(result) {
    const err = I18N.error('val.title', { count: result.issues.length });
    err.validation = result;
    return err;
  }

  /** Structured log for the browser console (F12) — the full list, however long. */
  function logValidationFailure(file, result) {
    console.groupCollapsed(`CourseTrack Admin — upload BLOCKED: ${result.issues.length} validation problem(s) in "${file.name}"`);
    console.log('Sheet:', result.sheetName, '| header row:', result.headerRow, '| Code column:', result.codeColumn, '| Name column:', result.nameColumn);
    console.log('Rows read:', result.totalRows, '| student rows:', result.studentRows, '| blank rows ignored:', result.blankRows);
    console.table(result.issues.map((issue) => ({
      problem: issue.type,
      detail: issue.column || issue.code || issue.codes || (issue.columns ? issue.columns.join(', ') : ''),
      excelRows: issue.rows ? issue.rows.join(', ') : '',
    })));
    console.log('Full structured result:', result);
    console.groupEnd();
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

  // How each kind of Firebase failure (see common.js) is worded for the admin.
  const failedWithReason = (e) => ({ key: 'err.fbFailed', vars: { reason: e.reason || e.message } });
  const ADMIN_ERROR_KEYS = {
    timeout: 'err.fbTimeout', offline: 'err.offline', network: 'err.fbNetwork', auth: 'err.fbDenied',
    notfound: 'err.fbNotFound', ratelimit: 'err.fbRateLimited',
    server: failedWithReason, client: failedWithReason, parse: failedWithReason, remote: failedWithReason,
  };

  /** One call to the shared Firebase client. GET and PUT are idempotent, so a transient
   *  failure is retried once; writes use print=silent so Firebase doesn't echo the whole
   *  dataset back; the admin secret (if any) is appended by appendAuthParam and is never logged. */
  function firebaseRequest(url, method, body, query) {
    const target = appendAuthParam(url);
    return CT.firebase.request(query ? CT.firebase.withQuery(target, query) : target, {
      method, body, timeoutMs: FIREBASE_TIMEOUT_MS, retries: 1, silent: method === 'PUT' || method === 'PATCH', errorKeys: ADMIN_ERROR_KEYS,
    });
  }

  /** Firebase RTDB keys may not contain . $ # [ ] / or ASCII control
   *  characters, and must not be empty. */
  function sanitizeFirebaseKey(rawKey) {
    const cleaned = String(rawKey).trim().replace(/[.#$[\]/\x00-\x1F\x7F]/g, '_');
    return cleaned || `row_${Math.random().toString(36).slice(2, 10)}`;
  }

  /* =====================================================================
     SCOPED PARTIAL UPDATES — one course/track at a time, never the whole dataset
     ---------------------------------------------------------------------
     An upload is the work of ONE instructor / course (Design, HVAC...). It
     must change exactly the columns that are IN the file, for exactly the
     students that are in the file — and nothing else, ever:

       • columns in the file   -> overwritten with the new values (corrections welcome)
       • every other column    -> untouched (other courses, their attendance, their grades)
       • every other student   -> untouched
       • students not yet in the database -> added

     How that is achieved (and why it is not "fetch the record, merge, write it back"):
     each value is written to its OWN path in ONE atomic multi-path PATCH —
     {"A1/Design 1": 10, "A1/Design 2": 7, ...}. Nothing is read-modify-written,
     so two instructors uploading at the same moment cannot overwrite each other
     (a fetch-merge-PUT would lose whichever write landed first). The only read
     is a keys-only listing, used to match incoming codes to existing students
     case-insensitively — exactly how the Student Portal matches them.

     Rules worth knowing (MERGE_RULES):
       • a blank cell leaves the stored value alone (a half-filled sheet must not erase grades);
       • the Code column is the join key: an existing student's is never rewritten;
       • each course's columns are recorded in /meta/tracks, so a file that would
         overwrite ANOTHER course's columns asks for confirmation first.
     ===================================================================== */

  /** The course/track an upload belongs to: the worksheet's name or — when it only has a default
   *  name such as "Sheet1" — the file name without its extension. */
  function deriveCourseName(sheetName, fileName) {
    const sheet = String(sheetName || '').trim();
    if (sheet && !GENERIC_SHEET_NAME.test(sheet)) return sheet;
    return String(fileName || '').replace(/\.[^.]+$/, '').trim() || sheet || 'Course';
  }

  /**
   * PURE (no network): turns the parsed sheet into database writes.
   * @param {{headers: string[], rows: any[][], existingKeys: string[]}} input  existingKeys = the keys already under /students
   * @returns {{updates: object, byStudent: Map, columns: string[], counts: object}}
   *   updates   { "<studentKey>/<column>": value }  — the single multi-path PATCH body
   *   byStudent Map(studentKey -> { column: value }) — the same writes, grouped (used by the batched fallback)
   *   columns   the course's own columns (everything except Code, Name and e-mail)
   */
  function buildMergePlan({ headers, rows, existingKeys }) {
    const codeCol = headers.findIndex((h) => /code/i.test(String(h).trim()));
    const nameCol = headers.findIndex((h, c) => c !== codeCol && NAME_HEADER_PATTERN.test(String(h).trim()));

    const keyByLower = new Map();           // the Student Portal matches codes case-insensitively, so merging must too
    existingKeys.forEach((key) => { if (!keyByLower.has(key.toLowerCase())) keyByLower.set(key.toLowerCase(), key); });

    const columns = [];
    headers.forEach((header, c) => {
      if (header === '' || c === codeCol || c === nameCol || IDENTITY_COLUMN_PATTERN.test(header) || columns.indexOf(header) !== -1) return;
      columns.push(header);
    });

    const updates = {};
    const byStudent = new Map();
    const counts = { students: 0, created: 0, matched: 0, fields: 0, blanksIgnored: 0 };

    rows.forEach((row) => {
      const code = cellText(row[codeCol]);
      if (!code) return;                    // only fully blank spacer rows get here: validation blocked every other row without a Code
      const wanted = sanitizeFirebaseKey(code);
      const known = keyByLower.get(wanted.toLowerCase());
      const key = known || wanted;
      const isNew = !known;
      keyByLower.set(wanted.toLowerCase(), key);
      counts.students += 1;
      if (isNew) counts.created += 1; else counts.matched += 1;

      const fields = {};
      headers.forEach((header, c) => {
        if (header === '') return;          // an empty, header-less column (validation proved it holds no data)
        if (c === codeCol && !isNew) return; // the join key of an existing student is never rewritten
        const raw = row[c];
        const blank = cellText(raw) === '' || (typeof raw === 'number' && !Number.isFinite(raw));
        let value = raw;
        if (blank) {
          if (!MERGE_RULES.blankCellOverwrites) { counts.blanksIgnored += 1; return; }
          if (isNew) return;                // nothing stored yet, nothing to clear
          value = null;                     // Firebase deletes a path written as null
        }
        fields[header] = value;
      });
      byStudent.set(key, fields);
      Object.keys(fields).forEach((header) => { updates[`${key}/${header}`] = fields[header]; counts.fields += 1; });
    });

    return { updates, byStudent, columns, counts };
  }

  /** The record in /meta/tracks for this course; an existing one is reused even if its capitalisation differs. */
  function trackRecordKey(courseName, tracks) {
    const wanted = sanitizeFirebaseKey(courseName);
    return Object.keys(tracks || {}).find((key) => key.toLowerCase() === wanted.toLowerCase()) || wanted;
  }

  function ownedColumns(track) {
    const list = track && track.columns;
    if (!list) return [];
    return Array.isArray(list) ? list.filter(Boolean) : Object.keys(list).map((k) => list[k]);   // Firebase may hand a list back as an object
  }

  /** Columns in this file that were last written by a DIFFERENT course (the same course re-uploading is a correction, not a conflict). */
  function findOverlaps(columns, tracks, ownKey) {
    const overlaps = [];
    Object.keys(tracks || {}).forEach((key) => {
      if (key === ownKey) return;
      const owned = ownedColumns(tracks[key]);
      columns.forEach((column) => {
        if (owned.indexOf(column) !== -1) overlaps.push({ column, courseKey: key, course: (tracks[key] && tracks[key].name) || key });
      });
    });
    return overlaps;
  }

  function describeOverlaps(overlaps) {
    const byCourse = new Map();
    overlaps.forEach((o) => { if (!byCourse.has(o.course)) byCourse.set(o.course, []); byCourse.get(o.course).push(o.column); });
    return Array.from(byCourse.entries()).map(([course, cols]) => `${cols.join(', ')} ("${course}")`).join('; ');
  }

  function cancelledError() {
    const err = I18N.error('err.uploadCancelled');
    err.cancelled = true;
    return err;
  }

  /** Reads what is needed to merge safely (nothing is written yet) and builds the plan. */
  async function prepareMerge({ headers, rows, headerRowIndex, courseName, fileName }) {
    // Last line of defence, as before: nothing that failed validation may reach the database.
    const validation = validateStudentData({ headers, rows, headerRowIndex });
    if (!validation.ok) throw validationError(validation);

    const urls = getFirebaseUrls();
    const tracksUrl = urls.metaUrl.replace(/meta\.json$/, 'meta/tracks.json');
    const [shallow, tracks] = await Promise.all([
      firebaseRequest(urls.studentsUrl, 'GET', undefined, { shallow: 'true' }),   // keys only: a few bytes per student
      firebaseRequest(tracksUrl, 'GET').catch((err) => {                           // advisory only: never blocks an upload
        console.warn('CourseTrack Admin — could not read the course list (overlap check skipped):', err.message);
        return null;
      }),
    ]);

    const existingKeys = shallow && typeof shallow === 'object' ? Object.keys(shallow) : [];
    const plan = buildMergePlan({ headers, rows, existingKeys });
    const knownTracks = tracks && typeof tracks === 'object' ? tracks : {};
    const trackKey = trackRecordKey(courseName, knownTracks);
    return { plan, urls, tracksUrl, courseName, fileName, trackKey, tracks: knownTracks, overlaps: findOverlaps(plan.columns, knownTracks, trackKey), existingCount: existingKeys.length };
  }

  /** If the database refuses path-style keys, update student by student: no longer one atomic step,
   *  but every request still touches only its own student's listed fields. */
  async function patchStudentsInBatches(studentsUrl, byStudent) {
    const entries = Array.from(byStudent.entries());
    for (let i = 0; i < entries.length; i += MERGE_RULES.fallbackBatchSize) {
      const batch = entries.slice(i, i + MERGE_RULES.fallbackBatchSize);
      await Promise.all(batch.map(([key, fields]) => firebaseRequest(studentsUrl.replace(/students\.json$/, `students/${encodeURIComponent(key)}.json`), 'PATCH', fields)));
    }
  }

  /** Writes the plan. The student data goes first (and is the only part that can fail the upload);
   *  the course record + "last update" are advisory. */
  async function commitMerge(prepared) {
    const { plan, urls, tracksUrl, courseName, fileName, trackKey, tracks, overlaps } = prepared;
    let batched = false;

    if (Object.keys(plan.updates).length) {
      try {
        await firebaseRequest(urls.studentsUrl, 'PATCH', plan.updates);   // ONE atomic update: all of it or none of it
      } catch (err) {
        if (!(err instanceof CT.firebase.FirebaseError) || err.kind !== 'client' || err.status !== 400) throw err;
        batched = true;
        await patchStudentsInBatches(urls.studentsUrl, plan.byStudent);
      }
    }

    // From here on the student data IS live. /meta only feeds the "Last Update" tile and the course list, so if
    // THAT write fails the upload still succeeded — the admin is told about the small gap instead.
    const lastUpdate = new Date().toISOString();
    const metaUpdate = { lastUpdate, studentsWritten: plan.counts.students };
    // A course keeps ownership of every column it has EVER written: a partial re-upload (only "Design 1")
    // must not make the system forget that "Design 2" is Design's too.
    const previous = ownedColumns(tracks[trackKey]);
    const ownedNow = previous.concat(plan.columns.filter((column) => previous.indexOf(column) === -1));
    metaUpdate[`tracks/${trackKey}`] = { name: courseName, columns: ownedNow, students: plan.counts.students, fileName, updatedAt: lastUpdate };
    const taken = new Set(overlaps.map((o) => o.column));
    new Set(overlaps.map((o) => o.courseKey)).forEach((courseKey) => {       // columns this file just took over are no longer the other course's
      const remaining = ownedColumns(tracks[courseKey]).filter((column) => !taken.has(column));
      metaUpdate[`tracks/${courseKey}/columns`] = remaining.length ? remaining : null;
    });
    let metaSaved = true;
    try {
      await firebaseRequest(urls.metaUrl, 'PATCH', metaUpdate);
    } catch (err) {
      metaSaved = false;
      console.warn('CourseTrack Admin — the student data was saved, but /meta could not be updated:', err.message);
    }

    return { lastUpdate, metaSaved, batched, counts: plan.counts, columns: plan.columns, totalStudents: prepared.existingCount + plan.counts.created, tracksUrl };
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

  let validationReportEl = null; // created on first use, directly under #upload-error

  function resetBanners() {
    dom.uploadSuccess.hidden = true;
    dom.uploadError.hidden = true;
    hideValidationReport();
  }

  function showSuccessBanner(key, vars) {
    resetBanners();
    I18N.setText(dom.uploadSuccessText, key || 'upload.success', vars);
    dom.uploadSuccess.hidden = false;
  }

  /** Accepts an Error (keyed errors stay translatable, raw ones are shown
   *  verbatim) or a dictionary key such as ERRORS.UNSUPPORTED_FILE. The
   *  "❌ " prefix comes from data-i18n-prefix on #upload-error-text. */
  function showErrorBanner(errOrKey) {
    resetBanners();
    I18N.setErrorText(dom.uploadErrorText, errOrKey, 'err.invalidExcel');
    dom.uploadError.hidden = false;
    // A validation failure carries its structured result: list every problem.
    if (errOrKey && errOrKey.validation) renderValidationReport(errOrKey.validation);
  }

  function getValidationReport() {
    if (!validationReportEl) {
      validationReportEl = document.createElement('div');
      validationReportEl.id = 'validation-report';
      validationReportEl.className = 'validation-report';
      validationReportEl.hidden = true;
      dom.uploadError.insertAdjacentElement('afterend', validationReportEl);
    }
    return validationReportEl;
  }

  function hideValidationReport() {
    if (!validationReportEl) return;
    validationReportEl.hidden = true;
    validationReportEl.classList.remove('validation-report--ok');
    validationReportEl.textContent = '';
  }

  /** The success summary: what was written, for whom, and what was deliberately left alone. */
  function renderMergeReport(result, prepared) {
    const report = getValidationReport();
    report.textContent = '';
    report.classList.add('validation-report--ok');
    const list = document.createElement('ul');
    list.className = 'validation-report__list';
    const add = (key, vars) => {
      const item = document.createElement('li');
      setHtmlText(item, key, vars);
      list.appendChild(item);
    };
    add('merge.columns', { n: result.columns.length, columns: result.columns.length ? formatColumnList(result.columns) : '—' });
    add('merge.students', { matched: result.counts.matched, created: result.counts.created });
    if (result.counts.blanksIgnored) add('merge.blanks', { n: result.counts.blanksIgnored });
    if (prepared.overlaps.length) add('merge.overwrote', { details: describeOverlaps(prepared.overlaps) });
    if (result.batched) add('merge.batched');
    report.appendChild(list);
    report.hidden = false;
  }

  /** Like I18N.setText, but for dictionary entries that contain markup
   *  (<bdi> around codes). Values are HTML-escaped by I18N.apply, and the key
   *  is stored on the element so the line re-translates on a language switch. */
  function setHtmlText(el, key, vars) {
    el.setAttribute('data-i18n-html', key);
    if (vars) el.setAttribute('data-i18n-vars', JSON.stringify(vars));
    I18N.apply(el);
  }

  function describeIssue(issue) {
    switch (issue.type) {
      case 'missingHeader': return { key: issue.column === 'code' ? 'val.missingCodeHeader' : 'val.missingNameHeader' };
      case 'badHeader': return { key: 'val.badHeader', vars: { columns: formatColumnList(issue.columns) } };
      case 'headlessColumn': return { key: 'val.headlessColumn', vars: { columns: formatColumnList(issue.columns) } };
      case 'missingCode': return { key: 'val.missingCode', vars: { rows: formatRowList(issue.rows) } };
      case 'missingName': return { key: 'val.missingName', vars: { rows: formatRowList(issue.rows) } };
      case 'duplicateCode': return { key: 'val.duplicate', vars: { code: issue.code, rows: formatRowList(issue.rows) } };
      case 'keyCollision': return { key: 'val.keyCollision', vars: { codes: issue.codes, rows: formatRowList(issue.rows) } };
      default: return { key: 'val.hint' };
    }
  }

  function renderValidationReport(result) {
    const report = getValidationReport();
    report.textContent = '';

    if (result.sheetName) {
      const meta = document.createElement('p');
      meta.className = 'validation-report__meta';
      I18N.setText(meta, 'val.sheetInfo', { sheet: result.sheetName, headerRow: result.headerRow });
      report.appendChild(meta);
    }

    const list = document.createElement('ul');
    list.className = 'validation-report__list';
    result.issues.slice(0, MAX_LISTED_ISSUES).forEach((issue) => {
      const item = document.createElement('li');
      item.className = `validation-issue validation-issue--${issue.type}`;
      const { key, vars } = describeIssue(issue);
      setHtmlText(item, key, vars);
      list.appendChild(item);
    });
    if (result.issues.length > MAX_LISTED_ISSUES) {
      const more = document.createElement('li');
      more.className = 'validation-issue validation-issue--more';
      setHtmlText(more, 'val.moreIssues', { n: result.issues.length - MAX_LISTED_ISSUES });
      list.appendChild(more);
    }
    report.appendChild(list);

    const hint = document.createElement('p');
    hint.className = 'validation-report__hint';
    I18N.setText(hint, 'val.hint');
    report.appendChild(hint);
    if (result.issues.some((issue) => issue.type === 'duplicateCode')) {
      const caseHint = document.createElement('p');
      caseHint.className = 'validation-report__hint';
      I18N.setText(caseHint, 'val.hintCase');
      report.appendChild(caseHint);
    }

    report.hidden = false;
    try { report.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (err) { /* cosmetic only */ }
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

  /** `status` is a dictionary key (status.*), not display text.
   *  @param {{fileName?: string|null, headers?: string[], students?: number, lastUpdate?: string|null, status?: string}} info */
  function updateStatsDisplay({ fileName, headers, students, lastUpdate, status }) {
    if (fileName !== undefined) {
      if (fileName) I18N.setRaw(dom.statFile, fileName);        // real file name — never re-translated
      else I18N.setText(dom.statFile, 'stat.noFile');
    }
    if (students !== undefined) dom.statStudents.textContent = students;
    if (headers) {
      dom.statWeeks.textContent = String(countWeeks(headers));
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
    if (dom.dropzone.classList.contains('is-uploading')) {
      CT.toast.show({ id: 'upload-busy', kind: 'info', titleKey: 'toast.title.uploadBusy', messageKey: 'toast.msg.uploadBusy' });
      return;
    }

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
      const { headers, rows, headerRowIndex, sheetName } = await parseExcelFile(file);

      markStepsUpTo('process');
      await wait(150);

      // VALIDATION GATE — before the Statistics tiles are touched (they must
      // keep describing what is actually in the database) and long before any
      // fetch. On failure this throws; nothing below it runs, so no PUT is sent.
      const validation = validateStudentData({ headers, rows, headerRowIndex, sheetName });
      if (!validation.ok) {
        logValidationFailure(file, validation);
        throw validationError(validation);
      }

      if (validation.warnings.length) {
        CT.toast.show({
          id: 'duplicate-headers', kind: 'warning', titleKey: 'toast.title.duplicateHeaders', messageKey: 'toast.msg.duplicateHeaders', duration: 14000,
          vars: { headers: validation.warnings.map((w) => `${w.header} (${w.columns.join(', ')})`).join('; ') },
        });
      }

      updateStatsDisplay({ fileName: file.name, headers, students: rows.length, status: 'status.processing' });

      markStepsUpTo('sync');
      const courseName = deriveCourseName(sheetName, file.name);
      const prepared = await prepareMerge({ headers, rows, headerRowIndex, courseName, fileName: file.name });
      if (prepared.overlaps.length && !window.confirm(I18N.t('merge.confirmOverlap', { course: courseName, details: describeOverlaps(prepared.overlaps) }))) {
        throw cancelledError();          // nothing has been written yet
      }
      const result = await commitMerge(prepared);

      markStepsUpTo('done');
      setStep('done', 'done');

      updateStatsDisplay({
        fileName: file.name,
        headers,
        students: result.totalStudents,
        lastUpdate: result.metaSaved ? result.lastUpdate : undefined,   // never show a time that wasn't saved
        status: 'status.active',
      });

      showSuccessBanner('upload.merged', { course: courseName, count: result.counts.students });
      renderMergeReport(result, prepared);
      await loadInitialStats();   // the tiles describe the WHOLE database (every course), not just this file
      if (!result.metaSaved) {
        CT.toast.show({ id: 'meta-partial', kind: 'warning', titleKey: 'toast.title.metaPartial', messageKey: 'toast.msg.metaPartial', duration: 14000 });
      }
    } catch (err) {
      if (err && err.cancelled) {
        showErrorBanner(err);        // nothing was written; the tiles were pointed at this file, so restore them from the database
        await loadInitialStats();
        return;
      }
      updateStatsDisplay({ status: 'status.failed' });
      showErrorBanner(err);
      // Firebase faults (timeout, offline, refused access...) also raise a toast; "Try again" re-runs this same file.
      CT.firebase.reportError(err, { scope: 'admin', onRetry: () => handleFile(file) });
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
      CT.firebase.reportError(err, { scope: 'admin', onRetry: loadInitialStats });
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
      }).catch((err) => {
        console.error('CourseTrack Admin — could not check the saved session (the gate stays locked):', err);
        dom.authInput.focus();
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
