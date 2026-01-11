-- =====================================================
-- Migration 007: Update Holiday Entitlement Trigger for Overtime
-- =====================================================
-- This migration updates the update_zero_hour_holiday_entitlement() function
-- to also recalculate holiday entitlements for contracted employees when
-- overtime shifts are added, updated, or deleted.
--
-- Changes:
-- 1. Function now handles both zero-hour contracts AND contracted employees
-- 2. For zero-hour contracts: Recalculates on any shift change (existing behavior)
-- 3. For contracted employees: Recalculates when overtime shifts are added/updated/deleted
-- 4. Recalculates when overtime flag changes or overtime shift times change
-- =====================================================

-- Update the trigger function to handle overtime for contracted employees
CREATE OR REPLACE FUNCTION update_zero_hour_holiday_entitlement()
RETURNS TRIGGER AS $$
DECLARE
    staff_id_var UUID;
    is_zero_hours BOOLEAN;
    should_recalculate BOOLEAN := false;
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
    
    -- Determine if we need to recalculate
    IF is_zero_hours THEN
        -- Always recalculate for zero-hour contracts when shifts change
        should_recalculate := true;
    ELSIF TG_OP = 'INSERT' THEN
        -- For contracted employees, recalculate if overtime shift is added
        should_recalculate := (NEW.overtime = true);
    ELSIF TG_OP = 'UPDATE' THEN
        -- For contracted employees, recalculate if:
        -- 1. Overtime flag changed (from false to true or vice versa)
        -- 2. Overtime flag is true and shift times changed (affects hours calculation)
        should_recalculate := (
            (OLD.overtime IS DISTINCT FROM NEW.overtime) OR
            (NEW.overtime = true AND (
                OLD.shift_start_datetime IS DISTINCT FROM NEW.shift_start_datetime OR
                OLD.shift_end_datetime IS DISTINCT FROM NEW.shift_end_datetime
            ))
        );
    ELSIF TG_OP = 'DELETE' THEN
        -- For contracted employees, recalculate if overtime shift is deleted
        should_recalculate := (OLD.overtime = true);
    END IF;
    
    -- Recalculate holiday entitlement if needed
    IF should_recalculate THEN
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

-- =====================================================
-- Verification
-- =====================================================

-- Verify the function was updated successfully
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM pg_proc 
        WHERE proname = 'update_zero_hour_holiday_entitlement'
    ) THEN
        RAISE NOTICE '✅ Migration 007: update_zero_hour_holiday_entitlement() function updated successfully';
    ELSE
        RAISE EXCEPTION '❌ Migration 007: Function update_zero_hour_holiday_entitlement() not found';
    END IF;
END $$;

-- Show function signature for verification
SELECT 
    'Function updated: update_zero_hour_holiday_entitlement' as status,
    proname as function_name,
    pg_get_function_arguments(oid) as arguments
FROM pg_proc 
WHERE proname = 'update_zero_hour_holiday_entitlement';
