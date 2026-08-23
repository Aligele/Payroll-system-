const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { renderPayslipPdf, renderP9Pdf } = require('../services/pdfGenerator');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('employee'));

// Every route below trusts req.user.employeeId (set at login, see auth.js)
// as the ONLY source of "which employee am I" — never a client-supplied
// id — so one self-service login can never reach another employee's data.
function myEmployeeId(req) {
  return req.user.employeeId;
}

router.get('/profile', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, employee_no, first_name, last_name, email, department, job_title,
            employment_type, hire_date, phone, basic_salary, allowances, status
     FROM employees WHERE id = $1`,
    [myEmployeeId(req)]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Employee record not found' });
  res.json(rows[0]);
});

router.get('/payslips', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.id, p.gross_pay, p.net_pay, p.paye, pr.period_month, pr.period_year, pr.status
     FROM payslips p JOIN payroll_runs pr ON pr.id = p.payroll_run_id
     WHERE p.employee_id = $1 ORDER BY pr.period_year DESC, pr.period_month DESC`,
    [myEmployeeId(req)]
  );
  res.json(rows);
});

router.get('/payslips/:id/pdf', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, e.employee_no, e.first_name, e.last_name, pr.period_month, pr.period_year
       FROM payslips p JOIN employees e ON e.id = p.employee_id JOIN payroll_runs pr ON pr.id = p.payroll_run_id
       WHERE p.id = $1 AND p.employee_id = $2`,
      [req.params.id, myEmployeeId(req)]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Payslip not found' });
    const payslip = rows[0];
    const pdfBuffer = await renderPayslipPdf(payslip, { periodMonth: payslip.period_month, periodYear: payslip.period_year });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="payslip-${payslip.period_year}-${String(payslip.period_month).padStart(2, '0')}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate payslip PDF' });
  }
});

router.get('/p9/:year', async (req, res) => {
  try {
    const employeeId = myEmployeeId(req);
    const { rows: empRows } = await pool.query('SELECT * FROM employees WHERE id = $1', [employeeId]);
    if (empRows.length === 0) return res.status(404).json({ error: 'Employee record not found' });

    const { rows: payslips } = await pool.query(
      `SELECT p.*, pr.period_month, pr.period_year FROM payslips p
       JOIN payroll_runs pr ON pr.id = p.payroll_run_id
       WHERE p.employee_id = $1 AND pr.period_year = $2`,
      [employeeId, req.params.year]
    );
    const pdfBuffer = await renderP9Pdf(empRows[0], payslips, req.params.year);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="p9-${req.params.year}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate P9' });
  }
});

router.get('/leave', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT l.*, lt.name AS leave_type_name FROM leave_requests l
     JOIN leave_types lt ON lt.id = l.leave_type_id
     WHERE l.employee_id = $1 ORDER BY l.start_date DESC`,
    [myEmployeeId(req)]
  );
  res.json(rows);
});

router.get('/leave-types', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM leave_types ORDER BY name');
  res.json(rows);
});

router.post('/leave', async (req, res) => {
  try {
    const { leaveTypeId, startDate, endDate, reason } = req.body;
    if (!leaveTypeId || !startDate || !endDate) {
      return res.status(400).json({ error: 'leaveTypeId, startDate and endDate are required' });
    }
    // Calendar-day count, inclusive — matches the admin-side leave route.
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (end < start) return res.status(400).json({ error: 'endDate cannot be before startDate' });
    const days = Math.round((end - start) / 86400000) + 1;

    const { rows } = await pool.query(
      `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason, status)
       VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING *`,
      [myEmployeeId(req), leaveTypeId, startDate, endDate, days, reason || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to submit leave request' });
  }
});

module.exports = router;
