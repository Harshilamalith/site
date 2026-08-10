const API_URL = "https://script.google.com/macros/s/AKfycbx3M6PqkzB50uSWVRTtYMcyjPxvCTn2Q8ItJEf3unbllNy1riEzgy1_VeBGWZ-G_KMc/exec";
const GOOGLE_CLIENT_ID = "10419694413-b1qvphvc74os0js4t5ectsrhf076mqtg.apps.googleusercontent.com";

const themeToggle = document.getElementById('theme-toggle');
const body = document.body;
const currentTheme = localStorage.getItem('theme');
if (currentTheme === 'light') { body.setAttribute('data-theme', 'light'); themeToggle.textContent = '☀️'; }
themeToggle.addEventListener('click', () => {
    if (body.getAttribute('data-theme') === 'light') {
        body.removeAttribute('data-theme'); themeToggle.textContent = '🌙'; localStorage.setItem('theme', 'dark');
    } else {
        body.setAttribute('data-theme', 'light'); themeToggle.textContent = '☀️'; localStorage.setItem('theme', 'light');
    }
});

let adminIdToken = null;

async function callApi(action, payload) {
    if (!API_URL || API_URL.indexOf('PASTE_YOUR') === 0) {
        throw new Error('Backend not connected yet (set API_URL in admin.js).');
    }
    const resp = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, payload: payload || {} })
    });
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || 'Something went wrong.');
    return data.data;
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// =========================================================
// Sign-in gate
// =========================================================
const loginGate = document.getElementById('admin-login-gate');
const adminShell = document.getElementById('admin-shell');
const loginStatus = document.getElementById('admin-login-status');
const signoutLink = document.getElementById('admin-signout-link');

function handleCredentialResponse(response) {
    adminIdToken = response.credential;
    loginStatus.textContent = 'Checking admin access...';
    loginStatus.style.color = 'var(--text-muted)';

    // Any admin-only call verifies the token AND the admin allow-list
    // server-side — this is just a convenient way to check both at once.
    callApi('adminListCourses', { adminIdToken }).then(() => {
        loginGate.style.display = 'none';
        adminShell.style.display = 'block';
        signoutLink.style.display = 'inline-block';
        initDashboard();
    }).catch((err) => {
        adminIdToken = null;
        loginStatus.textContent = err.message || 'This account is not authorized as an admin.';
        loginStatus.style.color = '#f87171';
    });
}

signoutLink.addEventListener('click', (e) => {
    e.preventDefault();
    adminIdToken = null;
    adminShell.style.display = 'none';
    signoutLink.style.display = 'none';
    loginGate.style.display = 'block';
    loginStatus.textContent = '';
    window.location.reload();
});

window.addEventListener('load', () => {
    if (typeof google === 'undefined' || !google.accounts) {
        loginStatus.textContent = 'Google sign-in unavailable.';
        return;
    }
    google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleCredentialResponse });
    google.accounts.id.renderButton(
        document.getElementById('admin-google-signin-slot'),
        { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with' }
    );
});

// =========================================================
// Tabs
// =========================================================
document.querySelectorAll('.admin-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.admin-tab-btn').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.admin-panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
        loadPanel(btn.dataset.tab);
    });
});

let coursesCache = [];

function initDashboard() {
    loadCoursesEverywhere().then(() => loadPanel('payments'));
}

function loadPanel(tab) {
    if (tab === 'payments') loadPayments();
    if (tab === 'courses') loadCoursesTable();
    if (tab === 'months') loadMonthsTable();
    if (tab === 'content') refreshContentMonthSelects().then(loadContentTable);
    if (tab === 'students') loadStudents();
}

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// =========================================================
// Courses (shared select population across tabs)
// =========================================================
async function loadCoursesEverywhere() {
    coursesCache = await callApi('adminListCourses', { adminIdToken });
    const selects = ['month-course-select', 'months-list-course-select', 'content-course-select', 'content-list-course-select'];
    selects.forEach((id) => {
        const el = document.getElementById(id);
        el.innerHTML = coursesCache.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}${c.active === false ? ' (hidden)' : ''}</option>`).join('');
    });
}

async function loadCoursesTable() {
    await loadCoursesEverywhere();
    const tbody = document.querySelector('#courses-table tbody');
    tbody.innerHTML = coursesCache.map((c) => `
        <tr>
            <td>${escapeHtml(c.name)}</td>
            <td>${c.order}</td>
            <td>${String(c.active) === 'false' ? '<span class="pill pill-blocked">Hidden</span>' : '<span class="pill pill-active">Live</span>'}</td>
            <td><button class="admin-btn-sm reject" data-id="${c.id}" data-action="delete-course">Hide</button></td>
        </tr>
    `).join('') || '<tr><td colspan="4">No courses yet.</td></tr>';

    tbody.querySelectorAll('[data-action="delete-course"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!confirm('Hide this course from students? Months and content stay saved.')) return;
            await callApi('adminDeleteCourse', { adminIdToken, id: btn.dataset.id });
            loadCoursesTable();
        });
    });
}

document.getElementById('course-add-btn').addEventListener('click', async () => {
    const status = document.getElementById('course-status');
    const name = document.getElementById('course-name').value.trim();
    if (!name) { status.textContent = 'Please enter a course name.'; status.style.color = '#f87171'; return; }

    status.textContent = 'Saving...'; status.style.color = 'var(--text-muted)';
    try {
        let tileImageUrl = '';
        const file = document.getElementById('course-tile-image').files[0];
        if (file) {
            const dataUrl = await fileToBase64(file);
            const uploaded = await callApi('adminUploadFile', { adminIdToken, kind: 'tile', fileBase64: dataUrl, fileName: file.name, mimeType: file.type });
            tileImageUrl = uploaded.url;
        }
        await callApi('adminAddCourse', {
            adminIdToken,
            name,
            description: document.getElementById('course-desc').value.trim(),
            order: Number(document.getElementById('course-order').value) || 0,
            tileImageUrl
        });
        document.getElementById('course-name').value = '';
        document.getElementById('course-desc').value = '';
        document.getElementById('course-order').value = '';
        document.getElementById('course-tile-image').value = '';
        status.textContent = 'Course added.'; status.style.color = 'var(--accent-green)';
        loadCoursesTable();
    } catch (err) {
        status.textContent = err.message; status.style.color = '#f87171';
    }
});

// =========================================================
// Months
// =========================================================
document.getElementById('month-add-btn').addEventListener('click', async () => {
    const status = document.getElementById('month-status');
    const courseId = document.getElementById('month-course-select').value;
    const name = document.getElementById('month-name').value.trim();
    if (!courseId || !name) { status.textContent = 'Choose a course and enter a month name.'; status.style.color = '#f87171'; return; }

    status.textContent = 'Saving...'; status.style.color = 'var(--text-muted)';
    try {
        await callApi('adminAddMonth', {
            adminIdToken, courseId, name,
            price: Number(document.getElementById('month-price').value) || 0,
            order: Number(document.getElementById('month-order').value) || 0,
            description: document.getElementById('month-desc').value.trim()
        });
        document.getElementById('month-name').value = '';
        document.getElementById('month-price').value = '';
        document.getElementById('month-order').value = '';
        document.getElementById('month-desc').value = '';
        status.textContent = 'Month added.'; status.style.color = 'var(--accent-green)';
        loadMonthsTable();
    } catch (err) {
        status.textContent = err.message; status.style.color = '#f87171';
    }
});

document.getElementById('months-list-course-select').addEventListener('change', loadMonthsTable);

async function loadMonthsTable() {
    const courseId = document.getElementById('months-list-course-select').value;
    if (!courseId) return;
    const months = await callApi('adminListMonths', { adminIdToken, courseId });
    const tbody = document.querySelector('#months-table tbody');
    tbody.innerHTML = months.map((m) => `
        <tr>
            <td>${escapeHtml(m.name)}</td>
            <td>${m.price || '-'}</td>
            <td>${m.order}</td>
            <td>${String(m.active) === 'false' ? '<span class="pill pill-blocked">Hidden</span>' : '<span class="pill pill-active">Live</span>'}</td>
            <td><button class="admin-btn-sm reject" data-id="${m.id}" data-action="delete-month">Hide</button></td>
        </tr>
    `).join('') || '<tr><td colspan="5">No months yet for this course.</td></tr>';

    tbody.querySelectorAll('[data-action="delete-month"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!confirm('Hide this month from students? Content and payment history stay saved.')) return;
            await callApi('adminDeleteMonth', { adminIdToken, id: btn.dataset.id });
            loadMonthsTable();
        });
    });
}

// =========================================================
// Content
// =========================================================
async function refreshContentMonthSelects() {
    const courseSelects = ['content-course-select', 'content-list-course-select'];
    for (const selId of courseSelects) {
        const courseId = document.getElementById(selId).value;
        const monthSelId = selId === 'content-course-select' ? 'content-month-select' : 'content-list-month-select';
        if (!courseId) continue;
        const months = await callApi('adminListMonths', { adminIdToken, courseId });
        document.getElementById(monthSelId).innerHTML = months.map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
    }
}
document.getElementById('content-course-select').addEventListener('change', refreshContentMonthSelects);
document.getElementById('content-list-course-select').addEventListener('change', () => { refreshContentMonthSelects().then(loadContentTable); });
document.getElementById('content-list-month-select').addEventListener('change', loadContentTable);

document.getElementById('content-add-btn').addEventListener('click', async () => {
    const status = document.getElementById('content-status');
    const courseId = document.getElementById('content-course-select').value;
    const monthId = document.getElementById('content-month-select').value;
    const type = document.getElementById('content-type-select').value;
    const title = document.getElementById('content-title').value.trim();
    let url = document.getElementById('content-url').value.trim();

    if (!courseId || !monthId || !title) { status.textContent = 'Choose a course/month and enter a title.'; status.style.color = '#f87171'; return; }

    status.textContent = 'Saving...'; status.style.color = 'var(--text-muted)';
    try {
        const file = document.getElementById('content-pdf-file').files[0];
        if (type === 'pdf' && file) {
            const dataUrl = await fileToBase64(file);
            const uploaded = await callApi('adminUploadFile', { adminIdToken, kind: 'content', fileBase64: dataUrl, fileName: file.name, mimeType: file.type });
            url = uploaded.url;
        }
        if (!url) { status.textContent = 'Provide a URL or upload a PDF.'; status.style.color = '#f87171'; return; }

        await callApi('adminAddContent', {
            adminIdToken, courseId, monthId, type, title, url,
            meta: document.getElementById('content-meta').value.trim()
        });
        document.getElementById('content-title').value = '';
        document.getElementById('content-meta').value = '';
        document.getElementById('content-url').value = '';
        document.getElementById('content-pdf-file').value = '';
        status.textContent = 'Content added.'; status.style.color = 'var(--accent-green)';
        loadContentTable();
    } catch (err) {
        status.textContent = err.message; status.style.color = '#f87171';
    }
});

async function loadContentTable() {
    const courseId = document.getElementById('content-list-course-select').value;
    const monthId = document.getElementById('content-list-month-select').value;
    if (!courseId || !monthId) return;
    const items = await callApi('adminListContent', { adminIdToken, courseId, monthId });
    const tbody = document.querySelector('#content-table tbody');
    tbody.innerHTML = items.map((c) => `
        <tr>
            <td>${escapeHtml(c.type)}</td>
            <td>${escapeHtml(c.title)}</td>
            <td>${escapeHtml(c.meta)}</td>
            <td><a href="${c.url}" target="_blank" rel="noopener">Open</a></td>
            <td><button class="admin-btn-sm reject" data-id="${c.id}" data-action="delete-content">Delete</button></td>
        </tr>
    `).join('') || '<tr><td colspan="5">No content yet for this month.</td></tr>';

    tbody.querySelectorAll('[data-action="delete-content"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!confirm('Delete this item permanently?')) return;
            await callApi('adminDeleteContent', { adminIdToken, id: btn.dataset.id });
            loadContentTable();
        });
    });
}

// =========================================================
// Payments
// =========================================================
document.getElementById('payments-filter').addEventListener('change', loadPayments);

async function loadPayments() {
    const status = document.getElementById('payments-filter').value;
    const payments = await callApi('adminListPayments', { adminIdToken, status });
    const courseName = (id) => (coursesCache.find((c) => c.id === id) || {}).name || id;

    const tbody = document.querySelector('#payments-table tbody');
    tbody.innerHTML = payments.map((p) => `
        <tr>
            <td>${escapeHtml(p.studentEmail)}</td>
            <td>${escapeHtml(courseName(p.courseId))}</td>
            <td>${escapeHtml(p.monthId)}</td>
            <td><a href="${p.slipUrl}" target="_blank" rel="noopener">View Slip</a></td>
            <td><span class="pill pill-${p.status}">${escapeHtml(p.status)}</span></td>
            <td>${p.submittedAt ? new Date(p.submittedAt).toLocaleString() : ''}</td>
            <td>
                ${p.status === 'pending' ? `
                    <button class="admin-btn-sm accept" data-id="${p.id}" data-action="accept">Accept</button>
                    <button class="admin-btn-sm reject" data-id="${p.id}" data-action="reject">Reject</button>
                ` : ''}
                ${p.status === 'accepted' ? `<button class="admin-btn-sm reject" data-email="${p.studentEmail}" data-course="${p.courseId}" data-month="${p.monthId}" data-action="revoke">Revoke Access</button>` : ''}
            </td>
        </tr>
    `).join('') || '<tr><td colspan="7">No payments found.</td></tr>';

    tbody.querySelectorAll('[data-action="accept"], [data-action="reject"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const decision = btn.dataset.action === 'accept' ? 'accept' : 'reject';
            let note = '';
            if (decision === 'reject') note = prompt('Optional note for the student (why it was rejected):') || '';
            await callApi('adminReviewPayment', { adminIdToken, paymentId: btn.dataset.id, decision, note });
            loadPayments();
        });
    });
    tbody.querySelectorAll('[data-action="revoke"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!confirm('Revoke this student\'s access to this month?')) return;
            await callApi('adminRevokeAccess', { adminIdToken, studentEmail: btn.dataset.email, courseId: btn.dataset.course, monthId: btn.dataset.month });
            loadPayments();
        });
    });
}

// =========================================================
// Students
// =========================================================
async function loadStudents() {
    const students = await callApi('adminListStudents', { adminIdToken });
    const courseName = (id) => (coursesCache.find((c) => c.id === id) || {}).name || id;

    const tbody = document.querySelector('#students-table tbody');
    tbody.innerHTML = students.map((s) => `
        <tr>
            <td>${escapeHtml(s.fullName || s.name)}</td>
            <td>${escapeHtml(s.email)}</td>
            <td>${escapeHtml(s.whatsapp)}</td>
            <td>${escapeHtml(s.school)}</td>
            <td>${escapeHtml(courseName(s.courseId))}</td>
            <td>${String(s.blocked) === 'true' ? '<span class="pill pill-blocked">Blocked</span>' : '<span class="pill pill-active">Active</span>'}</td>
            <td><button class="admin-btn-sm ${String(s.blocked) === 'true' ? 'accept' : 'reject'}" data-email="${s.email}" data-blocked="${String(s.blocked) !== 'true'}" data-action="toggle-block">${String(s.blocked) === 'true' ? 'Unblock' : 'Block'}</button></td>
        </tr>
    `).join('') || '<tr><td colspan="7">No students registered yet.</td></tr>';

    tbody.querySelectorAll('[data-action="toggle-block"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const blocked = btn.dataset.blocked === 'true';
            if (blocked && !confirm('Block this student? They will not be able to sign in.')) return;
            await callApi('adminSetStudentBlocked', { adminIdToken, email: btn.dataset.email, blocked });
            loadStudents();
        });
    });
}
