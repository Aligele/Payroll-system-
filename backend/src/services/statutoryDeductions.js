/**
 * Pure calculation functions for Kenyan statutory payroll deductions:
 * PAYE, NSSF (Tier I & II), SHA (SHIF), and the Affordable Housing Levy.
 *
 * Every function takes a `config` object (see defaultRates.js for shape)
 * so rates can be swapped per payroll run without touching this file.
 * All functions are pure (no DB/IO) so they're easy to unit test.
 */

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Progressive PAYE calculation over taxable income (after NSSF/SHA/AHL/pension). */
function calculatePAYE(taxableIncome, payeConfig) {
  const income = Math.max(0, taxableIncome);
  let remaining = income;
  let lowerBound = 0;
  let taxBeforeRelief = 0;
  const breakdown = [];

  for (const band of payeConfig.bands) {
    const bandCeiling = band.upTo === null ? Infinity : band.upTo;
    const bandWidth = bandCeiling - lowerBound;
    const taxableInBand = Math.max(0, Math.min(remaining, bandWidth));

    if (taxableInBand > 0) {
      const taxInBand = taxableInBand * band.rate;
      taxBeforeRelief += taxInBand;
      breakdown.push({
        from: lowerBound,
        to: band.upTo,
        rate: band.rate,
        amount: round2(taxableInBand),
        tax: round2(taxInBand),
      });
    }

    remaining -= taxableInBand;
    lowerBound = bandCeiling;
    if (remaining <= 0) break;
  }

  const relief = payeConfig.personalRelief || 0;
  const payeDue = Math.max(0, taxBeforeRelief - relief);

  return {
    taxableIncome: round2(income),
    payeBeforeRelief: round2(taxBeforeRelief),
    personalRelief: round2(Math.min(relief, taxBeforeRelief)),
    paye: round2(payeDue),
    breakdown,
  };
}

/** NSSF Tier I + Tier II employee contribution (employer matches both tiers). */
function calculateNSSF(pensionablePay, nssfConfig) {
  const pay = Math.max(0, pensionablePay);
  const { tier1, tier2 } = nssfConfig;

  const tier1Pensionable = Math.max(0, Math.min(pay, tier1.upperLimit) - tier1.lowerLimit);
  const tier1Amount = round2(tier1Pensionable * tier1.rate);

  const tier2Pensionable = Math.max(0, Math.min(pay, tier2.upperLimit) - tier2.lowerLimit);
  const tier2Amount = round2(tier2Pensionable * tier2.rate);

  const employeeTotal = round2(tier1Amount + tier2Amount);

  return {
    tier1: tier1Amount,
    tier2: tier2Amount,
    employeeTotal,
    employerTotal: employeeTotal, // NSSF employer contribution mirrors the employee's
  };
}

/** SHA / SHIF contribution: flat percentage of gross pay, with a floor. */
function calculateSHA(grossPay, shaConfig) {
  const computed = grossPay * shaConfig.rate;
  return round2(Math.max(computed, shaConfig.minimumContribution || 0));
}

/** Affordable Housing Levy: employee and matching employer portion. */
function calculateHousingLevy(grossPay, housingConfig) {
  return {
    employee: round2(grossPay * housingConfig.employeeRate),
    employer: round2(grossPay * housingConfig.employerRate),
  };
}

/**
 * Overtime pay under the Employment Act — 1.5x normal hourly rate on
 * weekdays, 2x on rest days/public holidays. Hourly rate is derived from
 * monthly basic salary using a configurable standard-hours divisor (see
 * defaultRates.js — this divisor isn't fixed by statute, so verify it
 * against your own contracts).
 */
function calculateOvertime(basicSalary, hours, overtimeConfig = {}) {
  const { weekday = 0, restDayHoliday = 0 } = hours || {};
  const standardHours = overtimeConfig.standardMonthlyHours || 195;
  const hourlyRate = standardHours > 0 ? basicSalary / standardHours : 0;
  const weekdayPay = round2(weekday * hourlyRate * (overtimeConfig.weekdayMultiplier ?? 1.5));
  const restDayHolidayPay = round2(restDayHoliday * hourlyRate * (overtimeConfig.restDayHolidayMultiplier ?? 2.0));
  return {
    weekdayHours: Number(weekday),
    restDayHolidayHours: Number(restDayHoliday),
    hourlyRate: round2(hourlyRate),
    weekdayPay,
    restDayHolidayPay,
    totalPay: round2(weekdayPay + restDayHolidayPay),
  };
}

/**
 * Runs a full payslip calculation for one employee for one pay period.
 *
 * @param {Object} input
 * @param {number} input.basicSalary
 * @param {Array<{name:string, amount:number, taxable:boolean}>} input.allowances
 * @param {Array<{name:string, amount:number}>} input.otherDeductions - non-statutory (loans, advances...)
 * @param {number} input.pensionContribution - voluntary registered pension, pre-tax up to cap
 * @param {Object} config - full statutory rate config (see defaultRates.js)
 */
function calculatePayslip(input, config) {
  const {
    basicSalary = 0,
    allowances = [],
    otherDeductions = [],
    pensionContribution = 0,
    overtimeHours = null, // { weekday, restDayHoliday } in hours, or null/omitted for none
  } = input;

  const taxableAllowances = allowances
    .filter((a) => a.taxable !== false)
    .reduce((sum, a) => sum + Number(a.amount || 0), 0);
  const nonTaxableAllowances = allowances
    .filter((a) => a.taxable === false)
    .reduce((sum, a) => sum + Number(a.amount || 0), 0);

  const overtime = overtimeHours && (Number(overtimeHours.weekday) > 0 || Number(overtimeHours.restDayHoliday) > 0)
    ? calculateOvertime(basicSalary, overtimeHours, config.overtime || {})
    : null;
  const overtimePay = overtime ? overtime.totalPay : 0;

  const grossPay = round2(basicSalary + taxableAllowances + nonTaxableAllowances + overtimePay);

  // NSSF is calculated on regular pensionable pay, which commonly excludes
  // overtime (it's irregular, not a fixed pensionable earning) — verify
  // against your own scheme rules, this isn't fixed by a single statute.
  const nssfBase = round2(basicSalary + taxableAllowances + nonTaxableAllowances);
  // SHA and the Housing Levy are calculated on gross cash pay, which does
  // include overtime.
  const shaHousingBase = grossPay;

  const nssf = calculateNSSF(nssfBase, config.nssf);
  const sha = calculateSHA(shaHousingBase, config.sha);
  const housingLevy = calculateHousingLevy(shaHousingBase, config.housingLevy);

  const cappedPension = Math.min(
    Number(pensionContribution || 0),
    config.paye.pensionReliefCap ?? Infinity
  );

  // Taxable income = gross taxable pay (including overtime, which is
  // ordinary taxable employment income) minus pre-tax statutory deductions and pension.
  const taxableGross = basicSalary + taxableAllowances + overtimePay;
  const taxableIncome = round2(
    Math.max(0, taxableGross - nssf.employeeTotal - sha - housingLevy.employee - cappedPension)
  );

  const payeResult = calculatePAYE(taxableIncome, config.paye);

  const otherDeductionsTotal = round2(
    otherDeductions.reduce((sum, d) => sum + Number(d.amount || 0), 0)
  );

  const totalDeductions = round2(
    nssf.employeeTotal +
      sha +
      housingLevy.employee +
      payeResult.paye +
      cappedPension +
      otherDeductionsTotal
  );

  const netPay = round2(grossPay - totalDeductions);

  // Employment Act §19: total deductions can't exceed a set fraction
  // (commonly two-thirds) of gross pay. This flags a breach — it doesn't
  // block the payslip, since a real breach still needs to be visible to fix.
  let deductionCap = null;
  if (config.deductionCap && config.deductionCap.maxFractionOfGross != null) {
    const limit = round2(grossPay * config.deductionCap.maxFractionOfGross);
    deductionCap = { limit, breached: totalDeductions > limit };
  }

  return {
    basicSalary: round2(basicSalary),
    taxableAllowances: round2(taxableAllowances),
    nonTaxableAllowances: round2(nonTaxableAllowances),
    overtime,
    grossPay,
    nssf,
    sha,
    housingLevy,
    pensionContribution: round2(cappedPension),
    taxableIncome: payeResult.taxableIncome,
    payeBeforeRelief: payeResult.payeBeforeRelief,
    personalRelief: payeResult.personalRelief,
    paye: payeResult.paye,
    payeBreakdown: payeResult.breakdown,
    otherDeductions,
    otherDeductionsTotal,
    totalDeductions,
    netPay,
    deductionCap,
  };
}

module.exports = {
  calculatePAYE,
  calculateNSSF,
  calculateSHA,
  calculateHousingLevy,
  calculateOvertime,
  calculatePayslip,
  round2,
};
