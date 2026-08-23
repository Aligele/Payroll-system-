const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { listLoans, createLoan, getLoanRepayments } = require('../services/loanService');
const { logAudit } = require('../services/auditLog');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('admin', 'staff')); // loan amounts are salary-deduction data, same tier as payroll

router.get('/', async (req, res) => {
  const loans = await listLoans(req.query.employeeId || null);
  res.json(loans);
});

router.get('/:id/repayments', async (req, res) => {
  const repayments = await getLoanRepayments(req.params.id);
  res.json(repayments);
});

router.post('/', async (req, res) => {
  try {
    const { employeeId, principalAmount, monthlyDeduction, disbursedDate, notes } = req.body;
    if (!employeeId || !principalAmount || !monthlyDeduction || !disbursedDate) {
      return res.status(400).json({ error: 'employeeId, principalAmount, monthlyDeduction and disbursedDate are required' });
    }
    if (Number(monthlyDeduction) <= 0 || Number(principalAmount) <= 0) {
      return res.status(400).json({ error: 'principalAmount and monthlyDeduction must be positive' });
    }
    const loan = await createLoan({ employeeId, principalAmount, monthlyDeduction, disbursedDate, notes, createdBy: req.user.sub });
    await logAudit(req.user.sub, 'loan.create', 'loan', loan.id, { employeeId, principalAmount, monthlyDeduction });
    res.status(201).json(loan);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create loan' });
  }
});

module.exports = router;
