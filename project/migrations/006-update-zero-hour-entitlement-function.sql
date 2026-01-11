-- =====================================================
-- Migration 006: Update Zero-Hour Entitlement Function
-- =====================================================
-- This migration updates the calculate_zero_hour_entitlement() function
-- to use the new formula and add employment date parameters for pro-rata calculations.
--
-- Changes:
-- 1. Update formula from (hours / 1950) * 28 to (hours / 12) * 5.6
-- 2. Remove 28-day cap
-- 3. Add employment date parameters for pro-rata calculations
-- 4. Add pro-rata factor calculation based on employment period
-- =====================================================

-- Update calculate_zero_hour_entitlement() function
CREATE OR REPLACE FUNCTION calculate_zero_hour_entitlement(
    p_staff_id UUID,
    p_holiday_year_start DATE,
    p_holiday_year_end DATE,
    p_employment_start_date DATE DEFAULT NULL,
    p_employment_end_date DATE DEFAULT NULL
)
RETURNS DECIMAL AS $$
DECLARE
    total_hours_worked DECIMAL;
    entitlement_days DECIMAL;
    base_entitlement_days DECIMAL;
    pro_rata_factor DECIMAL := 1.0;
    effective_start_date DATE;
    effective_end_date DATE;
    total_days_in_year INTEGER;
    working_days_in_period INTEGER;
    staff_name_value TEXT;
BEGIN
    -- Get staff name for shift query
    SELECT staff_name INTO staff_name_value
    FROM human_resource
    WHERE unique_id = p_staff_id;
    
    IF staff_name_value IS NULL THEN
        RAISE EXCEPTION 'Staff member with ID % not found', p_staff_id;
    END IF;
    
    -- Determine effective employment period within the holiday year
    effective_start_date := GREATEST(
        COALESCE(p_employment_start_date, p_holiday_year_start),
        p_holiday_year_start
    );
    
    effective_end_date := LEAST(
        COALESCE(p_employment_end_date, p_holiday_year_end),
        p_holiday_year_end
    );
    
    -- Calculate total hours worked in the holiday year, filtered by effective employment period
    -- Use staff_id lookup to get staff_name for more reliable matching
    SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (shift_end_datetime - shift_start_datetime)) / 3600), 0)
    INTO total_hours_worked
    FROM shifts 
    WHERE staff_name = staff_name_value
    AND shift_start_datetime >= effective_start_date
    AND shift_start_datetime <= effective_end_date
    AND shift_type != 'HOLIDAY';
    
    -- For zero-hour contracts: Calculate entitlement based on actual hours worked
    -- UK Statutory Method: 12.07% of hours worked
    -- This is derived from 5.6 weeks / (52 weeks - 5.6 weeks) = 5.6 / 46.4 = 12.07%
    -- Formula: total_hours_worked * 0.1207 = holiday entitlement in hours
    -- Convert to days: hours / 12
    base_entitlement_days := (total_hours_worked * 0.1207) / 12.0;
    
    -- Calculate pro-rata factor based on employment period within holiday year
    IF p_employment_start_date IS NOT NULL OR p_employment_end_date IS NOT NULL THEN
        total_days_in_year := p_holiday_year_end - p_holiday_year_start;
        working_days_in_period := effective_end_date - effective_start_date;
        
        -- Ensure we don't have negative days
        IF working_days_in_period < 0 THEN
            working_days_in_period := 0;
        END IF;
        
        -- Calculate pro-rata factor
        IF total_days_in_year > 0 THEN
            pro_rata_factor := working_days_in_period::DECIMAL / total_days_in_year::DECIMAL;
        ELSE
            pro_rata_factor := 0.0;
        END IF;
        
        -- Ensure pro-rata factor is between 0 and 1
        pro_rata_factor := GREATEST(0.0, LEAST(1.0, pro_rata_factor));
    END IF;
    
    -- Apply pro-rata factor to base entitlement
    entitlement_days := base_entitlement_days * pro_rata_factor;
    
    -- Keep precise calculation (no rounding)
    -- entitlement_days := CEIL(entitlement_days);
    -- Note: 28-day cap has been removed per plan requirements
    
    RETURN entitlement_days;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- Verification
-- =====================================================

-- Verify the function was updated successfully
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM pg_proc 
        WHERE proname = 'calculate_zero_hour_entitlement'
        AND pronargs = 5  -- Should have 5 parameters now
    ) THEN
        RAISE NOTICE '✅ Migration 006: calculate_zero_hour_entitlement() function updated successfully';
    ELSE
        RAISE EXCEPTION '❌ Migration 006: Function calculate_zero_hour_entitlement() not found or has wrong number of parameters';
    END IF;
END $$;

-- Show function signature for verification
SELECT 
    'Function updated: calculate_zero_hour_entitlement' as status,
    proname as function_name,
    pronargs as parameter_count,
    pg_get_function_arguments(oid) as arguments
FROM pg_proc 
WHERE proname = 'calculate_zero_hour_entitlement';
