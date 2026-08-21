-- HR module: extends employees with org/employment fields, and adds
-- leave management, attendance tracking, performance reviews, and
-- employee document records. Admin/HR-managed only — no employee
-- self-service login, so there's no separate "employee" auth role here.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS department VARCHAR(100);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS job_title VARCHAR(120);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS employment_type VARCHAR(20) DEFAULT 'full_time'; -- full_time | part_time | contract | intern
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(120);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(30);

-- Employee documents (metadata only — no file storage wired up yet;
-- `link` can point to wherever the actual file lives, e.g. a shared drive).
CREATE TABLE IF NOT EXISTS employee_documents (
    id              SERIAL PRIMARY KEY,
    employee_id     INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    name            VARCHAR(160) NOT NULL,
    category        VARCHAR(60), -- contract | id_copy | certificate | disciplinary | other
    link            TEXT,
    notes           TEXT,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Leave management
CREATE TABLE IF NOT EXISTS leave_types (
    id                      SERIAL PRIMARY KEY,
    name                    VARCHAR(60) UNIQUE NOT NULL,
    annual_entitlement_days NUMERIC(5,1) NOT NULL DEFAULT 0,
    paid                    BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS leave_requests (
    id              SERIAL PRIMARY KEY,
    employee_id     INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    leave_type_id   INTEGER NOT NULL REFERENCES leave_types(id),
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    days            NUMERIC(5,1) NOT NULL,
    reason          TEXT,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | approved | rejected
    approved_by     INTEGER REFERENCES users(id),
    approved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Attendance tracking (manually logged by HR/admin per day)
CREATE TABLE IF NOT EXISTS attendance_records (
    id              SERIAL PRIMARY KEY,
    employee_id     INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    date            DATE NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'present', -- present | absent | late | on_leave | holiday
    check_in        TIME,
    check_out       TIME,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (employee_id, date)
);

-- Performance reviews
CREATE TABLE IF NOT EXISTS performance_reviews (
    id              SERIAL PRIMARY KEY,
    employee_id     INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    review_period   VARCHAR(60) NOT NULL, -- e.g. "2026 H1", "Q3 2026"
    reviewer_name   VARCHAR(120),
    rating          SMALLINT, -- 1-5
    strengths       TEXT,
    improvements    TEXT,
    goals           TEXT,
    comments        TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance_records(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_performance_reviews_employee ON performance_reviews(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_documents_employee ON employee_documents(employee_id);

-- Sensible Kenyan Employment Act defaults — verify against current law before relying on these.
INSERT INTO leave_types (name, annual_entitlement_days, paid) VALUES
  ('Annual Leave', 21, true),
  ('Sick Leave', 14, true),
  ('Maternity Leave', 90, true),
  ('Paternity Leave', 14, true),
  ('Compassionate Leave', 5, true),
  ('Unpaid Leave', 0, false)
ON CONFLICT (name) DO NOTHING;
