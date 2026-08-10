/**
 * ClearPHYSICS LMS — Backend (Google Apps Script)
 * ------------------------------------------------
 * This script turns a Google Sheet + Google Drive into the database and
 * file store for the site. Deploy it as a Web App (see SETUP_GUIDE.md).
 *
 * All requests are POSTed as JSON: { action: "...", payload: {...} }
 * All responses are JSON: { ok: true, data: ... } or { ok: false, error: "..." }
 */

/** ========================= CONFIG ========================= */

// Admins: only these Google accounts can use admin actions.
const ADMIN_EMAILS = [
  'teacher1@gmail.com',
  'teacher2@gmail.com',
  'teacher3@gmail.com'
];

// Must match the client_id used by Google Identity Services on the site.
const GOOGLE_CLIENT_ID = '10419694413-b1qvphvc74os0js4t5ectsrhf076mqtg.apps.googleusercontent.com';

const DRIVE_FOLDERS = {
  ROOT: 'ClearPHYSICS LMS Files',
  SLIPS: 'Payment Slips',
  CONTENT: 'Course Content (PDFs)',
  TILES: 'Tile Images'
};

const SHEETS = {
  STUDENTS: 'Students',
  COURSES: 'Courses',
  MONTHS: 'Months',
  CONTENT: 'Content',
  PAYMENTS: 'Payments',
  ACCESS: 'Access'
};

const HEADERS = {
  Students: ['email', 'name', 'picture', 'fullName', 'whatsapp', 'contact', 'parentName',
    'parentContact', 'school', 'stream', 'courseId', 'blocked', 'createdAt', 'updatedAt'],
  Courses: ['id', 'name', 'description', 'tileImageUrl', 'order', 'active', 'createdAt'],
  Months: ['id', 'courseId', 'name', 'price', 'description', 'order', 'active', 'createdAt'],
  Content: ['id', 'courseId', 'monthId', 'type', 'title', 'url', 'meta', 'order', 'createdAt'],
  Payments: ['id', 'studentEmail', 'courseId', 'monthId', 'slipUrl', 'status', 'note',
    'submittedAt', 'reviewedAt', 'reviewedBy'],
  Access: ['studentEmail', 'courseId', 'monthId', 'status', 'grantedAt', 'revokedAt']
};

/** ========================= ENTRY POINTS ========================= */

function doGet(e) {
  return jsonOut_({ ok: true, data: 'ClearPHYSICS LMS API is running.' });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ ok: false, error: 'Invalid JSON body.' });
  }

  const action = body.action;
  const payload = body.payload || {};

  try {
    const handler = ROUTES[action];
    if (!handler) throw new Error('Unknown action: ' + action);
    const data = handler(payload);
    return jsonOut_({ ok: true, data: data });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err.message || err) });
  }
}

const ROUTES = {
  ping: () => 'pong',

  // ---- Student-facing ----
  registerStudent: registerStudent,
  getMyProfile: getMyProfile,
  deleteMyData: deleteMyData,
  getPublicCourses: getPublicCourses,
  getMonths: getMonthsForStudent,
  getMyAccess: getMyAccess,
  getMonthContent: getMonthContent,
  submitPaymentSlip: submitPaymentSlip,
  getMyPayments: getMyPayments,

  // ---- Admin ----
  adminListStudents: adminListStudents,
  adminSetStudentBlocked: adminSetStudentBlocked,

  adminListCourses: adminListCourses,
  adminAddCourse: adminAddCourse,
  adminUpdateCourse: adminUpdateCourse,
  adminDeleteCourse: adminDeleteCourse,

  adminListMonths: adminListMonths,
  adminAddMonth: adminAddMonth,
  adminUpdateMonth: adminUpdateMonth,
  adminDeleteMonth: adminDeleteMonth,

  adminListContent: adminListContent,
  adminAddContent: adminAddContent,
  adminUpdateContent: adminUpdateContent,
  adminDeleteContent: adminDeleteContent,

  adminUploadFile: adminUploadFile,

  adminListPayments: adminListPayments,
  adminReviewPayment: adminReviewPayment,
  adminGrantAccess: adminGrantAccess,
  adminRevokeAccess: adminRevokeAccess
};

/** ========================= AUTH HELPERS ========================= */

// Verifies a Google Identity Services credential (ID token) server-side.
// Never trust an email the client just hands you — always verify the token.
function verifyGoogleToken_(idToken) {
  if (!idToken) throw new Error('Missing Google sign-in token.');
  const resp = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if (resp.getResponseCode() !== 200) throw new Error('Google sign-in token is invalid or expired.');
  const info = JSON.parse(resp.getContentText());
  if (info.aud !== GOOGLE_CLIENT_ID) throw new Error('Token was not issued for this site.');
  return { email: String(info.email).toLowerCase(), name: info.name || '', picture: info.picture || '' };
}

function requireStudent_(payload) {
  const user = verifyGoogleToken_(payload.idToken);
  const student = findStudentByEmail_(user.email);
  if (student && String(student.blocked).toUpperCase() === 'TRUE') {
    throw new Error('Your access has been blocked. Please contact your teacher.');
  }
  return user;
}

function requireAdmin_(payload) {
  const user = verifyGoogleToken_(payload.adminIdToken || payload.idToken);
  if (ADMIN_EMAILS.indexOf(user.email) === -1) {
    throw new Error('You are not authorized to perform this action.');
  }
  return user;
}

/** ========================= SHEET HELPERS ========================= */

function getSS_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet_(name) {
  const ss = getSS_();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(HEADERS[name]);
  }
  return sheet;
}

function rowsToObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row.join('') === '') continue;
    const obj = { _row: i + 1 }; // 1-based sheet row number, for updates
    headers.forEach((h, idx) => { obj[h] = row[idx]; });
    out.push(obj);
  }
  return out;
}

function appendObject_(sheet, obj) {
  const headers = HEADERS[sheet.getName()];
  const row = headers.map((h) => (obj[h] !== undefined ? obj[h] : ''));
  sheet.appendRow(row);
}

function updateRowByField_(sheetName, matchField, matchValue, updates) {
  const sheet = getSheet_(sheetName);
  const headers = HEADERS[sheetName];
  const matchCol = headers.indexOf(matchField) + 1;
  if (matchCol === 0) throw new Error('Bad field: ' + matchField);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][matchCol - 1]) === String(matchValue)) {
      Object.keys(updates).forEach((key) => {
        const col = headers.indexOf(key) + 1;
        if (col > 0) sheet.getRange(i + 1, col).setValue(updates[key]);
      });
      return true;
    }
  }
  return false;
}

function newId_() {
  return Utilities.getUuid();
}

function nowIso_() {
  return new Date().toISOString();
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** ========================= DRIVE HELPERS ========================= */

function getOrCreateFolder_(name, parent) {
  const parentFolder = parent || DriveApp.getRootFolder();
  const it = parentFolder.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parentFolder.createFolder(name);
}

function getLmsFolder_(sub) {
  const root = getOrCreateFolder_(DRIVE_FOLDERS.ROOT);
  return getOrCreateFolder_(sub, root);
}

// Saves a base64 file into a Drive folder, makes it viewable by anyone
// with the link, and returns a direct URL.
function saveBase64File_(folder, base64Data, fileName, mimeType) {
  const cleaned = base64Data.indexOf(',') > -1 ? base64Data.split(',')[1] : base64Data;
  const bytes = Utilities.base64Decode(cleaned);
  const blob = Utilities.newBlob(bytes, mimeType || 'application/octet-stream', fileName || 'file');
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return {
    id: file.getId(),
    url: 'https://drive.google.com/file/d/' + file.getId() + '/view',
    downloadUrl: 'https://drive.google.com/uc?export=download&id=' + file.getId()
  };
}

/** ========================= STUDENTS ========================= */

function findStudentByEmail_(email) {
  const rows = rowsToObjects_(getSheet_(SHEETS.STUDENTS));
  return rows.find((r) => String(r.email).toLowerCase() === String(email).toLowerCase()) || null;
}

function registerStudent(payload) {
  const user = verifyGoogleToken_(payload.idToken);
  const existing = findStudentByEmail_(user.email);

  const record = {
    email: user.email,
    name: user.name,
    picture: user.picture,
    fullName: payload.fullName || '',
    whatsapp: payload.whatsapp || '',
    contact: payload.contact || '',
    parentName: payload.parentName || '',
    parentContact: payload.parentContact || '',
    school: payload.school || '',
    stream: payload.stream || '',
    courseId: payload.courseId || '',
    blocked: existing ? existing.blocked : false,
    createdAt: existing ? existing.createdAt : nowIso_(),
    updatedAt: nowIso_()
  };

  if (existing) {
    updateRowByField_(SHEETS.STUDENTS, 'email', user.email, record);
  } else {
    appendObject_(getSheet_(SHEETS.STUDENTS), record);
  }
  return record;
}

function getMyProfile(payload) {
  const user = requireStudent_(payload);
  return findStudentByEmail_(user.email);
}

function deleteRowsByField_(sheetName, field, value) {
  const sheet = getSheet_(sheetName);
  const headers = HEADERS[sheetName];
  const col = headers.indexOf(field);
  if (col === -1) return;
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][col]).toLowerCase() === String(value).toLowerCase()) {
      sheet.deleteRow(i + 1);
    }
  }
}

// Student self-service "Clear All My Data": removes their registration,
// payment history, and granted access. Course/month/content data is
// untouched. This is permanent.
function deleteMyData(payload) {
  const user = requireStudent_(payload);
  deleteRowsByField_(SHEETS.STUDENTS, 'email', user.email);
  deleteRowsByField_(SHEETS.PAYMENTS, 'studentEmail', user.email);
  deleteRowsByField_(SHEETS.ACCESS, 'studentEmail', user.email);
  return { email: user.email, deleted: true };
}

function adminListStudents(payload) {
  requireAdmin_(payload);
  return rowsToObjects_(getSheet_(SHEETS.STUDENTS));
}

function adminSetStudentBlocked(payload) {
  requireAdmin_(payload);
  updateRowByField_(SHEETS.STUDENTS, 'email', payload.email, {
    blocked: !!payload.blocked,
    updatedAt: nowIso_()
  });
  return { email: payload.email, blocked: !!payload.blocked };
}

/** ========================= COURSES ========================= */

function getPublicCourses() {
  return rowsToObjects_(getSheet_(SHEETS.COURSES))
    .filter((c) => String(c.active).toUpperCase() !== 'FALSE')
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}

function adminListCourses(payload) {
  requireAdmin_(payload);
  return rowsToObjects_(getSheet_(SHEETS.COURSES))
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}

function adminAddCourse(payload) {
  requireAdmin_(payload);
  const record = {
    id: newId_(),
    name: payload.name || 'Untitled Course',
    description: payload.description || '',
    tileImageUrl: payload.tileImageUrl || '',
    order: payload.order || 0,
    active: true,
    createdAt: nowIso_()
  };
  appendObject_(getSheet_(SHEETS.COURSES), record);
  return record;
}

function adminUpdateCourse(payload) {
  requireAdmin_(payload);
  updateRowByField_(SHEETS.COURSES, 'id', payload.id, payload.fields || {});
  return { id: payload.id };
}

// Soft delete: hides the course from students but keeps months/content/
// payment history intact so nothing is silently destroyed.
function adminDeleteCourse(payload) {
  requireAdmin_(payload);
  updateRowByField_(SHEETS.COURSES, 'id', payload.id, { active: false });
  return { id: payload.id };
}

/** ========================= MONTHS ========================= */

function getMonthsForStudent(payload) {
  requireStudent_(payload);
  return rowsToObjects_(getSheet_(SHEETS.MONTHS))
    .filter((m) => String(m.courseId) === String(payload.courseId) &&
      String(m.active).toUpperCase() !== 'FALSE')
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}

function adminListMonths(payload) {
  requireAdmin_(payload);
  return rowsToObjects_(getSheet_(SHEETS.MONTHS))
    .filter((m) => !payload.courseId || String(m.courseId) === String(payload.courseId))
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}

function adminAddMonth(payload) {
  requireAdmin_(payload);
  const record = {
    id: newId_(),
    courseId: payload.courseId,
    name: payload.name || 'Untitled Month',
    price: payload.price || 0,
    description: payload.description || '',
    order: payload.order || 0,
    active: true,
    createdAt: nowIso_()
  };
  appendObject_(getSheet_(SHEETS.MONTHS), record);
  return record;
}

function adminUpdateMonth(payload) {
  requireAdmin_(payload);
  updateRowByField_(SHEETS.MONTHS, 'id', payload.id, payload.fields || {});
  return { id: payload.id };
}

function adminDeleteMonth(payload) {
  requireAdmin_(payload);
  updateRowByField_(SHEETS.MONTHS, 'id', payload.id, { active: false });
  return { id: payload.id };
}

/** ========================= CONTENT ========================= */

function hasActiveAccess_(email, courseId, monthId) {
  const rows = rowsToObjects_(getSheet_(SHEETS.ACCESS));
  return rows.some((r) => String(r.studentEmail).toLowerCase() === String(email).toLowerCase() &&
    String(r.courseId) === String(courseId) &&
    String(r.monthId) === String(monthId) &&
    String(r.status) === 'active');
}

function getMonthContent(payload) {
  const user = requireStudent_(payload);
  const unlocked = hasActiveAccess_(user.email, payload.courseId, payload.monthId);

  if (!unlocked) {
    const payments = rowsToObjects_(getSheet_(SHEETS.PAYMENTS))
      .filter((p) => String(p.studentEmail).toLowerCase() === user.email &&
        String(p.courseId) === String(payload.courseId) &&
        String(p.monthId) === String(payload.monthId))
      .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    return { locked: true, latestPayment: payments[0] || null };
  }

  const content = rowsToObjects_(getSheet_(SHEETS.CONTENT))
    .filter((c) => String(c.courseId) === String(payload.courseId) &&
      String(c.monthId) === String(payload.monthId))
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

  return { locked: false, content: content };
}

function adminListContent(payload) {
  requireAdmin_(payload);
  return rowsToObjects_(getSheet_(SHEETS.CONTENT))
    .filter((c) => String(c.courseId) === String(payload.courseId) &&
      String(c.monthId) === String(payload.monthId))
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}

// type: 'pdf' | 'live' | 'recording'
function adminAddContent(payload) {
  requireAdmin_(payload);
  const record = {
    id: newId_(),
    courseId: payload.courseId,
    monthId: payload.monthId,
    type: payload.type,
    title: payload.title || '',
    url: payload.url || '',
    meta: payload.meta || '',
    order: payload.order || 0,
    createdAt: nowIso_()
  };
  appendObject_(getSheet_(SHEETS.CONTENT), record);
  return record;
}

function adminUpdateContent(payload) {
  requireAdmin_(payload);
  updateRowByField_(SHEETS.CONTENT, 'id', payload.id, payload.fields || {});
  return { id: payload.id };
}

function adminDeleteContent(payload) {
  requireAdmin_(payload);
  const sheet = getSheet_(SHEETS.CONTENT);
  const data = sheet.getDataRange().getValues();
  const idCol = HEADERS.Content.indexOf('id');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(payload.id)) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  return { id: payload.id };
}

/** ========================= FILE UPLOADS ========================= */

// Generic admin upload used for: content PDFs and course/month tile images.
// kind: 'content' | 'tile' | 'slip'(admin re-upload, rare)
function adminUploadFile(payload) {
  requireAdmin_(payload);
  const folderName = payload.kind === 'tile' ? DRIVE_FOLDERS.TILES : DRIVE_FOLDERS.CONTENT;
  const folder = getLmsFolder_(folderName);
  return saveBase64File_(folder, payload.fileBase64, payload.fileName, payload.mimeType);
}

/** ========================= PAYMENTS & ACCESS ========================= */

function submitPaymentSlip(payload) {
  const user = requireStudent_(payload);
  const folder = getLmsFolder_(DRIVE_FOLDERS.SLIPS);
  const saved = saveBase64File_(folder, payload.fileBase64, payload.fileName, payload.mimeType);

  const record = {
    id: newId_(),
    studentEmail: user.email,
    courseId: payload.courseId,
    monthId: payload.monthId,
    slipUrl: saved.url,
    status: 'pending',
    note: '',
    submittedAt: nowIso_(),
    reviewedAt: '',
    reviewedBy: ''
  };
  appendObject_(getSheet_(SHEETS.PAYMENTS), record);
  return record;
}

function getMyPayments(payload) {
  const user = requireStudent_(payload);
  return rowsToObjects_(getSheet_(SHEETS.PAYMENTS))
    .filter((p) => String(p.studentEmail).toLowerCase() === user.email)
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
}

function getMyAccess(payload) {
  const user = requireStudent_(payload);
  return rowsToObjects_(getSheet_(SHEETS.ACCESS))
    .filter((r) => String(r.studentEmail).toLowerCase() === user.email && r.status === 'active');
}

function adminListPayments(payload) {
  requireAdmin_(payload);
  let rows = rowsToObjects_(getSheet_(SHEETS.PAYMENTS));
  if (payload.status) rows = rows.filter((p) => p.status === payload.status);
  return rows.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
}

// decision: 'accept' | 'reject'
function adminReviewPayment(payload) {
  const admin = requireAdmin_(payload);
  const payments = rowsToObjects_(getSheet_(SHEETS.PAYMENTS));
  const record = payments.find((p) => String(p.id) === String(payload.paymentId));
  if (!record) throw new Error('Payment not found.');

  const status = payload.decision === 'accept' ? 'accepted' : 'rejected';
  updateRowByField_(SHEETS.PAYMENTS, 'id', payload.paymentId, {
    status: status,
    note: payload.note || '',
    reviewedAt: nowIso_(),
    reviewedBy: admin.email
  });

  if (status === 'accepted') {
    grantAccess_(record.studentEmail, record.courseId, record.monthId);
  }
  return { id: payload.paymentId, status: status };
}

function grantAccess_(email, courseId, monthId) {
  const sheet = getSheet_(SHEETS.ACCESS);
  const rows = rowsToObjects_(sheet);
  const existing = rows.find((r) => String(r.studentEmail).toLowerCase() === String(email).toLowerCase() &&
    String(r.courseId) === String(courseId) && String(r.monthId) === String(monthId));

  if (existing) {
    sheet.getRange(existing._row, HEADERS.Access.indexOf('status') + 1).setValue('active');
    sheet.getRange(existing._row, HEADERS.Access.indexOf('grantedAt') + 1).setValue(nowIso_());
  } else {
    appendObject_(sheet, {
      studentEmail: String(email).toLowerCase(),
      courseId: courseId,
      monthId: monthId,
      status: 'active',
      grantedAt: nowIso_(),
      revokedAt: ''
    });
  }
}

// Admin can grant access directly (e.g. scholarship / free month) without
// requiring a payment slip to exist first.
function adminGrantAccess(payload) {
  requireAdmin_(payload);
  grantAccess_(payload.studentEmail, payload.courseId, payload.monthId);
  return { studentEmail: payload.studentEmail, courseId: payload.courseId, monthId: payload.monthId };
}

function adminRevokeAccess(payload) {
  requireAdmin_(payload);
  const sheet = getSheet_(SHEETS.ACCESS);
  const rows = rowsToObjects_(sheet);
  const existing = rows.find((r) => String(r.studentEmail).toLowerCase() === String(payload.studentEmail).toLowerCase() &&
    String(r.courseId) === String(payload.courseId) && String(r.monthId) === String(payload.monthId));
  if (existing) {
    sheet.getRange(existing._row, HEADERS.Access.indexOf('status') + 1).setValue('revoked');
    sheet.getRange(existing._row, HEADERS.Access.indexOf('revokedAt') + 1).setValue(nowIso_());
  }
  return { studentEmail: payload.studentEmail, courseId: payload.courseId, monthId: payload.monthId };
}

/** ========================= ONE-TIME SETUP ========================= */

// Run this once manually from the Apps Script editor (select it in the
// function dropdown and click Run) to create all sheets with headers.
function setupSheets() {
  Object.keys(SHEETS).forEach((key) => getSheet_(SHEETS[key]));
  Logger.log('All sheets created/verified.');
}
