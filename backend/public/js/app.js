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
  const res = await fetch(API + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/* ---------------- Auth ---------------- */

function showApp() {
  $('#view-login').classList.add('hidden');
  $('#view-app').classList.remove('hidden');
  $('#user-name').textContent = state.user ? state.user.name : '';
  loadEmployees();
}

function showLogin() {
  $('#view-app').classList.add('hidden');
  $('#view-login').classList.remove('hidden');
}

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

$$('.nav-link').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.nav-link').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    $$('.panel').forEach((p) => p.classList.add('hidden'));
    $(`#panel-${btn.dataset.view}`).classList.remove('hidden');
    if (btn.dataset.view === 'history') loadHistory();
    if (btn.dataset.view === 'p9') loadP9EmployeeOptions();
  });
});

/* ---------------- Employees ---------------- */

async function loadEmployees() {
  const employees = await api('/employees');
  const tbody = $('#employees-tbody');
  tbody.innerHTML = '';
  employees.forEach((emp) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${emp.employee_no}</td>
      <td>${emp.first_name} ${emp.last_name}</td>
      <td>${emp.kra_pin || '—'}</td>
      <td class="num">${fmtMoney(emp.basic_salary)}</td>
      <td><span class="status-pill status-${emp.status}">${emp.status}</span></td>
      <td></td>
    `;
    tbody.appendChild(tr);
  });
}

$('#add-employee-btn').addEventListener('click', () => {
  $('#employee-form').reset();
  $('#employee-error').textContent = '';
  $('#employee-modal').classList.remove('hidden');
});
$('#employee-cancel').addEventListener('click', () => $('#employee-modal').classList.add('hidden'));

$('#employee-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    employeeNo: $('#f-employeeNo').value.trim(),
    firstName: $('#f-firstName').value.trim(),
    lastName: $('#f-lastName').value.trim(),
    email: $('#f-email').value.trim() || null,
    kraPin: $('#f-kraPin').value.trim() || null,
    nssfNumber: $('#f-nssfNumber').value.trim() || null,
    shaNumber: $('#f-shaNumber').value.trim() || null,
    basicSalary: Number($('#f-basicSalary').value),
  };
  try {
    await api('/employees', { method: 'POST', body: JSON.stringify(payload) });
    $('#employee-modal').classList.add('hidden');
    loadEmployees();
  } catch (err) {
    $('#employee-error').textContent = err.message;
  }
});

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

async function loadRunDetail(runId) {
  const { payrollRun, payslips } = await api(`/payroll/runs/${runId}`);
  const detail = $('#run-detail');
  detail.innerHTML = `
    <h3 style="font-family: var(--font-display); margin-top: 28px;">
      ${MONTHS[payrollRun.period_month - 1]} ${payrollRun.period_year} — payslips
      ${payrollRun.status === 'processed' ? `<button class="btn btn-primary" id="mark-paid-btn" style="font-size:12px; margin-left:12px;">Mark as paid</button>` : ''}
    </h3>
    <table class="ledger-table">
      <thead><tr><th>Employee</th><th class="num">Gross</th><th class="num">PAYE</th><th class="num">Net pay</th></tr></thead>
      <tbody>
        ${payslips.map((p) => `
          <tr data-payslip='${JSON.stringify(p).replace(/'/g, '&#39;')}'>
            <td>${p.first_name} ${p.last_name}</td>
            <td class="num">${fmtMoney(p.gross_pay)}</td>
            <td class="num">${fmtMoney(p.paye)}</td>
            <td class="num">${fmtMoney(p.net_pay)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
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
    alert(err.message);
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

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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

/* ---------------- Boot ---------------- */

if (state.token) showApp(); else showLogin();
