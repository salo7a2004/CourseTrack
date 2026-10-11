# CourseTrack — EN / عربي Language Toggle: Integration Guide

Three new/changed pieces:

| File | What to do |
|---|---|
| `i18n.js` (new) | Drop next to `config.js`. Holds the dictionary + engine. |
| `style-i18n-additions.css` | Append to the **end** of `style.css`. |
| `index.html`, `admin.html`, `student.js`, `admin.js`, `config.js` | Small edits listed below. |

Nothing in `config.js`'s Firebase section, the data parsing, column detection or Firebase calls changes.

---

## 1. Both HTML files — `<head>` and script order

**a) Add the Arabic font** (Poppins/Inter have no Arabic glyphs). In the existing Google Fonts `<link>`, add `&family=Cairo:wght@400;500;600;700;800` before `&display=swap`:

```html
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700;800&family=Inter:wght@400;500;600;700;800&family=Cairo:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
```

**b) Optional but recommended — no direction flash on reload.** Put this tiny inline script in `<head>`, right after the `<meta charset>`:

```html
<script>try{if(localStorage.getItem('coursetrack_lang')==='ar'){var r=document.documentElement;r.lang='ar';r.dir='rtl';}}catch(e){}</script>
```

**c) Script order at the bottom of `<body>`** — `i18n.js` must sit between `config.js` and the page script:

```html
<script src="config.js"></script>
<script src="i18n.js"></script>
<script src="student.js"></script>   <!-- admin.html: admin.js -->
```

**d) The language button.** Put it **immediately before** the existing `#theme-toggle` button, inside `.header-orgs`, on both pages:

```html
<button id="lang-toggle" class="lang-toggle" type="button" aria-pressed="false"
        data-i18n-aria="lang.switchAria" data-i18n-title="lang.switchAria">
  <span class="lang-toggle__opt is-active" data-lang-opt="en">EN</span>
  <span class="lang-toggle__opt" data-lang-opt="ar" lang="ar">عربي</span>
</button>
```

`i18n.js` wires the click, highlights the active side and sets `aria-pressed`. The two labels are never translated (standard for a language switch).

> **Rule for every edit below:** `data-i18n` replaces an element's *entire* text. If the element also contains an `<svg>` (section titles, the PDF button, the badge, the header link), wrap the words in a `<span data-i18n="…">` and leave the SVG outside it.

---

## 2. `index.html` — exact attribute changes

| Element | Add / change |
|---|---|
| `<title>` | `data-i18n="page.studentTitle"` |
| `<meta name="description">` | `data-i18n-content="page.studentDesc"` |
| `.loader-text` | `data-i18n="loading.portal"` |
| `#header-course-subtitle` | `data-i18n="header.subtitle"` |
| 1st `.org-chip__caption` | `data-i18n="org.managedBy"` |
| 2nd `.org-chip__caption` | `data-i18n="org.collab"` |
| `#org-logo-primary` | `data-i18n-alt="org.primaryLogoAlt"` |
| `#org-logo-partner` | `data-i18n-alt="org.partnerLogoAlt"` |
| `#theme-toggle` | `data-i18n-aria="theme.toggle" data-i18n-title="theme.toggleTitle"` |
| `.search-card__title` | `data-i18n="search.title"` |
| `.search-card__subtitle` | `data-i18n="search.subtitle"` |
| `#student-code-input` | `data-i18n-placeholder="search.placeholder" data-i18n-aria="search.inputAria"` |
| `#search-btn .btn-label` | `data-i18n="search.button"` |
| `.remember-code-row > span` | `data-i18n="search.remember"` |
| `#no-data-hint` | `data-i18n="search.hint"` |
| `#search-loading` text `<span>` (2nd) | `data-i18n="search.loading"` |
| `#error-title` | `data-i18n="err.notFound.title"` |
| `#error-message` | `data-i18n="err.notFound.msg"` |
| `.profile-eyebrow` | `data-i18n="profile.name"` |
| "Student Code" `.profile-meta__label` | `data-i18n="profile.code"` |
| "Email Address" `.profile-meta__label` | `data-i18n="profile.email"` |

Elements where the text sits beside an SVG — wrap the words:

```html
<!-- Download button -->
<button type="button" class="btn btn--ghost" id="download-pdf-btn">
  <svg …>…</svg>
  <span data-i18n="results.downloadPdf">Download Report Card (PDF)</span>
</button>

<!-- Section titles (3×): keep the <svg>, wrap the text -->
<h3 class="section-title"><svg …>…</svg> <span data-i18n="profile.title">Student Profile</span></h3>
<h3 class="section-title"><svg …>…</svg> <span data-i18n="weekly.title">Weekly Results</span></h3>
<h3 class="section-title"><svg …>…</svg> <span data-i18n="final.title">Final Result</span></h3>

<!-- Record-found badge -->
<div class="profile-badge success-pop"><svg …>…</svg> <span data-i18n="profile.badge">Record found</span></div>
```

Leave **untouched**: `#student-name`, `#student-code-display`, `#student-email`, `#timeline`, `#final-results` (all filled from Firebase), the org names (`9D`, `ENGX`) and the footer `<p>`s (see `applyBrandText` below).

---

## 3. `admin.html` — exact attribute changes

| Element | Add / change |
|---|---|
| `<title>` | `data-i18n="page.adminTitle"` |
| `.loader-text` | `data-i18n="loading.admin"` |
| `.admin-badge` | `data-i18n="admin.badge"` |
| org captions / logo alts / `#theme-toggle` | same as `index.html` |
| `.search-card__title` (upload card) | `data-i18n="upload.title"` |
| `.search-card__subtitle` (upload card) | `data-i18n-html="upload.subtitle"` (it contains `<strong>`) |
| `.dropzone-title` | `data-i18n-html="dropzone.title"` |
| `.dropzone-sub` | `data-i18n="dropzone.sub"` |
| Course-info `.info-field__label` ×3 | `info.courseName`, `info.instructor`, `info.version` (as `data-i18n`) |
| Course-info `.no-data-hint` | `data-i18n="info.hint"` |
| Stats `.info-field__label` ×7 | `stat.file`, `stat.students`, `stat.weeks`, `stat.tasks`, `stat.notes`, `stat.updated`, `stat.status` |
| `#stat-file` | `data-i18n="stat.noFile"` |
| `#stat-status` | `data-i18n="status.noData"` |
| `#upload-success-text` | `data-i18n="upload.success"` |
| `#upload-error-text` | `data-i18n="err.invalidExcel" data-i18n-prefix="❌ "` |

Wrap-the-words elements:

```html
<a href="index.html" class="header-link">
  <svg …>…</svg>
  <span data-i18n="admin.studentPortal">Student Portal</span>
</a>

<h3 class="section-title info-card__title"><svg …>…</svg> <span data-i18n="info.title">Course Information</span></h3>
<h3 class="section-title info-card__title"><svg …>…</svg> <span data-i18n="stats.title">Statistics</span></h3>
```

Upload steps — put the key on the **second** `<span>` of each step (the first is the dot):

```html
<div class="upload-step" data-step="upload"><span class="upload-step__dot"></span><span data-i18n="step.upload">Uploading…</span></div>
<div class="upload-step" data-step="read"><span class="upload-step__dot"></span><span data-i18n="step.read">Reading workbook…</span></div>
<div class="upload-step" data-step="process"><span class="upload-step__dot"></span><span data-i18n="step.process">Processing students…</span></div>
<div class="upload-step" data-step="sync"><span class="upload-step__dot"></span><span data-i18n="step.sync">Syncing to Firebase…</span></div>
<div class="upload-step" data-step="done"><span class="upload-step__dot"></span><span data-i18n="step.done">Finished.</span></div>
```

Leave untouched: `#info-course-name`, `#info-instructor-name`, `#info-version`, `#stat-students/weeks/tasks/notes/updated` (JS-filled).

---

## 4. `config.js` — optional Arabic branding overrides

The course name, subtitle and instructor name live in `config.js`, not the dictionary. They stay as written unless you add these (all optional, leave `''` to keep English):

```js
courseNameAr: '',
courseSubtitleAr: '',
instructorNameAr: '',
```

---

## 5. `student.js` — patches

**5.1** Right after `const CONFIG = window.APP_CONFIG || {};`:

```js
const I18N = window.I18N; // i18n.js must be loaded BEFORE this file
```

**5.2** Delete the three constants `SESSION_LABELS`, `NOT_PUBLISHED_LABEL`, `NO_NOTES_LABEL` (they become dictionary keys).

**5.3** Split the text half of `applyBranding()` into its own function so it can re-run on a language switch (logos stay in `applyBranding`, so they don't reload/flicker):

```js
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

/** Language-dependent branding text. Re-run on every language switch. */
function applyBrandText() {
  const courseName = I18N.cfgOr('courseName', null) || 'CourseTrack';
  dom.headerCourseName.textContent = courseName;
  dom.courseLogoPlaceholder.textContent = courseName.trim().charAt(0).toUpperCase();
  dom.headerCourseSubtitle.textContent = I18N.cfgOr('courseSubtitle', 'header.subtitle');

  const orgs = CONFIG.organizations || {};
  const footer = CONFIG.footerText || {};
  const isEn = I18N.getLang() === 'en';
  const primary = (orgs.primary && orgs.primary.name) || '';
  const partner = (orgs.partner && orgs.partner.name) || '';

  // English keeps whatever config.js says; Arabic uses the dictionary
  dom.footerPowered.textContent = isEn && footer.poweredBy ? footer.poweredBy : I18N.t('footer.poweredBy', { org: primary });
  dom.footerCollab.textContent = isEn && footer.collaboration ? footer.collaboration : I18N.t('footer.collab', { org: partner });

  const devName = (footer.developedBy || 'Salah Hossam').replace(/^Developed by\s*/i, '');
  dom.footerDeveloped.innerHTML = `${escapeHtml(I18N.t('footer.developedBy'))} <strong><bdi>${escapeHtml(devName)}</bdi></strong>`;
}
```

**5.4** `setAutoText` — it is used for real data, so it must detach any translation key (this is what guarantees a language switch can never overwrite a database value):

```js
function setAutoText(el, text) {
  el.removeAttribute('data-i18n');
  el.removeAttribute('data-i18n-vars');
  el.textContent = text;
  el.setAttribute('dir', 'auto');
}
```

**5.5** Error throws — replace each `new Error('…English…')` with a keyed error:

| Where | Replace with |
|---|---|
| `getStudentsUrl` "not configured" | `throw I18N.error('err.notConfigured');` |
| `fetchCourseData`, network catch | `throw I18N.error(err && err.name === 'AbortError' ? 'err.timeout' : 'err.network');` |
| `!response.ok` | `throw I18N.error(response.status === 401 \|\| response.status === 403 ? 'err.denied' : 'err.serverError');` |
| body-read `AbortError` | `throw I18N.error('err.timeout');` |
| `SyntaxError` branch | `throw I18N.error('err.unreadable');` |
| `!rows.length` | `throw I18N.error('err.noData');` |
| `if (data && data.error)` | **leave as is** — it is Firebase's own message, shown verbatim |

**5.6** `buildFieldCard` — takes a label key and the **raw** cell value; decides itself between data and fallback text:

```js
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
    I18N.setText(valueEl, fallbackKey);          // "Not Published Yet" — translatable
    valueEl.setAttribute('dir', 'auto');
  } else {
    setAutoText(valueEl, displayValue(value));   // real data — verbatim, never keyed
  }

  text.appendChild(labelEl);
  text.appendChild(valueEl);
  field.appendChild(icon);
  field.appendChild(text);
  return field;
}
```

**5.7** `buildWeekCard` — title and the three calls:

```js
I18N.setText(title, 'week.title', { n: week.num });   // replaces: title.textContent = `Week ${week.num}`;

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
```

**5.8** `renderProfile` — the "Student" fallback becomes translatable, real names stay verbatim:

```js
function renderProfile(columns, student) {
  const name = columns.name ? displayValue(student.raw[columns.name], '') : '';
  if (name) setAutoText(dom.studentName, name);
  else { I18N.setText(dom.studentName, 'profile.fallbackName'); dom.studentName.setAttribute('dir', 'auto'); }

  setAutoText(dom.studentCodeDisplay, student.code);
  /* …email block unchanged… */
}
```

**5.9** `handleSearch` — the two error branches:

```js
// student not found
I18N.setText(dom.errorTitle, 'err.notFound.title');
I18N.setText(dom.errorMessage, 'err.notFound.msg');
setViewState({ error: true });
return;

// catch (err)
I18N.setText(dom.errorTitle, 'err.generic.title');
I18N.setErrorText(dom.errorMessage, err, 'err.generic.msg');
setViewState({ error: true });
```

**5.10** `initDownloadPdf` — the report now follows the UI language (the old comment said "deliberately en/ltr"; the cloned results are already translated, so only the shell needs to change):

```js
// replaces the hard-coded <html lang="en" dir="ltr"> and <title>:
frameDoc.write(`<!DOCTYPE html>
<html lang="${I18N.getLang()}" dir="${I18N.getDir()}">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(I18N.t('print.docTitle', { code: studentCode }))}</title>
<link rel="stylesheet" href="${styleHref}">
</head>
<body></body>
</html>`);

// date:
const reportDate = new Date().toLocaleDateString(I18N.locale(), { year: 'numeric', month: 'long', day: 'numeric' });

// banner:
header.innerHTML = `
  <div>
    <div class="print-header__title">${escapeHtml(I18N.t('print.title'))}</div>
    <div class="print-header__subtitle">${escapeHtml(I18N.t('print.subtitle', { course: courseName }))}</div>
  </div>
  <div class="print-header__date">${reportDate}</div>
`;

// footer:
footer.textContent = primaryOrgName
  ? I18N.t('print.footerOrg', { org: primaryOrgName })
  : I18N.t('print.footer');
```

Dark mode is still deliberately not applied to the print frame. (Escaping `studentCode` in the `<title>` is a free hardening — it was interpolated raw before.)

**5.11** `init()` — one line after `initTheme();`:

```js
I18N.onChange(applyBrandText);
```

---

## 6. `admin.js` — patches

**6.1** After `const CONFIG`: `const I18N = window.I18N;` and, next to it, `let lastUpdateIso;`

**6.2** `ERRORS` now holds dictionary **keys**:

```js
const ERRORS = {
  UNSUPPORTED_FILE: 'err.unsupportedFile',
  INVALID_EXCEL: 'err.invalidExcel',
  SHEET_NOT_FOUND: 'err.sheetNotFound',
  CODE_NOT_FOUND: 'err.codeNotFound',
};
```

**6.3** Every `new Error(ERRORS.X)` becomes `I18N.error(ERRORS.X)` — in `pickSheet`, in `parseExcelFile` (`reader.onerror`, the two `INVALID_EXCEL` rejects, `CODE_NOT_FOUND`, the `catch` fallback) and in the push function (the two `CODE_NOT_FOUND` throws). Keep the `err instanceof Error ? err : …` pattern; keyed errors are `Error` objects, so they pass through.

**6.4** The inline English messages:

| Where | Replace with |
|---|---|
| SheetJS not loaded | `reject(I18N.error('err.sheetJsFailed'));` |
| empty sheet | `reject(I18N.error('err.sheetEmpty', { sheet: sheetName }));` |
| `getFirebaseUrls` | `throw I18N.error('err.fbNotConfigured');` |
| `firebaseRequest` network catch | `throw I18N.error(err && err.name === 'AbortError' ? 'err.fbTimeout' : 'err.fbNetwork');` |
| `firebaseRequest` body `AbortError` | `throw I18N.error('err.fbTimeout');` |
| permission denied | `throw I18N.error('err.fbDenied');` |
| generic failure | `throw I18N.error('err.fbFailed', { reason });` |

**6.5** Dates follow the language (display only; the stored ISO timestamp is unchanged):

```js
function formatDateTime(isoString) {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(I18N.locale(), { dateStyle: 'medium', timeStyle: 'short' });
}
```

**6.6** Banners:

```js
function showSuccessBanner() {
  resetBanners();
  I18N.setText(dom.uploadSuccessText, 'upload.success');
  dom.uploadSuccess.hidden = false;
}

function showErrorBanner(errOrKey) {          // accepts an Error or a key like ERRORS.UNSUPPORTED_FILE
  resetBanners();
  I18N.setErrorText(dom.uploadErrorText, errOrKey, 'err.invalidExcel');
  dom.uploadError.hidden = false;               // the "❌ " comes from data-i18n-prefix in the HTML
}
```

**6.7** `updateStatsDisplay` — file name is data (detach key), status is now a dictionary key:

```js
function updateStatsDisplay({ fileName, headers, students, lastUpdate, status }) {
  if (fileName !== undefined) {
    if (fileName) I18N.setRaw(dom.statFile, fileName);
    else I18N.setText(dom.statFile, 'stat.noFile');
  }
  if (students !== undefined) dom.statStudents.textContent = students;
  if (headers) {
    dom.statWeeks.textContent = countWeeks(headers);
    dom.statTasks.textContent = countPrefixed(headers, 't');
    dom.statNotes.textContent = countNotes(headers);
  }
  if (lastUpdate !== undefined) { lastUpdateIso = lastUpdate; dom.statUpdated.textContent = formatDateTime(lastUpdate); }
  if (status !== undefined) I18N.setText(dom.statStatus, status);
}
```

Update the callers' `status` values to keys: `'Processing…'` → `'status.processing'`, `'Active'` → `'status.active'`, `'Failed'` → `'status.failed'`, `'No data yet'` → `'status.noData'`, `'Not connected'` → `'status.notConnected'`.

**6.8** `handleFile`:

```js
showErrorBanner(ERRORS.UNSUPPORTED_FILE);        // unchanged — a key is accepted
…
showSuccessBanner();                              // was showSuccessBanner('✅ …')
…
} catch (err) {
  updateStatsDisplay({ status: 'status.failed' });
  showErrorBanner(err);                           // was: (err && err.message) || ERRORS.INVALID_EXCEL
}
```

**6.9** Same text/logo split as student.js: keep logos and org names in `applyBranding`, move the language-dependent lines into `applyBrandText` (use the footer block from 5.3 verbatim, minus the subtitle line, since the admin header has none), plus:

```js
const courseName = I18N.cfgOr('courseName', null) || 'CourseTrack';
dom.headerCourseName.textContent = courseName;
dom.courseLogoPlaceholder.textContent = courseName.trim().charAt(0).toUpperCase();
dom.infoCourseName.textContent = courseName;
dom.infoInstructorName.textContent = I18N.cfgOr('instructorName', null) || '—';
dom.infoVersion.textContent = CONFIG.appVersion || '—';
```

**6.10** `init()` — after `initTheme();`:

```js
I18N.onChange(() => {
  applyBrandText();
  dom.statUpdated.textContent = formatDateTime(lastUpdateIso);   // re-localise the date
});
```

---

## 7. How the four requirements are met

1. **Button** — `#lang-toggle` pill (`EN | عربي`) beside the theme toggle on both pages.
2. **Arabic mode** — `<html lang="ar" dir="rtl">`; static text via `data-i18n*`; JS-generated text (week titles, field labels, fallbacks, every error state, admin steps/status/banners, PDF banner) via keyed helpers, so an open error or open results re-translate **live** without a re-search; flex/grid containers mirror natively under `dir="rtl"`, and each physical `left`/`right` rule in `style.css` is mirrored once in the appended CSS.
3. **Persistence** — `localStorage['coursetrack_lang']`, one key shared by both pages; a `storage` listener also syncs a second open tab.
4. **Data integrity** — the engine only ever writes dictionary text. Anything that comes from Firebase/Excel (names, codes, emails, grades, notes, Excel headers shown as final-result labels) is written with `setAutoText`/`setRaw`, which **remove** the translation key, so no later language switch can replace it. No code path touches `/students.json`, `/meta.json`, column detection or `STORAGE_KEYS`/`REMEMBER_CODE_KEY`.

## 8. Things to know

- **Cell values are not translated.** If your sheet says `Present`/`Absent`, that is what students see in Arabic mode, and the green/red status colouring still keys off the existing English/Arabic keyword lists. Translating data was ruled out by requirement 4.
- Course name / instructor stay as in `config.js` unless you fill the optional `…Ar` fields (section 4).
- Week numbers and grades keep Western digits (they match the sheet); only admin date/time uses `ar-EG` formatting, which renders Arabic-Indic digits.
- The printed Arabic report relies on system fonts (the print iframe doesn't load Cairo); Segoe UI/Tahoma cover Arabic on Windows, macOS and Android.
- Adding a language later = a new block in `DICT`, a value in `SUPPORTED` and `META`, and a button option.

## 9. Test checklist

1. Console, either page — dictionary parity (both lists should be empty):
   ```js
   const { en, ar } = I18N.dict;
   console.log(Object.keys(en).filter(k => !(k in ar)), Object.keys(ar).filter(k => !(k in en)));
   ```
2. Click **عربي**: page mirrors, search icon on the right, timeline rail on the right, arrows flip. Reload: still Arabic. Open `admin.html` from the header link: still Arabic.
3. Search a real code → results show. Click **EN** with results on screen: labels, "Week N" and fallbacks switch; student name/code/email/grades do not change.
4. Search a bad code, switch language: the error title and message switch.
5. Search with the network off: the network error switches language too.
6. Download the PDF in Arabic: RTL layout, Arabic banner/footer, no timeline gutter on the right edge.
7. Admin: upload a file in Arabic; steps, success banner, statistics and the Last Update date are Arabic; the file name shown in "Current File" is unchanged. Upload a `.txt` for the Arabic "unsupported file" banner.
