# Holiday Entitlement Calculation Guide

## Overview

This document explains how holiday entitlements are calculated in our staff management system. The system follows UK statutory holiday entitlement rules and automatically calculates pro-rated entitlements based on employment dates and contracted hours changes.

## Company Holiday Policy

All employees are entitled to **5.6 weeks pro rata paid holiday leave per year** (up to a maximum of 28 days).

### Calculation Method
To work out how many days of paid leave you are entitled to each year:
1. **Convert contracted hours to days**: `contracted hours ÷ 12 = contracted days` (1 day = 12 hours)
2. **Calculate holiday entitlement**: `contracted days × 5.6 = holiday days`
3. **Round up to nearest full day**: This is your final entitlement

### Examples
- **36 hours/week**: 36 ÷ 12 = 3 days → 3 × 5.6 = 16.8 days → **17 days** (rounded up)
- **24 hours/week**: 24 ÷ 12 = 2 days → 2 × 5.6 = 11.2 days → **12 days** (rounded up)
- **12 hours/week**: 12 ÷ 12 = 1 day → 1 × 5.6 = 5.6 days → **6 days** (rounded up)

## Calculation Methods

### 1. Company Policy Calculation (Final Entitlement)

**Formula**: `CEIL((contracted hours ÷ 12) × 5.6)`

**Examples**:
- 36 hours/week: CEIL((36 ÷ 12) × 5.6) = CEIL(3 × 5.6) = CEIL(16.8) = **17 days**
- 24 hours/week: CEIL((24 ÷ 12) × 5.6) = CEIL(2 × 5.6) = CEIL(11.2) = **12 days**
- 12 hours/week: CEIL((12 ÷ 12) × 5.6) = CEIL(1 × 5.6) = CEIL(5.6) = **6 days**

### 2. Accurate Hours-Based Calculation (For Reference)

**Formula**: `5.6 weeks × contracted hours per week`

**Examples**:
- 36 hours/week: 5.6 × 36 = **201.6 hours** (16.8 days)
- 24 hours/week: 5.6 × 24 = **134.4 hours** (11.2 days)
- 12 hours/week: 5.6 × 12 = **67.2 hours** (5.6 days)

**Note**: The system shows both calculations for transparency, but the final entitlement follows the company policy (rounded up days).

### 3. Pro-rated Entitlement Calculation

When someone doesn't work the full financial year (April 6th to April 5th), their entitlement is pro-rated based on how long they work.

**Formula**: `Full entitlement × (Days worked ÷ Total days in year)`

## Scenarios and Examples

### Scenario 1: Full-Year Employee

**Example**: Sarah works 24 hours/week for the entire financial year (April 6th, 2025 to April 5th, 2026)

**Calculation**:
- Full entitlement: 5.6 × 24 = 134.4 hours
- Pro-rate factor: 365 days ÷ 365 days = 1.0 (100%)
- **Final entitlement: 134.4 hours (22.4 days)**

### Scenario 2: Mid-Year Start (Employment Start Date)

**Example**: John starts working 24 hours/week on July 10th, 2025

**Calculation**:
- Full entitlement: 5.6 × 24 = 134.4 hours
- Days from start to year end: July 10th to April 5th, 2026 = 270 days
- Total days in year: 365 days
- Pro-rate factor: 270 ÷ 365 = 0.7397 (73.97%)
- **Final entitlement: 134.4 × 0.7397 = 99.4 hours (16.6 days)**

### Scenario 3: Contracted Hours Change During Year

**Example**: Matt starts with 0 hours, then changes to 24 hours/week on September 8th, 2025

**Calculation**:
- Full entitlement for 24 hours: 5.6 × 24 = 134.4 hours
- Days from change to year end: September 8th to April 5th, 2026 = 209 days
- Total days in year: 365 days
- Pro-rate factor: 209 ÷ 365 = 0.5726 (57.26%)
- **Final entitlement: 134.4 × 0.5726 = 77.0 hours (12.8 days)**

### Scenario 4: Early Termination

**Example**: Lisa works 16 hours/week from April 6th, 2025, but leaves on December 31st, 2025

**Calculation**:
- Full entitlement: 5.6 × 16 = 89.6 hours
- Days worked: April 6th to December 31st, 2025 = 270 days
- Total days in year: 365 days
- Pro-rate factor: 270 ÷ 365 = 0.7397 (73.97%)
- **Final entitlement: 89.6 × 0.7397 = 66.3 hours (11.0 days)**

### Scenario 5: Zero Hours Contract

**Example**: Tom has a zero-hours contract but works variable hours

**Calculation**:
- Basic entitlement: 5.6 × 0 = 0 hours
- **Note**: Zero-hours workers get holiday pay based on hours actually worked, not contracted hours

### Scenario 6: Multiple Hours Changes

**Example**: Emma starts with 12 hours/week on June 1st, increases to 24 hours/week on September 1st

**Calculation**:
- **Period 1** (June 1st to August 31st): 12 hours/week
  - Full entitlement: 5.6 × 12 = 67.2 hours
  - Days: 92 days
  - Pro-rated: 67.2 × (92 ÷ 365) = 16.9 hours

- **Period 2** (September 1st to April 5th): 24 hours/week
  - Full entitlement: 5.6 × 24 = 134.4 hours
  - Days: 217 days
  - Pro-rated: 134.4 × (217 ÷ 365) = 79.9 hours

- **Total entitlement: 16.9 + 79.9 = 96.8 hours (16.1 days)**

## Real Examples from Our System

### John's Entitlement
- **Contracted Hours**: 24 hours/week
- **Employment Start**: July 10th, 2025
- **Calculation**: Pro-rated from July 10th to April 5th, 2026
- **Result**: 8.3 days (99.6 hours)

### Matt's Entitlement
- **Contracted Hours**: 24 hours/week (changed from 0 hours on September 8th, 2025)
- **Change Date**: September 8th, 2025
- **Calculation**: Pro-rated from September 8th to April 5th, 2026
- **Result**: 6.4 days (30.7 hours)

## Company-Specific Policies

### Holiday Year
- **Financial Year**: Holiday year runs from April 6th to April 5th (not calendar year)
- **Use It or Lose It**: All holiday days must be used before the end of the financial year (5th April) and cannot be carried over to the next year
- **Lost Holidays**: Any unused holiday at the end of the financial year will be lost

### Bank Holidays
- **Included in Entitlement**: Bank holidays are treated as any ordinary working days and paid at the standard rate
- **Part of 5.6 Weeks**: Bank holidays are included in the 5.6 weeks statutory holiday entitlement

### Overtime
- **Additional Entitlement**: Additional holiday entitlement will be accrued for any overtime worked

### Holiday Usage Rules
- **One Week Definition**: 'One week' of holiday is defined as the number of days worked in a normal week, as contracted
  - Example: If you have a 36hr (3 day)/week contract and you take a 7 day holiday, you will have used 3 days annual holiday leave
- **Partial Week Holidays**: If you use holiday for part of a week, you will only be entitled to the proportion of your normal contracted hours for the portion of the week you are not on holiday
  - Example: If you usually work 3 shifts a week and you are on holiday Mon-Thurs, you can use 2 holiday days and work 1 shift

## Key Points to Remember

1. **Calculation Method**: 1 day = 12 hours, then multiply contracted days by 5.6 and round up

2. **Pro-rating**: Entitlements are automatically pro-rated based on:
   - Employment start date
   - Contracted hours change dates
   - Employment end date (if applicable)

3. **Dual Display**: The system shows both:
   - **Accurate calculation**: Hours-based calculation (e.g., 16.8 days)
   - **Company policy**: Rounded up days (e.g., 17 days)

4. **Automatic Updates**: When contracted hours change, holiday entitlements are automatically recalculated

5. **Zero Hours**: Workers with zero contracted hours get holiday pay based on hours actually worked

## Technical Implementation

The system uses these database functions:

- `calculate_holiday_entitlement(contracted_hours)`: Basic calculation
- `calculate_pro_rated_entitlement(...)`: Pro-rating calculation
- `calculate_financial_year_entitlement(...)`: Full financial year calculation
- `recalculate_holiday_entitlement(...)`: Updates entitlements when changes occur

## API Endpoints

- `PUT /api/time-off/holiday-entitlements/:staffId/recalculate`: Recalculate individual entitlement
- `POST /api/time-off/holiday-entitlements/recalculate-early-terminations`: Bulk recalculate for early terminations

## Common Questions

**Q: Why does Matt have fewer days than John when they both work 24 hours?**
A: Matt's entitlement is pro-rated from September 8th (when he changed to 24 hours), while John's is pro-rated from July 10th (his employment start). John has been working 24 hours longer, so he gets more holiday entitlement.

**Q: What happens if someone changes their hours multiple times?**
A: The system calculates entitlement for each period separately and adds them together.

**Q: How is holiday pay calculated?**
A: Holiday pay = (Holiday hours taken) × (Current hourly rate at time of holiday)

**Q: Can entitlements be negative?**
A: No, the minimum entitlement is 0 hours, even for very short employment periods.

---

*This guide is based on UK statutory holiday entitlement rules and our system's implementation. For specific legal advice, consult with HR or legal professionals.*
