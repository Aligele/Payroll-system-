const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { runPayroll, getPayrollRun, listPayrollRuns } = require('../services/payrollService');
const { calculatePayslip } = require('../services/statutoryDeductions');
const { getActiveRateSet } = require('../services/payrollService');
const pool = require('../config/db');

const router = express.Router();
router.use(requireAuth);

// List all payroll runs (history)
router.get('/runs', async (req, res) => {
  const runs = await listPayrollRuns();
  res.json(runs);
});

// Get one payroll run with its payslips
router.get('/runs/:id', async (req, res) => {
  const result = await getPayrollRun(req.params.id);
  if (!result) return res.status(404).json({ error: 'Payroll run not found' });
  res.json(result);
});

// Process payroll for a period: deducts PAYE, SHA, NSSF, Housing Levy for every active employee
router.post('/run', async (req, res) => {
  try {
    const { periodMonth, periodYear } = req.body;
    if (!periodMonth || !periodYear) {
      return res.status(400).json({ error: 'periodMonth (1-12) and periodYear are required' });
    }
    const result = await runPayroll({ periodMonth, periodYear, createdBy: req.user.sub });
    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

// Mark a processed run as paid (locks it from being re-run)
router.post('/runs/:id/mark-paid', async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE payroll_runs SET status = 'paid' WHERE id = $1 AND status = 'processed' RETURNING *`,
    [req.params.id]
  );
  if (rows.length === 0) return res.status(400).json({ error: 'Run must be in "processed" status to mark as paid' });
  res.json(rows[0]);
});

// Preview a single employee's payslip without saving anything (useful for "what-if" checks)
router.post('/preview', async (req, res) => {
  try {
    const rateSet = await getActiveRateSet(pool);
    const result = calculatePayslip(req.body, rateSet.config);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
