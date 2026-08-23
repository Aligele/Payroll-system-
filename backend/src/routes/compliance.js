const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const pool = require('../config/db');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('admin', 'staff', 'hr_staff')); // explicit allow-list — excludes the 'employee' self-service role from all general HR/admin routes

/**
 * Upcoming statutory filing deadlines. KRA's Simplified PAYE Return
 * (mandatory since July 2025) unified PAYE, SHA, NSSF and the Housing
 * Levy onto the same filing cycle: due by the 9th of the month following
 * the pay period. This is computed on the fly, not stored — it's always
 * "the next 9th" relative to today, plus the current WIBA policy's
 * expiry if one is on file.
 */
router.get('/calendar', async (req, res) => {
  const now = new Date();
  const items = [];

  // Next PAYE/SHA/NSSF/Housing Levy filing deadline: the 9th of next month
  // (or this month, if today is before the 9th).
  const thisMonth9th = new Date(now.getFullYear(), now.getMonth(), 9);
  const nextDeadline = now <= thisMonth9th ? thisMonth9th : new Date(now.getFullYear(), now.getMonth() + 1, 9);
  const daysUntil = Math.ceil((nextDeadline - now) / (1000 * 60 * 60 * 24));
  items.push({
    type: 'statutory_filing',
    label: 'PAYE / SHA / NSSF / Housing Levy return',
    dueDate: nextDeadline.toISOString().slice(0, 10),
    daysUntil,
  });

  const { rows: wibaPolicies } = await pool.query(
    `SELECT * FROM wiba_policies WHERE coverage_end >= CURRENT_DATE ORDER BY coverage_end ASC LIMIT 1`
  );
  if (wibaPolicies.length > 0) {
    const expiry = new Date(wibaPolicies[0].coverage_end);
    items.push({
      type: 'wiba_renewal',
      label: `WIBA cover renewal (${wibaPolicies[0].insurer_name})`,
      dueDate: wibaPolicies[0].coverage_end,
      daysUntil: Math.ceil((expiry - now) / (1000 * 60 * 60 * 24)),
    });
  } else {
    items.push({ type: 'wiba_missing', label: 'No active WIBA cover on file', dueDate: null, daysUntil: null });
  }

  items.sort((a, b) => (a.daysUntil ?? Infinity) - (b.daysUntil ?? Infinity));
  res.json(items);
});

module.exports = router;
