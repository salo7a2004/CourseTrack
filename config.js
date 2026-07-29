/* =====================================================================
   COURSETRACK — SITE CONFIGURATION
   -----------------------------------------------------------------------
   Everything an instructor/administrator needs to rebrand this portal
   lives in this ONE object. Change values here — never inside
   index.html, style.css or script.js — to update:
     • Course name / instructor name (default values; editable in-app too)
     • Primary & partner organization names, taglines and logos
     • Primary / secondary brand colors
     • Default theme (light or dark)
     • Footer text
     • App version shown in the Course Information card

   To replace a logo later, either:
     a) point the path below at a new image file, or
     b) overwrite the existing file at that same path.
   No HTML or JavaScript changes are required either way.
   ===================================================================== */

window.APP_CONFIG = {
  // ---- Identity -------------------------------------------------------
  courseName: 'Engineering Fundamentals Program',
  instructorName: 'Add instructor name',
  appVersion: 'v3.0.0',

  // ---- Theme ------------------------------------------------------------
  // 'light' or 'dark'. Light Mode is the required default; visitors can
  // still switch to Dark Mode and their choice is remembered.
  theme: 'light',

  // ---- Brand colors -----------------------------------------------------
  // Applied at runtime as CSS custom properties — change these two lines
  // to re-theme the entire interface.
  colors: {
    primary: '#2F54EB',   // Royal Blue
    secondary: '#8FC7FF', // Baby Blue
  },

  // ---- Logos --------------------------------------------------------
  // Set `course` to a file path (e.g. 'assets/course-logo.png') to replace
  // the built-in mark. Leave it null to keep the default vector logo.
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
};
