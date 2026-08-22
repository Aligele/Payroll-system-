# Ledger — Kenya Payroll System

A payroll web app that automatically computes **PAYE, NSSF (Tier I & II), SHA (SHIF)
and the Affordable Housing Levy** when you run payroll, then produces a payslip
per employee. Stack: Node.js/Express + PostgreSQL, plain HTML/CSS/JS frontend
(no build step).

## How the deductions work

Order of calculation for each employee, per pay period (see
`backend/src/services/statutoryDeductions.js`):

1. **Gross pay** = basic salary + allowances (taxable and non-taxable).
2. **NSSF** — Tier I: 6% of the first KES 9,000; Tier II: 6% of pay between
   KES 9,001–108,000. Employer matches both tiers.
3. **SHA / SHIF** — 2.75% of gross pay, minimum KES 300.
4. **Housing Levy** — 1.5% of gross pay (employee), employer matches 1.5%.
5. **Taxable income** = taxable gross − NSSF − SHA − Housing Levy − pension
   contribution (capped at KES 30,000).
6. **PAYE** — progressive bands (10% / 25% / 30% / 32.5% / 35%), minus
   personal relief of KES 2,400/month.
7. **Net pay** = gross pay − all of the above − any other deductions (loans,
   advances, etc.).

**These rates are stored in the database** (`statutory_rate_sets` table), not
hardcoded, specifically so you can update them the moment KRA, NSSF or SHA
change a figure — without a code deploy. See "Updating statutory rates" below.

⚠️ **Verify the seeded rates against the official sources
(kra.go.ke, nssf.or.ke, sha.go.ke) before running real payroll.** Kenyan
payroll rates change via Finance Acts, court rulings and gazette notices —
the numbers in `backend/src/services/defaultRates.js` were current as of
August 2026 but a Finance Bill 2026 proposing new PAYE bands from 1 January
2027 was still before Parliament when this was built.

## Project structure

```
payroll-system/
├── backend/
│   ├── api/index.js                Vercel serverless entry point (exports the Express app)
│   ├── vercel.json                 Routes every request to api/index.js; bundles public/
│   ├── public/                     Static HTML/CSS/JS admin UI (served by Express)
│   └── src/
│       ├── app.js                  Express app (routes, middleware, static serving) — no listen()
│       ├── server.js               Local/Docker entry point — imports app.js, calls listen()
│       ├── config/db.js            PostgreSQL connection pool
│       ├── db/schema.sql           Table definitions
│       ├── db/migrate.js           Creates tables + seeds rates & admin user
│       ├── services/
│       │   ├── statutoryDeductions.js   PAYE/NSSF/SHA/Housing Levy math (pure functions)
│       │   ├── payrollService.js        Runs payroll for all employees, saves payslips
│       │   └── defaultRates.js          Seed values for the rate set
│       ├── routes/                 Employees, payroll, auth endpoints
│       └── middleware/auth.js      JWT auth guard
└── docker-compose.yml              Local Postgres for development
```

**Why the app.js / server.js split:** Vercel runs Node.js code as serverless
functions, not a long-lived process — so it needs a plain module that exports
the Express `app`, without anything calling `app.listen()`. `server.js` is
the traditional entry point for local development and Docker, where a real
persistent server is exactly what you want. Both just import the same
`app.js`, so the routes and middleware are identical either way.

## Setup

**1. Start PostgreSQL** (or point `DATABASE_URL` at an existing instance):
```bash
docker compose up -d
```

**2. Configure environment:**
```bash
cd backend
cp .env.example .env
# edit .env — set JWT_SECRET to a long random string
```

**3. Install dependencies and set up the database:**
```bash
npm install
npm run migrate
```
This creates the tables, seeds the 2026 rate set, and creates an admin user.
The generated login is printed to the console — by default
`admin@example.com` / `ChangeMe123!` unless you set `SEED_ADMIN_EMAIL` /
`SEED_ADMIN_PASSWORD` in `.env` first. **Change this password after first login.**

**4. Run the server:**
```bash
npm start
```
Open **http://localhost:4000** — this serves both the API (under `/api`) and
the frontend.

## Using it

1. Sign in.
2. **Employees** — add each employee with their basic salary, KRA PIN, NSSF
   and SHA numbers. (Allowances and other deductions can be added via the API
   — see below — the UI form covers the common fields; extend
   `employee-form` in `backend/public/js/app.js` if you want them in the UI too.)
3. **Run payroll** — pick a month/year and click "Process payroll". This
   calculates every active employee's deductions and creates payslips.
   Re-running the same period recalculates it (unless it's been marked paid).
4. **Payroll history** — browse past runs, click a row for its payslips,
   click a payslip row to see the full breakdown, and mark a run "paid" once
   salaries have actually been disbursed (this locks it).

## API reference (all except `/auth/login` require `Authorization: Bearer <token>`)

| Method & path                     | Purpose                                      |
|-----------------------------------|-----------------------------------------------|
| `POST /api/auth/login`            | Get a JWT                                     |
| `GET /api/employees`              | List employees                                |
| `POST /api/employees`             | Create employee (see body shape below)        |
| `PUT /api/employees/:id`          | Update employee                               |
| `DELETE /api/employees/:id`       | Sets status to `terminated`                   |
| `POST /api/payroll/run`           | `{ periodMonth, periodYear }` — processes payroll |
| `GET /api/payroll/runs`           | List all payroll runs                         |
| `GET /api/payroll/runs/:id`       | One run + its payslips                        |
| `POST /api/payroll/runs/:id/mark-paid` | Locks a processed run                    |
| `POST /api/payroll/preview`       | Calculate a payslip without saving (what-if)  |

Employee `allowances` and `otherDeductions` are JSON arrays, e.g.:
```json
{
  "allowances": [
    { "name": "House Allowance", "amount": 15000, "taxable": true },
    { "name": "Airtime", "amount": 2000, "taxable": false }
  ],
  "otherDeductions": [{ "name": "Staff loan repayment", "amount": 5000 }]
}
```

## Deleting or terminating an employee

Two different actions, on purpose:

- **Terminate employment** — soft action, marks the employee inactive.
  Their payslips, leave history, attendance, and performance reviews all
  stay intact and they're just excluded from future payroll runs. Use this
  for someone who actually left.
- **Delete (wrong entry)** — hard delete, for correcting a mistaken entry.
  **Blocked if the employee has any payroll history** (a real payslip can
  never be silently erased), so this only works for a freshly-added record
  with no payroll runs against it yet. Their leave/attendance/performance/
  document records are removed along with them.

Both are available from an employee's detail view (click any row on the
Employees page).

## User roles and admin management

There are three roles:
- **admin** — full access, including managing other users.
- **staff** — everything except user management: payroll, HR, leave,
  attendance, performance.
- **hr_staff** — leave, attendance, performance, and employee records, but
  **no payroll access at all** (every `/api/payroll/*` route returns 403)
  and no visibility into compensation — salary, bank details, allowances,
  deductions, and pension contribution are stripped from every employee
  response, and silently ignored if submitted when creating or editing an
  employee. This is enforced server-side, not just hidden in the UI.

The seeded account from the migration is an admin. Admins can add new
accounts and change roles from the **Users** tab, which only appears in the
sidebar for admins. Accounts are deactivated rather than deleted, so
historical records (who approved a leave request, who ran a payroll) stay
intact. The system won't let you demote or deactivate the last remaining
active admin.

## HR module

Alongside payroll, the app now covers core HR admin functions (all managed
by HR/admin staff — there's no separate employee login):

- **Employee records** — department, job title, employment type, emergency
  contact, plus a document register per employee (name/category/link — file
  storage itself isn't wired up yet, `link` just points wherever the actual
  file lives).
- **Leave management** — request, approve/reject, and a balance calculator
  (entitlement minus approved days taken, per leave type per year). Seeded
  with Kenyan Employment Act defaults (21 days annual, 14 sick, 90 maternity,
  14 paternity, 5 compassionate) — verify against current law before relying
  on these for real leave accounting.
- **Attendance** — mark daily status (present/absent/late/on leave/holiday)
  with optional check-in/out times, per employee per day.
- **Performance reviews** — review period, reviewer, 1–5 rating, strengths,
  areas for improvement, goals, and comments, with history per employee.

## Payslip and P9 downloads

- **Payslip PDF**: open any payslip (Run payroll results, or Payroll history →
  a run → a payslip row) and click "Download PDF".
- **P9 form**: the "P9 forms" tab generates a KRA-style Tax Deduction Card for
  one employee's full calendar year, computed from that employee's payslips
  across every payroll run in that year. This is **your own computed summary
  for record-keeping and handing to employees** — not an official KRA-issued
  document. Always reconcile the totals against what was actually filed on
  iTax before distributing it. KRA's own blank P9A template (for reference or
  manual filing) is at
  https://www.kra.go.ke/images/publications/P9-FORM-Template-2025.pdf.
- Set `COMPANY_NAME` in your environment variables to have it appear on
  generated PDFs (defaults to "Your Company Name" if unset).

## Updating statutory rates

Insert a new row into `statutory_rate_sets` and flip `is_active`:
```sql
UPDATE statutory_rate_sets SET is_active = false WHERE is_active = true;
INSERT INTO statutory_rate_sets (label, effective_from, config, is_active)
VALUES ('2027 rates', '2027-01-01', '{ ... full config JSON ... }', true);
```
Past payroll runs keep referencing the rate set that was active when they
ran (`payroll_runs.rate_set_id`), so historical payslips never change
retroactively.

## What this doesn't do yet (natural next steps)

- Payslip PDF export / email delivery
- Bank file / M-Pesa bulk-payment export for actual disbursement
- Multi-company / multi-currency support
- Leave, overtime, and commission modules feeding into gross pay
- Role-based permissions beyond a single `admin` role
- Automated tests for the calculation engine (the pure functions in
  `statutoryDeductions.js` are written to be easy to unit test — e.g. with
  Jest — this just hasn't been wired up)
