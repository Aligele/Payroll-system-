const express = require('express');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { renderCertificateOfServicePdf } = require('../services/pdfGenerator');

const router = express.Router();
router.use(requireAuth);

// Fields hr_staff can't see or set — compensation and bank details are
// payroll's domain, not HR's. Everything else on the employee record
// (name, department, job title, statutory ID numbers, emergency contact,
// employment status) is fine for HR to view and manage.
const PAYROLL_ONLY_FIELDS = [
  'basic_salary', 'bank_name', 'bank_account', 'allowances', 'other_deductions', 'pension_contribution',
];

function stripPayrollFields(row) {
  const copy = { ...row };
  PAYROLL_ONLY_FIELDS.forEach((f) => delete copy[f]);
  return copy;
}
const isHrStaff = (req) => req.user.role === 'hr_staff';

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM employees ORDER BY first_name, last_name');
  res.json(isHrStaff(req) ? rows.map(stripPayrollFields) : rows);
});

router.get('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM employees WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
  res.json(isHrStaff(req) ? stripPayrollFields(rows[0]) : rows[0]);
});

router.post('/', async (req, res) => {
  try {
    const {
      employeeNo, firstName, lastName, email, idNumber, kraPin, nssfNumber, shaNumber,
      bankName, bankAccount, basicSalary, allowances = [], otherDeductions = [],
      pensionContribution = 0, hireDate, department, jobTitle, employmentType,
      emergencyContactName, emergencyContactPhone, phone,
    } = req.body;

    if (!employeeNo || !firstName || !lastName) {
      return res.status(400).json({ error: 'employeeNo, firstName and lastName are required' });
    }
    // hr_staff can create the employee record, but compensation/bank details
    // stay at the schema default (0 / null) until an admin or payroll staff sets them.
    const hr = isHrStaff(req);
    if (!hr && basicSalary == null) {
      return res.status(400).json({ error: 'basicSalary is required' });
    }

    const { rows } = await pool.query(
      `INSERT INTO employees (
         employee_no, first_name, last_name, email, id_number, kra_pin, nssf_number, sha_number,
         bank_name, bank_account, basic_salary, allowances, other_deductions, pension_contribution, hire_date,
         department, job_title, employment_type, emergency_contact_name, emergency_contact_phone, phone
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
      [
        employeeNo, firstName, lastName, email, idNumber, kraPin, nssfNumber, shaNumber,
        hr ? null : bankName, hr ? null : bankAccount, hr ? 0 : basicSalary,
        JSON.stringify(hr ? [] : allowances), JSON.stringify(hr ? [] : otherDeductions),
        hr ? 0 : pensionContribution, hireDate || null, department || null, jobTitle || null,
        employmentType || 'full_time', emergencyContactName || null, emergencyContactPhone || null,
        phone || null,
      ]
    );
    res.status(201).json(hr ? stripPayrollFields(rows[0]) : rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Employee number already exists' });
    console.error(err);
    res.status(500).json({ error: 'Failed to create employee' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    let fields = [
      'employee_no', 'first_name', 'last_name', 'email', 'id_number', 'kra_pin', 'nssf_number',
      'sha_number', 'bank_name', 'bank_account', 'basic_salary', 'allowances', 'other_deductions',
      'pension_contribution', 'status', 'hire_date', 'department', 'job_title', 'employment_type',
      'emergency_contact_name', 'emergency_contact_phone', 'phone',
    ];
    if (isHrStaff(req)) fields = fields.filter((f) => !PAYROLL_ONLY_FIELDS.includes(f));

    const camelToSnake = {
      employeeNo: 'employee_no', firstName: 'first_name', lastName: 'last_name', idNumber: 'id_number',
      kraPin: 'kra_pin', nssfNumber: 'nssf_number', shaNumber: 'sha_number', bankName: 'bank_name',
      bankAccount: 'bank_account', basicSalary: 'basic_salary', otherDeductions: 'other_deductions',
      pensionContribution: 'pension_contribution', hireDate: 'hire_date', jobTitle: 'job_title',
      employmentType: 'employment_type', emergencyContactName: 'emergency_contact_name',
      emergencyContactPhone: 'emergency_contact_phone',
    };

    const updates = [];
    const values = [];
    let i = 1;
    for (const [key, value] of Object.entries(req.body)) {
      const column = camelToSnake[key] || key;
      if (!fields.includes(column)) continue;
      const isJsonField = column === 'allowances' || column === 'other_deductions';
      updates.push(`${column} = $${i}`);
      values.push(isJsonField ? JSON.stringify(value) : value);
      i += 1;
    }
    if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

    updates.push(`updated_at = now()`);
    values.push(req.params.id);

    const { rows } = await pool.query(
      `UPDATE employees SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
    res.json(isHrStaff(req) ? stripPayrollFields(rows[0]) : rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update employee' });
  }
});

router.delete('/:id', async (req, res) => {
  await pool.query(`UPDATE employees SET status = 'terminated', updated_at = now() WHERE id = $1`, [req.params.id]);
  res.status(204).send();
});

// Permanently removes an employee record — only for correcting a mistaken
// entry, not for offboarding a real employee (use the terminate action
// above for that). Blocked if the employee has any payroll history, so a
// real payslip can never be silently erased; leave/attendance/performance/
// document records cascade-delete along with the employee.
router.delete('/:id/permanent', async (req, res) => {
  try {
    const { rows: payslips } = await pool.query(
      'SELECT id FROM payslips WHERE employee_id = $1 LIMIT 1', [req.params.id]
    );
    if (payslips.length > 0) {
      return res.status(409).json({
        error: 'This employee has payroll history and cannot be permanently deleted. Use "Terminate" instead to mark them inactive.',
      });
    }
    const { rowCount } = await pool.query('DELETE FROM employees WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Employee not found' });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete employee' });
  }
});

// Certificate of Service — Employment Act requirement on end of service.
// No salary/compensation figures on it, so it's fine for hr_staff too.
router.get('/:id/certificate-of-service', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM employees WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Employee not found' });

    const pdfBuffer = await renderCertificateOfServicePdf(rows[0]);
    const filename = `certificate-of-service-${rows[0].employee_no}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate certificate of service' });
  }
});

module.exports = router;
