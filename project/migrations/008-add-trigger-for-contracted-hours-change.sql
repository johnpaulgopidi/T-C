-- =====================================================
-- Migration 008: Add Trigger for Contracted Hours Change
-- =====================================================
-- This migration adds a trigger to automatically recalculate holiday entitlements
-- when contracted_hours changes in the human_resource table.
--
-- This ensures that when a change request is deleted and contracted_hours is reverted,
-- the holiday entitlement is automatically recalculated.
-- =====================================================

-- Create trigger function to handle contracted hours changes
CREATE OR REPLACE FUNCTION trigger_recalculate_holiday_on_contracted_hours_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Only recalculate if contracted_hours actually changed
    IF (OLD.contracted_hours IS DISTINCT FROM NEW.contracted_hours) THEN
        
        -- Call the recalculate function
        PERFORM recalculate_holiday_entitlement(NEW.unique_id, NEW.employment_end_date);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to recalculate holiday entitlements when contracted hours change
DROP TRIGGER IF EXISTS recalculate_holiday_on_contracted_hours_change ON human_resource;

CREATE TRIGGER recalculate_holiday_on_contracted_hours_change
    AFTER UPDATE OF contracted_hours ON human_resource
    FOR EACH ROW 
    EXECUTE FUNCTION trigger_recalculate_holiday_on_contracted_hours_change();

-- =====================================================
-- Verification
-- =====================================================

-- Verify the function was created successfully
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM pg_proc 
        WHERE proname = 'trigger_recalculate_holiday_on_contracted_hours_change'
    ) THEN
        RAISE NOTICE '✅ Migration 008: trigger_recalculate_holiday_on_contracted_hours_change() function created successfully';
    ELSE
        RAISE EXCEPTION '❌ Migration 008: Function trigger_recalculate_holiday_on_contracted_hours_change() not found';
    END IF;
END $$;

-- Verify the trigger was created successfully
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM pg_trigger 
        WHERE tgname = 'recalculate_holiday_on_contracted_hours_change'
        AND tgrelid = 'human_resource'::regclass
    ) THEN
        RAISE NOTICE '✅ Migration 008: Trigger recalculate_holiday_on_contracted_hours_change created successfully';
    ELSE
        RAISE EXCEPTION '❌ Migration 008: Trigger recalculate_holiday_on_contracted_hours_change not found';
    END IF;
END $$;

-- Show trigger information for verification
SELECT 
    'Trigger created: recalculate_holiday_on_contracted_hours_change' as status,
    tgname as trigger_name,
    tgrelid::regclass as table_name,
    tgenabled as enabled
FROM pg_trigger 
WHERE tgname = 'recalculate_holiday_on_contracted_hours_change';
