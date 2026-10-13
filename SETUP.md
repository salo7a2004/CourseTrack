# CourseTrack — One-Time Setup (Firebase Realtime Database)

This project has two pages:

- **index.html** — public Student Portal (search-only, read-only)
- **admin.html** — private Admin Dashboard (upload only, `noindex` — don't link to it from anywhere public)

Both talk straight to your Firebase Realtime Database over its REST API
(plain `fetch`, no SDK, no server of your own).

## How the data is stored

```
/students   <- one record per student, keyed by student code
  SD26-001: { Code: "SD26-001", Name: "...", M1: 1, T1: 9, ... }
  SD26-002: { ... }
/meta       <- { lastUpdate, studentsWritten }  (shown on the Admin dashboard)
```

An Admin upload does a full `PUT` of `/students`, so it **replaces** every
previous record. Student codes containing `. # $ [ ] /` are stored with
those characters changed to `_` in the key only (the original code is
kept inside the record, so searching still works).

## 1. Create the database
1. Firebase console -> your project -> **Build -> Realtime Database -> Create database**.
2. Copy the database root URL, e.g. `https://your-project-default-rtdb.firebaseio.com`.

## 2. Connect config.js
```js
firebase: {
  databaseURL: 'https://your-project-default-rtdb.firebaseio.com', // root only - no /students.json
  databaseSecret: '',  // see "Securing writes" below
},
```

## 3. Securing writes (read this before going live)

Students only ever **read**, but the Admin page has to **write**, and a
static website has nowhere to hide a credential. Everything in
`config.js` is a public file anyone can open. Pick one:

**Option A - recommended for a public site: Firebase Authentication.**
Rules that only let one signed-in admin account write:
```json
{
  "rules": {
    "students": { ".read": true, ".write": "auth != null && auth.token.email === 'you@example.com'" },
    "meta":     { ".read": true, ".write": "auth != null && auth.token.email === 'you@example.com'" }
  }
}
```
This needs a small sign-in step added to `admin.html`/`admin.js`
(email + password, via Firebase's REST sign-in endpoint) - not included
yet. It is the only option here that is genuinely secure when
`admin.html` is on a public URL.

**Option B - works today, no code change: public read, locked writes, and
keep the secret OFF the internet.**
1. Rules:
   ```json
   {
     "rules": {
       "students": { ".read": true, ".write": false },
       "meta":     { ".read": true, ".write": false }
     }
   }
   ```
2. Get a Database Secret (Project settings -> Service accounts -> Database
   secrets). Google treats these as legacy, so newer projects may not
   offer one - use Option A then.
3. Put the secret in `databaseSecret` **only in a copy of `config.js` on
   your own computer**, and run uploads by opening your local
   `admin.html` from disk. Deploy the version of `config.js` with
   `databaseSecret: ''`.
4. **Never** commit the secret to a public GitHub repo or publish it:
   it is a full-admin credential that bypasses every rule, and anyone
   who finds it can read, change, or delete the entire database.

**Do not** use open write rules (`".write": true`) on a live site: the
database URL is public in `config.js`, so anyone could overwrite or wipe
every student record with a single request.

## 4. Upload your first Excel file
Open `admin.html`, drop in your `.xlsx`, and watch the steps:
Uploading -> Reading -> Processing -> Syncing to Firebase -> Finished. Then
open `index.html` and search a student code - no redeploy needed.

## 5. Admin passcode gate (admin.html)

`admin.html` now opens on a passcode screen. The dashboard is hidden (and
inert) in the page's own markup, and nothing that touches Firebase or the
Excel upload starts until the passcode is accepted. Once accepted, the
admin stays signed in until that browser tab is closed (`sessionStorage`),
or until they press the Sign out button in the header.

**Set it up**
1. On your own computer, open `make-admin-passcode.html` in a browser (it
   runs fully offline; you don't need to deploy it).
2. Choose a long passphrase (12+ characters, ideally 4+ random words), click
   *Generate hash*, and paste the resulting line into `config.js`, replacing
   `adminPasscodeHash: '',`.
3. Deploy `config.js`. Until a hash is set, `admin.html` stays locked and says
   the passcode is not configured.

`config.js` stores only a salted PBKDF2 hash, never the passcode. To change
the passcode, generate a new line and replace it; every existing session is
signed out automatically. If you forget the passcode, just generate a new one.

**Behaviour**
- 5 wrong attempts lock the form for 30 s; each further lockout doubles
  (up to 15 min). A page reload does not reset it.
- It needs a secure context for hashing: HTTPS, `localhost`, or a local file.
- Lower-priority fallbacks exist for compatibility — `adminPasscode` (plain
  text) and, last of all, `firebase.databaseSecret` — but both put the
  passcode in a public file in readable form. Don't use them for a live site.

**What this gate is — and is not**

It keeps students and casual visitors out of the admin screen. It is **not**
access control, and it cannot be, because everything it relies on runs in the
visitor's browser:

- `config.js` and `admin.js` are public files. Anyone can read the hash and
  try to guess the passcode offline (a long passphrase is the only defence),
  or open DevTools and remove the overlay or edit `sessionStorage`.
- It does nothing to the database itself. Anyone who knows your
  `databaseURL` can send requests to Firebase directly, with or without ever
  loading `admin.html`.

What actually protects your data is the Firebase rules from section 3, with
writes locked (`".write": false`, or Option A's signed-in-admin rule). Treat
the passcode gate as a convenience on top of that, not a replacement. In
particular, never deploy a real `databaseSecret` in `config.js`: it is a
full-admin credential and the gate cannot hide it.

## Privacy note
With public read on `/students`, the Student Portal downloads every
record and filters in the browser, so anyone who opens
`https://<your-project>.firebaseio.com/students.json` directly can see
all names, emails and grades - not just their own. (The old Google Sheets
bridge behaved the same way.) If that matters, the fix is to allow reads
only on individual records (rules `"students": { "$code": { ".read": true } }`)
and look students up by key instead of fetching the whole list.

## Notes
- The old Google Apps Script bridge is gone - `google-apps-script.gs`
  is no longer used and has been removed from the project; you can also
  delete the Apps Script deployment in your Google account.
- Requests time out after 15 s (student) / 30 s (admin) so a stalled
  connection ends in an error message instead of an endless spinner.
