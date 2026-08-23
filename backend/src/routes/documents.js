const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const pool = require('../config/db');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);
router.use(requireRole('admin', 'staff', 'hr_staff')); // explicit allow-list — excludes the 'employee' self-service role from all general HR/admin routes

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM employee_documents WHERE employee_id = $1 ORDER BY uploaded_at DESC',
    [req.params.employeeId]
  );
  res.json(rows);
});

router.post('/', async (req, res) => {
  try {
    const { name, category, link, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const { rows } = await pool.query(
      `INSERT INTO employee_documents (employee_id, name, category, link, notes)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.employeeId, name, category || 'other', link || null, notes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add document record' });
  }
});

router.delete('/:id', async (req, res) => {
  await pool.query(
    'DELETE FROM employee_documents WHERE id = $1 AND employee_id = $2',
    [req.params.id, req.params.employeeId]
  );
  res.status(204).send();
});

module.exports = router;
