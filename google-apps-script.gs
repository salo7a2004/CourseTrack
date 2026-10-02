/**
 * =====================================================================
 * COURSETRACK — GOOGLE SHEETS BRIDGE
 * -----------------------------------------------------------------------
 * This file does NOT belong in your website's folder. Paste it into the
 * Apps Script editor that is attached to the Google Sheet you want to
 * use as the single source of truth for course data.
 *
 * SETUP
 *   1. Open (or create) a Google Sheet.
 *   2. Extensions → Apps Script.
 *   3. Delete any starter code, paste this whole file in.
 *   4. Change ADMIN_TOKEN below to your own secret string — anything
 *      long and hard to guess. This must exactly match
 *      config.js → sheetsApi.adminToken.
 *   5. Click Deploy → New deployment.
 *        Type: Web app
 *        Execute as: Me
 *        Who has access: Anyone
 *   6. Click Deploy, authorize the permissions Google asks for, then
 *      copy the "Web app URL" it gives you.
 *   7. Paste that URL into config.js → sheetsApi.endpoint.
 *
 * WHAT IT DOES
 *   • GET  (used by the Student Portal): returns the current sheet's
 *     header row + data rows as JSON, plus the last-write timestamp.
 *   • POST (used by the Admin Dashboard only): replaces the sheet's
 *     contents with a new header row + data rows, after checking the
 *     request includes the correct ADMIN_TOKEN.
 *
 * SECURITY NOTE
 *   ADMIN_TOKEN is a simple shared secret, not real authentication —
 *   anyone who reads admin.js's source can see it. That's an inherent
 *   limit of a purely static site with no server of your own. It stops
 *   casual/accidental writes, not a determined attacker. For stronger
 *   protection, change "Who has access" to "Only myself" and always
 *   upload while logged into the Google account that owns the sheet —
 *   the admin page will then only work for you.
 * =====================================================================
 */

const SHEET_NAME = 'CourseData';
const ADMIN_TOKEN = 'REPLACE_WITH_YOUR_OWN_SECRET_TOKEN';

/** Reads the current data. Called by the Student Portal on every search. */
function doGet(e) {
  const sheet = getOrCreateSheet_();
  const values = sheet.getDataRange().getValues();
  const headers = values.length ? values[0] : [];
  const rows = values.length > 1 ? values.slice(1) : [];

  return jsonResponse_({
    success: true,
    headers,
    rows,
    lastUpdate: getLastUpdate_(),
  });
}

/** Replaces the sheet's contents. Called only by the Admin Dashboard. */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (body.token !== ADMIN_TOKEN) {
      return jsonResponse_({ success: false, error: 'Unauthorized: token did not match.' });
    }

    const headers = Array.isArray(body.headers) ? body.headers : [];
    const rows = Array.isArray(body.rows) ? body.rows : [];

    if (!headers.length) {
      return jsonResponse_({ success: false, error: 'No headers supplied — nothing to write.' });
    }

    // Defense in depth: admin.js already sends rectangular rows, but
    // normalize again here so a malformed payload from any client can
    // never crash setValues() with a "range width" error.
    const normalizedRows = rows.map((row) => {
      const copy = row.slice(0, headers.length);
      while (copy.length < headers.length) copy.push('');
      return copy;
    });

    const sheet = getOrCreateSheet_();
    sheet.clearContents();

    const grid = [headers, ...normalizedRows];
    sheet.getRange(1, 1, grid.length, headers.length).setValues(grid);

    const now = new Date().toISOString();
    setLastUpdate_(now);

    return jsonResponse_({ success: true, lastUpdate: now, studentsWritten: rows.length });
  } catch (err) {
    return jsonResponse_({ success: false, error: String(err) });
  }
}

function getOrCreateSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  return sheet;
}

function getLastUpdate_() {
  return PropertiesService.getScriptProperties().getProperty('lastUpdate') || null;
}

function setLastUpdate_(iso) {
  PropertiesService.getScriptProperties().setProperty('lastUpdate', iso);
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
