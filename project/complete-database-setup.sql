-- 🚀 Complete Database Setup Script
-- Staff Rota Management System with Time-Off Management
-- This script sets up the complete database schema including all tables, views, functions, and triggers
-- Run this in your PostgreSQL database to create everything needed for the system

-- =====================================================
-- 1. CORE TABLES
-- =====================================================

-- Human Resource table (staff members)
CREATE TABLE IF NOT EXISTS human_resource (
    unique_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_name TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'staff member' CHECK (role IN ('team leader', 'staff member')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    color_code VARCHAR(7) DEFAULT '#3b82f6',
    email TEXT,
    phone TEXT,
    department TEXT,
    hire_date DATE DEFAULT CURRENT_DATE,
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

-- Shifts table (staff assignments)
CREATE TABLE IF NOT EXISTS shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_id UUID NOT NULL REFERENCES periods(period_id) ON DELETE CASCADE,
    week_number INTEGER NOT NULL CHECK (week_number >= 1 AND week_number <= 52),
    date DATE NOT NULL,
    shift_type TEXT NOT NULL CHECK (shift_type IN ('Tom Day', 'Charlotte Day', 'Double Up', 'Tom Night', 'Charlotte Night', 'HOLIDAY')),
    staff_name TEXT NOT NULL REFERENCES human_resource(staff_name) ON DELETE CASCADE,
    start_time TIME,
    end_time TIME,
    total_hours DECIMAL(4,2),
    notes TEXT,
    solo_shift BOOLEAN DEFAULT FALSE,
    training BOOLEAN DEFAULT FALSE,
    short_notice BOOLEAN DEFAULT FALSE,
    payment_period_end BOOLEAN DEFAULT FALSE,
    financial_year_end BOOLEAN DEFAULT FALSE,
    overtime BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT (NOW() AT TIME ZONE 'Europe/London'),
    updated_at TIMESTAMPTZ DEFAULT (NOW() AT TIME ZONE 'Europe/London')
);

-- Role History table (audit trail for role changes)
CREATE TABLE IF NOT EXISTS role_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES human_resource(unique_id) ON DELETE CASCADE,
    staff_name TEXT NOT NULL,
    previous_role TEXT NOT NULL,
    new_role TEXT NOT NULL,
    changed_at TIMESTAMPTZ DEFAULT (NOW() AT TIME ZONE 'Europe/London'),
    changed_by TEXT DEFAULT 'system',
    reason TEXT
);

-- Human Resource History table (audit trail for all staff changes)
CREATE TABLE IF NOT EXISTS human_resource_history (
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

-- Contract History table (audit trail for contract changes)
CREATE TABLE IF NOT EXISTS contract_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES human_resource(unique_id) ON DELETE CASCADE,
    staff_name TEXT NOT NULL,
    contracted_hours DECIMAL(4,2) NOT NULL,
    pay_rate DECIMAL(6,2) NOT NULL,
    effective_from_date DATE NOT NULL,
    effective_to_date DATE,
    is_current BOOLEAN DEFAULT false,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT (NOW() AT TIME ZONE 'Europe/London'),
    updated_at TIMESTAMPTZ DEFAULT (NOW() AT TIME ZONE 'Europe/London')
);

-- Color History table (audit trail for color changes)
CREATE TABLE IF NOT EXISTS color_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES human_resource(unique_id) ON DELETE CASCADE,
    staff_name TEXT NOT NULL,
    old_color VARCHAR(7),
    new_color VARCHAR(7) NOT NULL,
    changed_at TIMESTAMPTZ DEFAULT (NOW() AT TIME ZONE 'Europe/London'),
    changed_by TEXT DEFAULT 'system',
    reason TEXT
);

-- Staff Snapshots table (point-in-time data capture)
CREATE TABLE IF NOT EXISTS staff_snapshots (
    snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_date DATE NOT NULL,
    staff_id UUID NOT NULL REFERENCES human_resource(unique_id) ON DELETE CASCADE,
    staff_name TEXT NOT NULL,
    role TEXT NOT NULL,
    contracted_hours DECIMAL(4,2),
    pay_rate DECIMAL(6,2),
    is_active BOOLEAN,
    employment_start_date DATE,
    employment_end_date DATE,
    created_at TIMESTAMPTZ DEFAULT (NOW() AT TIME ZONE 'Europe/London')
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
    CONSTRAINT valid_entitlement CHECK (statutory_entitlement_days >= 0 AND statutory_entitlement_hours >= 0)
);

-- =====================================================
-- 3. INDEXES FOR PERFORMANCE
-- =====================================================

-- Human Resource indexes
CREATE INDEX IF NOT EXISTS idx_human_resource_staff_name ON human_resource(staff_name);
CREATE INDEX IF NOT EXISTS idx_human_resource_role ON human_resource(role);
CREATE INDEX IF NOT EXISTS idx_human_resource_is_active ON human_resource(is_active);
CREATE INDEX IF NOT EXISTS idx_human_resource_updated_at ON human_resource(updated_at);
CREATE INDEX IF NOT EXISTS idx_human_resource_employment_dates ON human_resource(employment_start_date, employment_end_date);

-- Periods indexes
CREATE INDEX IF NOT EXISTS idx_periods_start_date ON periods(start_date);
CREATE INDEX IF NOT EXISTS idx_periods_end_date ON periods(end_date);
CREATE INDEX IF NOT EXISTS idx_periods_is_active ON periods(is_active);

-- Shifts indexes
CREATE INDEX IF NOT EXISTS idx_shifts_period_id ON shifts(period_id);
CREATE INDEX IF NOT EXISTS idx_shifts_week_number ON shifts(week_number);
CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(date);
CREATE INDEX IF NOT EXISTS idx_shifts_staff_name ON shifts(staff_name);
CREATE INDEX IF NOT EXISTS idx_shifts_shift_type ON shifts(shift_type);
CREATE INDEX IF NOT EXISTS idx_shifts_created_at ON shifts(created_at);

-- History tables indexes
CREATE INDEX IF NOT EXISTS idx_role_history_staff_id ON role_history(staff_id);
CREATE INDEX IF NOT EXISTS idx_role_history_staff_name ON role_history(staff_name);
CREATE INDEX IF NOT EXISTS idx_role_history_changed_at ON role_history(changed_at);

CREATE INDEX IF NOT EXISTS idx_human_resource_history_staff_id ON human_resource_history(staff_id);
CREATE INDEX IF NOT EXISTS idx_human_resource_history_staff_name ON human_resource_history(staff_name);
CREATE INDEX IF NOT EXISTS idx_human_resource_history_change_type ON human_resource_history(change_type);
CREATE INDEX IF NOT EXISTS idx_human_resource_history_changed_at ON human_resource_history(changed_at);

CREATE INDEX IF NOT EXISTS idx_contract_history_staff_id ON contract_history(staff_id);
CREATE INDEX IF NOT EXISTS idx_contract_history_staff_name ON contract_history(staff_name);
CREATE INDEX IF NOT EXISTS idx_contract_history_effective_dates ON contract_history(effective_from_date, effective_to_date);

CREATE INDEX IF NOT EXISTS idx_color_history_staff_id ON color_history(staff_id);
CREATE INDEX IF NOT EXISTS idx_color_history_staff_name ON color_history(staff_name);
CREATE INDEX IF NOT EXISTS idx_color_history_changed_at ON color_history(changed_at);

CREATE INDEX IF NOT EXISTS idx_staff_snapshots_date ON staff_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_staff_snapshots_staff_id ON staff_snapshots(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_snapshots_staff_name ON staff_snapshots(staff_name);

-- Holiday entitlements indexes
CREATE INDEX IF NOT EXISTS idx_holiday_entitlements_staff_id ON holiday_entitlements(staff_id);
CREATE INDEX IF NOT EXISTS idx_holiday_entitlements_staff_name ON holiday_entitlements(staff_name);
CREATE INDEX IF NOT EXISTS idx_holiday_entitlements_year ON holiday_entitlements(holiday_year_start, holiday_year_end);
CREATE INDEX IF NOT EXISTS idx_holiday_entitlements_zero_hours ON holiday_entitlements(is_zero_hours);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_shifts_period_week_date ON shifts(period_id, week_number, date);
CREATE INDEX IF NOT EXISTS idx_shifts_staff_date ON shifts(staff_name, date);
CREATE INDEX IF NOT EXISTS idx_human_resource_role_active ON human_resource(role, is_active);

-- =====================================================
-- 4. HELPER FUNCTIONS
-- =====================================================

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = (NOW() AT TIME ZONE 'Europe/London');
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Function to log role changes
CREATE OR REPLACE FUNCTION log_role_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.role != NEW.role THEN
        INSERT INTO role_history (staff_id, staff_name, previous_role, new_role, changed_at, changed_by)
        VALUES (NEW.unique_id, NEW.staff_name, OLD.role, NEW.role, (NOW() AT TIME ZONE 'Europe/London'), 'system');
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Function to log contract changes
CREATE OR REPLACE FUNCTION log_contract_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Log contracted hours changes
    IF OLD.contracted_hours != NEW.contracted_hours THEN
        INSERT INTO contract_history (staff_id, staff_name, contracted_hours, pay_rate, effective_from_date, is_current, reason)
        VALUES (NEW.unique_id, NEW.staff_name, NEW.contracted_hours, NEW.pay_rate, CURRENT_DATE, true, 'Contract updated');
        
        -- Mark previous contract as ended
        UPDATE contract_history 
        SET effective_to_date = CURRENT_DATE - INTERVAL '1 day', is_current = false
        WHERE staff_id = NEW.unique_id AND is_current = true AND id != (SELECT id FROM contract_history WHERE staff_id = NEW.unique_id ORDER BY created_at DESC LIMIT 1);
    END IF;
    
    -- Log pay rate changes
    IF OLD.pay_rate != NEW.pay_rate THEN
        INSERT INTO contract_history (staff_id, staff_name, contracted_hours, pay_rate, effective_from_date, is_current, reason)
        VALUES (NEW.unique_id, NEW.staff_name, NEW.contracted_hours, NEW.pay_rate, CURRENT_DATE, true, 'Pay rate updated');
        
        -- Mark previous contract as ended
        UPDATE contract_history 
        SET effective_to_date = CURRENT_DATE - INTERVAL '1 day', is_current = false
        WHERE staff_id = NEW.unique_id AND is_current = true AND id != (SELECT id FROM contract_history WHERE staff_id = NEW.unique_id ORDER BY created_at DESC LIMIT 1);
    END IF;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Function to log color changes
CREATE OR REPLACE FUNCTION log_color_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.color_code != NEW.color_code THEN
        INSERT INTO color_history (staff_id, staff_name, old_color, new_color, changed_at, changed_by)
        VALUES (NEW.unique_id, NEW.staff_name, OLD.color_code, NEW.color_code, (NOW() AT TIME ZONE 'Europe/London'), 'system');
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Function to check shift overlap for the same staff member
CREATE OR REPLACE FUNCTION check_shift_overlap()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if there's an overlapping shift for the same staff member on the same date
    IF EXISTS (
        SELECT 1 FROM shifts 
        WHERE staff_name = NEW.staff_name 
        AND date = NEW.date 
        AND id != NEW.id
        AND (
            (NEW.start_time, NEW.end_time) OVERLAPS (start_time, end_time)
            OR (start_time IS NULL AND end_time IS NULL) -- Holiday shifts
            OR (NEW.start_time IS NULL AND NEW.end_time IS NULL) -- Holiday shifts
        )
    ) THEN
        RAISE EXCEPTION 'Shift overlap detected for staff member % on date %', NEW.staff_name, NEW.date;
    END IF;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Function to calculate total hours
CREATE OR REPLACE FUNCTION calculate_total_hours()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.start_time IS NOT NULL AND NEW.end_time IS NOT NULL THEN
        -- Handle overnight shifts (end time < start time)
        IF NEW.end_time < NEW.start_time THEN
            NEW.total_hours = EXTRACT(EPOCH FROM (NEW.end_time + INTERVAL '24 hours' - NEW.start_time)) / 3600;
        ELSE
            NEW.total_hours = EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time)) / 3600;
        END IF;
    ELSE
        -- Holiday shifts have no time, so no hours
        NEW.total_hours = 0;
    END IF;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Function to calculate holiday entitlement based on contracted hours
CREATE OR REPLACE FUNCTION calculate_holiday_entitlement(contracted_hours DECIMAL)
RETURNS DECIMAL AS $$
BEGIN
    -- 5.6 weeks * (contracted_hours / 12 hours per day)
    RETURN ROUND((5.6 * (contracted_hours / 12.0))::DECIMAL, 1);
END;
$$ LANGUAGE plpgsql;

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

-- Function to calculate pro-rated holiday entitlement
CREATE OR REPLACE FUNCTION calculate_pro_rated_entitlement(
    contracted_hours DECIMAL,
    hire_date DATE,
    holiday_year_start DATE,
    holiday_year_end DATE,
    employment_end_date DATE DEFAULT NULL
)
RETURNS DECIMAL AS $$
DECLARE
    full_entitlement DECIMAL;
    days_in_year INTEGER;
    days_remaining INTEGER;
    pro_rate_factor DECIMAL;
    effective_end_date DATE;
BEGIN
    full_entitlement := calculate_holiday_entitlement(contracted_hours);
    
    days_in_year := holiday_year_end - holiday_year_start + 1;
    
    -- Determine effective end date for calculation
    IF employment_end_date IS NOT NULL AND employment_end_date < holiday_year_end THEN
        effective_end_date := employment_end_date;
    ELSE
        effective_end_date := holiday_year_end;
    END IF;
    
    -- Calculate days remaining considering both hire date and employment end date
    days_remaining := GREATEST(effective_end_date - GREATEST(hire_date, holiday_year_start) + 1, 0);
    pro_rate_factor := days_remaining::DECIMAL / days_in_year::DECIMAL;
    
    RETURN ROUND((full_entitlement * pro_rate_factor)::DECIMAL, 1);
END;
$$ LANGUAGE plpgsql;

-- Function to calculate holiday entitlement for financial year period
CREATE OR REPLACE FUNCTION calculate_financial_year_entitlement(
    contracted_hours DECIMAL,
    employment_start_date DATE DEFAULT NULL,
    employment_end_date DATE DEFAULT NULL
)
RETURNS DECIMAL AS $$
DECLARE
    full_entitlement DECIMAL;
    holiday_year_start DATE;
    holiday_year_end DATE;
    effective_start_date DATE;
    effective_end_date DATE;
    days_in_year INTEGER;
    days_remaining INTEGER;
    pro_rate_factor DECIMAL;
BEGIN
    -- Get current financial year dates (April 6th to April 5th)
    SELECT * INTO holiday_year_start, holiday_year_end FROM get_holiday_year_dates();
    
    -- Calculate full entitlement for the year
    full_entitlement := calculate_holiday_entitlement(contracted_hours);
    
    -- If no employment start date, assume full year entitlement
    IF employment_start_date IS NULL THEN
        RETURN full_entitlement;
    END IF;
    
    days_in_year := holiday_year_end - holiday_year_start + 1;
    
    -- Determine effective start and end dates
    effective_start_date := GREATEST(employment_start_date, holiday_year_start);
    
    IF employment_end_date IS NOT NULL AND employment_end_date < holiday_year_end THEN
        effective_end_date := employment_end_date;
    ELSE
        effective_end_date := holiday_year_end;
    END IF;
    
    -- Calculate days remaining
    days_remaining := GREATEST(effective_end_date - effective_start_date + 1, 0);
    pro_rate_factor := days_remaining::DECIMAL / days_in_year::DECIMAL;
    
    RETURN ROUND((full_entitlement * pro_rate_factor)::DECIMAL, 1);
END;
$$ LANGUAGE plpgsql;

-- Function to recalculate holiday entitlement when employment dates change
CREATE OR REPLACE FUNCTION recalculate_holiday_entitlement(
    staff_id UUID,
    new_employment_end_date DATE DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
    staff_record RECORD;
    holiday_year_start DATE;
    holiday_year_end DATE;
    new_entitlement_days DECIMAL;
    new_entitlement_hours DECIMAL;
BEGIN
    -- Get staff information
    SELECT 
        unique_id,
        staff_name,
        contracted_hours,
        employment_start_date,
        employment_end_date
    INTO staff_record
    FROM human_resource 
    WHERE unique_id = staff_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Staff member with ID % not found', staff_id;
    END IF;
    
    -- Get current holiday year dates
    SELECT * INTO holiday_year_start, holiday_year_end 
    FROM get_holiday_year_dates();
    
    -- Calculate new entitlement considering employment end date
    IF (staff_record.contracted_hours || 0) = 0 THEN
        -- Zero-hours contract - calculate based on hours worked
        new_entitlement_days := 0; -- Placeholder for zero-hours calculation
    ELSE
        -- Contracted staff - use financial year entitlement function
        SELECT calculate_financial_year_entitlement(
            staff_record.contracted_hours,
            staff_record.employment_start_date,
            COALESCE(new_employment_end_date, staff_record.employment_end_date)
        ) INTO new_entitlement_days;
    END IF;
    
    new_entitlement_hours := new_entitlement_days * 12;
    
    -- Update existing entitlement record
    UPDATE holiday_entitlements 
    SET 
        statutory_entitlement_days = new_entitlement_days,
        statutory_entitlement_hours = new_entitlement_hours,
        updated_at = CURRENT_TIMESTAMP
    WHERE staff_id = staff_id 
      AND holiday_year_start = holiday_year_start 
      AND holiday_year_end = holiday_year_end;
    
    -- If no existing record, create one
    IF NOT FOUND THEN
        INSERT INTO holiday_entitlements (
            staff_id, staff_name, holiday_year_start, holiday_year_end,
            contracted_hours_per_week, statutory_entitlement_days, statutory_entitlement_hours,
            is_zero_hours
        ) VALUES (
            staff_id,
            staff_record.staff_name,
            holiday_year_start,
            holiday_year_end,
            staff_record.contracted_hours,
            new_entitlement_days,
            new_entitlement_hours,
            (staff_record.contracted_hours = 0)
        );
    END IF;
    
    RAISE NOTICE 'Holiday entitlement recalculated for staff ID %: %.1f days (%.1f hours)', 
        staff_id, new_entitlement_days, new_entitlement_hours;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 5. TRIGGERS
-- =====================================================

-- Update timestamp triggers
DROP TRIGGER IF EXISTS update_human_resource_updated_at ON human_resource;
CREATE TRIGGER update_human_resource_updated_at 
    BEFORE UPDATE ON human_resource 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_periods_updated_at ON periods;
CREATE TRIGGER update_periods_updated_at 
    BEFORE UPDATE ON periods 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_shifts_updated_at ON shifts;
CREATE TRIGGER update_shifts_updated_at 
    BEFORE UPDATE ON shifts 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_contract_history_updated_at ON contract_history;
CREATE TRIGGER update_contract_history_updated_at 
    BEFORE UPDATE ON contract_history 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_holiday_entitlements_updated_at ON holiday_entitlements;
CREATE TRIGGER update_holiday_entitlements_updated_at
    BEFORE UPDATE ON holiday_entitlements
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Change logging triggers
DROP TRIGGER IF EXISTS log_role_changes ON human_resource;
CREATE TRIGGER log_role_changes 
    AFTER UPDATE ON human_resource 
    FOR EACH ROW EXECUTE FUNCTION log_role_change();

DROP TRIGGER IF EXISTS log_contract_changes ON human_resource;
CREATE TRIGGER log_contract_changes 
    AFTER UPDATE ON human_resource 
    FOR EACH ROW EXECUTE FUNCTION log_contract_change();

DROP TRIGGER IF EXISTS log_color_changes ON human_resource;
CREATE TRIGGER log_color_changes 
    AFTER UPDATE ON human_resource 
    FOR EACH ROW EXECUTE FUNCTION log_color_change();

-- Shift validation triggers
DROP TRIGGER IF EXISTS check_shift_overlap_trigger ON shifts;
CREATE TRIGGER check_shift_overlap_trigger 
    BEFORE INSERT OR UPDATE ON shifts 
    FOR EACH ROW EXECUTE FUNCTION check_shift_overlap();

DROP TRIGGER IF EXISTS calculate_total_hours_trigger ON shifts;
CREATE TRIGGER calculate_total_hours_trigger 
    BEFORE INSERT OR UPDATE ON shifts 
    FOR EACH ROW EXECUTE FUNCTION calculate_total_hours();

-- =====================================================
-- 6. VIEWS FOR COMMON QUERIES
-- =====================================================

-- View for active staff members
CREATE OR REPLACE VIEW active_staff AS
SELECT unique_id, staff_name, role, email, phone, department, hire_date, contracted_hours, pay_rate
FROM human_resource 
WHERE is_active = true
ORDER BY staff_name;

-- View for staff summary with role counts
CREATE OR REPLACE VIEW staff_summary AS
SELECT 
    role,
    COUNT(*) as total_count,
    COUNT(*) FILTER (WHERE is_active = true) as active_count,
    COUNT(*) FILTER (WHERE is_active = false) as inactive_count
FROM human_resource 
GROUP BY role
ORDER BY role;

-- View for shift assignments with staff details
CREATE OR REPLACE VIEW shift_assignments AS
SELECT 
    s.id,
    s.period_id,
    s.week_number,
    s.date,
    s.shift_type,
    s.staff_name,
    s.start_time,
    s.end_time,
    s.total_hours,
    s.notes,
    s.solo_shift,
    s.training,
    s.short_notice,
    s.payment_period_end,
    s.financial_year_end,
    s.overtime,
    hr.role as staff_role,
    hr.is_active as staff_active,
    hr.contracted_hours,
    hr.pay_rate,
    p.period_name,
    p.start_date as period_start,
    p.end_date as period_end
FROM shifts s
JOIN human_resource hr ON s.staff_name = hr.staff_name
JOIN periods p ON s.period_id = p.period_id
WHERE hr.is_active = true
ORDER BY s.date, s.start_time;

-- View for current holiday entitlements
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
    hr.is_active
FROM holiday_entitlements he
JOIN human_resource hr ON he.staff_id = hr.unique_id
WHERE he.holiday_year_start <= CURRENT_DATE 
  AND he.holiday_year_end >= CURRENT_DATE;

-- View for staff contract history
CREATE OR REPLACE VIEW staff_contract_history AS
SELECT 
    ch.id,
    ch.staff_id,
    ch.staff_name,
    ch.contracted_hours,
    ch.pay_rate,
    ch.effective_from_date,
    ch.effective_to_date,
    ch.is_current,
    ch.reason,
    ch.created_at,
    hr.role,
    hr.is_active
FROM contract_history ch
JOIN human_resource hr ON ch.staff_id = hr.unique_id
ORDER BY ch.staff_name, ch.effective_from_date DESC;

-- =====================================================
-- 7. SAMPLE DATA
-- =====================================================

-- Insert sample periods if none exist
INSERT INTO periods (period_name, start_date, end_date) 
SELECT 'Q1 2024', '2024-01-01', '2024-03-31'
WHERE NOT EXISTS (SELECT 1 FROM periods);

-- Insert sample staff if none exist
INSERT INTO human_resource (staff_name, role, is_active, contracted_hours, pay_rate) VALUES
    ('Helen', 'team leader', true, 36.0, 15.50),
    ('Fung', 'team leader', true, 36.0, 15.50),
    ('Anne', 'staff member', true, 36.0, 14.24),
    ('Annie', 'staff member', true, 36.0, 14.24),
    ('Lisa', 'staff member', true, 36.0, 14.24),
    ('Janet', 'staff member', true, 36.0, 14.24),
    ('Clara', 'team leader', true, 36.0, 15.50),
    ('John', 'staff member', true, 36.0, 14.24),
    ('Vania', 'staff member', true, 36.0, 14.24),
    ('Yasser', 'staff member', true, 36.0, 14.24),
    ('Matt', 'staff member', true, 36.0, 14.24)
ON CONFLICT (staff_name) DO NOTHING;

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
    'role_history' as table_name, COUNT(*) as record_count FROM role_history
UNION ALL
SELECT 
    'human_resource_history' as table_name, COUNT(*) as record_count FROM human_resource_history
UNION ALL
SELECT 
    'contract_history' as table_name, COUNT(*) as record_count FROM contract_history
UNION ALL
SELECT 
    'color_history' as table_name, COUNT(*) as record_count FROM color_history
UNION ALL
SELECT 
    'staff_snapshots' as table_name, COUNT(*) as record_count FROM staff_snapshots
UNION ALL
SELECT 
    'holiday_entitlements' as table_name, COUNT(*) as record_count FROM holiday_entitlements;

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

-- =====================================================
-- 9. COMMENTS AND DOCUMENTATION
-- =====================================================

COMMENT ON TABLE human_resource IS 'Main staff information table with employment details';
COMMENT ON TABLE periods IS 'Work periods for organizing schedules';
COMMENT ON TABLE shifts IS 'Staff shift assignments with flags and validation';
COMMENT ON TABLE role_history IS 'Audit trail for role changes';
COMMENT ON TABLE human_resource_history IS 'Complete audit trail for all staff changes';
COMMENT ON TABLE contract_history IS 'Contract change history with effective dates';
COMMENT ON TABLE color_history IS 'Color code change tracking';
COMMENT ON TABLE staff_snapshots IS 'Point-in-time staff data capture';
COMMENT ON TABLE holiday_entitlements IS 'Holiday entitlement tracking per financial year';

COMMENT ON FUNCTION calculate_holiday_entitlement IS 'Calculates statutory holiday entitlement based on contracted hours (5.6 weeks * hours/12)';
COMMENT ON FUNCTION get_holiday_year_dates IS 'Returns the current holiday year start and end dates (April 6th to April 5th)';
COMMENT ON FUNCTION recalculate_holiday_entitlement IS 'Recalculates holiday entitlement when employment dates change';

-- =====================================================
-- 10. PRODUCTION RECOMMENDATIONS
-- =====================================================

/*
PRODUCTION SETUP CHECKLIST:

✅ Complete database schema created
✅ All tables, views, functions, and triggers
✅ Indexes for performance optimization
✅ Audit trails for all changes
✅ Time-off management system
✅ Sample data inserted
✅ Views for common queries

NEXT STEPS:
1. Set up database backups
2. Configure connection pooling
3. Set up monitoring and logging
4. Configure SSL connections
5. Set up user permissions
6. Test all API endpoints
7. Monitor performance metrics

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
*/
