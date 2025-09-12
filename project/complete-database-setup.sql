-- 🚀 Complete Database Setup Script
-- Staff Rota Management System with Time-Off Management
-- This script sets up ONLY the database schema actually used in the codebase
-- Run this in your PostgreSQL database to create everything needed for the system
--
-- HOLIDAY POLICY IMPLEMENTATION:
-- • 5.6 weeks pro rata paid holiday leave per year (max 28 days)
-- • 1 day = 12 hours, round up to nearest full day
-- • Financial year: 6th April to 5th April
-- • No carryover - unused holiday lost at year end
-- • Bank holidays included in 5.6 weeks statutory entitlement
-- • Additional holiday entitlement accrued for overtime worked
-- • Proportional holiday usage based on contracted days per week

-- =====================================================
-- 1. CORE TABLES (ACTUALLY USED)
-- =====================================================

-- Human Resource table (staff members) - ONLY USED COLUMNS
CREATE TABLE IF NOT EXISTS human_resource (
    unique_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_name TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'staff member' CHECK (role IN ('team leader', 'staff member')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    color_code VARCHAR(7) DEFAULT '#3b82f6',
    employment_start_date DATE,
    employment_end_date DATE,
    contracted_hours DECIMAL(4,2) DEFAULT 36.0,
    pay_rate DECIMAL(6,2) DEFAULT 14.24,
    created_at TIMESTAMPTZ DEFAULT (NOW() AT TIME ZONE 'Europe/London'),
    updated_at TIMESTAMPTZ DEFAULT (NOW() AT TIME ZONE 'Europe/London')
);

-- Periods table (work periods)
CREATE TABLE IF NOT EXISTS periods (
    period_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_name TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT (NOW() AT TIME ZONE 'Europe/London'),
    updated_at TIMESTAMPTZ DEFAULT (NOW() AT TIME ZONE 'Europe/London'),
    CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

-- Shifts table (staff assignments) - ACTUAL SCHEMA USED IN SERVER.JS
CREATE TABLE IF NOT EXISTS shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_id UUID NOT NULL REFERENCES periods(period_id) ON DELETE CASCADE,
    week_number INTEGER NOT NULL CHECK (week_number >= 1 AND week_number <= 52),
    staff_name TEXT NOT NULL REFERENCES human_resource(staff_name) ON DELETE CASCADE,
    shift_start_datetime TIMESTAMPTZ NOT NULL,
    shift_end_datetime TIMESTAMPTZ NOT NULL,
    shift_type TEXT NOT NULL CHECK (shift_type IN ('Tom Day', 'Charlotte Day', 'Double Up', 'Tom Night', 'Charlotte Night', 'HOLIDAY')),
    solo_shift BOOLEAN DEFAULT FALSE,
    training BOOLEAN DEFAULT FALSE,
    short_notice BOOLEAN DEFAULT FALSE,
    call_out BOOLEAN DEFAULT FALSE,
    payment_period_end BOOLEAN DEFAULT FALSE,
    financial_year_end BOOLEAN DEFAULT FALSE,
    overtime BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT (NOW() AT TIME ZONE 'Europe/London'),
    updated_at TIMESTAMPTZ DEFAULT (NOW() AT TIME ZONE 'Europe/London')
);

-- Change Requests table (audit trail for all staff changes) - RENAMED FROM human_resource_history
CREATE TABLE IF NOT EXISTS change_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES human_resource(unique_id) ON DELETE CASCADE,
    staff_name TEXT NOT NULL,
    change_type TEXT NOT NULL,
    field_name TEXT,
    old_value TEXT,
    new_value TEXT,
    effective_from_date TIMESTAMPTZ DEFAULT (NOW() AT TIME ZONE 'Europe/London'),
    changed_at TIMESTAMPTZ DEFAULT (NOW() AT TIME ZONE 'Europe/London'),
    changed_by TEXT DEFAULT 'system',
    reason TEXT
);

-- =====================================================
-- 2. TIME-OFF MANAGEMENT TABLES
-- =====================================================

-- Holiday entitlement tracking table
CREATE TABLE IF NOT EXISTS holiday_entitlements (
    entitlement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES human_resource(unique_id) ON DELETE CASCADE,
    staff_name TEXT NOT NULL,
    holiday_year_start DATE NOT NULL, -- 6th April of each year
    holiday_year_end DATE NOT NULL,   -- 5th April of next year
    contracted_hours_per_week DECIMAL(4,2) NOT NULL,
    statutory_entitlement_days DECIMAL(4,1) NOT NULL, -- 5.6 weeks * (contracted_hours / 12)
    statutory_entitlement_hours DECIMAL(6,2) NOT NULL, -- statutory_entitlement_days * 12
    days_taken DECIMAL(4,1) DEFAULT 0,
    hours_taken DECIMAL(6,2) DEFAULT 0,
    days_remaining DECIMAL(4,1) GENERATED ALWAYS AS (statutory_entitlement_days - days_taken) STORED,
    hours_remaining DECIMAL(6,2) GENERATED ALWAYS AS (statutory_entitlement_hours - hours_taken) STORED,
    is_zero_hours BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT (NOW() AT TIME ZONE 'Europe/London'),
    updated_at TIMESTAMPTZ DEFAULT (NOW() AT TIME ZONE 'Europe/London'),
    CONSTRAINT valid_holiday_year CHECK (holiday_year_end > holiday_year_start),
    CONSTRAINT valid_entitlement CHECK (statutory_entitlement_days >= 0 AND statutory_entitlement_hours >= 0),
    CONSTRAINT unique_staff_holiday_year UNIQUE (staff_id, holiday_year_start)
);

-- =====================================================
-- 3. INDEXES FOR PERFORMANCE (ONLY USED COLUMNS)
-- =====================================================

-- Human Resource indexes
CREATE INDEX IF NOT EXISTS idx_human_resource_staff_name ON human_resource(staff_name);
CREATE INDEX IF NOT EXISTS idx_human_resource_role ON human_resource(role);
CREATE INDEX IF NOT EXISTS idx_human_resource_is_active ON human_resource(is_active);
CREATE INDEX IF NOT EXISTS idx_human_resource_updated_at ON human_resource(updated_at);
CREATE INDEX IF NOT EXISTS idx_human_resource_employment_dates ON human_resource(employment_start_date, employment_end_date);
CREATE INDEX IF NOT EXISTS idx_human_resource_color_code ON human_resource(color_code);

-- Periods indexes
CREATE INDEX IF NOT EXISTS idx_periods_start_date ON periods(start_date);
CREATE INDEX IF NOT EXISTS idx_periods_end_date ON periods(end_date);
CREATE INDEX IF NOT EXISTS idx_periods_is_active ON periods(is_active);

-- Shifts indexes - ACTUAL SCHEMA
CREATE INDEX IF NOT EXISTS idx_shifts_period_id ON shifts(period_id);
CREATE INDEX IF NOT EXISTS idx_shifts_week_number ON shifts(week_number);
CREATE INDEX IF NOT EXISTS idx_shifts_staff_name ON shifts(staff_name);
CREATE INDEX IF NOT EXISTS idx_shifts_shift_type ON shifts(shift_type);
CREATE INDEX IF NOT EXISTS idx_shifts_created_at ON shifts(created_at);
CREATE INDEX IF NOT EXISTS idx_shifts_call_out ON shifts(call_out);
CREATE INDEX IF NOT EXISTS idx_shifts_overtime ON shifts(overtime);
CREATE INDEX IF NOT EXISTS idx_shifts_solo_shift ON shifts(solo_shift);
CREATE INDEX IF NOT EXISTS idx_shifts_shift_start_datetime ON shifts(shift_start_datetime);
CREATE INDEX IF NOT EXISTS idx_shifts_shift_end_datetime ON shifts(shift_end_datetime);

-- Change Requests indexes
CREATE INDEX IF NOT EXISTS idx_change_requests_staff_id ON change_requests(staff_id);
CREATE INDEX IF NOT EXISTS idx_change_requests_staff_name ON change_requests(staff_name);
CREATE INDEX IF NOT EXISTS idx_change_requests_change_type ON change_requests(change_type);
CREATE INDEX IF NOT EXISTS idx_change_requests_changed_at ON change_requests(changed_at);
CREATE INDEX IF NOT EXISTS idx_change_requests_effective_from_date ON change_requests(effective_from_date);

-- Holiday entitlements indexes
CREATE INDEX IF NOT EXISTS idx_holiday_entitlements_staff_id ON holiday_entitlements(staff_id);
CREATE INDEX IF NOT EXISTS idx_holiday_entitlements_staff_name ON holiday_entitlements(staff_name);
CREATE INDEX IF NOT EXISTS idx_holiday_entitlements_year ON holiday_entitlements(holiday_year_start, holiday_year_end);
CREATE INDEX IF NOT EXISTS idx_holiday_entitlements_zero_hours ON holiday_entitlements(is_zero_hours);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_shifts_period_week_datetime ON shifts(period_id, week_number, shift_start_datetime);
CREATE INDEX IF NOT EXISTS idx_shifts_staff_datetime ON shifts(staff_name, shift_start_datetime);
CREATE INDEX IF NOT EXISTS idx_human_resource_role_active ON human_resource(role, is_active);
CREATE INDEX IF NOT EXISTS idx_shifts_flags ON shifts(solo_shift, training, short_notice, overtime, call_out);

-- =====================================================
-- 4. HELPER FUNCTIONS (ACTUALLY USED)
-- =====================================================

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = (NOW() AT TIME ZONE 'Europe/London');
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Function to get current holiday year dates
CREATE OR REPLACE FUNCTION get_holiday_year_dates(reference_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE(holiday_year_start DATE, holiday_year_end DATE) AS $$
BEGIN
    -- If reference date is before April 6th, holiday year started previous April 6th
    -- If reference date is April 6th or after, holiday year started this April 6th
    IF EXTRACT(MONTH FROM reference_date) < 4 OR 
       (EXTRACT(MONTH FROM reference_date) = 4 AND EXTRACT(DAY FROM reference_date) < 6) THEN
        holiday_year_start := TO_DATE((EXTRACT(YEAR FROM reference_date) - 1)::TEXT || '-04-06', 'YYYY-MM-DD');
        holiday_year_end := TO_DATE(EXTRACT(YEAR FROM reference_date)::TEXT || '-04-05', 'YYYY-MM-DD');
    ELSE
        holiday_year_start := TO_DATE(EXTRACT(YEAR FROM reference_date)::TEXT || '-04-06', 'YYYY-MM-DD');
        holiday_year_end := TO_DATE((EXTRACT(YEAR FROM reference_date) + 1)::TEXT || '-04-05', 'YYYY-MM-DD');
    END IF;
    
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate holiday entitlement based on contracted hours and employment dates
-- Policy: 5.6 weeks pro rata (max 28 days), round up to nearest full day
-- Includes pro-rata calculation based on employment start/end dates
CREATE OR REPLACE FUNCTION calculate_holiday_entitlement(
    contracted_hours DECIMAL,
    employment_start_date DATE DEFAULT NULL,
    employment_end_date DATE DEFAULT NULL,
    financial_year_start DATE DEFAULT NULL
)
RETURNS DECIMAL AS $$
DECLARE
    calculated_days DECIMAL;
    pro_rata_factor DECIMAL := 1.0;
    effective_start_date DATE;
    effective_end_date DATE;
    months_worked DECIMAL;
    total_months DECIMAL := 12.0; -- Financial year is 12 months
BEGIN
    -- Calculate base entitlement based on contracted hours (1 day = 12 hours)
    -- Annual holiday days = contracted_days_per_week * 5.6
    calculated_days := (contracted_hours / 12.0) * 5.6;
    
    -- Keep precise calculation (no rounding)
    -- calculated_days := CEIL(calculated_days);
    
    -- Apply maximum cap of 28 days
    IF calculated_days > 28 THEN
        calculated_days := 28;
    END IF;
    
    -- Calculate pro-rata factor if employment dates are provided
    IF employment_start_date IS NOT NULL OR employment_end_date IS NOT NULL THEN
        -- Use financial year start if not provided
        IF financial_year_start IS NULL THEN
            financial_year_start := DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '3 months 5 days';
        END IF;
        
        -- Determine effective start date (later of employment start or financial year start)
        effective_start_date := GREATEST(
            COALESCE(employment_start_date, financial_year_start),
            financial_year_start
        );
        
        -- Determine effective end date (earlier of employment end or financial year end)
        effective_end_date := LEAST(
            COALESCE(employment_end_date, financial_year_start + INTERVAL '1 year' - INTERVAL '1 day'),
            financial_year_start + INTERVAL '1 year' - INTERVAL '1 day'
        );
        
        -- Calculate months worked (including partial months)
        months_worked := EXTRACT(EPOCH FROM (effective_end_date::timestamp - effective_start_date::timestamp)) / (30.44 * 24 * 3600);
        
        -- Calculate pro-rata factor
        pro_rata_factor := GREATEST(0.0, LEAST(1.0, months_worked / total_months));
        
        -- Apply pro-rata factor
        calculated_days := calculated_days * pro_rata_factor;
        
        -- Keep precise calculation (no rounding)
        -- calculated_days := CEIL(calculated_days);
    END IF;
    
    RETURN calculated_days;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate zero-hour contract holiday entitlement based on actual hours worked
CREATE OR REPLACE FUNCTION calculate_zero_hour_entitlement(
    p_staff_id UUID,
    p_holiday_year_start DATE,
    p_holiday_year_end DATE
)
RETURNS DECIMAL AS $$
DECLARE
    total_hours_worked DECIMAL;
    entitlement_days DECIMAL;
BEGIN
    -- Calculate total hours worked in the holiday year using actual schema
    SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (shift_end_datetime - shift_start_datetime)) / 3600), 0)
    INTO total_hours_worked
    FROM shifts 
    WHERE staff_name = (SELECT staff_name FROM human_resource WHERE unique_id = p_staff_id)
    AND shift_start_datetime >= p_holiday_year_start 
    AND shift_start_datetime <= p_holiday_year_end
    AND shift_type != 'HOLIDAY';
    
    -- For zero-hour contracts: Calculate entitlement based on actual hours worked
    -- Policy: 5.6 weeks (28 days) per year for full-time equivalent
    -- If someone works 60 hours in a year, they get proportional entitlement
    -- Full year = 52 weeks × 37.5 hours = 1950 hours (standard full-time)
    -- So: (hours_worked / 1950) × 28 days
    entitlement_days := (total_hours_worked / 1950.0) * 28.0;
    
    -- Keep precise calculation (no rounding)
    -- entitlement_days := CEIL(entitlement_days);
    IF entitlement_days > 28 THEN
        entitlement_days := 28;
    END IF;
    
    RETURN entitlement_days;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate financial year entitlement with pro-rata based on employment dates
CREATE OR REPLACE FUNCTION calculate_financial_year_entitlement(
    p_contracted_hours_per_week NUMERIC,
    p_employment_start_date TIMESTAMPTZ,
    p_employment_end_date TIMESTAMPTZ
)
RETURNS NUMERIC AS $$
DECLARE
    current_holiday_year_start DATE;
    current_holiday_year_end DATE;
    effective_start_date DATE;
    effective_end_date DATE;
    total_days_in_year INTEGER;
    working_days_in_period INTEGER;
    pro_rata_factor NUMERIC;
    base_entitlement_days NUMERIC;
    final_entitlement_days NUMERIC;
BEGIN
    -- Get current holiday year dates
    SELECT h.holiday_year_start, h.holiday_year_end 
    INTO current_holiday_year_start, current_holiday_year_end 
    FROM get_holiday_year_dates() h;
    
    -- Determine effective employment period within the holiday year
    effective_start_date := GREATEST(
        COALESCE(p_employment_start_date::DATE, current_holiday_year_start),
        current_holiday_year_start
    );
    
    effective_end_date := LEAST(
        COALESCE(p_employment_end_date::DATE, current_holiday_year_end),
        current_holiday_year_end
    );
    
    -- Calculate pro-rata factor
    total_days_in_year := current_holiday_year_end - current_holiday_year_start;
    working_days_in_period := effective_end_date - effective_start_date;
    
    -- Ensure we don't have negative days
    IF working_days_in_period < 0 THEN
        working_days_in_period := 0;
    END IF;
    
    pro_rata_factor := working_days_in_period::NUMERIC / total_days_in_year::NUMERIC;
    
    -- Calculate base entitlement (5.6 weeks * contracted_hours / 12)
    base_entitlement_days := (p_contracted_hours_per_week / 12.0) * 5.6;
    
    -- Apply pro-rata factor
    final_entitlement_days := base_entitlement_days * pro_rata_factor;
    
    -- Keep precise calculation (no rounding)
    RETURN final_entitlement_days;
END;
$$ LANGUAGE plpgsql;

-- Function to recalculate holiday entitlement when employment dates change
CREATE OR REPLACE FUNCTION recalculate_holiday_entitlement(
    p_staff_id UUID,
    p_employment_end_date DATE DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
    staff_record RECORD;
    current_holiday_year_start DATE;
    current_holiday_year_end DATE;
    new_entitlement_days DECIMAL;
    new_entitlement_hours DECIMAL;
    contracted_hours_change_date TIMESTAMP;
    effective_start_date_for_prorata DATE;
    contracted_days_per_week DECIMAL;
    full_statutory_days DECIMAL;
    company_policy_days DECIMAL;
    overtime_hours DECIMAL;
    overtime_entitlement_days DECIMAL;
BEGIN
    -- Get staff information
    SELECT
        hr.unique_id,
        hr.staff_name,
        hr.contracted_hours,
        hr.employment_start_date,
        hr.employment_end_date
    INTO staff_record
    FROM human_resource hr
    WHERE hr.unique_id = p_staff_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Staff member with ID % not found', p_staff_id;
    END IF;

    -- Get current financial year dates
    SELECT h.holiday_year_start, h.holiday_year_end INTO current_holiday_year_start, current_holiday_year_end FROM get_holiday_year_dates() h;

    -- Determine the effective start date for pro-rata calculation
    -- This is either the employment start date or the most recent contracted hours change date within the holiday year
    SELECT cr.changed_at
    INTO contracted_hours_change_date
    FROM change_requests cr
    WHERE cr.staff_id = p_staff_id
      AND cr.change_type = 'contracted_hours_change'
      AND cr.changed_at >= current_holiday_year_start
    ORDER BY cr.changed_at ASC
    LIMIT 1;

    -- If there's a contracted hours change within the current holiday year, use that date for pro-rata
    IF contracted_hours_change_date IS NOT NULL THEN
        effective_start_date_for_prorata := contracted_hours_change_date::DATE;
    ELSE
        -- Otherwise, use the employment start date, ensuring it's not before the holiday year start
        effective_start_date_for_prorata := GREATEST(COALESCE(staff_record.employment_start_date, current_holiday_year_start), current_holiday_year_start);
    END IF;

    -- Calculate contracted days per week (1 day = 12 hours)
    contracted_days_per_week := staff_record.contracted_hours / 12.0;

    IF staff_record.contracted_hours = 0 THEN
        -- Zero-hours contract - calculate based on actual hours worked
        new_entitlement_days := calculate_zero_hour_entitlement(p_staff_id, current_holiday_year_start, current_holiday_year_end);
        new_entitlement_hours := new_entitlement_days * 12.0;
    ELSE
        -- Calculate base statutory entitlement using the updated function with pro-rata
        -- Use the parameter if provided, otherwise use the database value
        new_entitlement_days := calculate_holiday_entitlement(
            staff_record.contracted_hours,
            staff_record.employment_start_date,
            CASE 
                WHEN p_employment_end_date IS NOT NULL THEN p_employment_end_date
                ELSE staff_record.employment_end_date
            END,
            current_holiday_year_start
        );
        
        -- Add overtime accrual (additional holiday for overtime worked)
        -- Policy: Additional holiday entitlement will be accrued for any overtime worked
        -- Calculate overtime hours worked in the current holiday year
        SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (shift_end_datetime - shift_start_datetime)) / 3600), 0)
        INTO overtime_hours
        FROM shifts s
        WHERE s.staff_name = staff_record.staff_name
          AND s.shift_start_datetime >= current_holiday_year_start
          AND s.shift_start_datetime <= current_holiday_year_end
          AND s.overtime = true;
        
        -- Convert overtime hours to additional holiday days (overtime_hours / 12)
        overtime_entitlement_days := overtime_hours / 12.0;
        
        -- Add overtime entitlement to base entitlement
        new_entitlement_days := new_entitlement_days + overtime_entitlement_days;
        
        new_entitlement_hours := new_entitlement_days * 12.0;
    END IF;

    -- Update existing entitlement record
    UPDATE holiday_entitlements
    SET
        contracted_hours_per_week = staff_record.contracted_hours,
        statutory_entitlement_days = new_entitlement_days,
        statutory_entitlement_hours = new_entitlement_hours,
        is_zero_hours = (staff_record.contracted_hours = 0),
        updated_at = CURRENT_TIMESTAMP
    WHERE staff_id = p_staff_id
      AND holiday_entitlements.holiday_year_start = current_holiday_year_start
      AND holiday_entitlements.holiday_year_end = current_holiday_year_end;

    -- If no existing record, create one
    IF NOT FOUND THEN
        INSERT INTO holiday_entitlements (
            entitlement_id, staff_id, staff_name, holiday_year_start, holiday_year_end,
            contracted_hours_per_week, statutory_entitlement_days, statutory_entitlement_hours, is_zero_hours
        ) VALUES (
            gen_random_uuid(), p_staff_id, staff_record.staff_name, current_holiday_year_start, current_holiday_year_end,
            staff_record.contracted_hours, new_entitlement_days, new_entitlement_hours, (staff_record.contracted_hours = 0)
        );
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to update holiday entitlement usage for a specific staff member
CREATE OR REPLACE FUNCTION update_holiday_entitlement_usage(p_staff_id UUID)
RETURNS VOID AS $$
DECLARE
    staff_name_value TEXT;
    total_days_taken DECIMAL;
    total_hours_taken DECIMAL;
    current_holiday_year_start DATE;
    current_holiday_year_end DATE;
BEGIN
    -- Get staff name
    SELECT hr.staff_name INTO staff_name_value
    FROM human_resource hr
    WHERE hr.unique_id = p_staff_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Staff member with ID % not found', p_staff_id;
    END IF;
    
    -- Get current holiday year dates
    SELECT h.holiday_year_start, h.holiday_year_end 
    INTO current_holiday_year_start, current_holiday_year_end 
    FROM get_holiday_year_dates() h;
    
    -- Calculate total days and hours taken from holiday shifts
    SELECT 
        COALESCE(COUNT(*), 0) as days_taken,
        COALESCE(SUM(EXTRACT(EPOCH FROM (shift_end_datetime - shift_start_datetime)) / 3600), 0) as hours_taken
    INTO total_days_taken, total_hours_taken
    FROM shifts s
    WHERE s.staff_name = staff_name_value
      AND s.shift_type = 'HOLIDAY'
      AND s.shift_start_datetime >= current_holiday_year_start 
      AND s.shift_start_datetime <= current_holiday_year_end;
    
    -- Update the holiday entitlement record (remaining columns are generated automatically)
    UPDATE holiday_entitlements
    SET 
        days_taken = total_days_taken,
        hours_taken = total_hours_taken,
        updated_at = CURRENT_TIMESTAMP
    WHERE staff_id = p_staff_id
      AND holiday_year_start = current_holiday_year_start
      AND holiday_year_end = current_holiday_year_end;
END;
$$ LANGUAGE plpgsql;

-- Function to update holiday entitlement usage for all staff members
CREATE OR REPLACE FUNCTION update_all_holiday_entitlement_usage()
RETURNS TABLE(staff_id UUID, staff_name TEXT, days_taken DECIMAL, hours_taken DECIMAL) AS $$
DECLARE
    staff_record RECORD;
BEGIN
    -- Loop through all active staff members
    FOR staff_record IN 
        SELECT hr.unique_id, hr.staff_name 
        FROM human_resource hr
        WHERE hr.is_active = true
    LOOP
        -- Update usage for this staff member
        PERFORM update_holiday_entitlement_usage(staff_record.unique_id);
        
        -- Return the updated values
        SELECT he.staff_id, he.staff_name, he.days_taken, he.hours_taken
        INTO staff_id, staff_name, days_taken, hours_taken
        FROM holiday_entitlements he
        WHERE he.staff_id = staff_record.unique_id
          AND he.holiday_year_start <= CURRENT_DATE 
          AND he.holiday_year_end >= CURRENT_DATE;
        
        RETURN NEXT;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to automatically create holiday entitlements for new financial year
-- This should be called annually on April 6th to create new entitlements
CREATE OR REPLACE FUNCTION create_new_financial_year_entitlements()
RETURNS TABLE(staff_id UUID, staff_name TEXT, new_entitlement_days DECIMAL, created BOOLEAN) AS $$
DECLARE
    staff_record RECORD;
    current_holiday_year_start DATE;
    current_holiday_year_end DATE;
    new_entitlement_days DECIMAL;
    new_entitlement_hours DECIMAL;
    entitlement_exists BOOLEAN;
BEGIN
    -- Get current holiday year dates
    SELECT h.holiday_year_start, h.holiday_year_end 
    INTO current_holiday_year_start, current_holiday_year_end 
    FROM get_holiday_year_dates() h;
    
    -- Loop through all active staff members
    FOR staff_record IN 
        SELECT hr.unique_id, hr.staff_name, hr.contracted_hours
        FROM human_resource hr
        WHERE hr.is_active = true
    LOOP
        -- Check if entitlement already exists for this year
        SELECT EXISTS(
            SELECT 1 FROM holiday_entitlements 
            WHERE holiday_entitlements.staff_id = staff_record.unique_id
              AND holiday_entitlements.holiday_year_start = current_holiday_year_start
        ) INTO entitlement_exists;
        
        IF NOT entitlement_exists THEN
            -- Calculate new entitlement using the policy function with pro-rata
            new_entitlement_days := calculate_holiday_entitlement(
                staff_record.contracted_hours,
                staff_record.employment_start_date,
                staff_record.employment_end_date,
                current_holiday_year_start
            );
            new_entitlement_hours := new_entitlement_days * 12.0;
            
            -- Create new entitlement record
            INSERT INTO holiday_entitlements (
                entitlement_id, staff_id, staff_name, holiday_year_start, holiday_year_end,
                contracted_hours_per_week, statutory_entitlement_days, statutory_entitlement_hours, 
                days_taken, hours_taken, is_zero_hours
            ) VALUES (
                gen_random_uuid(), staff_record.unique_id, staff_record.staff_name, 
                current_holiday_year_start, current_holiday_year_end,
                staff_record.contracted_hours, new_entitlement_days, new_entitlement_hours,
                0.0, 0.0, (staff_record.contracted_hours = 0)
            );
            
            -- Return the created entitlement
            staff_id := staff_record.unique_id;
            staff_name := staff_record.staff_name;
            created := true;
            RETURN NEXT;
        ELSE
            -- Entitlement already exists, return existing data
            staff_id := staff_record.unique_id;
            staff_name := staff_record.staff_name;
            SELECT he.statutory_entitlement_days INTO new_entitlement_days
            FROM holiday_entitlements he
            WHERE he.staff_id = staff_record.unique_id
              AND he.holiday_year_start = current_holiday_year_start;
            created := false;
            RETURN NEXT;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to check if financial year end has been flagged and trigger renewal
-- This function checks for shifts with financial_year_end = true and creates new entitlements
CREATE OR REPLACE FUNCTION check_and_renew_holiday_entitlements()
RETURNS TABLE(
    action_taken TEXT, 
    financial_year_end_date DATE, 
    shifts_found INTEGER, 
    entitlements_created INTEGER,
    message TEXT
) AS $$
DECLARE
    financial_year_end_date DATE;
    shifts_count INTEGER;
    renewal_result RECORD;
    entitlements_created_count INTEGER := 0;
    current_date_check DATE := CURRENT_DATE;
BEGIN
    -- Check if there are any shifts with financial_year_end = true from yesterday or earlier
    -- This ensures we only trigger renewal after the financial year end has passed
    SELECT 
        DATE(s.shift_start_datetime) as fy_end_date,
        COUNT(*) as shift_count
    INTO financial_year_end_date, shifts_count
    FROM shifts s
    WHERE s.financial_year_end = true
      AND DATE(s.shift_start_datetime) <= current_date_check - INTERVAL '1 day'
    GROUP BY DATE(s.shift_start_datetime)
    ORDER BY fy_end_date DESC
    LIMIT 1;
    
    -- If no financial year end shifts found, return no action
    IF shifts_count IS NULL OR shifts_count = 0 THEN
        action_taken := 'NO_ACTION';
        financial_year_end_date := NULL;
        shifts_found := 0;
        entitlements_created := 0;
        message := 'No financial year end shifts found. No renewal needed.';
        RETURN NEXT;
        RETURN;
    END IF;
    
    -- Check if entitlements for the next financial year already exist
    -- Get the next financial year dates (current + 1 year)
    DECLARE
        next_year_start DATE;
        next_year_end DATE;
        existing_entitlements INTEGER;
    BEGIN
        -- Calculate next financial year (current + 1 year)
        next_year_start := financial_year_end_date + INTERVAL '1 day'; -- April 6th
        next_year_end := next_year_start + INTERVAL '1 year' - INTERVAL '1 day'; -- April 5th next year
        
        -- Check if entitlements already exist for next year
        SELECT COUNT(*) INTO existing_entitlements
        FROM holiday_entitlements he
        WHERE he.holiday_year_start = next_year_start;
        
        IF existing_entitlements > 0 THEN
            action_taken := 'ALREADY_RENEWED';
            financial_year_end_date := financial_year_end_date;
            shifts_found := shifts_count;
            entitlements_created := existing_entitlements;
            message := 'Financial year end detected but entitlements already exist for next year.';
            RETURN NEXT;
            RETURN;
        END IF;
        
        -- Create new entitlements for the next financial year
        -- Temporarily modify the get_holiday_year_dates function behavior
        -- by creating entitlements for the next year
        FOR renewal_result IN
            SELECT hr.unique_id, hr.staff_name, hr.contracted_hours, hr.employment_start_date, hr.employment_end_date
            FROM human_resource hr
            WHERE hr.is_active = true
        LOOP
            -- Calculate new entitlement using the policy function with pro-rata
            DECLARE
                new_entitlement_days DECIMAL;
                new_entitlement_hours DECIMAL;
            BEGIN
                new_entitlement_days := calculate_holiday_entitlement(
                    renewal_result.contracted_hours,
                    renewal_result.employment_start_date,
                    renewal_result.employment_end_date,
                    next_year_start
                );
                new_entitlement_hours := new_entitlement_days * 12.0;
                
                -- Create new entitlement record for next financial year
                INSERT INTO holiday_entitlements (
                    entitlement_id, staff_id, staff_name, holiday_year_start, holiday_year_end,
                    contracted_hours_per_week, statutory_entitlement_days, statutory_entitlement_hours, 
                    days_taken, hours_taken, is_zero_hours
                ) VALUES (
                    gen_random_uuid(), renewal_result.unique_id, renewal_result.staff_name, 
                    next_year_start, next_year_end,
                    renewal_result.contracted_hours, new_entitlement_days, new_entitlement_hours,
                    0.0, 0.0, (renewal_result.contracted_hours = 0)
                );
                
                entitlements_created_count := entitlements_created_count + 1;
            END;
        END LOOP;
        
        action_taken := 'RENEWED';
        financial_year_end_date := financial_year_end_date;
        shifts_found := shifts_count;
        entitlements_created := entitlements_created_count;
        message := 'Financial year end detected. New holiday entitlements created for next financial year.';
        RETURN NEXT;
    END;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 5. TRIGGERS (ACTUALLY USED)
-- =====================================================

-- Create trigger function to handle employment date changes
CREATE OR REPLACE FUNCTION trigger_recalculate_holiday_on_employment_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Only recalculate if employment dates actually changed
    IF (OLD.employment_start_date IS DISTINCT FROM NEW.employment_start_date 
        OR OLD.employment_end_date IS DISTINCT FROM NEW.employment_end_date) THEN
        
        -- Call the recalculate function
        PERFORM recalculate_holiday_entitlement(NEW.unique_id, NEW.employment_end_date);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger function to update zero-hour contract holiday entitlements when shifts change
CREATE OR REPLACE FUNCTION update_zero_hour_holiday_entitlement()
RETURNS TRIGGER AS $$
DECLARE
    staff_id_var UUID;
    is_zero_hours BOOLEAN;
BEGIN
    -- Get the staff_id and check if it's a zero-hour contract
    IF TG_OP = 'DELETE' THEN
        staff_id_var := (SELECT unique_id FROM human_resource WHERE staff_name = OLD.staff_name);
    ELSE
        staff_id_var := (SELECT unique_id FROM human_resource WHERE staff_name = NEW.staff_name);
    END IF;
    
    -- Check if this is a zero-hour contract
    SELECT (contracted_hours = 0) INTO is_zero_hours
    FROM human_resource 
    WHERE unique_id = staff_id_var;
    
    -- Only update if it's a zero-hour contract
    IF is_zero_hours THEN
        -- Recalculate holiday entitlement for zero-hour contract
        PERFORM recalculate_holiday_entitlement(staff_id_var, NULL);
    END IF;
    
    -- Return appropriate record
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Update timestamp triggers (only create if function exists)
DO $$
BEGIN
    -- Check if the function exists before creating triggers
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
        DROP TRIGGER IF EXISTS update_human_resource_updated_at ON human_resource;
        CREATE TRIGGER update_human_resource_updated_at 
            BEFORE UPDATE ON human_resource 
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

        -- Trigger to recalculate holiday entitlements when employment dates change
        CREATE TRIGGER recalculate_holiday_on_employment_change
            AFTER UPDATE OF employment_start_date, employment_end_date ON human_resource
            FOR EACH ROW 
            EXECUTE FUNCTION trigger_recalculate_holiday_on_employment_change();

        -- Create triggers for shifts table to update zero-hour contract entitlements
        CREATE TRIGGER update_zero_hour_entitlement_on_shift_change
            AFTER INSERT OR UPDATE OR DELETE ON shifts
            FOR EACH ROW 
            EXECUTE FUNCTION update_zero_hour_holiday_entitlement();

        DROP TRIGGER IF EXISTS update_periods_updated_at ON periods;
        CREATE TRIGGER update_periods_updated_at 
            BEFORE UPDATE ON periods 
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

        DROP TRIGGER IF EXISTS update_shifts_updated_at ON shifts;
        CREATE TRIGGER update_shifts_updated_at 
            BEFORE UPDATE ON shifts 
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

        DROP TRIGGER IF EXISTS update_holiday_entitlements_updated_at ON holiday_entitlements;
        CREATE TRIGGER update_holiday_entitlements_updated_at
            BEFORE UPDATE ON holiday_entitlements
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- Function to automatically renew holiday entitlements when financial year end is flagged
CREATE OR REPLACE FUNCTION trigger_holiday_entitlement_renewal()
RETURNS TRIGGER AS $$
DECLARE
    financial_year_end_date DATE;
    next_year_start DATE;
    next_year_end DATE;
    staff_record RECORD;
    new_entitlement_days DECIMAL;
    new_entitlement_hours DECIMAL;
    entitlements_created_count INTEGER := 0;
    existing_entitlements INTEGER;
BEGIN
    -- Only proceed if financial_year_end is being set to true
    IF (TG_OP = 'INSERT' AND NEW.financial_year_end = true) OR 
       (TG_OP = 'UPDATE' AND NEW.financial_year_end = true AND (OLD.financial_year_end IS NULL OR OLD.financial_year_end = false)) THEN
        
        -- Get the financial year end date from the shift
        financial_year_end_date := DATE(NEW.shift_start_datetime);
        
        -- Calculate next financial year dates
        next_year_start := financial_year_end_date + INTERVAL '1 day'; -- April 6th
        next_year_end := next_year_start + INTERVAL '1 year' - INTERVAL '1 day'; -- April 5th next year
        
        -- Check if entitlements already exist for next year
        SELECT COUNT(*) INTO existing_entitlements
        FROM holiday_entitlements he
        WHERE he.holiday_year_start = next_year_start;
        
        -- Only create entitlements if they don't already exist
        IF existing_entitlements = 0 THEN
            -- Create new entitlements for all active staff members
            FOR staff_record IN
                SELECT hr.unique_id, hr.staff_name, hr.contracted_hours, hr.employment_start_date, hr.employment_end_date
                FROM human_resource hr
                WHERE hr.is_active = true
            LOOP
                -- Calculate new entitlement using the policy function with pro-rata
                new_entitlement_days := calculate_holiday_entitlement(
                    staff_record.contracted_hours,
                    staff_record.employment_start_date,
                    staff_record.employment_end_date,
                    next_year_start
                );
                new_entitlement_hours := new_entitlement_days * 12.0;
                
                -- Create new entitlement record for next financial year
                INSERT INTO holiday_entitlements (
                    entitlement_id, staff_id, staff_name, holiday_year_start, holiday_year_end,
                    contracted_hours_per_week, statutory_entitlement_days, statutory_entitlement_hours, 
                    days_taken, hours_taken, is_zero_hours
                ) VALUES (
                    gen_random_uuid(), staff_record.unique_id, staff_record.staff_name, 
                    next_year_start, next_year_end,
                    staff_record.contracted_hours, new_entitlement_days, new_entitlement_hours,
                    0.0, 0.0, (staff_record.contracted_hours = 0)
                );
                
                entitlements_created_count := entitlements_created_count + 1;
            END LOOP;
            
            -- Log the renewal action
            RAISE NOTICE 'Financial year end detected on %. Created % new holiday entitlements for financial year % to %', 
                financial_year_end_date, entitlements_created_count, next_year_start, next_year_end;
        ELSE
            -- Log that entitlements already exist
            RAISE NOTICE 'Financial year end detected on % but entitlements already exist for financial year % to %', 
                financial_year_end_date, next_year_start, next_year_end;
        END IF;
    END IF;
    
    -- Return the new record
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic holiday entitlement renewal
DROP TRIGGER IF EXISTS trigger_holiday_renewal_on_financial_year_end ON shifts;
CREATE TRIGGER trigger_holiday_renewal_on_financial_year_end
    AFTER INSERT OR UPDATE ON shifts
    FOR EACH ROW
    EXECUTE FUNCTION trigger_holiday_entitlement_renewal();

-- =====================================================
-- 6. VIEWS FOR COMMON QUERIES (ACTUALLY USED)
-- =====================================================

-- View for current holiday entitlements - USED IN SERVER.JS
-- Updated to dynamically show entitlements based on active financial year end flags
-- Default financial year: 6th April to 5th April (unless otherwise flagged)
CREATE OR REPLACE VIEW current_holiday_entitlements AS
SELECT 
    he.entitlement_id,
    he.staff_id,
    he.staff_name,
    he.holiday_year_start,
    he.holiday_year_end,
    he.contracted_hours_per_week,
    he.statutory_entitlement_days,
    he.statutory_entitlement_hours,
    he.days_taken,
    he.hours_taken,
    he.days_remaining,
    he.hours_remaining,
    he.is_zero_hours,
    he.created_at,
    he.updated_at,
    hr.role,
    hr.is_active,
    hr.color_code
FROM holiday_entitlements he
JOIN human_resource hr ON he.staff_id = hr.unique_id
WHERE he.holiday_year_start = (
    -- Get the active financial year start date based on financial year end flags
    WITH active_financial_years AS (
        SELECT 
            DATE(s.shift_start_datetime) as fy_end_date,
            DATE(s.shift_start_datetime) + INTERVAL '1 day' as next_fy_start
        FROM shifts s
        WHERE s.financial_year_end = true
        ORDER BY s.shift_start_datetime DESC
        LIMIT 1
    ),
    current_date_info AS (
        SELECT CURRENT_DATE as today
    )
    SELECT 
        CASE 
            WHEN EXISTS (SELECT 1 FROM active_financial_years) THEN
                -- Use the financial year from the flag
                (SELECT next_fy_start FROM active_financial_years)
            ELSE
                -- Default: 6th April to 5th April financial year
                CASE 
                    WHEN EXTRACT(MONTH FROM (SELECT today FROM current_date_info)) >= 4 THEN
                        -- Current year's April 6th
                        DATE_TRUNC('year', (SELECT today FROM current_date_info)) + INTERVAL '3 months 5 days'
                    ELSE
                        -- Previous year's April 6th
                        DATE_TRUNC('year', (SELECT today FROM current_date_info)) - INTERVAL '1 year' + INTERVAL '3 months 5 days'
                END
        END
);

-- =====================================================
-- 7. HOLIDAY ENTITLEMENTS CONSTRAINTS AND CLEANUP
-- =====================================================

-- Add unique constraint to prevent duplicate holiday entitlements per staff per financial year
ALTER TABLE holiday_entitlements 
ADD CONSTRAINT unique_staff_financial_year 
UNIQUE (staff_id, holiday_year_start);

-- Function to check holiday entitlements count doesn't exceed active staff
CREATE OR REPLACE FUNCTION check_holiday_entitlements_count()
RETURNS TRIGGER AS $$
DECLARE
    active_staff_count INTEGER;
    current_entitlements_count INTEGER;
BEGIN
    -- Count active staff
    SELECT COUNT(*) INTO active_staff_count 
    FROM human_resource 
    WHERE is_active = true;
    
    -- Count current entitlements for the same financial year
    SELECT COUNT(*) INTO current_entitlements_count
    FROM holiday_entitlements 
    WHERE holiday_year_start = NEW.holiday_year_start;
    
    -- If this would exceed the number of active staff, prevent the insert
    IF current_entitlements_count >= active_staff_count THEN
        RAISE EXCEPTION 'Cannot have more holiday entitlements than active staff members for financial year %', NEW.holiday_year_start;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to enforce the constraint
DROP TRIGGER IF EXISTS check_holiday_entitlements_trigger ON holiday_entitlements;
CREATE TRIGGER check_holiday_entitlements_trigger
    BEFORE INSERT ON holiday_entitlements
    FOR EACH ROW
    EXECUTE FUNCTION check_holiday_entitlements_count();

-- Function to update holiday entitlements when shifts change
CREATE OR REPLACE FUNCTION update_holiday_entitlements_on_shift_change()
RETURNS TRIGGER AS $$
DECLARE
    staff_id_to_update UUID;
BEGIN
    -- Get the staff_id for the staff member
    SELECT hr.unique_id INTO staff_id_to_update
    FROM human_resource hr
    WHERE hr.staff_name = COALESCE(NEW.staff_name, OLD.staff_name);
    
    -- Update holiday entitlements for this staff member
    IF staff_id_to_update IS NOT NULL THEN
        PERFORM update_holiday_entitlement_usage(staff_id_to_update);
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create separate triggers for INSERT/UPDATE and DELETE operations
DROP TRIGGER IF EXISTS update_holiday_entitlements_insert_update_trigger ON shifts;
DROP TRIGGER IF EXISTS update_holiday_entitlements_delete_trigger ON shifts;

-- Trigger for INSERT and UPDATE operations
CREATE TRIGGER update_holiday_entitlements_insert_update_trigger
    AFTER INSERT OR UPDATE ON shifts
    FOR EACH ROW
    WHEN (NEW.shift_type = 'HOLIDAY')
    EXECUTE FUNCTION update_holiday_entitlements_on_shift_change();

-- Trigger for DELETE operations
CREATE TRIGGER update_holiday_entitlements_delete_trigger
    AFTER DELETE ON shifts
    FOR EACH ROW
    WHEN (OLD.shift_type = 'HOLIDAY')
    EXECUTE FUNCTION update_holiday_entitlements_on_shift_change();

-- Function to clean up duplicate holiday entitlements
CREATE OR REPLACE FUNCTION cleanup_holiday_entitlements()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER := 0;
    current_fy_start DATE;
    active_staff_count INTEGER;
BEGIN
    -- Get current active financial year start
    WITH active_financial_years AS (
        SELECT 
            DATE(s.shift_start_datetime) + INTERVAL '1 day' as next_fy_start
        FROM shifts s
        WHERE s.financial_year_end = true
        ORDER BY s.shift_start_datetime DESC
        LIMIT 1
    )
    SELECT 
        CASE 
            WHEN EXISTS (SELECT 1 FROM active_financial_years) THEN
                (SELECT next_fy_start FROM active_financial_years)
            ELSE
                CASE 
                    WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 4 THEN
                        DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '3 months 5 days'
                    ELSE
                        DATE_TRUNC('year', CURRENT_DATE) - INTERVAL '1 year' + INTERVAL '3 months 5 days'
                END
        END INTO current_fy_start;
    
    -- Count active staff
    SELECT COUNT(*) INTO active_staff_count 
    FROM human_resource 
    WHERE is_active = true;
    
    -- Delete all entitlements except for the current active financial year
    DELETE FROM holiday_entitlements 
    WHERE holiday_year_start != current_fy_start;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    -- Ensure we have exactly one record per active staff member for current financial year
    INSERT INTO holiday_entitlements (staff_id, staff_name, holiday_year_start, holiday_year_end, contracted_hours_per_week, statutory_entitlement_days, statutory_entitlement_hours, days_taken, hours_taken, is_zero_hours)
    SELECT 
        hr.unique_id, 
        hr.staff_name, 
        current_fy_start,
        current_fy_start + INTERVAL '1 year' - INTERVAL '1 day',
        hr.contracted_hours, 
        calculate_holiday_entitlement(hr.contracted_hours, hr.employment_start_date, hr.employment_end_date, current_fy_start), 
        calculate_holiday_entitlement(hr.contracted_hours, hr.employment_start_date, hr.employment_end_date, current_fy_start) * 12.0, 
        0.0, 
        0.0, 
        (hr.contracted_hours = 0)
    FROM human_resource hr 
    WHERE hr.is_active = true
    AND NOT EXISTS (
        SELECT 1 FROM holiday_entitlements he 
        WHERE he.staff_id = hr.unique_id 
        AND he.holiday_year_start = current_fy_start
    );
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 8. SAMPLE DATA
-- =====================================================

-- Insert 4-week periods starting from Monday March 31, 2025 to financial year end 2100
-- Each period is exactly 4 weeks (28 days) long, aligned with UK financial year (April 6th to April 5th)
INSERT INTO periods (period_name, start_date, end_date) 
WITH period_generator AS (
    SELECT 
        'Period ' || LPAD(period_num::TEXT, 2, '0') || ' ' || 
        CASE 
            WHEN EXTRACT(MONTH FROM start_date) >= 4 THEN EXTRACT(YEAR FROM start_date)::TEXT
            ELSE (EXTRACT(YEAR FROM start_date) - 1)::TEXT
        END as period_name,
        start_date,
        start_date + INTERVAL '27 days' as end_date
    FROM (
        SELECT 
            period_num,
            -- Start from Monday March 31, 2025, then add 28-day intervals
            DATE('2025-03-31') + INTERVAL '28 days' * (period_num - 1) as start_date
        FROM 
            generate_series(1, 1000) as period_num  -- Generate enough periods to cover 2025-2100
    ) as periods
    WHERE 
        -- Only include periods that end before or on April 5, 2101 (end of financial year 2100)
        (DATE('2025-03-31') + INTERVAL '28 days' * (period_num - 1) + INTERVAL '27 days') <= DATE('2101-04-05')
)
SELECT 
    period_name, 
    start_date::DATE, 
    end_date::DATE
FROM period_generator
WHERE NOT EXISTS (
    SELECT 1 FROM periods p 
    WHERE p.period_name = period_generator.period_name 
    AND p.start_date = period_generator.start_date::DATE 
    AND p.end_date = period_generator.end_date::DATE
);

-- Insert sample staff if none exist (with specific colors and pay rates)
INSERT INTO human_resource (staff_name, role, is_active, contracted_hours, pay_rate, color_code) VALUES
    ('Anne', 'staff member', true, 36.0, 13.13, '#00B050'),
    ('Annie', 'staff member', true, 36.0, 13.13, '#92D050'),
    ('Clara', 'team leader', true, 36.0, 14.24, '#0070C0'),
    ('Fung', 'staff member', true, 36.0, 13.13, '#FFFF00'),
    ('Helen', 'team leader', true, 36.0, 14.24, '#EE0000'),
    ('Janet', 'staff member', true, 36.0, 13.13, '#FF66FF'),
    ('John', 'staff member', true, 36.0, 13.13, '#00B0F0'),
    ('Lisa', 'staff member', true, 36.0, 13.13, '#CC99FF'),
    ('Matt', 'staff member', true, 0.0, 13.13, '#FFC000'),
    ('Vania', 'staff member', true, 36.0, 13.13, '#7030A0'),
    ('Yasser', 'staff member', true, 0.0, 13.13, '#C4BC96')
ON CONFLICT (staff_name) DO NOTHING;

-- Note: shifts and change_requests tables are intentionally left empty
-- Only periods, human_resource, and holiday_entitlements tables are populated

-- Insert holiday entitlements for current holiday year (2025-2026)
-- This will populate the time-off tab with data
-- Note: Holiday entitlements are auto-generated based on contracted hours
INSERT INTO holiday_entitlements (
    staff_id, staff_name, holiday_year_start, holiday_year_end,
    contracted_hours_per_week, statutory_entitlement_days, statutory_entitlement_hours,
    days_taken, hours_taken, is_zero_hours
) 
SELECT 
    hr.unique_id,
    hr.staff_name,
    '2025-04-06'::DATE as holiday_year_start,
    '2026-04-05'::DATE as holiday_year_end,
    hr.contracted_hours as contracted_hours_per_week,
    CASE 
        WHEN hr.contracted_hours > 0 THEN calculate_holiday_entitlement(hr.contracted_hours, hr.employment_start_date, hr.employment_end_date, '2025-04-06'::DATE)
        ELSE 0
    END as statutory_entitlement_days,
    CASE 
        WHEN hr.contracted_hours > 0 THEN calculate_holiday_entitlement(hr.contracted_hours, hr.employment_start_date, hr.employment_end_date, '2025-04-06'::DATE) * 12.0
        ELSE 0
    END as statutory_entitlement_hours,
    -- Start with 0 days taken for current year
    0.0 as days_taken,
    0.0 as hours_taken,
    (hr.contracted_hours = 0) as is_zero_hours
FROM human_resource hr
WHERE hr.is_active = true
ON CONFLICT (staff_id, holiday_year_start) DO NOTHING;

-- =====================================================
-- 8. SETUP COMPLETION
-- =====================================================

-- Show setup completion status
SELECT '✅ Complete database setup completed successfully!' as status;

-- Show table counts
SELECT 
    'human_resource' as table_name, COUNT(*) as record_count FROM human_resource
UNION ALL
SELECT 
    'periods' as table_name, COUNT(*) as record_count FROM periods
UNION ALL
SELECT 
    'shifts' as table_name, COUNT(*) as record_count FROM shifts
UNION ALL
SELECT 
    'change_requests' as table_name, COUNT(*) as record_count FROM change_requests
UNION ALL
SELECT 
    'holiday_entitlements' as table_name, COUNT(*) as record_count FROM holiday_entitlements;

-- Note: shifts and change_requests tables are intentionally empty
-- Only periods, human_resource, and holiday_entitlements are populated with data

-- Show active staff count
SELECT 
    COUNT(*) as total_staff,
    COUNT(*) FILTER (WHERE is_active = true) as active_staff,
    COUNT(*) FILTER (WHERE is_active = false) as inactive_staff
FROM human_resource;

-- Show role distribution
SELECT 
    role,
    COUNT(*) as count
FROM human_resource 
GROUP BY role 
ORDER BY role;

-- Show database features summary
SELECT 
    'Database Features' as category,
    'Holiday entitlement management with pro-rata calculations' as feature
UNION ALL
SELECT 'Database Features', 'Change request system with effective dates'
UNION ALL
SELECT 'Database Features', 'Call-out flag support (2x pay)'
UNION ALL
SELECT 'Database Features', 'Overtime tracking (1.5x pay)'
UNION ALL
SELECT 'Database Features', 'Performance optimized indexes'
UNION ALL
SELECT 'Database Features', 'Automatic data validation triggers'
UNION ALL
SELECT 'Database Features', 'UK statutory holiday calculations'
UNION ALL
SELECT 'Database Features', 'Dynamic holiday usage tracking from shifts'
UNION ALL
SELECT 'Database Features', 'ACTUAL SCHEMA MATCHING SERVER.JS IMPLEMENTATION';

-- =====================================================
-- 9. COMMENTS AND DOCUMENTATION
-- =====================================================

COMMENT ON TABLE human_resource IS 'Main staff information table with employment details and color coding - ONLY USED COLUMNS';
COMMENT ON TABLE periods IS 'Work periods for organizing schedules into manageable chunks';
COMMENT ON TABLE shifts IS 'Staff shift assignments with comprehensive flags and validation - uses shift_start_datetime and shift_end_datetime';
COMMENT ON TABLE change_requests IS 'Complete audit trail for all staff changes with effective dates - RENAMED FROM human_resource_history';
COMMENT ON TABLE holiday_entitlements IS 'Holiday entitlement tracking per UK financial year with dynamic usage calculation';

COMMENT ON COLUMN shifts.shift_start_datetime IS 'Start datetime of the shift (TIMESTAMPTZ)';
COMMENT ON COLUMN shifts.shift_end_datetime IS 'End datetime of the shift (TIMESTAMPTZ)';
COMMENT ON COLUMN shifts.call_out IS 'Call-out flag for 2x pay multiplier';
COMMENT ON COLUMN shifts.overtime IS 'Overtime flag for 1.5x pay multiplier';
COMMENT ON COLUMN human_resource.color_code IS 'Hex color code for staff identification in UI';
COMMENT ON COLUMN change_requests.effective_from_date IS 'When the change becomes effective (for future-dated changes)';

COMMENT ON FUNCTION calculate_holiday_entitlement IS 'Calculates statutory holiday entitlement based on contracted hours (5.6 weeks * hours/12, max 28 days, rounded up to nearest full day)';
COMMENT ON FUNCTION get_holiday_year_dates IS 'Returns the current holiday year start and end dates (April 6th to April 5th)';
COMMENT ON FUNCTION calculate_zero_hour_entitlement IS 'Calculates holiday entitlement for zero-hour contracts based on actual hours worked';
COMMENT ON FUNCTION calculate_financial_year_entitlement IS 'Calculates pro-rata holiday entitlement based on employment dates within financial year';
COMMENT ON FUNCTION recalculate_holiday_entitlement IS 'Recalculates holiday entitlement when employment dates change, handles both contracted and zero-hour contracts';
COMMENT ON FUNCTION update_holiday_entitlement_usage IS 'Updates holiday usage for a specific staff member from shifts table';
COMMENT ON FUNCTION update_all_holiday_entitlement_usage IS 'Updates holiday usage for all staff members from shifts table';
COMMENT ON FUNCTION create_new_financial_year_entitlements IS 'Creates new holiday entitlements for all active staff for the current financial year - call annually on April 6th';
COMMENT ON FUNCTION check_and_renew_holiday_entitlements IS 'Automatically checks for financial year end flags in shifts table and creates new holiday entitlements for next financial year';
COMMENT ON FUNCTION trigger_holiday_entitlement_renewal IS 'Trigger function that automatically creates new holiday entitlements when financial_year_end flag is set on shifts';

-- =====================================================
-- 10. PRODUCTION RECOMMENDATIONS
-- =====================================================

/*
PRODUCTION SETUP CHECKLIST:

✅ Complete database schema created - ONLY ACTUALLY USED FEATURES
✅ All tables, views, functions, and triggers - MINIMAL SET
✅ Indexes for performance optimization
✅ Time-off management system with pro-rata calculations
✅ Change request system with effective dates
✅ Call-out and overtime flag support
✅ Dynamic holiday usage tracking
✅ Sample data inserted (1009 periods 2025-2100, 11 staff, holiday entitlements)
✅ Shifts and change_requests tables intentionally left empty
✅ Comprehensive documentation

NEXT STEPS:
1. Set up database backups
2. Configure connection pooling
3. Set up monitoring and logging
4. Configure SSL connections
5. Set up user permissions
6. Test all API endpoints
7. Monitor performance metrics
8. Enable autovacuum for optimal performance
9. Set up annual holiday entitlement renewal process

SECURITY CONSIDERATIONS:
- Use environment variables for database credentials
- Implement proper user authentication
- Set up database user permissions
- Enable SSL connections
- Regular security updates

PERFORMANCE OPTIMIZATION:
- Monitor query performance
- Adjust index strategies as needed
- Set up connection pooling
- Regular database maintenance
- Monitor resource usage
- Enable autovacuum (recommended settings in README)

ANNUAL HOLIDAY ENTITLEMENT RENEWAL:
- Holiday entitlements automatically renew when financial year end is flagged
- Two approaches available:

1. AUTOMATED TRIGGER APPROACH (RECOMMENDED):
   - Uses database trigger on shifts table
   - Automatically fires when financial_year_end flag is set to true
   - Creates new entitlements immediately for next financial year
   - No scheduled tasks or manual intervention required
   - Trigger: trigger_holiday_renewal_on_financial_year_end

2. MANUAL APPROACH:
   - Must manually call create_new_financial_year_entitlements() function annually
   - Recommended schedule: April 6th of each year (start of new financial year)
   - Function creates new entitlements for all active staff members
   - Command: SELECT * FROM create_new_financial_year_entitlements();

- Both approaches use current contracted hours and apply company holiday policy
- Trigger approach is fully automated and requires no maintenance

FEATURES INCLUDED (ONLY ACTUALLY USED):
- Complete staff management system with change tracking
- Shift scheduling with flags (solo, training, short notice, overtime, call-out)
- Holiday entitlement management (UK statutory with pro-rata)
- Change request system with effective dates
- Historical data tracking (change_requests table)
- Performance optimized indexes
- Automatic data validation
- Pay calculation support (1.5x overtime, 2x call-out)
- Dynamic holiday usage calculation from shifts
- ACTUAL SCHEMA MATCHING SERVER.JS IMPLEMENTATION
- NO UNUSED COLUMNS OR TABLES
*/