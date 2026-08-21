const express = require('express');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM employees ORDER BY first_name, last_name');
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM employees WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
  res.json(rows[0]);
});

router.post('/', async (req, res) => {
  try {
    const {
      employeeNo, firstName, lastName, email, idNumber, kraPin, nssfNumber, shaNumber,
      bankName, bankAccount, basicSalary, allowances = [], otherDeductions = [],
      pensionContribution = 0, hireDate, department, jobTitle, employmentType,
      emergencyContactName, emergencyContactPhone,
    } = req.body;

    if (!employeeNo || !firstName || !lastName || basicSalary == null) {
      return res.status(400).json({ error: 'employeeNo, firstName, lastName and basicSalary are required' });
    }

    const { rows } = await pool.query(
      `INSERT INTO employees (
         employee_no, first_name, last_name, email, id_number, kra_pin, nssf_number, sha_number,
         bank_name, bank_account, basic_salary, allowances, other_deductions, pension_contribution, hire_date,
         department, job_title, employment_type, emergency_contact_name, emergency_contact_phone
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
      [
        employeeNo, firstName, lastName, email, idNumber, kraPin, nssfNumber, shaNumber,
        bankName, bankAccount, basicSalary, JSON.stringify(allowances), JSON.stringify(otherDeductions),
        pensionContribution, hireDate || null, department || null, jobTitle || null,
        employmentType || 'full_time', emergencyContactName || null, emergencyContactPhone || null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Employee number already exists' });
    console.error(err);
    res.status(500).json({ error: 'Failed to create employee' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const fields = [
      'employee_no', 'first_name', 'last_name', 'email', 'id_number', 'kra_pin', 'nssf_number',
      'sha_number', 'bank_name', 'bank_account', 'basic_salary', 'allowances', 'other_deductions',
      'pension_contribution', 'status', 'hire_date', 'department', 'job_title', 'employment_type',
      'emergency_contact_name', 'emergency_contact_phone',
    ];
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
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update employee' });
  }
});

router.delete('/:id', async (req, res) => {
  await pool.query(`UPDATE employees SET status = 'terminated', updated_at = now() WHERE id = $1`, [req.params.id]);
  res.status(204).send();
});

module.exports = router;
