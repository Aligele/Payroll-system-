-- Overtime, statutory remittance tracking, and WIBA insurance compliance.

-- Payslip fields added alongside overtime/deduction-cap support.
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS overtime_weekday_hours NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS overtime_restday_hours NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS overtime_pay NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS deduction_cap_breached BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS deduction_cap_limit NUMERIC(14,2);

-- Overtime entries are logged against a date, then picked up and folded
-- into gross pay the next time payroll runs for that employee's period —
-- payroll_run_id is set once applied, so an entry is never double-counted.
CREATE TABLE IF NOT EXISTS overtime_entries (
    id              SERIAL PRIMARY KEY,
    employee_id     INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    date            DATE NOT NULL,
    hours           NUMERIC(5,2) NOT NULL,
    rate_type       VARCHAR(20) NOT NULL DEFAULT 'weekday', -- weekday (1.5x) | rest_day_holiday (2x)
    notes           TEXT,
    payroll_run_id  INTEGER REFERENCES payroll_runs(id), -- NULL until applied to a run
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_overtime_employee_date ON overtime_entries(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_overtime_unapplied ON overtime_entries(employee_id) WHERE payroll_run_id IS NULL;

-- One row per statutory obligation per payroll run, recording whether/when
-- it was actually paid to KRA/NSSF/SHA — separate from the payslip amounts,
-- which are just what's owed, not proof of payment.
CREATE TABLE IF NOT EXISTS remittances (
    id              SERIAL PRIMARY KEY,
    payroll_run_id  INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
    type            VARCHAR(20) NOT NULL, -- paye | nssf | sha | housing_levy
    amount_due      NUMERIC(14,2) NOT NULL,
    paid            BOOLEAN NOT NULL DEFAULT false,
    reference_number VARCHAR(100),
    paid_date       DATE,
    paid_by         INTEGER REFERENCES users(id),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (payroll_run_id, type)
);

-- Work Injury Benefits Act cover — mandatory employer insurance, tracked
-- at the company level rather than per-employee/per-payslip.
CREATE TABLE IF NOT EXISTS wiba_policies (
    id              SERIAL PRIMARY KEY,
    insurer_name    VARCHAR(160) NOT NULL,
    policy_number   VARCHAR(100) NOT NULL,
    coverage_start  DATE NOT NULL,
    coverage_end    DATE NOT NULL,
    premium_amount  NUMERIC(14,2),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
