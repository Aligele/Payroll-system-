const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('admin')); // every route below is admin-only

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, email, role, is_active, created_at FROM users ORDER BY created_at'
  );
  res.json(rows);
});

router.post('/', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const finalRole = ['admin', 'hr_staff'].includes(role) ? role : 'staff';

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4)
       RETURNING id, name, email, role, is_active, created_at`,
      [name, email, hash, finalRole]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A user with this email already exists' });
    console.error(err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Update role and/or active status (not password — that's a separate, more
// sensitive action; add a dedicated reset-password route if you need one).
router.put('/:id', async (req, res) => {
  try {
    const { role, isActive } = req.body;
    const updates = [];
    const values = [];
    let i = 1;

    if (role) {
      if (!['admin', 'staff', 'hr_staff'].includes(role)) return res.status(400).json({ error: 'role must be admin, staff, or hr_staff' });
      updates.push(`role = $${i++}`);
      values.push(role);
    }
    if (typeof isActive === 'boolean') {
      updates.push(`is_active = $${i++}`);
      values.push(isActive);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    // Guard: don't allow deactivating or demoting the very last active admin,
    // or every user could get locked out of user management entirely.
    if ((role && role !== 'admin') || isActive === false) {
      const { rows: admins } = await pool.query(
        `SELECT id FROM users WHERE role = 'admin' AND is_active = true`
      );
      if (admins.length === 1 && admins[0].id === Number(req.params.id)) {
        return res.status(400).json({ error: 'Cannot remove the last active admin' });
      }
    }

    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${i} RETURNING id, name, email, role, is_active, created_at`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

module.exports = router;
