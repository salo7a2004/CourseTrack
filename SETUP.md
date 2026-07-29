# CourseTrack — One-Time Setup

This project has two pages:

- **index.html** — public Student Portal (search-only, read-only)
- **admin.html** — private Admin Dashboard (upload only, `noindex` — don't link to it from anywhere public)

Both pages read/write a single Google Sheet through a small bridge script
that Google hosts for you for free. You never run or maintain a server.

## 1. Create the Google Sheet
Create a new, blank Google Sheet. You don't need to add any columns —
the bridge script creates its own tab automatically on first upload.

## 2. Add the bridge script
1. In the Sheet, open **Extensions → Apps Script**.
2. Delete the placeholder code and paste in the entire contents of
   `google-apps-script.gs` (included in this project).
3. Near the top, change:
   ```js
   const ADMIN_TOKEN = 'REPLACE_WITH_YOUR_OWN_SECRET_TOKEN';
   ```
   to any long, hard-to-guess string of your own.

## 3. Deploy it as a Web App
1. Click **Deploy → New deployment**.
2. Type: **Web app**.
3. Execute as: **Me**.
4. Who has access: **Anyone**.
5. Click **Deploy**, then approve the permissions Google asks for.
6. Copy the **Web app URL** it gives you (ends in `/exec`).

## 4. Connect config.js
Open `config.js` and fill in the two values under `sheetsApi`:

```js
sheetsApi: {
  endpoint: 'PASTE_YOUR_WEB_APP_URL_HERE',
  adminToken: 'THE_SAME_SECRET_YOU_SET_IN_STEP_2',
},
```

Both `index.html` (via `student.js`) and `admin.html` (via `admin.js`)
read this same file — nothing else needs to change.

## 5. Upload your first Excel file
Open `admin.html`, drag in your `.xlsx` file, and watch the step
indicator: Uploading → Reading → Processing → Syncing → Finished. Once
it says **Active**, open `index.html` and search any student code from
that file — no redeploy, no republish, just refresh.

## Notes
- **Security**: `ADMIN_TOKEN` is a shared secret, not real login
  authentication — anyone who reads `admin.js`'s source could see it.
  This is an inherent limit of a purely static site with no server of
  its own. For stronger protection, set "Who has access" to **Only
  myself** in step 3, and only open `admin.html` while signed into the
  Google account that owns the Sheet.
- **Re-deploying the script**: if you edit `google-apps-script.gs` later,
  choose **Deploy → Manage deployments → Edit → New version** so the
  same URL picks up your changes.
- Keep `admin.html` unlinked from any public navigation — it's only
  reachable by whoever has the direct URL.
