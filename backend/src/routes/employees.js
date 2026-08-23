const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { renderCertificateOfServicePdf } = require('../services/pdfGenerator');
const { createDefaultChecklist, getChecklist, toggleItem } = require('../services/offboardingService');
const { logAudit } = require('../services/auditLog');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('admin', 'staff', 'hr_staff')); // explicit allow-list — excludes the 'employee' self-service role; that role gets its own scoped routes in selfService.js

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
  const { rows } = await pool.query(
    `UPDATE employees SET status = 'terminated', updated_at = now() WHERE id = $1 RETURNING first_name, last_name`,
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
  await createDefaultChecklist(req.params.id);
  await logAudit(req.user.sub, 'employee.terminate', 'employee', req.params.id, { name: `${rows[0].first_name} ${rows[0].last_name}` });
  res.status(204).send();
});

// Offboarding checklist — auto-seeded on termination above.
router.get('/:id/offboarding', async (req, res) => {
  const items = await getChecklist(req.params.id);
  res.json(items);
});

router.patch('/:employeeId/offboarding/:itemId', async (req, res) => {
  const updated = await toggleItem(req.params.itemId, !!req.body.completed, req.user.sub);
  if (!updated) return res.status(404).json({ error: 'Checklist item not found' });
  res.json(updated);
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

// Enable employee self-service login — admin/staff only (this router's
// own gate already restricts to admin/staff/hr_staff; require admin/staff
// specifically here since it creates a login credential).
router.post('/:id/enable-self-service', requireRole('admin', 'staff'), async (req, res) => {
  try {
    const { rows: empRows } = await pool.query('SELECT * FROM employees WHERE id = $1', [req.params.id]);
    if (empRows.length === 0) return res.status(404).json({ error: 'Employee not found' });
    const employee = empRows[0];
    if (!employee.email) {
      return res.status(400).json({ error: 'This employee has no email on record — add one first, self-service login needs it.' });
    }

    const { rows: existing } = await pool.query('SELECT id FROM users WHERE employee_id = $1', [req.params.id]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'This employee already has a self-service login. Use the password reset flow instead of creating a new one.' });
    }

    const tempPassword = crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 12);
    const hash = await bcrypt.hash(tempPassword, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, employee_id)
       VALUES ($1,$2,$3,'employee',$4) RETURNING id, name, email`,
      [`${employee.first_name} ${employee.last_name}`, employee.email, hash, req.params.id]
    );
    await logAudit(req.user.sub, 'employee.enable_self_service', 'employee', req.params.id, { userId: rows[0].id });

    // Temp password is returned once, here — same pattern as the existing
    // admin password-reset flow. It is not recoverable after this response;
    // communicate it to the employee directly, and have them change it once
    // logged in (no self-service change-password route exists yet).
    res.status(201).json({ email: rows[0].email, temporaryPassword: tempPassword });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A login with this email already exists' });
    console.error(err);
    res.status(500).json({ error: 'Failed to enable self-service login' });
  }
});

module.exports = router;
