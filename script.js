// =========================================================
// CONFIG — paste your deployed Apps Script Web App URL here
// =========================================================
const API_URL = "https://script.google.com/macros/s/AKfycbx3M6PqkzB50uSWVRTtYMcyjPxvCTn2Q8ItJEf3unbllNy1riEzgy1_VeBGWZ-G_KMc/exec";
const GOOGLE_CLIENT_ID = "10419694413-b1qvphvc74os0js4t5ectsrhf076mqtg.apps.googleusercontent.com";

const themeToggle = document.getElementById('theme-toggle');
const body = document.body;

// Check for saved user preference in local storage
const currentTheme = localStorage.getItem('theme');
if (currentTheme === 'light') {
    body.setAttribute('data-theme', 'light');
    themeToggle.textContent = '☀️';
}

themeToggle.addEventListener('click', () => {
    if (body.getAttribute('data-theme') === 'light') {
        body.removeAttribute('data-theme');
        themeToggle.textContent = '🌙';
        localStorage.setItem('theme', 'dark');
    } else {
        body.setAttribute('data-theme', 'light');
        themeToggle.textContent = '☀️';
        localStorage.setItem('theme', 'light');
    }
});

// =========================================================
// Reading Progress Bar
// =========================================================
const progressBarFill = document.getElementById('progress-bar-fill');

function updateProgressBar() {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const docHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    const pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    progressBarFill.style.width = pct + '%';
}
window.addEventListener('scroll', updateProgressBar);
window.addEventListener('resize', updateProgressBar);

// =========================================================
// API helper — talks to the Apps Script backend
// =========================================================
// Uses text/plain content-type on purpose: this keeps the request a
// "simple request" so the browser skips a CORS preflight (which Apps
// Script web apps can't answer), and Apps Script's response can then
// be read normally.
//
// Google's free-tier Web App occasionally returns a slow/garbled
// response under normal load (a known quirk, not a bug in this code) —
// so a failed attempt is retried a couple of times with a short pause
// before actually surfacing an error to the user.
function wait_(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function callApi(action, payload, attempt) {
    attempt = attempt || 1;
    if (!API_URL || API_URL.indexOf('PASTE_YOUR') === 0) {
        throw new Error('The site is not connected to the backend yet (API_URL not set in script.js).');
    }

    let resp;
    try {
        resp = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action, payload: payload || {} })
        });
    } catch (networkErr) {
        if (attempt < 3) { await wait_(500 * attempt); return callApi(action, payload, attempt + 1); }
        throw new Error('Could not reach the server. Please check your connection and try again.');
    }

    let data;
    try {
        data = await resp.json();
    } catch (parseErr) {
        // Response wasn't valid JSON — almost always a transient hiccup.
        if (attempt < 3) { await wait_(500 * attempt); return callApi(action, payload, attempt + 1); }
        throw new Error('The server is temporarily busy. Please try again in a moment.');
    }

    if (!data.ok) throw new Error(data.error || 'Something went wrong.');
    return data.data;
}

// =========================================================
// Google Sign-In + Booking Modal
// =========================================================
const modalOverlay = document.getElementById('booking-modal');
const bookBtn = document.getElementById('book-session-btn');
const navCtaBtn = document.getElementById('nav-cta-btn');
const closeBtn = document.getElementById('modal-close-btn');
const preLogin = document.getElementById('modal-pre-login');
const postLogin = document.getElementById('modal-post-login');
const modalDone = document.getElementById('modal-done');
const modalStatus = document.getElementById('modal-status');
const regStatus = document.getElementById('reg-status');
const registrationForm = document.getElementById('registration-form');
const navAcademicsLink = document.getElementById('nav-academics-link');
const navSignoutLink = document.getElementById('nav-signout-link');
const navEditDetailsLink = document.getElementById('nav-edit-details-link');
const studentStatus = document.getElementById('student-status');
const academicsSection = document.getElementById('academics-section');
const proceedAcademicsBtn = document.getElementById('proceed-academics-btn');
const postLoginTitle = document.getElementById('modal-post-login-title');
const regSubmitBtn = document.getElementById('reg-submit-btn');
const regClearAllBtn = document.getElementById('reg-clear-all-btn');
const confirmClearModal = document.getElementById('confirm-clear-modal');
const confirmClearCancelBtn = document.getElementById('confirm-clear-cancel-btn');
const confirmClearYesBtn = document.getElementById('confirm-clear-yes-btn');
const confirmClearStatus = document.getElementById('confirm-clear-status');
const navHomeLink = document.getElementById('nav-home-link');
const navCoursesLink = document.getElementById('nav-courses-link');
const courseModeSection = document.getElementById('courses-section');
const navContactLink = document.getElementById('nav-contact-link');
const contactSection = document.getElementById('contact-section');

const monthsGrid = document.getElementById('months-grid');
const monthContentView = document.getElementById('month-content-view');
const monthContentTitle = document.getElementById('month-content-title');
const monthLockedPanel = document.getElementById('month-locked-panel');
const lockedStatusText = document.getElementById('locked-status-text');
const monthContentPanels = document.getElementById('month-content-panels');
const backToMonthsBtn = document.getElementById('back-to-months-btn');
const slipUploadForm = document.getElementById('slip-upload-form');
const slipFileInput = document.getElementById('slip-file-input');
const slipStatus = document.getElementById('slip-status');
const slipSubmitBtn = document.getElementById('slip-submit-btn');

let selectedBatch = null;   // courseId chosen from a course tile, pre-fills the form
let currentIdToken = null;  // fresh Google ID token, required for any API call
let currentProfile = null;  // student profile as returned by the backend
let coursesCache = [];
let monthsCache = [];
let activeMonth = null;

function hideModeSections() {
    body.classList.remove('course-mode');
    body.classList.remove('contact-mode');
    courseModeSection.style.display = 'none';
    contactSection.style.display = 'none';
    academicsSection.style.display = 'none';
}

// Phone fields
const phoneFieldIds = ['reg-whatsapp', 'reg-contact', 'reg-parent-contact'];
phoneFieldIds.forEach((id) => {
    const field = document.getElementById(id);
    field.addEventListener('input', () => {
        field.value = sanitizePhoneInput(field.value);
        field.classList.remove('input-error');
    });
});

function sanitizePhoneInput(raw) {
    const hasPlus = raw.trim().startsWith('+');
    const digits = raw.replace(/\D/g, '');
    let value = hasPlus ? '+' + digits : digits;
    const maxLen = hasPlus ? 12 : 10;
    return value.slice(0, maxLen);
}

function isValidPhone(value) {
    return /^0\d{9}$/.test(value) || /^\+94\d{9}$/.test(value);
}

function validatePhoneFields() {
    const whatsappField = document.getElementById('reg-whatsapp');
    const contactField = document.getElementById('reg-contact');
    const parentContactField = document.getElementById('reg-parent-contact');
    [whatsappField, contactField, parentContactField].forEach((f) => f.classList.remove('input-error'));

    const errors = [];
    const formatHint = 'Use 0771234567 or +94771234567.';

    if (!isValidPhone(whatsappField.value.trim())) {
        whatsappField.classList.add('input-error');
        errors.push(`WhatsApp number is invalid. ${formatHint}`);
    }
    if (contactField.value.trim() && !isValidPhone(contactField.value.trim())) {
        contactField.classList.add('input-error');
        errors.push(`Contact number is invalid. ${formatHint}`);
    }
    if (!isValidPhone(parentContactField.value.trim())) {
        parentContactField.classList.add('input-error');
        errors.push(`Parent/guardian contact number is invalid. ${formatHint}`);
    }
    if (errors.length) {
        regStatus.textContent = errors[0];
        regStatus.style.color = '#f87171';
        return false;
    }
    return true;
}

function openModal() {
    modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}
function closeModal() {
    modalOverlay.classList.remove('active');
    document.body.style.overflow = '';
}

bookBtn.addEventListener('click', () => {
    if (currentProfile) {
        academicsSection.scrollIntoView({ behavior: 'smooth' });
        return;
    }
    preLogin.style.display = 'block';
    postLogin.style.display = 'none';
    modalDone.style.display = 'none';
    regClearAllBtn.style.display = 'none';
    openModal();
});
if (navCtaBtn) navCtaBtn.addEventListener('click', (e) => { e.preventDefault(); bookBtn.click(); });

function setLoginButtonText(text) {
    if (bookBtn) bookBtn.textContent = text;
    if (navCtaBtn) navCtaBtn.textContent = text;
}
closeBtn.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// =========================================================
// Nav / mode switching
// =========================================================
navCoursesLink.addEventListener('click', (e) => {
    e.preventDefault();
    hideModeSections();
    body.classList.add('course-mode');
    document.getElementById('course-mode-section').style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

navHomeLink.addEventListener('click', (e) => {
    e.preventDefault();
    hideModeSections();
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

navContactLink.addEventListener('click', (e) => {
    e.preventDefault();
    hideModeSections();
    body.classList.add('contact-mode');
    contactSection.style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

// =========================================================
// About Us (video modal)
// =========================================================
// Paste your Google Drive video's PREVIEW url here — NOT the normal
// "share" link. Take the file ID from your share link
// (https://drive.google.com/file/d/THIS_PART/view) and use:
// https://drive.google.com/file/d/THIS_PART/preview
const ABOUT_VIDEO_URL = "https://drive.google.com/file/d/1-YhpdKl0irWlWOORmsJHUO-NcrWOgUKI/preview";

const navAboutLink = document.getElementById('nav-about-link');
const aboutModal = document.getElementById('about-modal');
const aboutModalCloseBtn = document.getElementById('about-modal-close-btn');
const aboutVideoIframe = document.getElementById('about-video-iframe');

function openAboutModal() {
    if (!ABOUT_VIDEO_URL || ABOUT_VIDEO_URL.indexOf('PASTE_YOUR') === 0) {
        alert('The About Us video link hasn\'t been set up yet.');
        return;
    }
    aboutVideoIframe.src = ABOUT_VIDEO_URL;
    aboutModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}
function closeAboutModal() {
    aboutModal.classList.remove('active');
    aboutVideoIframe.src = ''; // stops playback when closed
    document.body.style.overflow = '';
}
navAboutLink.addEventListener('click', (e) => { e.preventDefault(); openAboutModal(); });
aboutModalCloseBtn.addEventListener('click', closeAboutModal);
aboutModal.addEventListener('click', (e) => { if (e.target === aboutModal) closeAboutModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && aboutModal.classList.contains('active')) closeAboutModal(); });

navAcademicsLink.addEventListener('click', (e) => {
    e.preventDefault();
    hideModeSections();
    academicsSection.style.display = 'block';
    academicsSection.scrollIntoView({ behavior: 'smooth' });
});

// =========================================================
// Courses — loaded dynamically from the backend
// =========================================================
function courseTileHtml(course) {
    const img = course.tileImageUrl
        ? `<div class="tile-image"><img src="${course.tileImageUrl}" alt="${course.name}"></div>`
        : '';
    return `
        <div class="glass-tile course-tile" data-course-id="${course.id}">
            ${img}
            <div class="tile-content">
                <div class="tile-tag">A/L Batch</div>
                <h3>${course.name}</h3>
                <p>${course.description || 'Sign in to access notes, papers, and class recordings.'}</p>
                <span class="tile-link">Sign in to access →</span>
            </div>
        </div>
    `;
}

function wireCourseTileClicks(container) {
    container.querySelectorAll('.course-tile').forEach((tile) => {
        tile.addEventListener('click', () => {
            selectedBatch = tile.getAttribute('data-course-id');
            if (currentProfile) {
                academicsSection.scrollIntoView({ behavior: 'smooth' });
                return;
            }
            preLogin.style.display = 'block';
            postLogin.style.display = 'none';
            modalDone.style.display = 'none';
            regClearAllBtn.style.display = 'none';
            openModal();
        });
    });
}

async function loadCourses() {
    try {
        coursesCache = await callApi('getPublicCourses');
    } catch (err) {
        coursesCache = [];
    }

    const regBatchSelect = document.getElementById('reg-batch');
    const courseModeGrid = document.getElementById('course-tiles-grid');
    const coursesGrid = document.getElementById('courses-tiles-grid');

    if (!coursesCache.length) {
        const emptyMsg = '<p class="academics-empty">No batches are open for enrolment yet — please check back soon.</p>';
        courseModeGrid.innerHTML = emptyMsg;
        coursesGrid.innerHTML = emptyMsg;
        regBatchSelect.innerHTML = '<option value="" disabled selected>No batches available yet</option>';
        return;
    }

    courseModeGrid.innerHTML = coursesCache.map(courseTileHtml).join('');
    coursesGrid.innerHTML = coursesCache.map(courseTileHtml).join('');
    wireCourseTileClicks(courseModeGrid);
    wireCourseTileClicks(coursesGrid);

    regBatchSelect.innerHTML = '<option value="" disabled selected>Select your batch</option>' +
        coursesCache.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
}

// =========================================================
// Sign-in
// =========================================================
function handleCredentialResponse(response) {
    currentIdToken = response.credential;

    callApi('getMyProfile', { idToken: currentIdToken }).then((profile) => {
        if (profile) {
            currentProfile = profile;
            showDoneStep(profile, false);
        } else {
            // New student — decode just enough from the token to prefill the form
            // (display only; the server verifies the real token on submit).
            const payloadPart = JSON.parse(decodeURIComponent(atob(currentIdToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')));
            document.getElementById('modal-user-avatar').src = payloadPart.picture || '';
            document.getElementById('modal-user-name').textContent = payloadPart.name || '';
            document.getElementById('modal-user-email').textContent = payloadPart.email || '';
            document.getElementById('reg-fullname').value = payloadPart.name || '';
            document.getElementById('modal-user').style.display = 'flex';

            preLogin.style.display = 'none';
            postLogin.style.display = 'block';
            regClearAllBtn.style.display = 'none';
            if (selectedBatch) document.getElementById('reg-batch').value = selectedBatch;
        }
    }).catch((err) => {
        modalStatus.textContent = err.message || 'Sign-in failed. Please try again.';
        modalStatus.style.color = '#f87171';
    });
}

// =========================================================
// Registration
// =========================================================
let isEditMode = false;

registrationForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validatePhoneFields()) return;

    const courseId = document.getElementById('reg-batch').value;
    const stream = document.getElementById('reg-stream').value;
    if (!courseId || !stream) {
        regStatus.textContent = 'Please select your stream and batch.';
        regStatus.style.color = '#f87171';
        return;
    }

    regSubmitBtn.disabled = true;
    regStatus.textContent = 'Saving...';
    regStatus.style.color = 'var(--text-muted)';

    try {
        const profile = await callApi('registerStudent', {
            idToken: currentIdToken,
            fullName: document.getElementById('reg-fullname').value.trim(),
            whatsapp: document.getElementById('reg-whatsapp').value.trim(),
            contact: document.getElementById('reg-contact').value.trim(),
            parentName: document.getElementById('reg-parent-name').value.trim(),
            parentContact: document.getElementById('reg-parent-contact').value.trim(),
            school: document.getElementById('reg-school').value.trim(),
            stream: stream,
            courseId: courseId
        });
        currentProfile = profile;
        showDoneStep(profile, isEditMode);
        isEditMode = false;
    } catch (err) {
        regStatus.textContent = err.message || 'Could not save your details. Please try again.';
        regStatus.style.color = '#f87171';
    } finally {
        regSubmitBtn.disabled = false;
    }
});

navEditDetailsLink.addEventListener('click', (e) => {
    e.preventDefault();
    if (!currentProfile) return;

    isEditMode = true;
    document.getElementById('modal-user-avatar').src = currentProfile.picture || '';
    document.getElementById('modal-user-name').textContent = currentProfile.fullName || currentProfile.name;
    document.getElementById('modal-user-email').textContent = currentProfile.email;
    document.getElementById('modal-user').style.display = 'flex';

    document.getElementById('reg-fullname').value = currentProfile.fullName || '';
    document.getElementById('reg-whatsapp').value = currentProfile.whatsapp || '';
    document.getElementById('reg-contact').value = currentProfile.contact || '';
    document.getElementById('reg-parent-name').value = currentProfile.parentName || '';
    document.getElementById('reg-parent-contact').value = currentProfile.parentContact || '';
    document.getElementById('reg-school').value = currentProfile.school || '';
    document.getElementById('reg-stream').value = currentProfile.stream || '';
    document.getElementById('reg-batch').value = currentProfile.courseId || '';

    postLoginTitle.textContent = 'Edit Your Details';
    regSubmitBtn.textContent = 'Save Changes';
    regClearAllBtn.style.display = 'block';
    regStatus.textContent = '';

    preLogin.style.display = 'none';
    postLogin.style.display = 'block';
    modalDone.style.display = 'none';
    openModal();
});

regClearAllBtn.addEventListener('click', (e) => {
    e.preventDefault();
    confirmClearStatus.textContent = '';
    confirmClearModal.classList.add('active');
});
confirmClearCancelBtn.addEventListener('click', () => confirmClearModal.classList.remove('active'));
confirmClearModal.addEventListener('click', (e) => { if (e.target === confirmClearModal) confirmClearModal.classList.remove('active'); });

confirmClearYesBtn.addEventListener('click', async () => {
    if (!currentProfile) { confirmClearModal.classList.remove('active'); return; }

    confirmClearYesBtn.disabled = true;
    confirmClearStatus.textContent = 'Clearing your data...';
    confirmClearStatus.style.color = 'var(--text-muted)';

    try {
        await callApi('deleteMyData', { idToken: currentIdToken });
    } catch (err) {
        confirmClearStatus.textContent = err.message || 'Could not clear your data. Please try again.';
        confirmClearStatus.style.color = '#f87171';
        confirmClearYesBtn.disabled = false;
        return;
    }

    confirmClearYesBtn.disabled = false;
    confirmClearModal.classList.remove('active');
    closeModal();

    body.classList.remove('student-mode');
    navAcademicsLink.style.display = 'none';
    navEditDetailsLink.style.display = 'none';
    navSignoutLink.style.display = 'none';
    studentStatus.style.display = 'none';
    academicsSection.style.display = 'none';
    setLoginButtonText('Log In Now');
    currentProfile = null;
    currentIdToken = null;
    isEditMode = false;
    if (typeof google !== 'undefined' && google.accounts) google.accounts.id.disableAutoSelect();
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

function showDoneStep(profile, wasEdit) {
    preLogin.style.display = 'none';
    postLogin.style.display = 'none';
    modalDone.style.display = 'block';
    postLoginTitle.textContent = 'Complete Your Profile';
    regSubmitBtn.textContent = 'Save & Unlock My Batch';

    document.getElementById('modal-done-text').textContent = wasEdit
        ? `Your details have been updated, ${profile.fullName || profile.name}.`
        : `You're registered, ${profile.fullName || profile.name}. Head to your dashboard for notes and recordings.`;

    unlockAcademics(profile);
}

proceedAcademicsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    closeModal();
    academicsSection.scrollIntoView({ behavior: 'smooth' });
});

function unlockAcademics(profile) {
    hideModeSections();
    body.classList.add('student-mode');
    selectedBatch = null;
    setLoginButtonText('Go to My Dashboard');

    navAcademicsLink.style.display = 'inline-block';
    navEditDetailsLink.style.display = 'inline-block';
    navSignoutLink.style.display = 'inline-block';
    studentStatus.style.display = 'block';

    const courseName = (coursesCache.find((c) => c.id === profile.courseId) || {}).name || profile.courseId;
    studentStatus.textContent = `Signed in as ${profile.fullName || profile.name} — ${courseName}`;

    // Populate the LMS sidebar + dashboard welcome (presentation only)
    const avatarEl = document.getElementById('sidebar-avatar');
    if (avatarEl) avatarEl.src = profile.picture || '';
    const nameEl = document.getElementById('sidebar-name');
    if (nameEl) nameEl.textContent = profile.fullName || profile.name;
    const batchEl = document.getElementById('sidebar-batch');
    if (batchEl) batchEl.textContent = courseName;
    const welcomeEl = document.getElementById('lms-welcome-title');
    if (welcomeEl) welcomeEl.textContent = `Welcome back, ${(profile.fullName || profile.name || '').split(' ')[0]}`;
    const welcomeSub = document.getElementById('lms-welcome-sub');
    if (welcomeSub) welcomeSub.textContent = `Batch ${courseName} — here's your study dashboard.`;

    enterLmsDashboard();
    renderMonths(profile.courseId);
}

navSignoutLink.addEventListener('click', (e) => {
    e.preventDefault();
    const confirmed = window.confirm('Are you sure you want to sign out? You can sign back in with Google anytime — your details will still be saved.');
    if (!confirmed) return;

    body.classList.remove('student-mode');
    navAcademicsLink.style.display = 'none';
    navEditDetailsLink.style.display = 'none';
    navSignoutLink.style.display = 'none';
    studentStatus.style.display = 'none';
    academicsSection.style.display = 'none';
    setLoginButtonText('Log In Now');
    currentProfile = null;
    currentIdToken = null;
    if (typeof google !== 'undefined' && google.accounts) google.accounts.id.disableAutoSelect();
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

// =========================================================
// Months
// =========================================================
async function renderMonths(courseId) {
    document.getElementById('academics-batch-title').textContent =
        `${(coursesCache.find((c) => c.id === courseId) || {}).name || 'My Batch'} — My Academics`;

    monthContentView.style.display = 'none';
    monthsGrid.style.display = 'grid';
    monthsGrid.innerHTML = '<p class="academics-empty">Loading months...</p>';
    academicsSection.style.display = 'block';

    try {
        monthsCache = await callApi('getMonths', { idToken: currentIdToken, courseId });
    } catch (err) {
        monthsGrid.innerHTML = `<p class="academics-empty">${err.message}</p>`;
        return;
    }

    if (!monthsCache.length) {
        monthsGrid.innerHTML = '<p class="academics-empty">No months have been added for this batch yet — check back soon.</p>';
        return;
    }

    monthsGrid.innerHTML = monthsCache.map((m) => `
        <a class="academics-card month-card" href="#" data-month-id="${m.id}">
            <div class="month-card-top">
                <span class="month-card-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                </span>
                <div class="month-card-titles">
                    <span class="card-title">${m.name}</span>
                    ${m.price ? `<span class="card-meta">Rs. ${m.price} · per month</span>` : ''}
                </div>
                <span class="month-card-arrow" aria-hidden="true">→</span>
            </div>
            ${m.description ? `<p class="card-desc">${m.description}</p>` : ''}
        </a>
    `).join('');

    monthsGrid.querySelectorAll('.month-card').forEach((card) => {
        card.addEventListener('click', (e) => {
            e.preventDefault();
            openMonth(card.getAttribute('data-month-id'));
        });
    });

    refreshLmsStats();
}

backToMonthsBtn.addEventListener('click', () => {
    monthContentView.style.display = 'none';
    monthsGrid.style.display = 'grid';
});

async function openMonth(monthId) {
    activeMonth = monthsCache.find((m) => m.id === monthId);
    if (!activeMonth) return;

    setActiveLmsNav('months');
    monthsGrid.style.display = 'none';
    monthContentView.style.display = 'block';
    monthContentTitle.textContent = activeMonth.name;
    monthLockedPanel.style.display = 'none';
    monthContentPanels.style.display = 'none';
    slipStatus.textContent = '';
    slipUploadForm.reset();

    let result;
    try {
        result = await callApi('getMonthContent', {
            idToken: currentIdToken,
            courseId: currentProfile.courseId,
            monthId: monthId
        });
    } catch (err) {
        lockedStatusText.textContent = err.message;
        monthLockedPanel.style.display = 'block';
        return;
    }

    if (result.locked) {
        monthLockedPanel.style.display = 'block';
        const p = result.latestPayment;
        if (p && p.status === 'pending') {
            lockedStatusText.textContent = 'Your payment slip is pending review by your teacher. You\'ll get access as soon as it\'s approved.';
            slipUploadForm.style.display = 'none';
        } else if (p && p.status === 'rejected') {
            lockedStatusText.textContent = `Your last payment slip was not accepted${p.note ? ' (' + p.note + ')' : ''}. Please upload a new one.`;
            slipUploadForm.style.display = 'flex';
        } else {
            lockedStatusText.textContent = 'This month isn\'t unlocked yet. Upload your payment slip below and your teacher will review it — once accepted, you\'ll have permanent access.';
            slipUploadForm.style.display = 'flex';
        }
    } else {
        monthContentPanels.style.display = 'block';
        renderContentGrid('live', result.content.filter((c) => c.type === 'live'));
        renderContentGrid('recording', result.content.filter((c) => c.type === 'recording'));
        renderContentGrid('pdf', result.content.filter((c) => c.type === 'pdf'));
    }
}

function renderContentGrid(type, items) {
    const gridId = type === 'live' ? 'live-grid' : (type === 'recording' ? 'recordings-grid' : 'notes-grid');
    const grid = document.getElementById(gridId);
    if (!items.length) {
        grid.innerHTML = `<p class="academics-empty">Nothing here yet.</p>`;
        return;
    }
    grid.innerHTML = items.map((item) => contentCardHtml(type, item)).join('');
}

function contentCardHtml(type, item) {
    const icons = {
        live: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="14" height="14" rx="2"/><polygon points="22 7 16 12 22 17 22 7"/></svg>',
        recording: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
        pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>'
    };
    const badges = { live: 'Live Class', recording: 'Recording', pdf: 'Notes' };
    const labels = { live: 'Join Live Class', recording: 'Watch Recording', pdf: 'Open PDF' };
    return `
        <a class="content-card content-card--${type}" href="${item.url}" target="_blank" rel="noopener">
            <span class="content-card-icon">${icons[type]}</span>
            <span class="card-type-badge">${badges[type]}</span>
            <span class="card-title">${item.title}</span>
            ${item.meta ? `<span class="card-meta">${item.meta}</span>` : (type === 'live' ? '<span class="card-meta">Check the scheduled time with your teacher</span>' : '')}
            <span class="content-card-action">${labels[type]}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><path d="M7 17L17 7"/><path d="M7 7h10v10"/></svg>
            </span>
        </a>
    `;
}

// =========================================================
// Payment slip upload
// =========================================================
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

slipUploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = slipFileInput.files[0];
    if (!file) return;

    slipSubmitBtn.disabled = true;
    slipStatus.textContent = 'Uploading...';
    slipStatus.style.color = 'var(--text-muted)';

    try {
        const dataUrl = await fileToBase64(file);
        await callApi('submitPaymentSlip', {
            idToken: currentIdToken,
            courseId: currentProfile.courseId,
            monthId: activeMonth.id,
            fileBase64: dataUrl,
            fileName: file.name,
            mimeType: file.type
        });
        slipStatus.textContent = 'Payment slip uploaded! Your teacher will review it shortly.';
        slipStatus.style.color = 'var(--accent-green)';
        slipUploadForm.style.display = 'none';
        lockedStatusText.textContent = 'Your payment slip is pending review by your teacher. You\'ll get access as soon as it\'s approved.';
    } catch (err) {
        slipStatus.textContent = err.message || 'Upload failed. Please try again.';
        slipStatus.style.color = '#f87171';
    } finally {
        slipSubmitBtn.disabled = false;
    }
});

// =========================================================
// Startup
// =========================================================
window.addEventListener('load', async () => {
    await loadCourses();

    if (typeof google === 'undefined' || !google.accounts) {
        modalStatus.textContent = 'Google sign-in unavailable (no client ID configured).';
        return;
    }
    google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse,
        auto_select: true
    });
    google.accounts.id.renderButton(
        document.getElementById('google-signin-slot'),
        { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with' }
    );
    // Attempt a silent sign-in so a returning student doesn't have to
    // click the button again — restores their session with a fresh token.
    google.accounts.id.prompt();
});

// =========================================================
// UI polish — mobile nav, particles, scroll reveal, parallax
// (safe no-ops when elements are absent)
// =========================================================
(function () {
    // Mobile navigation toggle
    const siteNav = document.getElementById('site-nav');
    const navToggle = document.getElementById('nav-toggle');
    const navLinksEl = document.getElementById('nav-links');

    if (navToggle && navLinksEl) {
        navToggle.addEventListener('click', () => {
            const open = siteNav.classList.toggle('nav-open');
            navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
        navLinksEl.addEventListener('click', (e) => {
            if (e.target.closest('a') || e.target.classList.contains('theme-toggle')) {
                siteNav.classList.remove('nav-open');
                navToggle.setAttribute('aria-expanded', 'false');
            }
        });
    }

    // Nav shadow when scrolled
    function onScroll() {
        if (siteNav) siteNav.classList.toggle('scrolled', window.scrollY > 12);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    // Hero button that opens the About Us video modal
    document.querySelectorAll('[data-open-about]').forEach((btn) => {
        btn.addEventListener('click', () => openAboutModal());
    });

    // Footer quick links forward to the matching nav links
    document.querySelectorAll('[data-nav]').forEach((link) => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const src = document.querySelector('[data-nav-src="' + link.dataset.nav + '"]');
            if (src) src.click();
        });
    });

    // Footer year
    const yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    // Scroll reveal with a gentle cascade
    const revealEls = document.querySelectorAll('[data-reveal]');
    if (revealEls.length && 'IntersectionObserver' in window) {
        revealEls.forEach((el, i) => {
            el.style.setProperty('--rd', Math.min(i, 10) * 70 + 'ms');
            el.classList.add('reveal-init');
        });
        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    io.unobserve(entry.target);
                }
            });
        }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
        revealEls.forEach((el) => io.observe(el));
    }

    // Aurora blobs drift with scroll
    const shape1 = document.querySelector('.shape-1');
    const shape2 = document.querySelector('.shape-2');
    function parallax() {
        if (shape1) shape1.style.top = (-120 + window.scrollY * 0.06) + 'px';
        if (shape2) shape2.style.bottom = (-140 + window.scrollY * 0.05) + 'px';
    }
    window.addEventListener('scroll', parallax, { passive: true });

    // Constellation particle field
    const canvas = document.getElementById('bg-canvas');
    if (canvas && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        const ctx = canvas.getContext('2d');
        const particles = [];
        let w, h, frame = 0;

        function resize() {
            w = canvas.width = window.innerWidth;
            h = canvas.height = window.innerHeight;
        }
        window.addEventListener('resize', resize);
        resize();

        const COUNT = Math.min(60, Math.max(24, Math.floor(w / 26)));
        let color = 'rgba(125, 211, 252, 0.55)';

        function readColor() {
            const v = getComputedStyle(document.documentElement).getPropertyValue('--particle-color').trim();
            if (v) color = v;
        }
        readColor();

        function rand(a, b) { return a + Math.random() * (b - a); }
        for (let i = 0; i < COUNT; i++) {
            particles.push({
                x: Math.random() * w,
                y: Math.random() * h,
                vx: rand(-0.25, 0.25),
                vy: rand(-0.25, 0.25),
                r: rand(0.8, 2.2)
            });
        }

        const LINK_DIST = 130;
        function tick() {
            if (frame % 120 === 0) readColor();
            frame++;
            ctx.clearRect(0, 0, w, h);
            for (let i = 0; i < particles.length; i++) {
                const p = particles[i];
                p.x += p.vx;
                p.y += p.vy;
                if (p.x < 0 || p.x > w) p.vx *= -1;
                if (p.y < 0 || p.y > h) p.vy *= -1;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.globalAlpha = 0.6;
                ctx.fill();
                for (let j = i + 1; j < particles.length; j++) {
                    const q = particles[j];
                    const dx = p.x - q.x;
                    const dy = p.y - q.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < LINK_DIST) {
                        ctx.globalAlpha = (1 - dist / LINK_DIST) * 0.22;
                        ctx.beginPath();
                        ctx.moveTo(p.x, p.y);
                        ctx.lineTo(q.x, q.y);
                        ctx.strokeStyle = color;
                        ctx.lineWidth = 1;
                        ctx.stroke();
                    }
                }
            }
            ctx.globalAlpha = 1;
            requestAnimationFrame(tick);
        }
        tick();
    }
})();

// =========================================================
// LMS dashboard presentation — view switching + stats
// (wires up the sidebar; does not touch any backend logic)
// =========================================================
const lmsDashboardEl = document.getElementById('lms-dashboard');
const lmsMonthsViewEl = document.getElementById('lms-months-view');

function setActiveLmsNav(name) {
    document.querySelectorAll('.lms-nav-item').forEach((item) => {
        item.classList.toggle('active', item.dataset.lmsNav === name);
    });
}

function enterLmsDashboard() {
    if (lmsDashboardEl) lmsDashboardEl.style.display = 'block';
    if (lmsMonthsViewEl) lmsMonthsViewEl.style.display = 'none';
    if (monthContentView) monthContentView.style.display = 'none';
    setActiveLmsNav('dashboard');
}

function enterLmsMonths() {
    if (lmsDashboardEl) lmsDashboardEl.style.display = 'none';
    if (lmsMonthsViewEl) {
        lmsMonthsViewEl.style.display = 'block';
        monthsGrid.style.display = 'grid';
    }
    if (monthContentView) monthContentView.style.display = 'none';
    setActiveLmsNav('months');
}

function refreshLmsStats() {
    if (!currentProfile) return;
    const courseName = (coursesCache.find((c) => c.id === currentProfile.courseId) || {}).name || currentProfile.courseId;
    const stats = { 'stat-months': monthsCache.length, 'stat-batch': courseName, 'stat-stream': currentProfile.stream || '—' };
    Object.entries(stats).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    });
}

// Sidebar + quick-card navigation
document.querySelectorAll('[data-lms-nav]').forEach((item) => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const target = item.dataset.lmsNav;
        if (target === 'dashboard') enterLmsDashboard();
        else if (target === 'months') enterLmsMonths();
        else {
            const srcMap = { edit: 'nav-edit-details-link', contact: 'nav-contact-link', signout: 'nav-signout-link' };
            const el = document.getElementById(srcMap[target]);
            if (el) el.click();
        }
    });
});

// Returning to Academics always lands on the dashboard overview
navAcademicsLink.addEventListener('click', () => enterLmsDashboard());
// Back button returns to the months view
backToMonthsBtn.addEventListener('click', () => enterLmsMonths());
