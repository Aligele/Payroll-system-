require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { DEFAULT_RATE_CONFIG } = require('../services/defaultRates');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Applying schema...');
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schemaSql);

    console.log('Applying HR module schema (leave, attendance, performance, documents)...');
    const hrSchemaSql = fs.readFileSync(path.join(__dirname, 'hr_schema.sql'), 'utf8');
    await client.query(hrSchemaSql);

    console.log('Checking for an active statutory rate set...');
    const { rows: existingRates } = await client.query(
      'SELECT id FROM statutory_rate_sets WHERE is_active = true LIMIT 1'
    );

    if (existingRates.length === 0) {
      console.log('Seeding default 2026 statutory rate set...');
      await client.query(
        `INSERT INTO statutory_rate_sets (label, effective_from, config, is_active)
         VALUES ($1, $2, $3, true)`,
        ['2026 Kenya statutory rates', '2026-02-01', DEFAULT_RATE_CONFIG]
      );
    } else {
      console.log('An active rate set already exists, skipping seed.');
    }

    const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
    const { rows: existingUsers } = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [adminEmail]
    );

    if (existingUsers.length === 0) {
      const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!';
      const hash = await bcrypt.hash(adminPassword, 10);
      await client.query(
        `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin')`,
        ['Payroll Admin', adminEmail, hash]
      );
      console.log(`Seeded admin user: ${adminEmail} / ${adminPassword} (change this immediately)`);
    } else {
      console.log('Admin user already exists, skipping seed.');
    }

    console.log('Migration complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
