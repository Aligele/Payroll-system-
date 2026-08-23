const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const pool = require('../config/db');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('admin', 'staff', 'hr_staff')); // explicit allow-list — excludes the 'employee' self-service role from all general HR/admin routes

router.get('/', async (req, res) => {
  const { employeeId } = req.query;
  const { rows } = await pool.query(
    `SELECT pr.*, e.first_name, e.last_name, e.employee_no
     FROM performance_reviews pr
     JOIN employees e ON e.id = pr.employee_id
     ${employeeId ? 'WHERE pr.employee_id = $1' : ''}
     ORDER BY pr.created_at DESC`,
    employeeId ? [employeeId] : []
  );
  res.json(rows);
});

router.post('/', async (req, res) => {
  try {
    const { employeeId, reviewPeriod, reviewerName, rating, strengths, improvements, goals, comments } = req.body;
    if (!employeeId || !reviewPeriod) {
      return res.status(400).json({ error: 'employeeId and reviewPeriod are required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO performance_reviews
         (employee_id, review_period, reviewer_name, rating, strengths, improvements, goals, comments)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [employeeId, reviewPeriod, reviewerName || null, rating || null, strengths || null, improvements || null, goals || null, comments || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create performance review' });
  }
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM performance_reviews WHERE id = $1', [req.params.id]);
  res.status(204).send();
});

module.exports = router;
