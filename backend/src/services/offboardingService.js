const pool = require('../config/db');

const DEFAULT_ITEMS = [
  'Return company assets (laptop, phone, access card, keys)',
  'Issue final payslip',
  'Issue Certificate of Service',
  'Revoke system access (this system, email, other logins)',
  'Clear any outstanding loan balance',
  'Conduct exit interview',
];

/** Called when an employee is terminated — seeds the standard checklist. */
async function createDefaultChecklist(employeeId) {
  const values = DEFAULT_ITEMS.map((_, i) => `($1, $${i + 2})`).join(', ');
  await pool.query(
    `INSERT INTO offboarding_checklists (employee_id, item) VALUES ${values}`,
    [employeeId, ...DEFAULT_ITEMS]
  );
}

async function getChecklist(employeeId) {
  const { rows } = await pool.query(
    'SELECT * FROM offboarding_checklists WHERE employee_id = $1 ORDER BY id',
    [employeeId]
  );
  return rows;
}

async function toggleItem(itemId, completed, userId) {
  const { rows } = await pool.query(
    `UPDATE offboarding_checklists
     SET completed = $1, completed_at = CASE WHEN $1 THEN now() ELSE NULL END,
         completed_by = CASE WHEN $1 THEN $2 ELSE NULL END
     WHERE id = $3 RETURNING *`,
    [completed, userId || null, itemId]
  );
  return rows[0] || null;
}

module.exports = { createDefaultChecklist, getChecklist, toggleItem };
