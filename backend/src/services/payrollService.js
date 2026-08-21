const pool = require('../config/db');
const { calculatePayslip } = require('./statutoryDeductions');

async function getActiveRateSet(client) {
  const { rows } = await client.query(
    'SELECT * FROM statutory_rate_sets WHERE is_active = true ORDER BY effective_from DESC LIMIT 1'
  );
  if (rows.length === 0) {
    throw new Error('No active statutory rate set configured. Run the seed/migration first.');
  }
  return rows[0];
}

/**
 * Runs payroll for every active employee for the given month/year.
 * Idempotent per (month, year): re-running an existing draft period
 * recalculates and overwrites its payslips.
 */
async function runPayroll({ periodMonth, periodYear, createdBy }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const rateSet = await getActiveRateSet(client);

    let { rows: runRows } = await client.query(
      'SELECT * FROM payroll_runs WHERE period_month = $1 AND period_year = $2',
      [periodMonth, periodYear]
    );

    let payrollRun;
    if (runRows.length > 0) {
      payrollRun = runRows[0];
      if (payrollRun.status === 'paid') {
        throw new Error('This payroll period has already been marked as paid and cannot be re-run.');
      }
      await client.query('DELETE FROM payslips WHERE payroll_run_id = $1', [payrollRun.id]);
      await client.query(
        'UPDATE payroll_runs SET status = $1, rate_set_id = $2, run_date = now() WHERE id = $3',
        ['draft', rateSet.id, payrollRun.id]
      );
    } else {
      const { rows } = await client.query(
        `INSERT INTO payroll_runs (period_month, period_year, status, rate_set_id, created_by)
         VALUES ($1, $2, 'draft', $3, $4) RETURNING *`,
        [periodMonth, periodYear, rateSet.id, createdBy || null]
      );
      payrollRun = rows[0];
    }

    const { rows: employees } = await client.query(
      `SELECT * FROM employees WHERE status = 'active'`
    );

    const payslips = [];
    for (const emp of employees) {
      const result = calculatePayslip(
        {
          basicSalary: Number(emp.basic_salary),
          allowances: emp.allowances || [],
          otherDeductions: emp.other_deductions || [],
          pensionContribution: Number(emp.pension_contribution || 0),
        },
        rateSet.config
      );

      const { rows: inserted } = await client.query(
        `INSERT INTO payslips (
           payroll_run_id, employee_id, basic_salary, taxable_allowances, non_taxable_allowances,
           gross_pay, nssf_tier1, nssf_tier2, nssf_total, sha_contribution, housing_levy,
           pension_contribution, taxable_income, paye_before_relief, personal_relief, paye,
           other_deductions_total, other_deductions_detail, total_deductions, net_pay,
           employer_nssf, employer_housing_levy
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
         RETURNING *`,
        [
          payrollRun.id,
          emp.id,
          result.basicSalary,
          result.taxableAllowances,
          result.nonTaxableAllowances,
          result.grossPay,
          result.nssf.tier1,
          result.nssf.tier2,
          result.nssf.employeeTotal,
          result.sha,
          result.housingLevy.employee,
          result.pensionContribution,
          result.taxableIncome,
          result.payeBeforeRelief,
          result.personalRelief,
          result.paye,
          result.otherDeductionsTotal,
          JSON.stringify(result.otherDeductions),
          result.totalDeductions,
          result.netPay,
          result.nssf.employerTotal,
          result.housingLevy.employer,
        ]
      );
      payslips.push({ ...inserted[0], employee_no: emp.employee_no, first_name: emp.first_name, last_name: emp.last_name });
    }

    await client.query('UPDATE payroll_runs SET status = $1 WHERE id = $2', ['processed', payrollRun.id]);
    await client.query('COMMIT');

    return { payrollRun: { ...payrollRun, status: 'processed' }, payslips, rateSetLabel: rateSet.label };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getPayrollRun(payrollRunId) {
  const { rows: runRows } = await pool.query('SELECT * FROM payroll_runs WHERE id = $1', [payrollRunId]);
  if (runRows.length === 0) return null;

  const { rows: payslips } = await pool.query(
    `SELECT p.*, e.employee_no, e.first_name, e.last_name, e.bank_name, e.bank_account
     FROM payslips p JOIN employees e ON e.id = p.employee_id
     WHERE p.payroll_run_id = $1 ORDER BY e.first_name`,
    [payrollRunId]
  );

  return { payrollRun: runRows[0], payslips };
}

async function listPayrollRuns() {
  const { rows } = await pool.query(
    `SELECT pr.*, count(ps.id) AS employee_count, COALESCE(sum(ps.net_pay), 0) AS total_net_pay
     FROM payroll_runs pr LEFT JOIN payslips ps ON ps.payroll_run_id = pr.id
     GROUP BY pr.id ORDER BY pr.period_year DESC, pr.period_month DESC`
  );
  return rows;
}

module.exports = { runPayroll, getPayrollRun, listPayrollRuns, getActiveRateSet };
