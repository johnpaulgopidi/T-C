-- =====================================================
-- Migration 007: Update Holiday Entitlement Trigger
-- =====================================================
-- This migration updates the update_zero_hour_holiday_entitlement() function
-- to ensure it properly handles shift changes for zero-hour contracts.
--
-- Changes:
-- 1. Function handles zero-hour contracts: Recalculates on any shift change
-- 2. For contracted employees: No automatic recalculation (statutory entitlement only)
-- 3. Ensures trigger exists and is properly attached
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
    
    -- If staff member not found, skip recalculation (shouldn't happen with foreign keys, but be safe)
    IF staff_id_var IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    
    -- Check if this is a zero-hour contract
    SELECT (contracted_hours = 0) INTO is_zero_hours
    FROM human_resource 
    WHERE unique_id = staff_id_var;
    
    -- Only recalculate for zero-hour contracts (statutory entitlement only for contracted employees)
    IF is_zero_hours THEN
        -- Always recalculate for zero-hour contracts when shifts change
        -- (their entitlement is based on actual hours worked)
        should_recalculate := true;
    END IF;
    -- For contracted employees: No automatic recalculation needed
    -- Statutory entitlement is based on contracted hours only, not overtime
    
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

-- =====================================================
-- Ensure Trigger Exists
-- =====================================================
-- The trigger must exist for the function to be called when shifts change.
-- This ensures the trigger is created even if it doesn't exist yet.

-- Drop and recreate the trigger to ensure it uses the updated function
DROP TRIGGER IF EXISTS update_zero_hour_entitlement_on_shift_change ON shifts;

CREATE TRIGGER update_zero_hour_entitlement_on_shift_change
    AFTER INSERT OR UPDATE OR DELETE ON shifts
    FOR EACH ROW 
    EXECUTE FUNCTION update_zero_hour_holiday_entitlement();

-- Verify the trigger was created successfully
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM pg_trigger 
        WHERE tgname = 'update_zero_hour_entitlement_on_shift_change'
        AND tgrelid = 'shifts'::regclass
    ) THEN
        RAISE NOTICE '✅ Migration 007: Trigger update_zero_hour_entitlement_on_shift_change created/updated successfully';
    ELSE
        RAISE EXCEPTION '❌ Migration 007: Trigger update_zero_hour_entitlement_on_shift_change not found';
    END IF;
END $$;

-- Show trigger information for verification
SELECT 
    'Trigger created: update_zero_hour_entitlement_on_shift_change' as status,
    tgname as trigger_name,
    tgrelid::regclass as table_name,
    tgenabled as enabled
FROM pg_trigger 
WHERE tgname = 'update_zero_hour_entitlement_on_shift_change';
