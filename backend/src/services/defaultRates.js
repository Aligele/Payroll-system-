/**
 * Default Kenyan statutory deduction rates.
 *
 * IMPORTANT: These figures change periodically (Finance Act amendments, NSSF
 * Act phased increases, SHA gazette notices). This file only seeds the
 * `statutory_rate_sets` table on first run — after that, update rates by
 * inserting a new row in that table (see README "Updating statutory rates"),
 * NOT by editing this file, so historical payslips keep using the rates
 * that were actually in force when they were run.
 *
 * Sources current as of Aug 2026: KRA Income Tax Act Cap 470 (PAYE bands,
 * unchanged since Finance Act 2023), NSSF Act Tier I/II limits (revised
 * 1 Feb 2026), Social Health Insurance Act 2023 (SHA/SHIF), Affordable
 * Housing Act 2024. Verify against kra.go.ke / nssf.or.ke / sha.go.ke
 * before going live — a Finance Bill 2026 proposing new PAYE bands from
 * 1 Jan 2027 was still before Parliament at the time this was written.
 *
 * Overtime and deduction-cap figures come from the Employment Act 2007:
 * §19 caps total deductions at two-thirds of wages; overtime multipliers
 * (1.5x / 2x) are standard Regulation of Wages practice. The hours-per-month
 * divisor used to derive an hourly rate from a monthly salary is NOT set in
 * statute — 195 is a commonly used figure (26 days x 7.5 hrs) but employers
 * vary; check your own contracts/CBA and adjust standardMonthlyHours below
 * if it doesn't match.
 */

const DEFAULT_RATE_CONFIG = {
  currency: 'KES',
  paye: {
    // Progressive monthly bands. `upTo` is inclusive; last band has upTo: null.
    bands: [
      { upTo: 24000, rate: 0.10 },
      { upTo: 32333, rate: 0.25 },
      { upTo: 500000, rate: 0.30 },
      { upTo: 800000, rate: 0.325 },
      { upTo: null, rate: 0.35 },
    ],
    personalRelief: 2400,
    // NSSF, SHA, AHL and registered-pension contributions (up to the cap)
    // are deducted from gross pay BEFORE PAYE bands are applied.
    pensionReliefCap: 30000,
  },
  nssf: {
    tier1: { lowerLimit: 0, upperLimit: 9000, rate: 0.06 },
    tier2: { lowerLimit: 9000, upperLimit: 108000, rate: 0.06 },
  },
  sha: {
    rate: 0.0275,
    minimumContribution: 300,
  },
  housingLevy: {
    employeeRate: 0.015,
    employerRate: 0.015,
  },
  overtime: {
    standardMonthlyHours: 195, // see note above — verify against your own contracts
    weekdayMultiplier: 1.5,
    restDayHolidayMultiplier: 2.0,
  },
  deductionCap: {
    // Employment Act §19: total deductions (statutory + other) may not
    // exceed this fraction of gross pay.
    maxFractionOfGross: 2 / 3,
  },
};

module.exports = { DEFAULT_RATE_CONFIG };
