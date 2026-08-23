/**
 * Generates a CSV matching the "Employee Details – Sheet B" field
 * structure of KRA's Simplified PAYE Return (mandatory since July 2025
 * for all employers). This is meant to be imported into KRA's own Excel
 * workbook using its "import CSV" function — see the official guide:
 * https://www.kra.go.ke/images/publications/STEP-BY-STEP-GUIDE-FOR-THE-SIMPLIFIED-PAYE-RETURN.pdf
 *
 * There is currently no public API for private employers to submit PAYE
 * returns directly to iTax — the government's own guide describes this
 * as an offline Excel/CSV process (the API integration KRA has announced
 * is specifically for government HR/finance systems: GHRIS, IFMIS, CBK).
 * So this CSV still needs to be imported into KRA's Excel template and
 * uploaded through iTax by a person — it just means you're not manually
 * re-typing each employee's figures to get there.
 *
 * Several Sheet B fields aren't tracked anywhere in this system yet and
 * are exported as 0 — flagged per-employee in the `skipped`-style notes
 * so you know which employees may need manual top-up before filing:
 * Value of Car Benefit, Value of Meals, Value of Non-Cash Benefits,
 * Value of Housing, Other Benefits, PRMF, Mortgage Interest, Insurance
 * Relief, and Resident/PWD status (assumed Resident / not PWD).
 */

function toCsvField(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}
function toCsvRow(fields) {
  return fields.map(toCsvField).join(',');
}

const HEADERS = [
  'PIN', 'Name', 'Resident Status', 'PWD',
  'Total Cash Pay', 'Value of Car Benefit', 'Value of Meals', 'Value of Non-Cash Benefits',
  'Value of Housing', 'Other Benefits', 'SHIF', 'NSSF', 'Other Pension Contribution',
  'PRMF', 'Mortgage Interest', 'Affordable Housing Levy', 'Personal Relief',
  'Insurance Relief', 'Self-Assessed PAYE',
];

// Fields this system doesn't currently track — always exported as 0/defaults.
const UNTRACKED_NOTE = 'Value of Car Benefit, Value of Meals, Value of Non-Cash Benefits, ' +
  'Value of Housing, Other Benefits, PRMF, Mortgage Interest, and Insurance Relief are not ' +
  'tracked by this system (exported as 0) — add manually in KRA\'s Excel template if applicable. ' +
  'Resident Status is assumed "Resident" and PWD is assumed "No" for every employee — correct manually if not accurate.';

/**
 * @param {Array} payslips - rows from getPayrollRun (basic_salary, taxable_allowances,
 *   overtime_pay, sha_contribution, nssf_total, pension_contribution, housing_levy,
 *   personal_relief, paye, employee_no, first_name, last_name, kra_pin)
 * @returns {{ csv: string, skipped: Array<{employee_no, name, reason}> }}
 */
function generateKraPayeCsv(payslips) {
  const rows = [toCsvRow(HEADERS)];
  const skipped = [];

  for (const p of payslips) {
    const name = `${p.first_name} ${p.last_name}`;
    if (!p.kra_pin) {
      skipped.push({ employee_no: p.employee_no, name, reason: 'missing KRA PIN — required by KRA, cannot be filed without it' });
      continue;
    }
    const totalCashPay = Number(p.basic_salary) + Number(p.taxable_allowances) + Number(p.overtime_pay || 0);
    rows.push(toCsvRow([
      p.kra_pin, name, 'Resident', 'No',
      totalCashPay.toFixed(2), '0.00', '0.00', '0.00',
      '0.00', '0.00', Number(p.sha_contribution).toFixed(2), Number(p.nssf_total).toFixed(2),
      Number(p.pension_contribution || 0).toFixed(2), '0.00', '0.00',
      Number(p.housing_levy).toFixed(2), Number(p.personal_relief).toFixed(2),
      '0.00', Number(p.paye).toFixed(2),
    ]));
  }

  return { csv: rows.join('\r\n'), skipped, untrackedNote: UNTRACKED_NOTE };
}

module.exports = { generateKraPayeCsv };
