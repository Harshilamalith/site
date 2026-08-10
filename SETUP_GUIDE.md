# ClearPHYSICS LMS — One-Time Setup Guide

You only need to do this once. After this, everything (adding courses,
months, content, approving payments, blocking students) is done through
the Admin Dashboard in your browser — no code.

## Step 1 — Create the Google Sheet (your database)

1. Go to [sheets.google.com](https://sheets.google.com) and create a new,
   blank spreadsheet.
2. Rename it something like **"ClearPHYSICS LMS Database"**.
3. Keep this tab open — you'll come back to it.

## Step 2 — Attach the backend script

1. In the Sheet, click **Extensions → Apps Script**.
2. Delete anything in the `Code.gs` editor that opens, and paste in the
   entire contents of the `Code.gs` file provided to you.
3. At the top of the file, check/edit:
   - `ADMIN_EMAILS` — the Google accounts allowed to use the admin
     dashboard. Yours are already filled in:
     `teacher1@gmail.com, teacher2@gmail.com, teacher3@gmail.com`
   - `GOOGLE_CLIENT_ID` — should already match the one used on your site.
     If you ever create a new OAuth Client ID in Google Cloud Console,
     update it here too, and in `script.js` / `admin.js`.
4. Click the **Save** icon (💾).
5. In the function dropdown at the top (next to the "Debug" button),
   select **setupSheets**, then click **Run** (▶️).
   - The first time, Google will ask you to authorize the script —
     click through "Advanced → Go to (project name)" — this is normal
     for scripts you write yourself.
6. Go back to your Sheet tab and refresh. You should now see new tabs:
   `Students`, `Courses`, `Months`, `Content`, `Payments`, `Access`.
   **Do not rename these tabs or their header rows** — the script relies
   on the exact names.

## Step 3 — Deploy it as a Web App

1. Back in the Apps Script editor, click **Deploy → New deployment**.
2. Click the gear icon ⚙️ next to "Select type" and choose **Web app**.
3. Fill in:
   - Description: `LMS API v1`
   - Execute as: **Me** (your account)
   - Who has access: **Anyone**
4. Click **Deploy**. Approve any permission prompts.
5. Copy the **Web app URL** it gives you — it looks like:
   `https://script.google.com/macros/s/AKfycb.../exec`
6. Paste that URL into `script.js` and `admin.js` where you see
   `const API_URL = "PASTE_YOUR_WEB_APP_URL_HERE";`

> **Whenever you edit `Code.gs` in the future** (e.g. if I send you an
> updated version), you must click **Deploy → Manage deployments →
> ✏️ Edit → New version → Deploy** for the changes to go live. Just
> saving the file is not enough.

## Step 4 — Google Sign-In client ID (only if you don't already have one)

Your site already references a `GOOGLE_CLIENT_ID` in `script.js`. If you
ever need a new one:

1. Go to [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials).
2. Create an OAuth 2.0 Client ID → Application type: **Web application**.
3. Under "Authorized JavaScript origins", add the exact URL(s) your site
   is hosted at (e.g. `https://yourdomain.com`).
4. Copy the Client ID into `script.js`, `admin.js`, and `Code.gs`
   (`GOOGLE_CLIENT_ID`).

## Step 5 — Upload the site files

Upload `index.html`, `styles.css`, `script.js`, `admin.html`, and
`admin.js` to wherever your site is hosted (same folder, same as now).

## Step 6 — Try it out

1. Open your site, sign in with a **non-admin** Google account, and walk
   through registering, picking a course/month, and uploading a test
   payment slip.
2. Open `yoursite.com/admin.html` and sign in with one of the
   `ADMIN_EMAILS` accounts. You should see the dashboard with tabs for
   Students, Courses, Months, Content, and Payments.
3. Use the dashboard to add your first course (e.g. "2027 AL"), add a
   month under it (e.g. "April"), add some content (PDF/live link/
   recording), then go approve the test payment slip from Step 1 and
   confirm the content unlocks for that student.

## Notes on the data (all stored in your Sheet + Drive)

- **Files** (payment slips, PDFs, tile images) are saved into a Drive
  folder called **"ClearPHYSICS LMS Files"** (with subfolders), shared
  as "anyone with the link can view" so students can open them.
- **"Delete" for courses/months** is a *soft delete* — it hides them
  from students immediately but keeps the underlying data (so nothing
  is destroyed by accident). You can see everything by looking directly
  at the Sheet.
- **Lifetime access** lives in the `Access` tab — one row per
  student+course+month with `status = active`. Revoking sets it to
  `revoked`; the student instantly loses access next time they load
  that month.
- Free/Google account quotas comfortably cover a single tuition class's
  traffic. If you ever outgrow Apps Script (very large numbers of
  concurrent students), the same data model can move to Firebase later.
