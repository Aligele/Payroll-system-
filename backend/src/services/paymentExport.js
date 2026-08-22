/**
 * Generates payment disbursement files from a processed payroll run's
 * payslips, so net pay can actually be sent out — either via M-Pesa Bulk
 * Payment (B2C) or a bank's bulk-upload tool.
 *
 * Neither of these is guaranteed to match your exact provider's template
 * byte-for-byte:
 *  - M-Pesa: Safaricom's Bulk Payment (B2C) service requires a CSV with
 *    each recipient's name, MSISDN, and amount — this generates that core
 *    structure, but Safaricom issues each organization its own template
 *    once onboarded, so double-check column order/headers against yours
 *    before the first real upload.
 *  - Bank: there is no single standard across Kenyan banks — this is a
 *    generic, commonly-accepted layout (account number, account name,
 *    amount, narration). Your bank's bulk EFT/RTGS tool may need columns
 *    renamed, reordered, or a branch/bank code added.
 */

function toCsvField(value) {
  const str = String(value ?? '');
  // Quote any field containing a comma, quote, or newline, per CSV convention.
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}
function toCsvRow(fields) {
  return fields.map(toCsvField).join(',');
}

/**
 * Normalizes common Kenyan phone number formats to the 2547XXXXXXXX /
 * 2541XXXXXXXX form M-Pesa's MSISDN field requires.
 * Accepts: 07XXXXXXXX, 01XXXXXXXX, 7XXXXXXXX, 1XXXXXXXX, 2547XXXXXXXX,
 * +2547XXXXXXXX (with or without spaces/dashes). Returns null if the
 * input doesn't resemble a valid Kenyan mobile number.
 */
function normalizeKenyanPhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, '');
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  if (/^0[17]\d{8}$/.test(digits)) return '254' + digits.slice(1);
  if (/^[17]\d{8}$/.test(digits)) return '254' + digits;
  return null;
}

/**
 * @param {Array} payslips - rows from getPayrollRun (must include phone, first_name, last_name, net_pay)
 * @returns {{ csv: string, skipped: Array<{employee_no, name, reason}> }}
 */
function generateMpesaCsv(payslips) {
  const rows = [toCsvRow(['Name', 'MSISDN', 'Amount'])];
  const skipped = [];

  for (const p of payslips) {
    const name = `${p.first_name} ${p.last_name}`;
    const phone = normalizeKenyanPhone(p.phone);
    if (!phone) {
      skipped.push({ employee_no: p.employee_no, name, reason: 'missing or invalid phone number' });
      continue;
    }
    if (Number(p.net_pay) <= 0) {
      skipped.push({ employee_no: p.employee_no, name, reason: 'net pay is zero or negative' });
      continue;
    }
    rows.push(toCsvRow([name, phone, Number(p.net_pay).toFixed(2)]));
  }

  return { csv: rows.join('\r\n'), skipped };
}

/**
 * @param {Array} payslips - rows from getPayrollRun (must include bank_name, bank_account, employee_no, first_name, last_name, net_pay)
 * @returns {{ csv: string, skipped: Array<{employee_no, name, reason}> }}
 */
function generateBankCsv(payslips) {
  const rows = [toCsvRow(['Employee No', 'Account Name', 'Bank Name', 'Account Number', 'Amount', 'Narration'])];
  const skipped = [];

  for (const p of payslips) {
    const name = `${p.first_name} ${p.last_name}`;
    if (!p.bank_name || !p.bank_account) {
      skipped.push({ employee_no: p.employee_no, name, reason: 'missing bank name or account number' });
      continue;
    }
    if (Number(p.net_pay) <= 0) {
      skipped.push({ employee_no: p.employee_no, name, reason: 'net pay is zero or negative' });
      continue;
    }
    rows.push(toCsvRow([
      p.employee_no, name, p.bank_name, p.bank_account,
      Number(p.net_pay).toFixed(2), `Salary ${p.employee_no}`,
    ]));
  }

  return { csv: rows.join('\r\n'), skipped };
}

module.exports = { normalizeKenyanPhone, generateMpesaCsv, generateBankCsv };
