-- Staff loans/advances — a real ledger instead of a flat "other deduction"
-- line. Monthly deduction is applied automatically by payroll while a loan
-- is active, same pattern as overtime_entries: each repayment is logged
-- and tied back to the payroll run that applied it.
CREATE TABLE IF NOT EXISTS loans (
    id                SERIAL PRIMARY KEY,
    employee_id       INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    principal_amount  NUMERIC(14,2) NOT NULL,
    balance_remaining NUMERIC(14,2) NOT NULL,
    monthly_deduction NUMERIC(14,2) NOT NULL,
    disbursed_date    DATE NOT NULL,
    status            VARCHAR(20) NOT NULL DEFAULT 'active', -- active | paid_off | written_off
    notes             TEXT,
    created_by        INTEGER REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loans_employee ON loans(employee_id);
CREATE INDEX IF NOT EXISTS idx_loans_active ON loans(employee_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS loan_repayments (
    id              SERIAL PRIMARY KEY,
    loan_id         INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    payroll_run_id  INTEGER NOT NULL REFERENCES payroll_runs(id),
    amount          NUMERIC(14,2) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (loan_id, payroll_run_id)
);

-- Offboarding checklist — auto-populated with default items when an
-- employee is terminated, tracked to completion.
CREATE TABLE IF NOT EXISTS offboarding_checklists (
    id           SERIAL PRIMARY KEY,
    employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    item         VARCHAR(200) NOT NULL,
    completed    BOOLEAN NOT NULL DEFAULT false,
    completed_at TIMESTAMPTZ,
    completed_by INTEGER REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_offboarding_employee ON offboarding_checklists(employee_id);

-- Audit log — who did what, when. Scoped to the sensitive/high-value
-- actions (employee changes, payroll runs, user/role changes, remittance
-- payments) rather than every single mutation in the app.
CREATE TABLE IF NOT EXISTS audit_log (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER REFERENCES users(id),
    action      VARCHAR(60) NOT NULL,
    entity_type VARCHAR(40) NOT NULL,
    entity_id   INTEGER,
    details     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);

-- Links a login to an employee record, for employee self-service. NULL
-- for admin/staff/hr_staff accounts that aren't tied to one employee.
ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id INTEGER REFERENCES employees(id);
