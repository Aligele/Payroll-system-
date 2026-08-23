const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const pool = require('../config/db');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('admin', 'staff', 'hr_staff')); // explicit allow-list — excludes the 'employee' self-service role from all general HR/admin routes

// List overtime entries. ?employeeId= and ?applied=false are optional filters.
router.get('/', async (req, res) => {
  const { employeeId, applied } = req.query;
  const conditions = [];
  const values = [];
  let i = 1;

  if (employeeId) { conditions.push(`o.employee_id = $${i++}`); values.push(employeeId); }
  if (applied === 'false') conditions.push('o.payroll_run_id IS NULL');
  if (applied === 'true') conditions.push('o.payroll_run_id IS NOT NULL');

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT o.*, e.first_name, e.last_name, e.employee_no
     FROM overtime_entries o JOIN employees e ON e.id = o.employee_id
     ${where}
     ORDER BY o.date DESC`,
    values
  );
  res.json(rows);
});

router.post('/', async (req, res) => {
  try {
    const { employeeId, date, hours, rateType, notes } = req.body;
    if (!employeeId || !date || !hours) {
      return res.status(400).json({ error: 'employeeId, date and hours are required' });
    }
    if (!['weekday', 'rest_day_holiday'].includes(rateType)) {
      return res.status(400).json({ error: 'rateType must be weekday or rest_day_holiday' });
    }
    const { rows } = await pool.query(
      `INSERT INTO overtime_entries (employee_id, date, hours, rate_type, notes)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [employeeId, date, hours, rateType, notes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to log overtime entry' });
  }
});

// Only unapplied entries can be removed — once folded into a payroll run,
// removing it here would desync from the payslip that already used it.
router.delete('/:id', async (req, res) => {
  const { rowCount } = await pool.query(
    'DELETE FROM overtime_entries WHERE id = $1 AND payroll_run_id IS NULL',
    [req.params.id]
  );
  if (rowCount === 0) {
    return res.status(400).json({ error: 'Entry not found or already applied to a payroll run' });
  }
  res.status(204).send();
});

module.exports = router;
