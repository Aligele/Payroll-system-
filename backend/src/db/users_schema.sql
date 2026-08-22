-- Adds account-status support so admins can deactivate accounts instead of
-- deleting them (preserves foreign key history — payroll_runs.created_by,
-- leave_requests.approved_by, etc. still resolve correctly).
-- Role values in use: 'admin' (full access incl. user management) | 'staff'
-- (everything else). The column itself has no CHECK constraint, so this is
-- convention, not a hard DB rule.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
