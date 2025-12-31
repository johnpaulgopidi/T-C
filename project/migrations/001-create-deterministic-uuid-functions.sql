-- =====================================================
-- Migration: Create Deterministic UUID Generation Functions
-- =====================================================
-- This migration creates UUID v5 (RFC 4122) generation functions
-- for deterministic UUID generation based on natural keys.
-- All UUIDs will be generated deterministically, ensuring the same
-- record gets the same UUID across different databases.
--
-- UUID v5 uses SHA-1 hashing of namespace + name, making it
-- deterministic and suitable for database synchronization.
-- =====================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- 1. CORE UUID V5 GENERATION FUNCTION
-- =====================================================

-- Core UUID v5 generation function
-- Uses RFC 4122 UUID v5 specification (SHA-1 based)
CREATE OR REPLACE FUNCTION generate_uuid_v5(namespace_uuid UUID, name TEXT)
RETURNS UUID AS $$
BEGIN
    -- Use PostgreSQL's uuid-ossp extension for UUID v5 generation
    -- UUID v5 uses SHA-1 hashing: namespace UUID + name string
    RETURN uuid_generate_v5(namespace_uuid, name);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION generate_uuid_v5 IS 'Core UUID v5 generation function using RFC 4122 specification. Deterministic: same namespace + name = same UUID.';

-- =====================================================
-- 2. APPLICATION NAMESPACE UUID
-- =====================================================

-- Fixed application namespace UUID for this application
-- This ensures all UUIDs generated are in the same namespace
-- Using a well-known UUID namespace (DNS namespace format)
DO $$
DECLARE
    app_namespace_uuid UUID := '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
BEGIN
    -- Store the namespace UUID in a configuration table or use it directly
    -- For now, we'll use it directly in functions
    NULL; -- Placeholder for namespace storage if needed
END $$;

-- =====================================================
-- 3. GENERIC DETERMINISTIC UUID WRAPPER
-- =====================================================

-- Generic wrapper function for generating deterministic UUIDs
-- Uses application namespace + table name + seed value
CREATE OR REPLACE FUNCTION generate_deterministic_uuid(table_name TEXT, seed_value TEXT)
RETURNS UUID AS $$
DECLARE
    app_namespace_uuid UUID := '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    combined_name TEXT;
BEGIN
    -- Combine table name and seed value to create unique identifier
    -- Format: "table_name:seed_value"
    combined_name := table_name || ':' || COALESCE(seed_value, '');
    
    -- Generate UUID v5 using application namespace
    RETURN generate_uuid_v5(app_namespace_uuid, combined_name);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION generate_deterministic_uuid IS 'Generic wrapper for generating deterministic UUIDs. Uses application namespace + table name + seed value.';

-- =====================================================
-- 4. TABLE-SPECIFIC UUID GENERATION FUNCTIONS
-- =====================================================

-- Human Resource UUID generation
-- Natural key: staff_name (unique)
CREATE OR REPLACE FUNCTION uuid_human_resource(staff_name TEXT)
RETURNS UUID AS $$
DECLARE
    app_namespace_uuid UUID := '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    seed_value TEXT;
BEGIN
    -- Use staff_name as the seed (it's unique)
    seed_value := 'human_resource:' || COALESCE(staff_name, '');
    
    RETURN generate_uuid_v5(app_namespace_uuid, seed_value);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION uuid_human_resource IS 'Generates deterministic UUID for human_resource table based on staff_name.';

-- Period UUID generation
-- Natural key: period_name + start_date (combination should be unique)
CREATE OR REPLACE FUNCTION uuid_period(period_name TEXT, start_date DATE)
RETURNS UUID AS $$
DECLARE
    app_namespace_uuid UUID := '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    seed_value TEXT;
BEGIN
    -- Combine period_name and start_date as seed
    seed_value := 'period:' || COALESCE(period_name, '') || ':' || COALESCE(start_date::TEXT, '');
    
    RETURN generate_uuid_v5(app_namespace_uuid, seed_value);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION uuid_period IS 'Generates deterministic UUID for periods table based on period_name and start_date.';

-- Shift UUID generation
-- Natural key: period_id + staff_name + shift_start_datetime + shift_type
CREATE OR REPLACE FUNCTION uuid_shift(
    period_id UUID,
    staff_name TEXT,
    shift_start_datetime TIMESTAMPTZ,
    shift_type TEXT
)
RETURNS UUID AS $$
DECLARE
    app_namespace_uuid UUID := '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    seed_value TEXT;
BEGIN
    -- Combine all natural key components
    seed_value := 'shift:' || 
                  COALESCE(period_id::TEXT, '') || ':' ||
                  COALESCE(staff_name, '') || ':' ||
                  COALESCE(shift_start_datetime::TEXT, '') || ':' ||
                  COALESCE(shift_type, '');
    
    RETURN generate_uuid_v5(app_namespace_uuid, seed_value);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION uuid_shift IS 'Generates deterministic UUID for shifts table based on period_id, staff_name, shift_start_datetime, and shift_type.';

-- Change Request UUID generation
-- Natural key: staff_id + change_type + field_name + changed_at
CREATE OR REPLACE FUNCTION uuid_change_request(
    staff_id UUID,
    change_type TEXT,
    field_name TEXT,
    changed_at TIMESTAMPTZ
)
RETURNS UUID AS $$
DECLARE
    app_namespace_uuid UUID := '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    seed_value TEXT;
BEGIN
    -- Combine all natural key components
    seed_value := 'change_request:' ||
                  COALESCE(staff_id::TEXT, '') || ':' ||
                  COALESCE(change_type, '') || ':' ||
                  COALESCE(field_name, '') || ':' ||
                  COALESCE(changed_at::TEXT, '');
    
    RETURN generate_uuid_v5(app_namespace_uuid, seed_value);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION uuid_change_request IS 'Generates deterministic UUID for change_requests table based on staff_id, change_type, field_name, and changed_at.';

-- Setting UUID generation
-- Natural key: type_of_setting (unique)
CREATE OR REPLACE FUNCTION uuid_setting(type_of_setting TEXT)
RETURNS UUID AS $$
DECLARE
    app_namespace_uuid UUID := '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    seed_value TEXT;
BEGIN
    -- Use type_of_setting as the seed (it's unique)
    seed_value := 'setting:' || COALESCE(type_of_setting, '');
    
    RETURN generate_uuid_v5(app_namespace_uuid, seed_value);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION uuid_setting IS 'Generates deterministic UUID for settings table based on type_of_setting.';

-- Unavailable Staff Daily UUID generation
-- Natural key: period_id + date (unique constraint exists)
CREATE OR REPLACE FUNCTION uuid_unavailable_staff_daily(period_id UUID, date DATE)
RETURNS UUID AS $$
DECLARE
    app_namespace_uuid UUID := '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    seed_value TEXT;
BEGIN
    -- Combine period_id and date as seed
    seed_value := 'unavailable_staff_daily:' ||
                  COALESCE(period_id::TEXT, '') || ':' ||
                  COALESCE(date::TEXT, '');
    
    RETURN generate_uuid_v5(app_namespace_uuid, seed_value);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION uuid_unavailable_staff_daily IS 'Generates deterministic UUID for unavailable_staff_daily table based on period_id and date.';

-- Holiday Entitlement UUID generation
-- Natural key: staff_id + holiday_year_start (unique constraint exists)
CREATE OR REPLACE FUNCTION uuid_holiday_entitlement(staff_id UUID, holiday_year_start DATE)
RETURNS UUID AS $$
DECLARE
    app_namespace_uuid UUID := '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    seed_value TEXT;
BEGIN
    -- Combine staff_id and holiday_year_start as seed
    seed_value := 'holiday_entitlement:' ||
                  COALESCE(staff_id::TEXT, '') || ':' ||
                  COALESCE(holiday_year_start::TEXT, '');
    
    RETURN generate_uuid_v5(app_namespace_uuid, seed_value);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION uuid_holiday_entitlement IS 'Generates deterministic UUID for holiday_entitlements table based on staff_id and holiday_year_start.';

-- =====================================================
-- 5. VERIFICATION AND TESTING
-- =====================================================

-- Test function to verify UUID determinism
-- This function can be called to verify that the same input
-- always produces the same UUID
CREATE OR REPLACE FUNCTION test_uuid_determinism()
RETURNS TABLE(
    function_name TEXT,
    test_input TEXT,
    uuid_result UUID,
    is_deterministic BOOLEAN
) AS $$
DECLARE
    test_uuid1 UUID;
    test_uuid2 UUID;
    test_uuid3 UUID;
BEGIN
    -- Test uuid_human_resource
    test_uuid1 := uuid_human_resource('Test Staff');
    test_uuid2 := uuid_human_resource('Test Staff');
    test_uuid3 := uuid_human_resource('Test Staff');
    
    function_name := 'uuid_human_resource';
    test_input := 'Test Staff';
    uuid_result := test_uuid1;
    is_deterministic := (test_uuid1 = test_uuid2 AND test_uuid2 = test_uuid3);
    RETURN NEXT;
    
    -- Test uuid_period
    test_uuid1 := uuid_period('Period 01 2025', '2025-04-06'::DATE);
    test_uuid2 := uuid_period('Period 01 2025', '2025-04-06'::DATE);
    test_uuid3 := uuid_period('Period 01 2025', '2025-04-06'::DATE);
    
    function_name := 'uuid_period';
    test_input := 'Period 01 2025, 2025-04-06';
    uuid_result := test_uuid1;
    is_deterministic := (test_uuid1 = test_uuid2 AND test_uuid2 = test_uuid3);
    RETURN NEXT;
    
    -- Test uuid_setting
    test_uuid1 := uuid_setting('Flat rate for SSP per week');
    test_uuid2 := uuid_setting('Flat rate for SSP per week');
    test_uuid3 := uuid_setting('Flat rate for SSP per week');
    
    function_name := 'uuid_setting';
    test_input := 'Flat rate for SSP per week';
    uuid_result := test_uuid1;
    is_deterministic := (test_uuid1 = test_uuid2 AND test_uuid2 = test_uuid3);
    RETURN NEXT;
    
    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION test_uuid_determinism IS 'Test function to verify that UUID generation functions are deterministic (same input = same output).';

-- =====================================================
-- 6. MIGRATION COMPLETION
-- =====================================================

-- Log migration completion
DO $$
BEGIN
    RAISE NOTICE '✅ Migration 001: Deterministic UUID functions created successfully!';
    RAISE NOTICE '   - Core UUID v5 generation function created';
    RAISE NOTICE '   - Application namespace UUID: 6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    RAISE NOTICE '   - 7 table-specific UUID functions created';
    RAISE NOTICE '   - Test function available: test_uuid_determinism()';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '  1. Run: SELECT * FROM test_uuid_determinism(); to verify functions';
    RAISE NOTICE '  2. Proceed with migration 002 to migrate existing data';
END $$;
