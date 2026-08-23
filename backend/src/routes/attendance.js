const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const pool = require('../config/db');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('admin', 'staff', 'hr_staff')); // explicit allow-list — excludes the 'employee' self-service role from all general HR/admin routes

// All active employees with their attendance status for a given date
// (employees with no record yet show status: null, so the UI can render "unmarked").
router.get('/', async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query(
    `SELECT e.id AS employee_id, e.first_name, e.last_name, e.employee_no,
            a.id AS attendance_id, a.status, a.check_in, a.check_out, a.notes
     FROM employees e
     LEFT JOIN attendance_records a ON a.employee_id = e.id AND a.date = $1
     WHERE e.status = 'active'
     ORDER BY e.first_name, e.last_name`,
    [date]
  );
  res.json({ date, records: rows });
});

// Bulk mark attendance for a date: { date, records: [{ employeeId, status, checkIn, checkOut, notes }] }
router.post('/', async (req, res) => {
  const { date, records } = req.body;
  if (!date || !Array.isArray(records)) {
    return res.status(400).json({ error: 'date and records[] are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of records) {
      await client.query(
        `INSERT INTO attendance_records (employee_id, date, status, check_in, check_out, notes)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (employee_id, date)
         DO UPDATE SET status = $3, check_in = $4, check_out = $5, notes = $6`,
        [r.employeeId, date, r.status || 'present', r.checkIn || null, r.checkOut || null, r.notes || null]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ date, updated: records.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to save attendance' });
  } finally {
    client.release();
  }
});

// One employee's attendance history for a given month
router.get('/:employeeId', async (req, res) => {
  const { month, year } = req.query;
  const y = year || new Date().getFullYear();
  const m = month || new Date().getMonth() + 1;
  const { rows } = await pool.query(
    `SELECT * FROM attendance_records
     WHERE employee_id = $1 AND EXTRACT(YEAR FROM date) = $2 AND EXTRACT(MONTH FROM date) = $3
     ORDER BY date`,
    [req.params.employeeId, y, m]
  );
  res.json(rows);
});

module.exports = router;
