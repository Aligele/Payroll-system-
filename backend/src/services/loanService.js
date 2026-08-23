const pool = require('../config/db');

async function listLoans(employeeId) {
  const where = employeeId ? 'WHERE l.employee_id = $1' : '';
  const values = employeeId ? [employeeId] : [];
  const { rows } = await pool.query(
    `SELECT l.*, e.first_name, e.last_name, e.employee_no
     FROM loans l JOIN employees e ON e.id = l.employee_id
     ${where}
     ORDER BY l.created_at DESC`,
    values
  );
  return rows;
}

async function createLoan({ employeeId, principalAmount, monthlyDeduction, disbursedDate, notes, createdBy }) {
  const { rows } = await pool.query(
    `INSERT INTO loans (employee_id, principal_amount, balance_remaining, monthly_deduction, disbursed_date, notes, created_by)
     VALUES ($1,$2,$2,$3,$4,$5,$6) RETURNING *`,
    [employeeId, principalAmount, monthlyDeduction, disbursedDate, notes || null, createdBy || null]
  );
  return rows[0];
}

async function getLoanRepayments(loanId) {
  const { rows } = await pool.query(
    `SELECT r.*, pr.period_month, pr.period_year FROM loan_repayments r
     JOIN payroll_runs pr ON pr.id = r.payroll_run_id
     WHERE r.loan_id = $1 ORDER BY pr.period_year, pr.period_month`,
    [loanId]
  );
  return rows;
}

/**
 * Called from within the payroll transaction (same client, so it commits
 * or rolls back atomically with the rest of the run). Applies each active
 * loan's monthly deduction — or the remaining balance if smaller — as a
 * repayment, and marks the loan paid_off once the balance hits zero.
 * Returns the total repayment amount for the employee this period, to be
 * folded into otherDeductions.
 */
async function applyLoanRepayments(client, employeeId, payrollRunId) {
  const { rows: activeLoans } = await client.query(
    `SELECT * FROM loans WHERE employee_id = $1 AND status = 'active' FOR UPDATE`,
    [employeeId]
  );

  let total = 0;
  const applied = [];
  for (const loan of activeLoans) {
    const amount = Math.min(Number(loan.monthly_deduction), Number(loan.balance_remaining));
    if (amount <= 0) continue;

    await client.query(
      `INSERT INTO loan_repayments (loan_id, payroll_run_id, amount) VALUES ($1,$2,$3)
       ON CONFLICT (loan_id, payroll_run_id) DO NOTHING`,
      [loan.id, payrollRunId, amount]
    );
    const newBalance = Math.round((Number(loan.balance_remaining) - amount) * 100) / 100;
    await client.query(
      `UPDATE loans SET balance_remaining = $1, status = $2 WHERE id = $3`,
      [newBalance, newBalance <= 0 ? 'paid_off' : 'active', loan.id]
    );
    total += amount;
    applied.push({ name: `Loan repayment (${loan.disbursed_date.toISOString ? loan.disbursed_date.toISOString().slice(0, 10) : loan.disbursed_date})`, amount });
  }
  return { total: Math.round(total * 100) / 100, applied };
}

/** Releases loan_repayments tied to a run being re-processed, restoring balances, mirroring the overtime release-on-rerun pattern. */
async function releaseLoanRepayments(client, payrollRunId) {
  const { rows: repayments } = await client.query(
    `SELECT * FROM loan_repayments WHERE payroll_run_id = $1`,
    [payrollRunId]
  );
  for (const r of repayments) {
    await client.query(
      `UPDATE loans SET balance_remaining = balance_remaining + $1, status = 'active' WHERE id = $2`,
      [r.amount, r.loan_id]
    );
  }
  await client.query(`DELETE FROM loan_repayments WHERE payroll_run_id = $1`, [payrollRunId]);
}

module.exports = { listLoans, createLoan, getLoanRepayments, applyLoanRepayments, releaseLoanRepayments };
