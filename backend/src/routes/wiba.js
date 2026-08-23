const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const pool = require('../config/db');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('admin', 'staff', 'hr_staff')); // explicit allow-list — excludes the 'employee' self-service role from all general HR/admin routes

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM wiba_policies ORDER BY coverage_end DESC');
  res.json(rows);
});

router.post('/', async (req, res) => {
  try {
    const { insurerName, policyNumber, coverageStart, coverageEnd, premiumAmount, notes } = req.body;
    if (!insurerName || !policyNumber || !coverageStart || !coverageEnd) {
      return res.status(400).json({ error: 'insurerName, policyNumber, coverageStart and coverageEnd are required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO wiba_policies (insurer_name, policy_number, coverage_start, coverage_end, premium_amount, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [insurerName, policyNumber, coverageStart, coverageEnd, premiumAmount || null, notes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save WIBA policy' });
  }
});

module.exports = router;
