const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const pool = require('../config/db');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('admin', 'staff', 'hr_staff')); // explicit allow-list — excludes the 'employee' self-service role from all general HR/admin routes

// --- Leave types ---

router.get('/types', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM leave_types ORDER BY name');
  res.json(rows);
});

router.post('/types', async (req, res) => {
  try {
    const { name, annualEntitlementDays, paid } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const { rows } = await pool.query(
      `INSERT INTO leave_types (name, annual_entitlement_days, paid) VALUES ($1, $2, $3) RETURNING *`,
      [name, annualEntitlementDays || 0, paid !== false]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A leave type with this name already exists' });
    console.error(err);
    res.status(500).json({ error: 'Failed to create leave type' });
  }
});

// --- Leave requests ---

router.get('/requests', async (req, res) => {
  const { employeeId, status } = req.query;
  const conditions = [];
  const values = [];
  let i = 1;

  if (employeeId) { conditions.push(`lr.employee_id = $${i++}`); values.push(employeeId); }
  if (status) { conditions.push(`lr.status = $${i++}`); values.push(status); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT lr.*, e.first_name, e.last_name, e.employee_no, lt.name AS leave_type_name
     FROM leave_requests lr
     JOIN employees e ON e.id = lr.employee_id
     JOIN leave_types lt ON lt.id = lr.leave_type_id
     ${where}
     ORDER BY lr.created_at DESC`,
    values
  );
  res.json(rows);
});

router.post('/requests', async (req, res) => {
  try {
    const { employeeId, leaveTypeId, startDate, endDate, reason } = req.body;
    if (!employeeId || !leaveTypeId || !startDate || !endDate) {
      return res.status(400).json({ error: 'employeeId, leaveTypeId, startDate and endDate are required' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (end < start) return res.status(400).json({ error: 'endDate cannot be before startDate' });
    // Calendar-day count, inclusive. Doesn't exclude weekends/public holidays —
    // adjust here if you need working-day-only leave accounting.
    const days = Math.round((end - start) / 86400000) + 1;

    const { rows } = await pool.query(
      `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [employeeId, leaveTypeId, startDate, endDate, days, reason || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create leave request' });
  }
});

router.post('/requests/:id/approve', async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE leave_requests SET status = 'approved', approved_by = $1, approved_at = now()
     WHERE id = $2 AND status = 'pending' RETURNING *`,
    [req.user.sub, req.params.id]
  );
  if (rows.length === 0) return res.status(400).json({ error: 'Request not found or not pending' });
  res.json(rows[0]);
});

router.post('/requests/:id/reject', async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE leave_requests SET status = 'rejected', approved_by = $1, approved_at = now()
     WHERE id = $2 AND status = 'pending' RETURNING *`,
    [req.user.sub, req.params.id]
  );
  if (rows.length === 0) return res.status(400).json({ error: 'Request not found or not pending' });
  res.json(rows[0]);
});

// --- Leave balance: entitlement minus approved days taken, per type, for a given year ---

router.get('/balance/:employeeId', async (req, res) => {
  const year = req.query.year || new Date().getFullYear();
  const { rows } = await pool.query(
    `SELECT lt.id, lt.name, lt.annual_entitlement_days,
            COALESCE(SUM(lr.days) FILTER (
              WHERE lr.status = 'approved' AND EXTRACT(YEAR FROM lr.start_date) = $2
            ), 0) AS days_taken
     FROM leave_types lt
     LEFT JOIN leave_requests lr ON lr.leave_type_id = lt.id AND lr.employee_id = $1
     GROUP BY lt.id, lt.name, lt.annual_entitlement_days
     ORDER BY lt.name`,
    [req.params.employeeId, year]
  );
  const balances = rows.map((r) => ({
    ...r,
    days_remaining: Number(r.annual_entitlement_days) - Number(r.days_taken),
  }));
  res.json(balances);
});

module.exports = router;
