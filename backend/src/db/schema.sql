-- Payroll system schema (Kenya statutory deductions)

CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(120) NOT NULL,
    email           VARCHAR(160) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    role            VARCHAR(20) NOT NULL DEFAULT 'admin', -- admin | payroll_officer
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employees (
    id              SERIAL PRIMARY KEY,
    employee_no     VARCHAR(30) UNIQUE NOT NULL,
    first_name      VARCHAR(80) NOT NULL,
    last_name       VARCHAR(80) NOT NULL,
    email           VARCHAR(160),
    id_number       VARCHAR(30),
    kra_pin         VARCHAR(20),
    nssf_number     VARCHAR(30),
    sha_number      VARCHAR(30),
    bank_name       VARCHAR(100),
    bank_account    VARCHAR(50),
    basic_salary    NUMERIC(14,2) NOT NULL DEFAULT 0,
    allowances      JSONB NOT NULL DEFAULT '[]', -- [{ "name": "House Allowance", "amount": 15000, "taxable": true }]
    other_deductions JSONB NOT NULL DEFAULT '[]', -- [{ "name": "Staff Loan", "amount": 5000 }]
    pension_contribution NUMERIC(14,2) NOT NULL DEFAULT 0, -- voluntary registered pension, pre-tax, capped at 30000
    status          VARCHAR(20) NOT NULL DEFAULT 'active', -- active | suspended | terminated
    hire_date       DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Statutory rates are stored in the DB (not hardcoded) so they can be updated
-- when KRA / NSSF / SHA change figures, without a code deploy.
CREATE TABLE IF NOT EXISTS statutory_rate_sets (
    id              SERIAL PRIMARY KEY,
    label           VARCHAR(60) NOT NULL,          -- e.g. "2026 rates"
    effective_from  DATE NOT NULL,
    config          JSONB NOT NULL,                 -- full rate config, see services/statutoryDeductions.js
    is_active       BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payroll_runs (
    id              SERIAL PRIMARY KEY,
    period_month    SMALLINT NOT NULL,  -- 1-12
    period_year     SMALLINT NOT NULL,
    run_date        TIMESTAMPTZ NOT NULL DEFAULT now(),
    status          VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft | processed | paid
    rate_set_id     INTEGER REFERENCES statutory_rate_sets(id),
    created_by      INTEGER REFERENCES users(id),
    UNIQUE (period_month, period_year)
);

CREATE TABLE IF NOT EXISTS payslips (
    id                  SERIAL PRIMARY KEY,
    payroll_run_id      INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
    employee_id         INTEGER NOT NULL REFERENCES employees(id),
    basic_salary        NUMERIC(14,2) NOT NULL,
    taxable_allowances  NUMERIC(14,2) NOT NULL DEFAULT 0,
    non_taxable_allowances NUMERIC(14,2) NOT NULL DEFAULT 0,
    gross_pay           NUMERIC(14,2) NOT NULL,
    nssf_tier1           NUMERIC(14,2) NOT NULL DEFAULT 0,
    nssf_tier2           NUMERIC(14,2) NOT NULL DEFAULT 0,
    nssf_total            NUMERIC(14,2) NOT NULL DEFAULT 0,
    sha_contribution       NUMERIC(14,2) NOT NULL DEFAULT 0,
    housing_levy            NUMERIC(14,2) NOT NULL DEFAULT 0,
    pension_contribution     NUMERIC(14,2) NOT NULL DEFAULT 0,
    taxable_income            NUMERIC(14,2) NOT NULL DEFAULT 0,
    paye_before_relief          NUMERIC(14,2) NOT NULL DEFAULT 0,
    personal_relief               NUMERIC(14,2) NOT NULL DEFAULT 0,
    paye                            NUMERIC(14,2) NOT NULL DEFAULT 0,
    other_deductions_total           NUMERIC(14,2) NOT NULL DEFAULT 0,
    other_deductions_detail          JSONB NOT NULL DEFAULT '[]',
    total_deductions                  NUMERIC(14,2) NOT NULL DEFAULT 0,
    net_pay                            NUMERIC(14,2) NOT NULL,
    employer_nssf                       NUMERIC(14,2) NOT NULL DEFAULT 0,
    employer_housing_levy                NUMERIC(14,2) NOT NULL DEFAULT 0,
    created_at                            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (payroll_run_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_payslips_employee ON payslips(employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_period ON payroll_runs(period_year, period_month);
