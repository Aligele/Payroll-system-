/**
 * Standard payroll journal entry, as a generic CSV (Date, Account, Debit,
 * Credit, Description, Memo) — the format both QuickBooks and Xero accept
 * for a general journal import. Account NAMES are used rather than
 * chart-of-accounts codes, since we have no way to know this company's
 * actual chart of accounts; they'll need to be mapped to the real
 * account names/codes on import if they differ.
 *
 * Standard structure for one payroll run:
 *   Dr Salaries & Wages Expense         (gross pay, total)
 *     Cr PAYE Payable                   (total PAYE withheld)
 *     Cr NSSF Payable                   (total NSSF withheld)
 *     Cr SHIF/SHA Payable               (total SHA withheld)
 *     Cr Affordable Housing Levy Payable (total AHL withheld)
 *     Cr Loan Repayments Receivable     (total loan deductions, if any)
 *     Cr Net Salaries Payable / Bank    (total net pay)
 * Debits and credits are asserted to balance before returning.
 */

function toCsvField(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}
function toCsvRow(fields) {
  return fields.map(toCsvField).join(',');
}
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function generateJournalCsv(payrollRun, payslips, { periodLabel } = {}) {
  const date = new Date().toISOString().slice(0, 10);
  const desc = periodLabel || `Payroll ${payrollRun.period_month}/${payrollRun.period_year}`;

  const totals = payslips.reduce((acc, p) => {
    acc.gross += Number(p.gross_pay);
    acc.paye += Number(p.paye);
    acc.nssf += Number(p.nssf_total);
    acc.sha += Number(p.sha_contribution);
    acc.housing += Number(p.housing_levy);
    acc.pension += Number(p.pension_contribution || 0);
    acc.net += Number(p.net_pay);
    // Loan deductions are folded into other_deductions_detail alongside any
    // other manual deduction lines — separated out here by label prefix so
    // they can post to their own account rather than a generic bucket.
    const otherDeductions = typeof p.other_deductions_detail === 'string'
      ? JSON.parse(p.other_deductions_detail) : (p.other_deductions_detail || []);
    otherDeductions.forEach((d) => {
      if (String(d.name || '').startsWith('Loan repayment')) acc.loanRepayments += Number(d.amount || 0);
      else acc.otherDeductions += Number(d.amount || 0);
    });
    return acc;
  }, { gross: 0, paye: 0, nssf: 0, sha: 0, housing: 0, pension: 0, net: 0, loanRepayments: 0, otherDeductions: 0 });

  const rows = [toCsvRow(['Date', 'Account', 'Debit', 'Credit', 'Description', 'Memo'])];
  const addLine = (account, debit, credit) => {
    if (round2(debit) === 0 && round2(credit) === 0) return;
    rows.push(toCsvRow([date, account, debit ? round2(debit).toFixed(2) : '', credit ? round2(credit).toFixed(2) : '', desc, `Payroll run #${payrollRun.id}`]));
  };

  addLine('Salaries & Wages Expense', totals.gross, 0);
  addLine('PAYE Payable', 0, totals.paye);
  addLine('NSSF Payable', 0, totals.nssf);
  addLine('SHIF/SHA Payable', 0, totals.sha);
  addLine('Affordable Housing Levy Payable', 0, totals.housing);
  addLine('Pension Contributions Payable', 0, totals.pension);
  addLine('Loan Repayments Receivable', 0, totals.loanRepayments);
  addLine('Other Deductions Payable', 0, totals.otherDeductions);
  addLine('Net Salaries Payable', 0, totals.net);

  const totalDebits = round2(totals.gross);
  const totalCredits = round2(totals.paye + totals.nssf + totals.sha + totals.housing + totals.pension + totals.loanRepayments + totals.otherDeductions + totals.net);
  const balanced = totalDebits === totalCredits;

  return { csv: rows.join('\r\n'), totalDebits, totalCredits, balanced };
}

module.exports = { generateJournalCsv };
