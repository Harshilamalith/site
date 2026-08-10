# ClearPHYSICS — LMS Upgrade

## What's in here

```
apps-script/
  Code.gs           ← the whole backend (paste into Apps Script)
  SETUP_GUIDE.md     ← do this once, step by step
site/
  index.html         ← student-facing site (updated)
  styles.css         ← updated with new LMS + admin styles
  script.js          ← updated: talks to the backend instead of hardcoded content
  admin.html          ← NEW: teacher admin dashboard
  admin.js            ← NEW: admin dashboard logic
```

## Start here

Read **`apps-script/SETUP_GUIDE.md`** first — it walks through creating the
Google Sheet, pasting in `Code.gs`, deploying it as a Web App, and where to
paste the resulting URL (`API_URL`) into `script.js` and `admin.js`. That's
the only "technical" step; everything after that is point-and-click.

## How each requirement was covered

1. **Responsive UI** — kept your existing responsive breakpoints and glass
   design system; new sections (months, content cards, admin dashboard)
   reuse the same responsive grid patterns, so they resize the same way.

2. **Courses & admin course management** — Courses live in the `Courses`
   Sheet tab, managed from Admin → Courses (add, and "hide" which is a
   soft delete — reversible by flipping `active` back to `TRUE` in the
   Sheet). Tile images upload straight from the dashboard into Drive.

3. **Months** — same pattern as courses, one level down (Admin → Months,
   scoped to a course). Students pick a course at registration, then pick
   a month from a tile grid.

4. **Content uploads (PDF / Live / Recording)** — Admin → Content: pick a
   course + month + type, add a title/link (or upload a PDF directly —
   it's stored in Drive and the link is filled in automatically). Cards
   render with distinct icons/labels for each type on the student side.

5. **Payment slip approval & lifetime access** — Student uploads a slip
   (image or PDF) from the locked month view → lands in Admin → Payments
   as "pending" → Accept/Reject. Accepting writes a row to the `Access`
   sheet (`status: active`), which is what actually unlocks that month —
   permanently, on any device, forever, until revoked.

6. **Blocking / revoking** — Admin → Students has a Block/Unblock button
   (blocked students can't sign in at all). Admin → Payments has a
   "Revoke Access" button per accepted payment (removes access to just
   that one month, without touching their account).

7. **No-code admin** — everything above is buttons and forms in
   `admin.html`. The only code either of us touches after setup is if you
   want new features later.

## Known simplifications (good next steps, not blockers)

- **Session refresh**: sign-in uses a fresh Google ID token verified on
  the server for every action. On page reload it tries a silent
  "One Tap" re-sign-in automatically; if that's ever blocked by the
  browser, a student just clicks "Log In Now" again — no data is lost.
- **Course delete / month delete** are soft deletes (hidden, not
  destroyed) on purpose, so a misclick can't wipe payment history.
- **Design match to your reference screenshots**: content cards are
  styled to fit your existing blue/green glass theme with matching
  icons/labels per type, rather than being a pixel-for-pixel copy of the
  reference app's screenshots (different app, different design system).
  Happy to tighten this further if you send exact colors/spacing you
  want matched.
- I did **not** wire up the old Google Apps Script URL from your
  original `script.js` — that one only handled the contact-style
  "delete" case. Everything now goes through the new `Code.gs`.

## Testing checklist

- [ ] Run `setupSheets` once in the Apps Script editor
- [ ] Deploy as Web App, paste URL into `script.js` and `admin.js`
- [ ] Sign in on `admin.html` with one of your 3 teacher emails
- [ ] Add a course, a month under it, and one of each content type
- [ ] Sign in on `index.html` as a student, register, pick that course/month
- [ ] Upload a test payment slip
- [ ] Go back to admin, accept it, confirm the student's month unlocks
- [ ] Try Block on that student, confirm they're signed out / can't sign in
- [ ] Try Revoke Access, confirm content locks again for that month
