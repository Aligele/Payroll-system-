const { Pool } = require('pg');

// Managed Postgres providers (Supabase, Neon, RDS, etc.) require SSL on
// direct connections. node-postgres doesn't infer this from the connection
// string alone, so it has to be set explicitly — without it, every query
// fails at connection time. rejectUnauthorized: false is standard here
// because these providers use certs that aren't in Node's default trust
// store; the connection itself is still encrypted, just not chain-verified.
const useSSL = process.env.DATABASE_SSL !== 'false';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  // Log and let the pool recover instead of crashing the whole process —
  // in a serverless environment (Vercel) each invocation is short-lived,
  // and process.exit() here would kill unrelated in-flight requests too.
  console.error('Unexpected error on idle PostgreSQL client', err);
});

module.exports = pool;
