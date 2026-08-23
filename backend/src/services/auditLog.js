const pool = require('../config/db');

/**
 * Records an entry in the audit log. Fire-and-forget by design — a
 * logging failure should never block the actual mutation it's recording,
 * so this swallows its own errors (logged to console) rather than
 * throwing.
 */
async function logAudit(userId, action, entityType, entityId, details = null) {
  try {
    await pool.query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId || null, action, entityType, entityId || null, details ? JSON.stringify(details) : null]
    );
  } catch (err) {
    console.error('Audit log write failed (non-fatal):', err.message);
  }
}

async function listAuditLog({ limit = 50, before } = {}) {
  const values = [];
  let where = '';
  if (before) { values.push(before); where = `WHERE a.created_at < $${values.length}`; }
  values.push(limit);
  const { rows } = await pool.query(
    `SELECT a.*, u.name AS user_name, u.email AS user_email
     FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     ${where}
     ORDER BY a.created_at DESC
     LIMIT $${values.length}`,
    values
  );
  return rows;
}

module.exports = { logAudit, listAuditLog };
