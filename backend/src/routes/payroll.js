const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  runPayroll, getPayrollRun, listPayrollRuns, getActiveRateSet,
  getRemittances, recordRemittancePayment,
} = require('../services/payrollService');
const { calculatePayslip } = require('../services/statutoryDeductions');
const { renderPayslipPdf, renderP9Pdf, renderP10Pdf } = require('../services/pdfGenerator');
const { generateMpesaCsv, generateBankCsv } = require('../services/paymentExport');
const { generateKraPayeCsv } = require('../services/kraPayeExport');
const pool = require('../config/db');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('admin', 'staff')); // hr_staff has no payroll/salary access at all

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

// Download a single payslip as a PDF
router.get('/payslips/:id/pdf', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, e.employee_no, e.first_name, e.last_name,
              pr.period_month, pr.period_year
       FROM payslips p
       JOIN employees e ON e.id = p.employee_id
       JOIN payroll_runs pr ON pr.id = p.payroll_run_id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Payslip not found' });

    const payslip = rows[0];
    const pdfBuffer = await renderPayslipPdf(payslip, {
      periodMonth: payslip.period_month,
      periodYear: payslip.period_year,
    });

    const filename = `payslip-${payslip.employee_no}-${payslip.period_year}-${String(payslip.period_month).padStart(2, '0')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate payslip PDF' });
  }
});

// Download a KRA-style P9 (annual tax deduction card) for one employee/year,
// computed from that employee's payslips across the year's payroll runs.
router.get('/employees/:employeeId/p9/:year', async (req, res) => {
  try {
    const { employeeId, year } = req.params;

    const { rows: employees } = await pool.query('SELECT * FROM employees WHERE id = $1', [employeeId]);
    if (employees.length === 0) return res.status(404).json({ error: 'Employee not found' });

    const { rows: monthlyPayslips } = await pool.query(
      `SELECT p.*, pr.period_month, pr.period_year
       FROM payslips p
       JOIN payroll_runs pr ON pr.id = p.payroll_run_id
       WHERE p.employee_id = $1 AND pr.period_year = $2
       ORDER BY pr.period_month`,
      [employeeId, year]
    );

    if (monthlyPayslips.length === 0) {
      return res.status(404).json({ error: `No payroll records found for this employee in ${year}` });
    }

    const pdfBuffer = await renderP9Pdf(employees[0], monthlyPayslips, year);

    const filename = `P9-${employees[0].employee_no}-${year}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate P9 form' });
  }
});

// Payment disbursement exports for a processed payroll run — M-Pesa Bulk
// Payment CSV and a generic bank bulk-upload CSV. See paymentExport.js for
// caveats: these are close to the real formats but not guaranteed to match
// your exact provider's template without checking column names first.

router.get('/runs/:id/export/mpesa', async (req, res) => {
  try {
    const result = await getPayrollRun(req.params.id);
    if (!result) return res.status(404).json({ error: 'Payroll run not found' });

    const { csv, skipped } = generateMpesaCsv(result.payslips);
    if (skipped.length > 0) {
      res.setHeader('X-Skipped-Employees', encodeURIComponent(JSON.stringify(skipped)));
    }
    const filename = `mpesa-bulk-payment-run-${req.params.id}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate M-Pesa payment file' });
  }
});

router.get('/runs/:id/export/bank', async (req, res) => {
  try {
    const result = await getPayrollRun(req.params.id);
    if (!result) return res.status(404).json({ error: 'Payroll run not found' });

    const { csv, skipped } = generateBankCsv(result.payslips);
    if (skipped.length > 0) {
      res.setHeader('X-Skipped-Employees', encodeURIComponent(JSON.stringify(skipped)));
    }
    const filename = `bank-payment-run-${req.params.id}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate bank payment file' });
  }
});

// CSV matching KRA's Simplified PAYE Return "Sheet B" field structure, for
// import into KRA's own Excel workbook — see kraPayeExport.js for exactly
// what this does and doesn't cover.
router.get('/runs/:id/export/kra-paye', async (req, res) => {
  try {
    const result = await getPayrollRun(req.params.id);
    if (!result) return res.status(404).json({ error: 'Payroll run not found' });

    const { csv, skipped, untrackedNote } = generateKraPayeCsv(result.payslips);
    if (skipped.length > 0) {
      res.setHeader('X-Skipped-Employees', encodeURIComponent(JSON.stringify(skipped)));
    }
    res.setHeader('X-Untracked-Fields-Note', encodeURIComponent(untrackedNote));
    const filename = `kra-paye-return-run-${req.params.id}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate KRA PAYE return CSV' });
  }
});

// Monthly PAYE return (P10) for a processed run.
router.get('/runs/:id/p10', async (req, res) => {
  try {
    const result = await getPayrollRun(req.params.id);
    if (!result) return res.status(404).json({ error: 'Payroll run not found' });

    const { rows: employeesWithPin } = await pool.query(
      `SELECT p.employee_id, e.kra_pin FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE p.payroll_run_id = $1`,
      [req.params.id]
    );
    const pinByEmployee = Object.fromEntries(employeesWithPin.map((r) => [r.employee_id, r.kra_pin]));
    const payslipsWithPin = result.payslips.map((p) => ({ ...p, kra_pin: pinByEmployee[p.employee_id] }));

    const pdfBuffer = await renderP10Pdf(result.payrollRun, payslipsWithPin, process.env.EMPLOYER_KRA_PIN || null);

    const filename = `P10-${result.payrollRun.period_year}-${String(result.payrollRun.period_month).padStart(2, '0')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate P10 return' });
  }
});

// Remittance status: what's owed to KRA/NSSF/SHA/Housing Levy for this run,
// and whether/when it was actually paid.
router.get('/runs/:id/remittances', async (req, res) => {
  const remittances = await getRemittances(req.params.id);
  res.json(remittances);
});

router.post('/runs/:id/remittances/:type/pay', async (req, res) => {
  try {
    const { type } = req.params;
    if (!['paye', 'nssf', 'sha', 'housing_levy'].includes(type)) {
      return res.status(400).json({ error: 'Invalid remittance type' });
    }
    const { referenceNumber, paidDate, notes } = req.body;
    const updated = await recordRemittancePayment(req.params.id, type, {
      referenceNumber, paidDate, notes, paidBy: req.user.sub,
    });
    if (!updated) return res.status(404).json({ error: 'Remittance record not found for this run/type' });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to record remittance payment' });
  }
});

module.exports = router;
