/* =====================================================================
   COURSETRACK — SITE CONFIGURATION
   -----------------------------------------------------------------------
   The ONE file to edit for branding and data-source settings. Neither
   index.html, admin.html, style.css, student.js nor admin.js should ever
   need to change when you rebrand the portal or point it at a new
   Google Sheet — everything flows from here.
   ===================================================================== */

window.APP_CONFIG = {
  // ---- Identity (shown to students; NOT editable from either page) ----
  courseName: 'Engineering Fundamentals Program',
  courseSubtitle: 'Student Portal',
  instructorName: 'Add instructor name',
  appVersion: 'v5.0.0',

  // ---- Theme ------------------------------------------------------------
  // Light Mode is always the default regardless of this value or the
  // visitor's OS setting; Dark Mode remains available via the toggle.
  theme: 'light',

  // ---- Brand colors -----------------------------------------------------
  colors: {
    primary: '#2F54EB',   // Royal Blue
    secondary: '#8FC7FF', // Baby Blue
  },

  // ---- Logos --------------------------------------------------------
  // Set `course` to a file path (e.g. 'assets/course-logo.png') to replace
  // the default letter badge. Leave any of these null/empty and a clean
  // text placeholder is shown instead — never a broken image icon.
  logos: {
    course: null,
    primaryOrg: 'assets/logo-9d.png',
    partnerOrg: 'assets/logo-engx.png',
  },

  // ---- Organizations ------------------------------------------------------
  organizations: {
    primary: { name: '9D', tagline: 'Design Develop Dominant' },
    partner: { name: 'ENGX', tagline: 'Engineering Training' },
  },

  // ---- Footer -----------------------------------------------------------
  footerText: {
    poweredBy: 'Powered by 9D',
    collaboration: 'In Collaboration With ENGX',
    developedBy: 'Developed by Salah Hossam',
  },

  // ---- Google Sheets bridge -----------------------------------------------
  // This is what makes Google Sheets the single source of truth:
  //   • student.js sends GET requests here to read the live data.
  //   • admin.js sends POST requests here to overwrite it after an upload.
  // Both requests hit the same Google Apps Script Web App URL — see
  // google-apps-script.gs and SETUP.md for the one-time setup.
  sheetsApi: {
    endpoint: "https://script.google.com/macros/s/AKfycbz_7GJPPFj867kKnldLJZ22vqk7uJ2YE3pvEHT5OXqy_8Zaf0HkYljpVmB-GG3kcsA2/exec",
    adminToken: "SolidWorks2026@9DENGX"
}
};
