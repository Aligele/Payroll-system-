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
 *
 * Also folds in any unapplied overtime entries logged for each employee
 * within that period, and records the amounts owed to KRA/NSSF/SHA/the
 * Housing Levy as pending remittances (see the `remittances` table) so
 * they can be marked paid once actually sent.
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
      // Release any overtime entries this run had already claimed, so a
      // recompute picks them up again instead of silently losing them.
      await client.query('UPDATE overtime_entries SET payroll_run_id = NULL WHERE payroll_run_id = $1', [payrollRun.id]);
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

    const periodStart = `${periodYear}-${String(periodMonth).padStart(2, '0')}-01`;
    const periodEnd = new Date(periodYear, periodMonth, 0).toISOString().slice(0, 10); // last day of month

    const { rows: employees } = await client.query(
      `SELECT * FROM employees WHERE status = 'active'`
    );

    const remittanceTotals = { paye: 0, nssf: 0, sha: 0, housing_levy: 0 };
    const payslips = [];

    for (const emp of employees) {
      const { rows: overtimeRows } = await client.query(
        `SELECT * FROM overtime_entries
         WHERE employee_id = $1 AND payroll_run_id IS NULL AND date BETWEEN $2 AND $3`,
        [emp.id, periodStart, periodEnd]
      );
      const overtimeHours = overtimeRows.reduce(
        (acc, row) => {
          if (row.rate_type === 'rest_day_holiday') acc.restDayHoliday += Number(row.hours);
          else acc.weekday += Number(row.hours);
          return acc;
        },
        { weekday: 0, restDayHoliday: 0 }
      );

      const result = calculatePayslip(
        {
          basicSalary: Number(emp.basic_salary),
          allowances: emp.allowances || [],
          otherDeductions: emp.other_deductions || [],
          pensionContribution: Number(emp.pension_contribution || 0),
          overtimeHours,
        },
        rateSet.config
      );

      const { rows: inserted } = await client.query(
        `INSERT INTO payslips (
           payroll_run_id, employee_id, basic_salary, taxable_allowances, non_taxable_allowances,
           gross_pay, nssf_tier1, nssf_tier2, nssf_total, sha_contribution, housing_levy,
           pension_contribution, taxable_income, paye_before_relief, personal_relief, paye,
           other_deductions_total, other_deductions_detail, total_deductions, net_pay,
           employer_nssf, employer_housing_levy,
           overtime_weekday_hours, overtime_restday_hours, overtime_pay,
           deduction_cap_breached, deduction_cap_limit
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
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
          result.overtime ? result.overtime.weekdayHours : 0,
          result.overtime ? result.overtime.restDayHolidayHours : 0,
          result.overtime ? result.overtime.totalPay : 0,
          result.deductionCap ? result.deductionCap.breached : false,
          result.deductionCap ? result.deductionCap.limit : null,
        ]
      );

      if (overtimeRows.length > 0) {
        await client.query(
          `UPDATE overtime_entries SET payroll_run_id = $1 WHERE id = ANY($2::int[])`,
          [payrollRun.id, overtimeRows.map((r) => r.id)]
        );
      }

      remittanceTotals.paye += result.paye;
      remittanceTotals.nssf += result.nssf.employeeTotal;
      remittanceTotals.sha += result.sha;
      remittanceTotals.housing_levy += result.housingLevy.employee;

      payslips.push({ ...inserted[0], employee_no: emp.employee_no, first_name: emp.first_name, last_name: emp.last_name });
    }

    for (const [type, amount] of Object.entries(remittanceTotals)) {
      await client.query(
        `INSERT INTO remittances (payroll_run_id, type, amount_due)
         VALUES ($1, $2, $3)
         ON CONFLICT (payroll_run_id, type) DO UPDATE SET amount_due = EXCLUDED.amount_due`,
        [payrollRun.id, type, Math.round(amount * 100) / 100]
      );
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
    `SELECT p.*, e.employee_no, e.first_name, e.last_name, e.bank_name, e.bank_account, e.phone
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

async function getRemittances(payrollRunId) {
  const { rows } = await pool.query(
    'SELECT * FROM remittances WHERE payroll_run_id = $1 ORDER BY type',
    [payrollRunId]
  );
  return rows;
}

async function recordRemittancePayment(payrollRunId, type, { referenceNumber, paidDate, notes, paidBy }) {
  const { rows } = await pool.query(
    `UPDATE remittances
     SET paid = true, reference_number = $1, paid_date = $2, notes = $3, paid_by = $4
     WHERE payroll_run_id = $5 AND type = $6
     RETURNING *`,
    [referenceNumber || null, paidDate || null, notes || null, paidBy || null, payrollRunId, type]
  );
  return rows[0] || null;
}

module.exports = {
  runPayroll, getPayrollRun, listPayrollRuns, getActiveRateSet,
  getRemittances, recordRemittancePayment,
};
