/* =====================================================================
   COURSETRACK — SITE CONFIGURATION
   -----------------------------------------------------------------------
   The ONE file to edit for branding and data-source settings. Neither
   index.html, admin.html, style.css, student.js nor admin.js should ever
   need to change when you rebrand the portal or point it at a new
   Firebase project — everything flows from here.
   ===================================================================== */

window.APP_CONFIG = {
  // ---- Identity (shown to students; NOT editable from either page) ----
  courseName: 'Engineering Fundamentals Program',
  courseSubtitle: 'Student Portal',
  instructorName: 'Add instructor name',
  appVersion: 'v6.0.0',

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

  // ---- Firebase Realtime Database ----------------------------------------
  // This is what makes Firebase the single source of truth:
  //   • student.js sends GET requests to  {databaseURL}/students.json
  //   • admin.js   sends PUT requests to  {databaseURL}/students.json
  //     (a full overwrite — exactly what a fresh Excel upload should do)
  //     plus {databaseURL}/meta.json for the Last Update timestamp the
  //     Admin Dashboard's Statistics panel shows.
  // databaseURL is the project ROOT — no trailing slash, no /students.json
  // on the end. Both paths above are built from it in code, so this is
  // the only place a Firebase project ever needs to be configured.
  firebase: {
    databaseURL: 'https://d-scholarship-default-rtdb.firebaseio.com',
    // ADMIN-ONLY and OPTIONAL — read by admin.js, never by student.js.
    // WARNING: this file is a public static file, so anything placed
    // here is downloadable by anyone who opens it, and a Firebase
    // Database Secret is a FULL-ADMIN credential that bypasses every
    // database rule. Do NOT commit a real secret to a public GitHub repo
    // or publish it on a public site. Prefer leaving this blank and
    // using the safer options explained in SETUP.md ("Securing writes").
    databaseSecret: '',
  },
};
