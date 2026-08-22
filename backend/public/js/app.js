const API = '/api';
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

let state = {
  token: localStorage.getItem('payroll_token') || null,
  user: JSON.parse(localStorage.getItem('payroll_user') || 'null'),
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function fmtMoney(n) {
  return 'KES ' + Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function api(path, options = {}) {
  // Fire-and-forget: piggyback a refresh on real activity without slowing
  // this request down or blocking on it.
  if (path !== '/auth/refresh' && path !== '/auth/login') maybeRefreshSession();

  const res = await fetch(API + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) {
    handleSessionExpired();
    const err = new Error('Session expired');
    err.sessionExpired = true;
    throw err;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Shows the raw error unless it's the session-expiry case (that's already
// handled by a full-screen redirect with its own message — piling an alert
// on top of it is just noise).
function reportError(err) {
  if (err && err.sessionExpired) return;
  alert(err.message);
}

function handleSessionExpired() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('payroll_token');
  localStorage.removeItem('payroll_user');
  showLogin();
  $('#login-error').textContent = 'Your session expired — sign in again to continue. Any unsaved employee draft was kept.';
}

/* ---------------- Auth ---------------- */

// A background setInterval is unreliable on mobile — browsers throttle or
// fully suspend JS timers once the tab isn't in the foreground (screen
// locked, app switched away), which is most of how this gets used on a
// phone. So instead of relying on a timer surviving that, the session
// renews opportunistically: on every real API call (guaranteed to happen
// during actual use), and whenever the tab becomes visible again after
// being backgrounded — both of which fire reliably regardless of what the
// OS did to background timers in between.
let lastSessionRefreshAt = 0;
const SESSION_REFRESH_MIN_GAP_MS = 5 * 60 * 1000; // don't refresh more than once per 5 min

async function maybeRefreshSession() {
  if (!state.token) return;
  if (Date.now() - lastSessionRefreshAt < SESSION_REFRESH_MIN_GAP_MS) return;
  lastSessionRefreshAt = Date.now();
  try {
    const res = await fetch(API + '/auth/refresh', {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}` },
    });
    if (!res.ok) return; // a real expiry is handled by api()'s own 401 check on the next actual request
    const data = await res.json();
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('payroll_token', data.token);
    localStorage.setItem('payroll_user', JSON.stringify(data.user));
  } catch (err) {
    // network hiccup — harmless, it'll just try again on the next activity
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') maybeRefreshSession();
});

function showApp() {
  $('#view-landing').classList.add('hidden');
  $('#view-login').classList.add('hidden');
  $('#view-app').classList.remove('hidden');
  $('#user-name').textContent = state.user ? state.user.name : '';
  if (!state.user || state.user.role !== 'admin') {
    $('#nav-users').classList.add('hidden');
    $('#nav-admin-label').classList.add('hidden');
  }
  if (state.user && state.user.role === 'hr_staff') {
    // hr_staff has no payroll/salary access — hide those nav items and form fields
    // (the backend enforces this independently; this just keeps the UI honest).
    ['run-payroll', 'history', 'p9'].forEach((view) => {
      const link = document.querySelector(`.nav-link[data-view="${view}"]`);
      if (link) link.classList.add('hidden');
    });
    $('#nav-payroll-label').classList.add('hidden');
    document.querySelectorAll('.payroll-field').forEach((el) => el.classList.add('hidden'));
    const salaryHeader = document.querySelector('#panel-employees thead th.num');
    if (salaryHeader) salaryHeader.classList.add('hidden');
  }
  maybeRefreshSession();
  loadEmployees();
}

function showLanding() {
  $('#view-app').classList.add('hidden');
  $('#view-login').classList.add('hidden');
  $('#view-landing').classList.remove('hidden');
}

function showLogin() {
  $('#view-app').classList.add('hidden');
  $('#view-landing').classList.add('hidden');
  $('#view-login').classList.remove('hidden');
}

$('#landing-signin-btn').addEventListener('click', showLogin);
$('#landing-back-btn').addEventListener('click', showLanding);

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#login-email').value.trim();
  const password = $('#login-password').value;
  $('#login-error').textContent = '';
  try {
    const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('payroll_token', data.token);
    localStorage.setItem('payroll_user', JSON.stringify(data.user));
    showApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

$('#logout-btn').addEventListener('click', () => {
  state.token = null;
  state.user = null;
  localStorage.removeItem('payroll_token');
  localStorage.removeItem('payroll_user');
  showLogin();
});

/* ---------------- Navigation ---------------- */

function openDrawer() {
  $('#sidebar').classList.add('drawer-open');
  $('#drawer-backdrop').classList.remove('hidden');
}
function closeDrawer() {
  $('#sidebar').classList.remove('drawer-open');
  $('#drawer-backdrop').classList.add('hidden');
}
$('#drawer-toggle').addEventListener('click', openDrawer);
$('#drawer-backdrop').addEventListener('click', closeDrawer);

$$('.nav-link').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.nav-link').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    $$('.panel').forEach((p) => p.classList.add('hidden'));
    $(`#panel-${btn.dataset.view}`).classList.remove('hidden');
    if (btn.dataset.view === 'history') loadHistory();
    if (btn.dataset.view === 'p9') loadP9EmployeeOptions();
    if (btn.dataset.view === 'leave') initLeaveTab();
    if (btn.dataset.view === 'attendance') initAttendanceTab();
    if (btn.dataset.view === 'performance') initPerformanceTab();
    if (btn.dataset.view === 'users') loadUsers();
    if (btn.dataset.view === 'compliance') initComplianceTab();
    closeDrawer(); // no-op on desktop, closes the off-canvas menu on mobile
  });
});

/* ---------------- Employees ---------------- */

async function loadEmployees() {
  const employees = await api('/employees');
  const tbody = $('#employees-tbody');
  const hideSalary = state.user && state.user.role === 'hr_staff';
  tbody.innerHTML = '';
  employees.forEach((emp) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${emp.employee_no}</td>
      <td>${emp.first_name} ${emp.last_name}</td>
      <td>${emp.department || '—'}</td>
      <td>${emp.job_title || '—'}</td>
      ${hideSalary ? '' : `<td class="num">${fmtMoney(emp.basic_salary)}</td>`}
      <td><span class="status-pill status-${emp.status}">${emp.status}</span></td>
      <td></td>
    `;
    tr.addEventListener('click', () => openEmployeeDetail(emp));
    tbody.appendChild(tr);
  });
}

/* ---------------- Employee form draft auto-save ----------------
   Guards against exactly what happened before: a session expiring (or the
   tab closing, or anything else interrupting) mid-form loses everything
   typed. Saved continuously to localStorage, restored next time the
   "Add employee" modal opens, cleared on successful save or explicit Cancel. */

const EMPLOYEE_DRAFT_KEY = 'employee_form_draft';
const EMPLOYEE_FIELD_IDS = [
  'f-employeeNo', 'f-firstName', 'f-lastName', 'f-email', 'f-department', 'f-jobTitle',
  'f-employmentType', 'f-kraPin', 'f-nssfNumber', 'f-shaNumber', 'f-basicSalary', 'f-phone',
  'f-emergencyContactName', 'f-emergencyContactPhone',
];

function saveEmployeeDraft() {
  const draft = {};
  EMPLOYEE_FIELD_IDS.forEach((id) => { draft[id] = $(`#${id}`).value; });
  localStorage.setItem(EMPLOYEE_DRAFT_KEY, JSON.stringify(draft));
}
function clearEmployeeDraft() { localStorage.removeItem(EMPLOYEE_DRAFT_KEY); }

$('#employee-form').addEventListener('input', saveEmployeeDraft);

$('#add-employee-btn').addEventListener('click', () => {
  $('#employee-form').reset();
  $('#employee-error').textContent = '';

  const savedDraft = localStorage.getItem(EMPLOYEE_DRAFT_KEY);
  if (savedDraft) {
    const draft = JSON.parse(savedDraft);
    EMPLOYEE_FIELD_IDS.forEach((id) => { if (draft[id]) $(`#${id}`).value = draft[id]; });
    $('#employee-error').textContent = 'Restored your unsaved draft from before.';
    $('#employee-error').style.color = 'var(--forest)';
  } else {
    $('#employee-error').style.color = '';
  }

  $('#employee-modal').classList.remove('hidden');
});
$('#employee-cancel').addEventListener('click', () => {
  clearEmployeeDraft();
  $('#employee-modal').classList.add('hidden');
});

$('#employee-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    employeeNo: $('#f-employeeNo').value.trim(),
    firstName: $('#f-firstName').value.trim(),
    lastName: $('#f-lastName').value.trim(),
    email: $('#f-email').value.trim() || null,
    department: $('#f-department').value.trim() || null,
    jobTitle: $('#f-jobTitle').value.trim() || null,
    employmentType: $('#f-employmentType').value,
    kraPin: $('#f-kraPin').value.trim() || null,
    nssfNumber: $('#f-nssfNumber').value.trim() || null,
    shaNumber: $('#f-shaNumber').value.trim() || null,
    phone: $('#f-phone').value.trim() || null,
    emergencyContactName: $('#f-emergencyContactName').value.trim() || null,
    emergencyContactPhone: $('#f-emergencyContactPhone').value.trim() || null,
  };
  if ($('#f-basicSalary').value !== '') payload.basicSalary = Number($('#f-basicSalary').value);
  try {
    await api('/employees', { method: 'POST', body: JSON.stringify(payload) });
    clearEmployeeDraft();
    $('#employee-modal').classList.add('hidden');
    loadEmployees();
  } catch (err) {
    if (!err.sessionExpired) {
      $('#employee-error').style.color = '';
      $('#employee-error').textContent = err.message;
    }
    // On session expiry the draft is deliberately left in place — it'll be
    // there waiting when they log back in and reopen "Add employee".
  }
});

/* ---------------- Employee detail (documents) ---------------- */

let currentDetailEmployeeId = null;

async function openEmployeeDetail(emp) {
  currentDetailEmployeeId = emp.id;
  $('#ed-name').textContent = `${emp.first_name} ${emp.last_name}`;
  $('#ed-meta').textContent = [emp.job_title, emp.department, emp.employee_no].filter(Boolean).join(' · ');
  $('#employee-detail-modal').classList.remove('hidden');
  await loadEmployeeDocuments();
}

async function loadEmployeeDocuments() {
  const docs = await api(`/employees/${currentDetailEmployeeId}/documents`);
  const tbody = $('#ed-documents-tbody');
  tbody.innerHTML = docs.length ? '' : '<tr><td colspan="3" class="muted">No documents recorded.</td></tr>';
  docs.forEach((d) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${d.link ? `<a href="${d.link}" target="_blank" rel="noopener">${d.name}</a>` : d.name}</td>
      <td>${d.category || '—'}</td>
      <td><button class="link-btn" data-doc-id="${d.id}">Remove</button></td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('[data-doc-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/employees/${currentDetailEmployeeId}/documents/${btn.dataset.docId}`, { method: 'DELETE' });
      loadEmployeeDocuments();
    });
  });
}

$('#ed-doc-add').addEventListener('click', async () => {
  const name = $('#ed-doc-name').value.trim();
  if (!name) return;
  await api(`/employees/${currentDetailEmployeeId}/documents`, {
    method: 'POST',
    body: JSON.stringify({
      name,
      category: $('#ed-doc-category').value,
      link: $('#ed-doc-link').value.trim() || null,
    }),
  });
  $('#ed-doc-name').value = '';
  $('#ed-doc-link').value = '';
  loadEmployeeDocuments();
});

$('#employee-detail-close').addEventListener('click', () => $('#employee-detail-modal').classList.add('hidden'));

$('#ed-certificate').addEventListener('click', async () => {
  try {
    await downloadFile(`/employees/${currentDetailEmployeeId}/certificate-of-service`, 'certificate-of-service.pdf');
  } catch (err) {
    reportError(err);
  }
});

$('#ed-terminate').addEventListener('click', async () => {
  if (!confirm('Mark this employee as terminated? Their records stay intact, but they\'ll be excluded from future payroll runs.')) return;
  try {
    await api(`/employees/${currentDetailEmployeeId}`, { method: 'DELETE' });
    $('#employee-detail-modal').classList.add('hidden');
    loadEmployees();
  } catch (err) {
    reportError(err);
  }
});

$('#ed-delete').addEventListener('click', async () => {
  if (!confirm('Permanently delete this employee record? This only works if they have no payroll history, and cannot be undone.')) return;
  try {
    await api(`/employees/${currentDetailEmployeeId}/permanent`, { method: 'DELETE' });
    $('#employee-detail-modal').classList.add('hidden');
    loadEmployees();
  } catch (err) {
    reportError(err);
  }
});

/* ---------------- Shared: populate an employee <select> ---------------- */

async function populateEmployeeSelect(selectEl, { includeAllOption = false } = {}) {
  const employees = await api('/employees');
  const keepFirst = includeAllOption ? selectEl.firstElementChild : null;
  selectEl.innerHTML = '';
  if (keepFirst) selectEl.appendChild(keepFirst);
  employees.forEach((emp) => {
    const opt = document.createElement('option');
    opt.value = emp.id;
    opt.textContent = `${emp.first_name} ${emp.last_name} (${emp.employee_no})`;
    selectEl.appendChild(opt);
  });
}

/* ---------------- Leave ---------------- */

async function initLeaveTab() {
  await populateEmployeeSelect($('#lv-employee'));
  await populateEmployeeSelect($('#lv-balance-employee'));
  const types = await api('/leave/types');
  $('#lv-type').innerHTML = types.map((t) => `<option value="${t.id}">${t.name} (${t.annual_entitlement_days} days/yr)</option>`).join('');
  $('#lv-balance-year').value = now.getFullYear();
  await loadLeaveRequests();
}

$('#lv-submit').addEventListener('click', async () => {
  $('#lv-error').textContent = '';
  try {
    await api('/leave/requests', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: $('#lv-employee').value,
        leaveTypeId: $('#lv-type').value,
        startDate: $('#lv-start').value,
        endDate: $('#lv-end').value,
        reason: $('#lv-reason').value.trim() || null,
      }),
    });
    $('#lv-start').value = '';
    $('#lv-end').value = '';
    $('#lv-reason').value = '';
    loadLeaveRequests();
  } catch (err) {
    $('#lv-error').textContent = err.message;
  }
});

$('#lv-balance-check').addEventListener('click', async () => {
  const employeeId = $('#lv-balance-employee').value;
  const year = $('#lv-balance-year').value;
  const balances = await api(`/leave/balance/${employeeId}?year=${year}`);
  $('#lv-balance-result').innerHTML = `
    <table class="ledger-table">
      <thead><tr><th>Type</th><th class="num">Entitlement</th><th class="num">Taken</th><th class="num">Remaining</th></tr></thead>
      <tbody>
        ${balances.map((b) => `
          <tr>
            <td>${b.name}</td>
            <td class="num">${b.annual_entitlement_days}</td>
            <td class="num">${b.days_taken}</td>
            <td class="num">${b.days_remaining}</td>
          </tr>`).join('')}
      </tbody>
    </table>
  `;
});

async function loadLeaveRequests() {
  const requests = await api('/leave/requests');
  const tbody = $('#leave-requests-tbody');
  tbody.innerHTML = '';
  requests.forEach((r) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.first_name} ${r.last_name}</td>
      <td>${r.leave_type_name}</td>
      <td>${r.start_date.slice(0, 10)} → ${r.end_date.slice(0, 10)}</td>
      <td class="num">${r.days}</td>
      <td><span class="status-pill status-${r.status === 'approved' ? 'active' : r.status === 'rejected' ? 'terminated' : 'draft'}">${r.status}</span></td>
      <td>${r.status === 'pending' ? `
        <button class="link-btn" data-approve="${r.id}">Approve</button> ·
        <button class="link-btn" data-reject="${r.id}">Reject</button>
      ` : ''}</td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('[data-approve]').forEach((btn) => {
    btn.addEventListener('click', async () => { await api(`/leave/requests/${btn.dataset.approve}/approve`, { method: 'POST' }); loadLeaveRequests(); });
  });
  tbody.querySelectorAll('[data-reject]').forEach((btn) => {
    btn.addEventListener('click', async () => { await api(`/leave/requests/${btn.dataset.reject}/reject`, { method: 'POST' }); loadLeaveRequests(); });
  });
}

/* ---------------- Attendance ---------------- */

const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'on_leave', 'holiday'];

function initAttendanceTab() {
  if (!$('#att-date').value) $('#att-date').value = new Date().toISOString().slice(0, 10);
  loadAttendance();
  initOvertimeSection();
}

$('#att-load').addEventListener('click', loadAttendance);

async function loadAttendance() {
  const date = $('#att-date').value;
  const { records } = await api(`/attendance?date=${date}`);
  const tbody = $('#attendance-tbody');
  tbody.innerHTML = '';
  records.forEach((r) => {
    const tr = document.createElement('tr');
    tr.dataset.employeeId = r.employee_id;
    tr.innerHTML = `
      <td>${r.first_name} ${r.last_name}</td>
      <td><select class="att-status">${ATTENDANCE_STATUSES.map((s) => `<option value="${s}" ${r.status === s ? 'selected' : ''}>${s.replace('_', ' ')}</option>`).join('')}</select></td>
      <td><input type="time" class="att-checkin" value="${r.check_in || ''}" /></td>
      <td><input type="time" class="att-checkout" value="${r.check_out || ''}" /></td>
    `;
    tbody.appendChild(tr);
  });
}

$('#att-save').addEventListener('click', async () => {
  $('#att-error').textContent = '';
  const date = $('#att-date').value;
  const records = [...$('#attendance-tbody').querySelectorAll('tr')].map((tr) => ({
    employeeId: tr.dataset.employeeId,
    status: tr.querySelector('.att-status').value,
    checkIn: tr.querySelector('.att-checkin').value || null,
    checkOut: tr.querySelector('.att-checkout').value || null,
  }));
  try {
    await api('/attendance', { method: 'POST', body: JSON.stringify({ date, records }) });
  } catch (err) {
    $('#att-error').textContent = err.message;
  }
});

/* ---------------- Overtime ---------------- */

async function initOvertimeSection() {
  await populateEmployeeSelect($('#ot-employee'));
  if (!$('#ot-date').value) $('#ot-date').value = new Date().toISOString().slice(0, 10);
  loadOvertimeEntries();
}

$('#ot-submit').addEventListener('click', async () => {
  $('#ot-error').textContent = '';
  try {
    await api('/overtime', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: $('#ot-employee').value,
        date: $('#ot-date').value,
        hours: Number($('#ot-hours').value),
        rateType: $('#ot-rate-type').value,
      }),
    });
    $('#ot-hours').value = '';
    loadOvertimeEntries();
  } catch (err) {
    $('#ot-error').textContent = err.message;
  }
});

async function loadOvertimeEntries() {
  const entries = await api('/overtime');
  const tbody = $('#overtime-tbody');
  tbody.innerHTML = '';
  entries.forEach((e) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${e.first_name} ${e.last_name}</td>
      <td>${e.date.slice(0, 10)}</td>
      <td class="num">${e.hours}</td>
      <td>${e.rate_type === 'rest_day_holiday' ? 'Rest day / holiday (2×)' : 'Weekday (1.5×)'}</td>
      <td><span class="status-pill status-${e.payroll_run_id ? 'active' : 'draft'}">${e.payroll_run_id ? 'applied' : 'pending'}</span></td>
      <td>${!e.payroll_run_id ? `<button class="link-btn" data-remove-ot="${e.id}">Remove</button>` : ''}</td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('[data-remove-ot]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/overtime/${btn.dataset.removeOt}`, { method: 'DELETE' });
      loadOvertimeEntries();
    });
  });
}

/* ---------------- Compliance (WIBA) ---------------- */

async function initComplianceTab() {
  loadWibaPolicies();
}

$('#wiba-submit').addEventListener('click', async () => {
  $('#wiba-error').textContent = '';
  try {
    await api('/wiba', {
      method: 'POST',
      body: JSON.stringify({
        insurerName: $('#wiba-insurer').value.trim(),
        policyNumber: $('#wiba-policy-number').value.trim(),
        coverageStart: $('#wiba-start').value,
        coverageEnd: $('#wiba-end').value,
        premiumAmount: $('#wiba-premium').value ? Number($('#wiba-premium').value) : null,
      }),
    });
    ['wiba-insurer', 'wiba-policy-number', 'wiba-start', 'wiba-end', 'wiba-premium'].forEach((id) => { $(`#${id}`).value = ''; });
    loadWibaPolicies();
  } catch (err) {
    $('#wiba-error').textContent = err.message;
  }
});

async function loadWibaPolicies() {
  const policies = await api('/wiba');
  const tbody = $('#wiba-tbody');
  const today = new Date().toISOString().slice(0, 10);
  tbody.innerHTML = policies.length ? '' : '<tr><td colspan="4" class="muted">No WIBA policy recorded yet.</td></tr>';
  policies.forEach((p) => {
    const active = p.coverage_start.slice(0, 10) <= today && today <= p.coverage_end.slice(0, 10);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.insurer_name}</td>
      <td>${p.policy_number}</td>
      <td>${p.coverage_start.slice(0, 10)} → ${p.coverage_end.slice(0, 10)}</td>
      <td><span class="status-pill status-${active ? 'active' : 'terminated'}">${active ? 'active' : 'expired'}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

/* ---------------- Performance ---------------- */

async function initPerformanceTab() {
  await populateEmployeeSelect($('#pf-employee'));
  await populateEmployeeSelect($('#pf-filter-employee'), { includeAllOption: true });
  await loadPerformanceReviews();
}

$('#pf-submit').addEventListener('click', async () => {
  $('#pf-error').textContent = '';
  try {
    await api('/performance', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: $('#pf-employee').value,
        reviewPeriod: $('#pf-period').value.trim(),
        reviewerName: $('#pf-reviewer').value.trim() || null,
        rating: $('#pf-rating').value || null,
        strengths: $('#pf-strengths').value.trim() || null,
        improvements: $('#pf-improvements').value.trim() || null,
        goals: $('#pf-goals').value.trim() || null,
        comments: $('#pf-comments').value.trim() || null,
      }),
    });
    ['pf-period', 'pf-reviewer', 'pf-strengths', 'pf-improvements', 'pf-goals', 'pf-comments'].forEach((id) => { $(`#${id}`).value = ''; });
    $('#pf-rating').value = '';
    loadPerformanceReviews();
  } catch (err) {
    $('#pf-error').textContent = err.message;
  }
});

$('#pf-filter-employee').addEventListener('change', loadPerformanceReviews);

async function loadPerformanceReviews() {
  const employeeId = $('#pf-filter-employee').value;
  const reviews = await api(`/performance${employeeId ? `?employeeId=${employeeId}` : ''}`);
  const stars = (r) => r ? '★'.repeat(r) + '☆'.repeat(5 - r) : '—';
  $('#perf-list').innerHTML = reviews.length ? reviews.map((r) => `
    <div class="review-card">
      <div class="review-head">
        <strong>${r.first_name} ${r.last_name}</strong> — ${r.review_period}
        <span class="review-stars">${stars(r.rating)}</span>
      </div>
      ${r.reviewer_name ? `<div class="muted">Reviewer: ${r.reviewer_name}</div>` : ''}
      ${r.strengths ? `<div><strong>Strengths:</strong> ${r.strengths}</div>` : ''}
      ${r.improvements ? `<div><strong>Areas for improvement:</strong> ${r.improvements}</div>` : ''}
      ${r.goals ? `<div><strong>Goals:</strong> ${r.goals}</div>` : ''}
      ${r.comments ? `<div><strong>Comments:</strong> ${r.comments}</div>` : ''}
    </div>
  `).join('') : '<p class="muted">No reviews yet.</p>';
}

/* ---------------- Run payroll ---------------- */

MONTHS.forEach((m, i) => {
  const opt = document.createElement('option');
  opt.value = i + 1;
  opt.textContent = m;
  $('#run-month').appendChild(opt);
});
const now = new Date();
$('#run-month').value = now.getMonth() + 1;
$('#run-year').value = now.getFullYear();

$('#run-payroll-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const periodMonth = Number($('#run-month').value);
  const periodYear = Number($('#run-year').value);
  const resultEl = $('#run-payroll-result');
  resultEl.innerHTML = '<p class="muted">Processing…</p>';
  try {
    const data = await api('/payroll/run', { method: 'POST', body: JSON.stringify({ periodMonth, periodYear }) });
    const totalNet = data.payslips.reduce((s, p) => s + Number(p.net_pay), 0);
    resultEl.innerHTML = `
      <div class="result-banner">Processed ${data.payslips.length} payslip(s) for ${MONTHS[periodMonth - 1]} ${periodYear} using "${data.rateSetLabel}". Total net pay: ${fmtMoney(totalNet)}.</div>
      <table class="ledger-table">
        <thead><tr><th>Employee</th><th class="num">Gross</th><th class="num">PAYE</th><th class="num">NSSF</th><th class="num">SHA</th><th class="num">Housing Levy</th><th class="num">Net pay</th></tr></thead>
        <tbody>
          ${data.payslips.map((p) => `
            <tr data-payslip='${JSON.stringify(p).replace(/'/g, '&#39;')}'>
              <td>${p.first_name} ${p.last_name}</td>
              <td class="num">${fmtMoney(p.gross_pay)}</td>
              <td class="num">${fmtMoney(p.paye)}</td>
              <td class="num">${fmtMoney(p.nssf_total)}</td>
              <td class="num">${fmtMoney(p.sha_contribution)}</td>
              <td class="num">${fmtMoney(p.housing_levy)}</td>
              <td class="num">${fmtMoney(p.net_pay)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;
    resultEl.querySelectorAll('tr[data-payslip]').forEach((row) => {
      row.addEventListener('click', () => openPayslip(JSON.parse(row.dataset.payslip)));
    });
  } catch (err) {
    resultEl.innerHTML = `<div class="error-banner">${err.message}</div>`;
  }
});

/* ---------------- History ---------------- */

async function loadHistory() {
  const runs = await api('/payroll/runs');
  const tbody = $('#history-tbody');
  tbody.innerHTML = '';
  $('#run-detail').innerHTML = '';
  runs.forEach((run) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${MONTHS[run.period_month - 1]} ${run.period_year}</td>
      <td><span class="status-pill status-${run.status}">${run.status}</span></td>
      <td class="num">${run.employee_count}</td>
      <td class="num">${fmtMoney(run.total_net_pay)}</td>
      <td></td>
    `;
    tr.addEventListener('click', () => loadRunDetail(run.id));
    tbody.appendChild(tr);
  });
}

const REMITTANCE_LABELS = { paye: 'PAYE (KRA)', nssf: 'NSSF', sha: 'SHA (SHIF)', housing_levy: 'Housing Levy' };

async function loadRunDetail(runId) {
  const { payrollRun, payslips } = await api(`/payroll/runs/${runId}`);
  const detail = $('#run-detail');
  detail.innerHTML = `
    <h3 style="font-family: var(--font-display); margin-top: 28px;">
      ${MONTHS[payrollRun.period_month - 1]} ${payrollRun.period_year} — payslips
    </h3>
    <div class="run-detail-actions">
      ${payrollRun.status === 'processed' ? `<button class="btn btn-primary" id="mark-paid-btn">Mark as paid</button>` : ''}
      <button class="btn btn-ghost" id="export-mpesa-btn">Download M-Pesa payment CSV</button>
      <button class="btn btn-ghost" id="export-bank-btn">Download bank payment CSV</button>
      <button class="btn btn-ghost" id="export-p10-btn">Download P10 monthly return</button>
    </div>
    <p class="form-error" id="export-warning"></p>
    <table class="ledger-table">
      <thead><tr><th>Employee</th><th class="num">Gross</th><th class="num">PAYE</th><th class="num">Net pay</th></tr></thead>
      <tbody>
        ${payslips.map((p) => `
          <tr data-payslip='${JSON.stringify(p).replace(/'/g, '&#39;')}'>
            <td>${p.first_name} ${p.last_name}${p.deduction_cap_breached ? ' <span class="status-pill status-terminated">deduction cap</span>' : ''}</td>
            <td class="num">${fmtMoney(p.gross_pay)}</td>
            <td class="num">${fmtMoney(p.paye)}</td>
            <td class="num">${fmtMoney(p.net_pay)}</td>
          </tr>`).join('')}
      </tbody>
    </table>

    <h3 class="subhead">Statutory remittances</h3>
    <p class="muted">What's owed for this run, and whether it's actually been paid to KRA/NSSF/SHA yet.</p>
    <div id="remittances-list"></div>
  `;
  detail.querySelectorAll('tr[data-payslip]').forEach((row) => {
    row.addEventListener('click', () => openPayslip(JSON.parse(row.dataset.payslip)));
  });
  const markPaidBtn = $('#mark-paid-btn');
  if (markPaidBtn) {
    markPaidBtn.addEventListener('click', async (evt) => {
      evt.stopPropagation();
      await api(`/payroll/runs/${runId}/mark-paid`, { method: 'POST' });
      loadRunDetail(runId);
      loadHistory();
    });
  }

  function describeSkipped(skipped) {
    if (skipped.length === 0) return '';
    const names = skipped.map((s) => `${s.name} (${s.reason})`).join('; ');
    return `Skipped ${skipped.length} employee(s) — missing info: ${names}`;
  }

  $('#export-mpesa-btn').addEventListener('click', async () => {
    $('#export-warning').textContent = '';
    try {
      const { skipped } = await downloadFile(`/payroll/runs/${runId}/export/mpesa`, 'mpesa-payment.csv');
      $('#export-warning').textContent = describeSkipped(skipped);
    } catch (err) {
      reportError(err);
    }
  });
  $('#export-bank-btn').addEventListener('click', async () => {
    $('#export-warning').textContent = '';
    try {
      const { skipped } = await downloadFile(`/payroll/runs/${runId}/export/bank`, 'bank-payment.csv');
      $('#export-warning').textContent = describeSkipped(skipped);
    } catch (err) {
      reportError(err);
    }
  });
  $('#export-p10-btn').addEventListener('click', async () => {
    try {
      await downloadFile(`/payroll/runs/${runId}/p10`, 'p10.pdf');
    } catch (err) {
      reportError(err);
    }
  });

  loadRemittances(runId);
}

async function loadRemittances(runId) {
  const remittances = await api(`/payroll/runs/${runId}/remittances`);
  const container = $('#remittances-list');
  container.innerHTML = remittances.map((r) => `
    <div class="review-card" data-type="${r.type}">
      <div class="review-head">
        <strong>${REMITTANCE_LABELS[r.type] || r.type}</strong>
        <span class="status-pill status-${r.paid ? 'active' : 'draft'}" style="margin-left:auto;">${r.paid ? 'paid' : 'pending'}</span>
      </div>
      <div>Amount due: ${fmtMoney(r.amount_due)}</div>
      ${r.paid
        ? `<div class="muted">Paid ${r.paid_date ? r.paid_date.slice(0, 10) : ''}${r.reference_number ? ' · Ref: ' + r.reference_number : ''}</div>`
        : `
          <div class="inline-form" style="margin-top:10px;">
            <label>Reference no. <input type="text" class="remit-ref" /></label>
            <label>Paid date <input type="date" class="remit-date" /></label>
            <button type="button" class="btn btn-ghost remit-pay-btn">Mark as paid</button>
          </div>
        `}
    </div>
  `).join('');

  container.querySelectorAll('.remit-pay-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.review-card');
      const type = card.dataset.type;
      const referenceNumber = card.querySelector('.remit-ref').value.trim();
      const paidDate = card.querySelector('.remit-date').value;
      try {
        await api(`/payroll/runs/${runId}/remittances/${type}/pay`, {
          method: 'POST',
          body: JSON.stringify({ referenceNumber, paidDate }),
        });
        loadRemittances(runId);
      } catch (err) {
        reportError(err);
      }
    });
  });
}

/* ---------------- Payslip receipt ---------------- */

function openPayslip(p) {
  currentPayslipId = p.id;
  $('#payslip-content').innerHTML = `
    <div class="payslip">
      <div class="payslip-header">${p.first_name} ${p.last_name}</div>
      <div class="payslip-sub">Employee No. ${p.employee_no || ''}</div>

      <div class="payslip-section-label">Earnings</div>
      <div class="payslip-row"><span>Basic salary</span><span>${fmtMoney(p.basic_salary)}</span></div>
      <div class="payslip-row"><span>Taxable allowances</span><span>${fmtMoney(p.taxable_allowances)}</span></div>
      <div class="payslip-row"><span>Non-taxable allowances</span><span>${fmtMoney(p.non_taxable_allowances)}</span></div>
      <div class="payslip-row total"><span>Gross pay</span><span>${fmtMoney(p.gross_pay)}</span></div>

      <div class="payslip-section-label">Statutory deductions</div>
      <div class="payslip-row"><span>NSSF Tier I</span><span>${fmtMoney(p.nssf_tier1)}</span></div>
      <div class="payslip-row"><span>NSSF Tier II</span><span>${fmtMoney(p.nssf_tier2)}</span></div>
      <div class="payslip-row"><span>SHA (SHIF)</span><span>${fmtMoney(p.sha_contribution)}</span></div>
      <div class="payslip-row"><span>Housing Levy</span><span>${fmtMoney(p.housing_levy)}</span></div>
      <div class="payslip-row"><span>Taxable income</span><span>${fmtMoney(p.taxable_income)}</span></div>
      <div class="payslip-row"><span>PAYE (before relief)</span><span>${fmtMoney(p.paye_before_relief)}</span></div>
      <div class="payslip-row"><span>Personal relief</span><span>−${fmtMoney(p.personal_relief)}</span></div>
      <div class="payslip-row"><span>PAYE payable</span><span>${fmtMoney(p.paye)}</span></div>
      ${Number(p.other_deductions_total) > 0 ? `<div class="payslip-row"><span>Other deductions</span><span>${fmtMoney(p.other_deductions_total)}</span></div>` : ''}
      <div class="payslip-row total"><span>Total deductions</span><span>${fmtMoney(p.total_deductions)}</span></div>

      <div class="payslip-row net"><span>Net pay</span><span>${fmtMoney(p.net_pay)}</span></div>
    </div>
  `;
  $('#payslip-modal').classList.remove('hidden');
}
$('#payslip-close').addEventListener('click', () => $('#payslip-modal').classList.add('hidden'));

let currentPayslipId = null;
$('#payslip-download').addEventListener('click', async () => {
  if (!currentPayslipId) return;
  try {
    await downloadFile(`/payroll/payslips/${currentPayslipId}/pdf`, 'payslip.pdf');
  } catch (err) {
    reportError(err);
  }
});

/* ---------------- Authenticated file downloads ---------------- */

async function downloadFile(path, fallbackFilename) {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${state.token}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Download failed');
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : fallbackFilename;
  const skippedHeader = res.headers.get('X-Skipped-Employees');
  const skipped = skippedHeader ? JSON.parse(decodeURIComponent(skippedHeader)) : [];

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  return { filename, skipped };
}

/* ---------------- P9 forms ---------------- */

async function loadP9EmployeeOptions() {
  const employees = await api('/employees');
  const select = $('#p9-employee');
  select.innerHTML = '';
  employees.forEach((emp) => {
    const opt = document.createElement('option');
    opt.value = emp.id;
    opt.textContent = `${emp.first_name} ${emp.last_name} (${emp.employee_no})`;
    select.appendChild(opt);
  });
}
$('#p9-year').value = now.getFullYear();

$('#p9-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const employeeId = $('#p9-employee').value;
  const year = $('#p9-year').value;
  $('#p9-error').textContent = '';
  try {
    await downloadFile(`/payroll/employees/${employeeId}/p9/${year}`, `P9-${year}.pdf`);
  } catch (err) {
    $('#p9-error').textContent = err.message;
  }
});

/* ---------------- Users (admin only) ---------------- */

async function loadUsers() {
  const users = await api('/users');
  const tbody = $('#users-tbody');
  tbody.innerHTML = '';
  const ROLE_LABELS = { admin: 'Admin', staff: 'Staff', hr_staff: 'HR staff' };
  users.forEach((u) => {
    const isSelf = state.user && u.id === state.user.id;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${u.name}${isSelf ? ' <span class="muted">(you)</span>' : ''}</td>
      <td>${u.email}</td>
      <td>
        ${isSelf ? `<span class="status-pill status-active">${ROLE_LABELS[u.role]}</span>` : `
          <select class="role-select" data-user-id="${u.id}">
            <option value="staff" ${u.role === 'staff' ? 'selected' : ''}>Staff</option>
            <option value="hr_staff" ${u.role === 'hr_staff' ? 'selected' : ''}>HR staff</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
        `}
      </td>
      <td><span class="status-pill status-${u.is_active ? 'active' : 'terminated'}">${u.is_active ? 'active' : 'deactivated'}</span></td>
      <td>
        ${!isSelf ? `
          <button class="link-btn" data-toggle-active="${u.id}" data-current-active="${u.is_active}">
            ${u.is_active ? 'Deactivate' : 'Reactivate'}
          </button>
        ` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.role-select').forEach((select) => {
    select.addEventListener('change', async () => {
      try {
        await api(`/users/${select.dataset.userId}`, { method: 'PUT', body: JSON.stringify({ role: select.value }) });
        loadUsers();
      } catch (err) { reportError(err); loadUsers(); }
    });
  });
  tbody.querySelectorAll('[data-toggle-active]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const newActive = btn.dataset.currentActive !== 'true';
      try {
        await api(`/users/${btn.dataset.toggleActive}`, { method: 'PUT', body: JSON.stringify({ isActive: newActive }) });
        loadUsers();
      } catch (err) { reportError(err); }
    });
  });
}

$('#u-add').addEventListener('click', async () => {
  $('#u-error').textContent = '';
  try {
    await api('/users', {
      method: 'POST',
      body: JSON.stringify({
        name: $('#u-name').value.trim(),
        email: $('#u-email').value.trim(),
        password: $('#u-password').value,
        role: $('#u-role').value,
      }),
    });
    $('#u-name').value = '';
    $('#u-email').value = '';
    $('#u-password').value = '';
    $('#u-role').value = 'staff';
    loadUsers();
  } catch (err) {
    $('#u-error').textContent = err.message;
  }
});

/* ---------------- Boot ---------------- */

if (state.token) showApp(); else showLanding();
