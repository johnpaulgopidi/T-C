-- =====================================================
-- Migration 005: Update Zero-Hour Entitlement Caller
-- =====================================================
-- This migration updates the recalculate_holiday_entitlement() function
-- to pass employment dates directly to calculate_zero_hour_entitlement()
-- instead of using a CASE statement.
--
-- Change: Updated the call to calculate_zero_hour_entitlement() to pass
-- staff_record.employment_start_date and staff_record.employment_end_date
-- directly, enabling proper pro-rata calculations based on employment dates.
-- =====================================================

-- Update recalculate_holiday_entitlement() function
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

    IF staff_record.contracted_hours = 0 THEN
        -- Zero-hours contract - calculate based on actual hours worked
        -- Updated to pass employment dates directly to calculate_zero_hour_entitlement()
        new_entitlement_days := calculate_zero_hour_entitlement(
            p_staff_id, 
            current_holiday_year_start, 
            current_holiday_year_end,
            staff_record.employment_start_date,
            staff_record.employment_end_date
        );
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
            uuid_holiday_entitlement(p_staff_id, current_holiday_year_start), p_staff_id, staff_record.staff_name, current_holiday_year_start, current_holiday_year_end,
            staff_record.contracted_hours, new_entitlement_days, new_entitlement_hours, (staff_record.contracted_hours = 0)
        );
    END IF;
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
        WHERE proname = 'recalculate_holiday_entitlement'
    ) THEN
        RAISE NOTICE '✅ Migration 005: recalculate_holiday_entitlement() function updated successfully';
    ELSE
        RAISE EXCEPTION '❌ Migration 005: Function recalculate_holiday_entitlement() not found';
    END IF;
END $$;

-- Show function signature for verification
SELECT 
    'Function updated: recalculate_holiday_entitlement' as status,
    proname as function_name,
    pg_get_function_arguments(oid) as arguments
FROM pg_proc 
WHERE proname = 'recalculate_holiday_entitlement';
