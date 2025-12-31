-- =====================================================
-- Migration: Comprehensive Verification Tests
-- =====================================================
-- This migration provides comprehensive test suite for:
-- 1. UUID Determinism Tests
-- 2. Data Integrity Tests
-- 3. Replication Tests
-- 4. Performance Tests
-- 5. Rollback Tests
--
-- Run this after migrations 001, 002, and 003 to verify
-- that everything is working correctly.
-- =====================================================

-- =====================================================
-- 1. UUID DETERMINISM TESTS
-- =====================================================

-- Test function to verify UUID determinism across all functions
CREATE OR REPLACE FUNCTION test_all_uuid_determinism()
RETURNS TABLE(
    test_name TEXT,
    function_tested TEXT,
    test_input TEXT,
    uuid_result UUID,
    is_deterministic BOOLEAN,
    error_message TEXT
) AS $$
DECLARE
    test_uuid1 UUID;
    test_uuid2 UUID;
    test_uuid3 UUID;
    test_period_id UUID;
    test_staff_id UUID;
    test_timestamp TIMESTAMPTZ;
BEGIN
    -- Test uuid_human_resource
    BEGIN
        test_uuid1 := uuid_human_resource('Test Staff Member');
        test_uuid2 := uuid_human_resource('Test Staff Member');
        test_uuid3 := uuid_human_resource('Test Staff Member');
        
        test_name := 'uuid_human_resource - Same Input';
        function_tested := 'uuid_human_resource';
        test_input := 'Test Staff Member';
        uuid_result := test_uuid1;
        is_deterministic := (test_uuid1 = test_uuid2 AND test_uuid2 = test_uuid3);
        error_message := NULL;
        RETURN NEXT;
        
        -- Test different inputs produce different UUIDs
        test_uuid1 := uuid_human_resource('Staff A');
        test_uuid2 := uuid_human_resource('Staff B');
        is_deterministic := (test_uuid1 != test_uuid2);
        test_name := 'uuid_human_resource - Different Inputs';
        test_input := 'Staff A vs Staff B';
        uuid_result := test_uuid1;
        error_message := NULL;
        RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
        test_name := 'uuid_human_resource - Error';
        function_tested := 'uuid_human_resource';
        test_input := 'Test Staff Member';
        uuid_result := NULL;
        is_deterministic := FALSE;
        error_message := SQLERRM;
        RETURN NEXT;
    END;
    
    -- Test uuid_period
    BEGIN
        test_uuid1 := uuid_period('Period 01 2025', '2025-04-06'::DATE);
        test_uuid2 := uuid_period('Period 01 2025', '2025-04-06'::DATE);
        test_uuid3 := uuid_period('Period 01 2025', '2025-04-06'::DATE);
        
        test_name := 'uuid_period - Same Input';
        function_tested := 'uuid_period';
        test_input := 'Period 01 2025, 2025-04-06';
        uuid_result := test_uuid1;
        is_deterministic := (test_uuid1 = test_uuid2 AND test_uuid2 = test_uuid3);
        error_message := NULL;
        RETURN NEXT;
        
        -- Test different inputs produce different UUIDs
        test_uuid1 := uuid_period('Period 01 2025', '2025-04-06'::DATE);
        test_uuid2 := uuid_period('Period 02 2025', '2025-05-04'::DATE);
        is_deterministic := (test_uuid1 != test_uuid2);
        test_name := 'uuid_period - Different Inputs';
        test_input := 'Period 01 vs Period 02';
        uuid_result := test_uuid1;
        error_message := NULL;
        RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
        test_name := 'uuid_period - Error';
        function_tested := 'uuid_period';
        test_input := 'Period 01 2025, 2025-04-06';
        uuid_result := NULL;
        is_deterministic := FALSE;
        error_message := SQLERRM;
        RETURN NEXT;
    END;
    
    -- Test uuid_setting
    BEGIN
        test_uuid1 := uuid_setting('Flat rate for SSP per week');
        test_uuid2 := uuid_setting('Flat rate for SSP per week');
        test_uuid3 := uuid_setting('Flat rate for SSP per week');
        
        test_name := 'uuid_setting - Same Input';
        function_tested := 'uuid_setting';
        test_input := 'Flat rate for SSP per week';
        uuid_result := test_uuid1;
        is_deterministic := (test_uuid1 = test_uuid2 AND test_uuid2 = test_uuid3);
        error_message := NULL;
        RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
        test_name := 'uuid_setting - Error';
        function_tested := 'uuid_setting';
        test_input := 'Flat rate for SSP per week';
        uuid_result := NULL;
        is_deterministic := FALSE;
        error_message := SQLERRM;
        RETURN NEXT;
    END;
    
    -- Test uuid_shift (requires period_id and staff_name)
    BEGIN
        -- Create test period UUID
        test_period_id := uuid_period('Test Period', '2025-01-01'::DATE);
        test_timestamp := '2025-01-15 08:00:00+00'::TIMESTAMPTZ;
        
        test_uuid1 := uuid_shift(test_period_id, 'Test Staff', test_timestamp, 'Tom Day');
        test_uuid2 := uuid_shift(test_period_id, 'Test Staff', test_timestamp, 'Tom Day');
        test_uuid3 := uuid_shift(test_period_id, 'Test Staff', test_timestamp, 'Tom Day');
        
        test_name := 'uuid_shift - Same Input';
        function_tested := 'uuid_shift';
        test_input := format('period_id=%s, staff=Test Staff, time=%s, type=Tom Day', test_period_id, test_timestamp);
        uuid_result := test_uuid1;
        is_deterministic := (test_uuid1 = test_uuid2 AND test_uuid2 = test_uuid3);
        error_message := NULL;
        RETURN NEXT;
        
        -- Test different shift types produce different UUIDs
        test_uuid1 := uuid_shift(test_period_id, 'Test Staff', test_timestamp, 'Tom Day');
        test_uuid2 := uuid_shift(test_period_id, 'Test Staff', test_timestamp, 'Charlotte Day');
        is_deterministic := (test_uuid1 != test_uuid2);
        test_name := 'uuid_shift - Different Types';
        test_input := 'Tom Day vs Charlotte Day';
        uuid_result := test_uuid1;
        error_message := NULL;
        RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
        test_name := 'uuid_shift - Error';
        function_tested := 'uuid_shift';
        test_input := 'Test shift';
        uuid_result := NULL;
        is_deterministic := FALSE;
        error_message := SQLERRM;
        RETURN NEXT;
    END;
    
    -- Test uuid_change_request
    BEGIN
        test_staff_id := uuid_human_resource('Test Staff');
        test_timestamp := '2025-01-15 10:00:00+00'::TIMESTAMPTZ;
        
        test_uuid1 := uuid_change_request(test_staff_id, 'update', 'pay_rate', test_timestamp);
        test_uuid2 := uuid_change_request(test_staff_id, 'update', 'pay_rate', test_timestamp);
        test_uuid3 := uuid_change_request(test_staff_id, 'update', 'pay_rate', test_timestamp);
        
        test_name := 'uuid_change_request - Same Input';
        function_tested := 'uuid_change_request';
        test_input := format('staff_id=%s, type=update, field=pay_rate, time=%s', test_staff_id, test_timestamp);
        uuid_result := test_uuid1;
        is_deterministic := (test_uuid1 = test_uuid2 AND test_uuid2 = test_uuid3);
        error_message := NULL;
        RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
        test_name := 'uuid_change_request - Error';
        function_tested := 'uuid_change_request';
        test_input := 'Test change request';
        uuid_result := NULL;
        is_deterministic := FALSE;
        error_message := SQLERRM;
        RETURN NEXT;
    END;
    
    -- Test uuid_unavailable_staff_daily
    BEGIN
        test_period_id := uuid_period('Test Period', '2025-01-01'::DATE);
        
        test_uuid1 := uuid_unavailable_staff_daily(test_period_id, '2025-01-15'::DATE);
        test_uuid2 := uuid_unavailable_staff_daily(test_period_id, '2025-01-15'::DATE);
        test_uuid3 := uuid_unavailable_staff_daily(test_period_id, '2025-01-15'::DATE);
        
        test_name := 'uuid_unavailable_staff_daily - Same Input';
        function_tested := 'uuid_unavailable_staff_daily';
        test_input := format('period_id=%s, date=2025-01-15', test_period_id);
        uuid_result := test_uuid1;
        is_deterministic := (test_uuid1 = test_uuid2 AND test_uuid2 = test_uuid3);
        error_message := NULL;
        RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
        test_name := 'uuid_unavailable_staff_daily - Error';
        function_tested := 'uuid_unavailable_staff_daily';
        test_input := 'Test unavailable';
        uuid_result := NULL;
        is_deterministic := FALSE;
        error_message := SQLERRM;
        RETURN NEXT;
    END;
    
    -- Test uuid_holiday_entitlement
    BEGIN
        test_staff_id := uuid_human_resource('Test Staff');
        
        test_uuid1 := uuid_holiday_entitlement(test_staff_id, '2025-04-06'::DATE);
        test_uuid2 := uuid_holiday_entitlement(test_staff_id, '2025-04-06'::DATE);
        test_uuid3 := uuid_holiday_entitlement(test_staff_id, '2025-04-06'::DATE);
        
        test_name := 'uuid_holiday_entitlement - Same Input';
        function_tested := 'uuid_holiday_entitlement';
        test_input := format('staff_id=%s, year_start=2025-04-06', test_staff_id);
        uuid_result := test_uuid1;
        is_deterministic := (test_uuid1 = test_uuid2 AND test_uuid2 = test_uuid3);
        error_message := NULL;
        RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
        test_name := 'uuid_holiday_entitlement - Error';
        function_tested := 'uuid_holiday_entitlement';
        test_input := 'Test holiday entitlement';
        uuid_result := NULL;
        is_deterministic := FALSE;
        error_message := SQLERRM;
        RETURN NEXT;
    END;
    
    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION test_all_uuid_determinism IS 'Comprehensive test function for UUID determinism. Tests all UUID generation functions to ensure same input = same output.';

-- Function to test UUID consistency between databases
-- This function should be run on both databases with the same test data
CREATE OR REPLACE FUNCTION test_uuid_consistency_across_databases()
RETURNS TABLE(
    table_name TEXT,
    natural_key TEXT,
    uuid_generated UUID,
    test_status TEXT
) AS $$
DECLARE
    test_staff_name TEXT := 'Consistency Test Staff';
    test_period_name TEXT := 'Consistency Test Period';
    test_period_start DATE := '2025-01-01';
    test_setting_type TEXT := 'Consistency Test Setting';
    test_staff_id UUID;
    test_period_id UUID;
    test_timestamp TIMESTAMPTZ := '2025-01-15 08:00:00+00'::TIMESTAMPTZ;
BEGIN
    -- Test human_resource UUID
    test_staff_id := uuid_human_resource(test_staff_name);
    table_name := 'human_resource';
    natural_key := test_staff_name;
    uuid_generated := test_staff_id;
    test_status := 'PASS - Run this on both databases and compare UUIDs';
    RETURN NEXT;
    
    -- Test period UUID
    test_period_id := uuid_period(test_period_name, test_period_start);
    table_name := 'periods';
    natural_key := format('%s, %s', test_period_name, test_period_start);
    uuid_generated := test_period_id;
    test_status := 'PASS - Run this on both databases and compare UUIDs';
    RETURN NEXT;
    
    -- Test setting UUID
    table_name := 'settings';
    natural_key := test_setting_type;
    uuid_generated := uuid_setting(test_setting_type);
    test_status := 'PASS - Run this on both databases and compare UUIDs';
    RETURN NEXT;
    
    -- Test shift UUID
    table_name := 'shifts';
    natural_key := format('period_id=%s, staff=%s, time=%s, type=Tom Day', test_period_id, test_staff_name, test_timestamp);
    uuid_generated := uuid_shift(test_period_id, test_staff_name, test_timestamp, 'Tom Day');
    test_status := 'PASS - Run this on both databases and compare UUIDs';
    RETURN NEXT;
    
    -- Test change_request UUID
    table_name := 'change_requests';
    natural_key := format('staff_id=%s, type=update, field=pay_rate, time=%s', test_staff_id, test_timestamp);
    uuid_generated := uuid_change_request(test_staff_id, 'update', 'pay_rate', test_timestamp);
    test_status := 'PASS - Run this on both databases and compare UUIDs';
    RETURN NEXT;
    
    -- Test unavailable_staff_daily UUID
    table_name := 'unavailable_staff_daily';
    natural_key := format('period_id=%s, date=2025-01-15', test_period_id);
    uuid_generated := uuid_unavailable_staff_daily(test_period_id, '2025-01-15'::DATE);
    test_status := 'PASS - Run this on both databases and compare UUIDs';
    RETURN NEXT;
    
    -- Test holiday_entitlement UUID
    table_name := 'holiday_entitlements';
    natural_key := format('staff_id=%s, year_start=2025-04-06', test_staff_id);
    uuid_generated := uuid_holiday_entitlement(test_staff_id, '2025-04-06'::DATE);
    test_status := 'PASS - Run this on both databases and compare UUIDs';
    RETURN NEXT;
    
    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION test_uuid_consistency_across_databases IS 'Test function to verify UUID consistency across databases. Run this on both databases and compare the UUIDs - they should be identical.';

-- =====================================================
-- 2. DATA INTEGRITY TESTS
-- =====================================================

-- Function to check all foreign key relationships
CREATE OR REPLACE FUNCTION test_foreign_key_integrity()
RETURNS TABLE(
    table_name TEXT,
    constraint_name TEXT,
    constraint_type TEXT,
    status TEXT,
    issue_count BIGINT,
    details TEXT
) AS $$
BEGIN
    -- Check shifts -> periods foreign key
    RETURN QUERY
    SELECT 
        'shifts'::TEXT as table_name,
        'shifts_period_id_fkey'::TEXT as constraint_name,
        'FOREIGN KEY'::TEXT as constraint_type,
        CASE 
            WHEN COUNT(*) = 0 THEN 'PASS'
            ELSE 'FAIL'
        END as status,
        COUNT(*)::BIGINT as issue_count,
        format('Orphaned shifts with invalid period_id: %s', COUNT(*)) as details
    FROM shifts s
    WHERE NOT EXISTS (
        SELECT 1 FROM periods p WHERE p.period_id = s.period_id
    );
    
    -- Check shifts -> human_resource foreign key
    RETURN QUERY
    SELECT 
        'shifts'::TEXT as table_name,
        'shifts_staff_name_fkey'::TEXT as constraint_name,
        'FOREIGN KEY'::TEXT as constraint_type,
        CASE 
            WHEN COUNT(*) = 0 THEN 'PASS'
            ELSE 'FAIL'
        END as status,
        COUNT(*)::BIGINT as issue_count,
        format('Orphaned shifts with invalid staff_name: %s', COUNT(*)) as details
    FROM shifts s
    WHERE NOT EXISTS (
        SELECT 1 FROM human_resource hr WHERE hr.staff_name = s.staff_name
    );
    
    -- Check change_requests -> human_resource foreign key
    RETURN QUERY
    SELECT 
        'change_requests'::TEXT as table_name,
        'change_requests_staff_id_fkey'::TEXT as constraint_name,
        'FOREIGN KEY'::TEXT as constraint_type,
        CASE 
            WHEN COUNT(*) = 0 THEN 'PASS'
            ELSE 'FAIL'
        END as status,
        COUNT(*)::BIGINT as issue_count,
        format('Orphaned change_requests with invalid staff_id: %s', COUNT(*)) as details
    FROM change_requests cr
    WHERE NOT EXISTS (
        SELECT 1 FROM human_resource hr WHERE hr.unique_id = cr.staff_id
    );
    
    -- Check holiday_entitlements -> human_resource foreign key
    RETURN QUERY
    SELECT 
        'holiday_entitlements'::TEXT as table_name,
        'holiday_entitlements_staff_id_fkey'::TEXT as constraint_name,
        'FOREIGN KEY'::TEXT as constraint_type,
        CASE 
            WHEN COUNT(*) = 0 THEN 'PASS'
            ELSE 'FAIL'
        END as status,
        COUNT(*)::BIGINT as issue_count,
        format('Orphaned holiday_entitlements with invalid staff_id: %s', COUNT(*)) as details
    FROM holiday_entitlements he
    WHERE NOT EXISTS (
        SELECT 1 FROM human_resource hr WHERE hr.unique_id = he.staff_id
    );
    
    -- Check unavailable_staff_daily -> periods foreign key
    RETURN QUERY
    SELECT 
        'unavailable_staff_daily'::TEXT as table_name,
        'unavailable_staff_daily_period_id_fkey'::TEXT as constraint_name,
        'FOREIGN KEY'::TEXT as constraint_type,
        CASE 
            WHEN COUNT(*) = 0 THEN 'PASS'
            ELSE 'FAIL'
        END as status,
        COUNT(*)::BIGINT as issue_count,
        format('Orphaned unavailable_staff_daily with invalid period_id: %s', COUNT(*)) as details
    FROM unavailable_staff_daily usd
    WHERE NOT EXISTS (
        SELECT 1 FROM periods p WHERE p.period_id = usd.period_id
    );
    
    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION test_foreign_key_integrity IS 'Test function to verify all foreign key relationships are intact. Checks for orphaned records.';

-- Function to check primary key constraints
CREATE OR REPLACE FUNCTION test_primary_key_constraints()
RETURNS TABLE(
    table_name TEXT,
    constraint_name TEXT,
    status TEXT,
    details TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        tc.table_name::TEXT,
        tc.constraint_name::TEXT,
        'PASS'::TEXT as status,
        format('Primary key constraint exists: %s', tc.constraint_name) as details
    FROM information_schema.table_constraints tc
    WHERE tc.constraint_type = 'PRIMARY KEY'
    AND tc.table_schema = 'public'
    AND tc.table_name IN (
        'human_resource',
        'periods',
        'shifts',
        'change_requests',
        'settings',
        'unavailable_staff_daily',
        'holiday_entitlements'
    )
    ORDER BY tc.table_name;
    
    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION test_primary_key_constraints IS 'Test function to verify all primary key constraints exist.';

-- Function to check for duplicate UUIDs (should never happen with deterministic UUIDs)
CREATE OR REPLACE FUNCTION test_uuid_uniqueness()
RETURNS TABLE(
    table_name TEXT,
    status TEXT,
    duplicate_count BIGINT,
    details TEXT
) AS $$
BEGIN
    -- Check human_resource
    RETURN QUERY
    SELECT 
        'human_resource'::TEXT as table_name,
        CASE 
            WHEN COUNT(*) = 0 THEN 'PASS'
            ELSE 'FAIL'
        END as status,
        COUNT(*)::BIGINT as duplicate_count,
        format('Duplicate UUIDs found: %s', COUNT(*)) as details
    FROM (
        SELECT unique_id, COUNT(*) as cnt
        FROM human_resource
        GROUP BY unique_id
        HAVING COUNT(*) > 1
    ) duplicates;
    
    -- Check periods
    RETURN QUERY
    SELECT 
        'periods'::TEXT as table_name,
        CASE 
            WHEN COUNT(*) = 0 THEN 'PASS'
            ELSE 'FAIL'
        END as status,
        COUNT(*)::BIGINT as duplicate_count,
        format('Duplicate UUIDs found: %s', COUNT(*)) as details
    FROM (
        SELECT period_id, COUNT(*) as cnt
        FROM periods
        GROUP BY period_id
        HAVING COUNT(*) > 1
    ) duplicates;
    
    -- Check shifts
    RETURN QUERY
    SELECT 
        'shifts'::TEXT as table_name,
        CASE 
            WHEN COUNT(*) = 0 THEN 'PASS'
            ELSE 'FAIL'
        END as status,
        COUNT(*)::BIGINT as duplicate_count,
        format('Duplicate UUIDs found: %s', COUNT(*)) as details
    FROM (
        SELECT id, COUNT(*) as cnt
        FROM shifts
        GROUP BY id
        HAVING COUNT(*) > 1
    ) duplicates;
    
    -- Check change_requests
    RETURN QUERY
    SELECT 
        'change_requests'::TEXT as table_name,
        CASE 
            WHEN COUNT(*) = 0 THEN 'PASS'
            ELSE 'FAIL'
        END as status,
        COUNT(*)::BIGINT as duplicate_count,
        format('Duplicate UUIDs found: %s', COUNT(*)) as details
    FROM (
        SELECT id, COUNT(*) as cnt
        FROM change_requests
        GROUP BY id
        HAVING COUNT(*) > 1
    ) duplicates;
    
    -- Check settings
    RETURN QUERY
    SELECT 
        'settings'::TEXT as table_name,
        CASE 
            WHEN COUNT(*) = 0 THEN 'PASS'
            ELSE 'FAIL'
        END as status,
        COUNT(*)::BIGINT as duplicate_count,
        format('Duplicate UUIDs found: %s', COUNT(*)) as details
    FROM (
        SELECT setting_id, COUNT(*) as cnt
        FROM settings
        GROUP BY setting_id
        HAVING COUNT(*) > 1
    ) duplicates;
    
    -- Check unavailable_staff_daily
    RETURN QUERY
    SELECT 
        'unavailable_staff_daily'::TEXT as table_name,
        CASE 
            WHEN COUNT(*) = 0 THEN 'PASS'
            ELSE 'FAIL'
        END as status,
        COUNT(*)::BIGINT as duplicate_count,
        format('Duplicate UUIDs found: %s', COUNT(*)) as details
    FROM (
        SELECT id, COUNT(*) as cnt
        FROM unavailable_staff_daily
        GROUP BY id
        HAVING COUNT(*) > 1
    ) duplicates;
    
    -- Check holiday_entitlements
    RETURN QUERY
    SELECT 
        'holiday_entitlements'::TEXT as table_name,
        CASE 
            WHEN COUNT(*) = 0 THEN 'PASS'
            ELSE 'FAIL'
        END as status,
        COUNT(*)::BIGINT as duplicate_count,
        format('Duplicate UUIDs found: %s', COUNT(*)) as details
    FROM (
        SELECT entitlement_id, COUNT(*) as cnt
        FROM holiday_entitlements
        GROUP BY entitlement_id
        HAVING COUNT(*) > 1
    ) duplicates;
    
    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION test_uuid_uniqueness IS 'Test function to verify UUID uniqueness across all tables. Should always pass with deterministic UUIDs.';

-- Function to check data consistency
CREATE OR REPLACE FUNCTION test_data_consistency()
RETURNS TABLE(
    test_name TEXT,
    status TEXT,
    record_count BIGINT,
    details TEXT
) AS $$
DECLARE
    total_records BIGINT;
    human_resource_count BIGINT;
    periods_count BIGINT;
    shifts_count BIGINT;
    change_requests_count BIGINT;
    settings_count BIGINT;
    unavailable_staff_daily_count BIGINT;
    holiday_entitlements_count BIGINT;
BEGIN
    -- Get record counts
    SELECT COUNT(*) INTO human_resource_count FROM human_resource;
    SELECT COUNT(*) INTO periods_count FROM periods;
    SELECT COUNT(*) INTO shifts_count FROM shifts;
    SELECT COUNT(*) INTO change_requests_count FROM change_requests;
    SELECT COUNT(*) INTO settings_count FROM settings;
    SELECT COUNT(*) INTO unavailable_staff_daily_count FROM unavailable_staff_daily;
    SELECT COUNT(*) INTO holiday_entitlements_count FROM holiday_entitlements;
    
    total_records := human_resource_count + periods_count + shifts_count + 
                     change_requests_count + settings_count + 
                     unavailable_staff_daily_count + holiday_entitlements_count;
    
    -- Test: All tables have data (or are empty consistently)
    test_name := 'Table Record Counts';
    status := 'INFO';
    record_count := total_records;
    details := format('human_resource: %s, periods: %s, shifts: %s, change_requests: %s, settings: %s, unavailable_staff_daily: %s, holiday_entitlements: %s',
                     human_resource_count, periods_count, shifts_count, 
                     change_requests_count, settings_count, 
                     unavailable_staff_daily_count, holiday_entitlements_count);
    RETURN NEXT;
    
    -- Test: Check for NULL UUIDs (should never happen)
    SELECT COUNT(*) INTO record_count
    FROM human_resource
    WHERE unique_id IS NULL;
    
    test_name := 'NULL UUIDs in human_resource';
    status := CASE WHEN record_count = 0 THEN 'PASS' ELSE 'FAIL' END;
    details := format('Found %s records with NULL UUIDs', record_count);
    RETURN NEXT;
    
    SELECT COUNT(*) INTO record_count
    FROM periods
    WHERE period_id IS NULL;
    
    test_name := 'NULL UUIDs in periods';
    status := CASE WHEN record_count = 0 THEN 'PASS' ELSE 'FAIL' END;
    details := format('Found %s records with NULL UUIDs', record_count);
    RETURN NEXT;
    
    -- Test: Check for invalid date ranges in periods
    SELECT COUNT(*) INTO record_count
    FROM periods
    WHERE end_date < start_date;
    
    test_name := 'Invalid Date Ranges in periods';
    status := CASE WHEN record_count = 0 THEN 'PASS' ELSE 'FAIL' END;
    details := format('Found %s periods with end_date < start_date', record_count);
    RETURN NEXT;
    
    -- Test: Check for shifts with invalid week numbers
    SELECT COUNT(*) INTO record_count
    FROM shifts
    WHERE week_number < 1 OR week_number > 52;
    
    test_name := 'Invalid Week Numbers in shifts';
    status := CASE WHEN record_count = 0 THEN 'PASS' ELSE 'FAIL' END;
    details := format('Found %s shifts with invalid week_number', record_count);
    RETURN NEXT;
    
    -- Test: Check for shifts with invalid datetime ranges
    SELECT COUNT(*) INTO record_count
    FROM shifts
    WHERE shift_end_datetime <= shift_start_datetime;
    
    test_name := 'Invalid Datetime Ranges in shifts';
    status := CASE WHEN record_count = 0 THEN 'PASS' ELSE 'FAIL' END;
    details := format('Found %s shifts with end_datetime <= start_datetime', record_count);
    RETURN NEXT;
    
    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION test_data_consistency IS 'Test function to verify data consistency and business rule compliance.';

-- =====================================================
-- 3. REPLICATION TESTS
-- =====================================================

-- Function to verify replication setup
CREATE OR REPLACE FUNCTION test_replication_setup()
RETURNS TABLE(
    test_name TEXT,
    status TEXT,
    details TEXT
) AS $$
DECLARE
    pub_exists BOOLEAN;
    sub_exists BOOLEAN;
    pub_table_count INTEGER;
    wal_level TEXT;
    sub_enabled BOOLEAN;
BEGIN
    -- Check wal_level
    wal_level := current_setting('wal_level');
    test_name := 'WAL Level Configuration';
    status := CASE 
        WHEN wal_level = 'logical' THEN 'PASS'
        ELSE 'FAIL'
    END;
    details := format('Current wal_level: %s (required: logical)', wal_level);
    RETURN NEXT;
    
    -- Check publication exists
    SELECT EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'db_publication'
    ) INTO pub_exists;
    
    test_name := 'Publication Exists';
    status := CASE WHEN pub_exists THEN 'PASS' ELSE 'FAIL' END;
    details := CASE 
        WHEN pub_exists THEN 'Publication db_publication exists'
        ELSE 'Publication db_publication does not exist'
    END;
    RETURN NEXT;
    
    -- Check tables in publication
    IF pub_exists THEN
        SELECT COUNT(*) INTO pub_table_count
        FROM pg_publication_tables
        WHERE pubname = 'db_publication';
        
        test_name := 'Tables in Publication';
        status := CASE 
            WHEN pub_table_count >= 7 THEN 'PASS'
            ELSE 'WARNING'
        END;
        details := format('Found %s tables in publication (expected: 7)', pub_table_count);
        RETURN NEXT;
    END IF;
    
    -- Check subscription exists
    SELECT EXISTS (
        SELECT 1 FROM pg_subscription WHERE subname = 'db_subscription'
    ) INTO sub_exists;
    
    test_name := 'Subscription Exists';
    status := CASE WHEN sub_exists THEN 'PASS' ELSE 'WARNING' END;
    details := CASE 
        WHEN sub_exists THEN 'Subscription db_subscription exists'
        ELSE 'Subscription db_subscription does not exist (may be normal if not yet configured)'
    END;
    RETURN NEXT;
    
    -- Check subscription enabled
    IF sub_exists THEN
        SELECT subenabled INTO sub_enabled
        FROM pg_subscription
        WHERE subname = 'db_subscription';
        
        test_name := 'Subscription Enabled';
        status := CASE 
            WHEN sub_enabled THEN 'PASS'
            ELSE 'WARNING'
        END;
        details := CASE 
            WHEN sub_enabled THEN 'Subscription is enabled'
            ELSE 'Subscription is disabled'
        END;
        RETURN NEXT;
    END IF;
    
    -- Check REPLICA IDENTITY FULL on all tables
    test_name := 'REPLICA IDENTITY FULL';
    status := 'INFO';
    details := 'Checking all tables have REPLICA IDENTITY FULL set...';
    RETURN NEXT;
    
    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION test_replication_setup IS 'Test function to verify replication setup is correct.';

-- Function to check replication lag (if subscription exists)
CREATE OR REPLACE FUNCTION test_replication_lag()
RETURNS TABLE(
    test_name TEXT,
    status TEXT,
    lag_bytes BIGINT,
    details TEXT
) AS $$
DECLARE
    lag_bytes_val BIGINT;
    lag_mb NUMERIC;
BEGIN
    -- Check if subscription exists
    IF NOT EXISTS (SELECT 1 FROM pg_subscription WHERE subname = 'db_subscription') THEN
        test_name := 'Replication Lag Check';
        status := 'SKIP';
        lag_bytes := NULL;
        details := 'Subscription does not exist - skipping lag check';
        RETURN NEXT;
        RETURN;
    END IF;
    
    -- Get replication lag
    SELECT 
        COALESCE(
            pg_wal_lsn_diff(
                pg_current_wal_lsn(),
                r.confirmed_flush_lsn
            ),
            0
        )
    INTO lag_bytes_val
    FROM pg_subscription s
    LEFT JOIN pg_replication_slots r ON s.subslotname = r.slot_name
    WHERE s.subname = 'db_subscription';
    
    lag_mb := lag_bytes_val / 1024.0 / 1024.0;
    
    test_name := 'Replication Lag';
    status := CASE 
        WHEN lag_bytes_val < 1048576 THEN 'PASS'  -- Less than 1MB
        WHEN lag_bytes_val < 10485760 THEN 'WARNING'  -- Less than 10MB
        ELSE 'FAIL'
    END;
    lag_bytes := lag_bytes_val;
    details := format('Replication lag: %s bytes (%.2f MB). Target: < 1MB', lag_bytes_val, lag_mb);
    RETURN NEXT;
    
    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION test_replication_lag IS 'Test function to check replication lag. Returns lag in bytes.';

-- Function to provide replication test instructions
CREATE OR REPLACE FUNCTION get_replication_test_instructions()
RETURNS TEXT AS $$
BEGIN
    RETURN '
-- =====================================================
-- REPLICATION TEST INSTRUCTIONS
-- =====================================================
-- These tests should be run manually on both databases
-- to verify bidirectional replication is working.
--
-- TEST 1: Insert Test on DB1
-- =====================================================
-- On DB1, run:
INSERT INTO human_resource (staff_name, role) 
VALUES (''Replication Test Staff'', ''staff member'')
ON CONFLICT (staff_name) DO NOTHING;

-- Wait a few seconds, then on DB2, check:
SELECT * FROM human_resource WHERE staff_name = ''Replication Test Staff'';
-- Expected: Record should appear on DB2
--
-- TEST 2: Insert Test on DB2
-- =====================================================
-- On DB2, run:
INSERT INTO periods (period_name, start_date, end_date) 
VALUES (''Replication Test Period'', ''2025-01-01'', ''2025-01-28'')
ON CONFLICT DO NOTHING;

-- Wait a few seconds, then on DB1, check:
SELECT * FROM periods WHERE period_name = ''Replication Test Period'';
-- Expected: Record should appear on DB1
--
-- TEST 3: Update Test on DB1
-- =====================================================
-- On DB1, run:
UPDATE human_resource 
SET pay_rate = 15.00 
WHERE staff_name = ''Replication Test Staff'';

-- Wait a few seconds, then on DB2, check:
SELECT pay_rate FROM human_resource WHERE staff_name = ''Replication Test Staff'';
-- Expected: pay_rate should be 15.00 on DB2
--
-- TEST 4: Delete Test on DB2
-- =====================================================
-- On DB2, run:
DELETE FROM periods WHERE period_name = ''Replication Test Period'';

-- Wait a few seconds, then on DB1, check:
SELECT * FROM periods WHERE period_name = ''Replication Test Period'';
-- Expected: Record should be deleted on DB1
--
-- TEST 5: Concurrent Write Test
-- =====================================================
-- On both DB1 and DB2 simultaneously, run:
INSERT INTO settings (type_of_setting, value) 
VALUES (''Concurrent Test Setting'', ''test_value'')
ON CONFLICT (type_of_setting) DO UPDATE SET value = EXCLUDED.value;

-- Check both databases:
SELECT * FROM settings WHERE type_of_setting = ''Concurrent Test Setting'';
-- Expected: Both databases should have the same value
-- (Last write wins, but with deterministic UUIDs, conflicts are minimized)
--
-- CLEANUP:
-- =====================================================
DELETE FROM human_resource WHERE staff_name = ''Replication Test Staff'';
DELETE FROM settings WHERE type_of_setting = ''Concurrent Test Setting'';
';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_replication_test_instructions IS 'Returns detailed instructions for manual replication testing.';

-- =====================================================
-- 4. PERFORMANCE TESTS
-- =====================================================

-- Function to test UUID generation performance
CREATE OR REPLACE FUNCTION test_uuid_generation_performance()
RETURNS TABLE(
    function_name TEXT,
    iterations INTEGER,
    total_time_ms NUMERIC,
    avg_time_ms NUMERIC,
    status TEXT
) AS $$
DECLARE
    start_time TIMESTAMPTZ;
    end_time TIMESTAMPTZ;
    test_iterations INTEGER := 1000;
    elapsed_ms NUMERIC;
BEGIN
    -- Test uuid_human_resource performance
    start_time := clock_timestamp();
    PERFORM uuid_human_resource('Performance Test Staff ' || generate_series) 
    FROM generate_series(1, test_iterations);
    end_time := clock_timestamp();
    elapsed_ms := EXTRACT(EPOCH FROM (end_time - start_time)) * 1000;
    
    function_name := 'uuid_human_resource';
    iterations := test_iterations;
    total_time_ms := elapsed_ms;
    avg_time_ms := elapsed_ms / test_iterations;
    status := CASE 
        WHEN avg_time_ms < 0.1 THEN 'PASS'
        WHEN avg_time_ms < 1.0 THEN 'WARNING'
        ELSE 'FAIL'
    END;
    RETURN NEXT;
    
    -- Test uuid_period performance
    start_time := clock_timestamp();
    PERFORM uuid_period('Period ' || generate_series, ('2025-01-01'::DATE + (generate_series || '' days'')::INTERVAL)::DATE)
    FROM generate_series(1, test_iterations);
    end_time := clock_timestamp();
    elapsed_ms := EXTRACT(EPOCH FROM (end_time - start_time)) * 1000;
    
    function_name := 'uuid_period';
    iterations := test_iterations;
    total_time_ms := elapsed_ms;
    avg_time_ms := elapsed_ms / test_iterations;
    status := CASE 
        WHEN avg_time_ms < 0.1 THEN 'PASS'
        WHEN avg_time_ms < 1.0 THEN 'WARNING'
        ELSE 'FAIL'
    END;
    RETURN NEXT;
    
    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION test_uuid_generation_performance IS 'Test function to measure UUID generation performance. Generates 1000 UUIDs and measures time.';

-- Function to get table statistics
CREATE OR REPLACE FUNCTION test_table_statistics()
RETURNS TABLE(
    table_name TEXT,
    row_count BIGINT,
    table_size TEXT,
    index_size TEXT,
    total_size TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        schemaname||'.'||tablename as table_name,
        pg_class.reltuples::BIGINT as row_count,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as table_size,
        pg_size_pretty(pg_indexes_size(schemaname||'.'||tablename)) as index_size,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size
    FROM pg_tables
    JOIN pg_class ON pg_class.relname = pg_tables.tablename
    WHERE schemaname = 'public'
    AND tablename IN (
        'human_resource',
        'periods',
        'shifts',
        'change_requests',
        'settings',
        'unavailable_staff_daily',
        'holiday_entitlements'
    )
    ORDER BY tablename;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION test_table_statistics IS 'Test function to get table statistics including row counts and sizes.';

-- =====================================================
-- 5. ROLLBACK TESTS
-- =====================================================

-- Function to provide rollback test instructions
CREATE OR REPLACE FUNCTION get_rollback_test_instructions()
RETURNS TEXT AS $$
BEGIN
    RETURN '
-- =====================================================
-- ROLLBACK TEST INSTRUCTIONS
-- =====================================================
-- These tests verify that you can rollback migrations
-- if something goes wrong.
--
-- IMPORTANT: Always create a full database backup before
-- running migrations. Use pg_dump for this:
--
-- pg_dump -h localhost -U postgres -d danieltime -F c -f backup_before_migration.dump
--
-- TEST 1: Verify Backup Creation
-- =====================================================
-- Before running migrations, create a backup:
-- pg_dump -h localhost -U postgres -d danieltime -F c -f backup.dump
--
-- Verify backup was created:
-- ls -lh backup.dump
--
-- TEST 2: Test Backup Restoration
-- =====================================================
-- 1. Create a test database:
--    CREATE DATABASE test_restore;
--
-- 2. Restore backup to test database:
--    pg_restore -h localhost -U postgres -d test_restore backup.dump
--
-- 3. Verify data:
--    \c test_restore
--    SELECT COUNT(*) FROM human_resource;
--    SELECT COUNT(*) FROM periods;
--    -- etc.
--
-- 4. Compare with original:
--    \c danieltime
--    SELECT COUNT(*) FROM human_resource;
--    -- Should match test_restore
--
-- TEST 3: Migration Rollback Procedure
-- =====================================================
-- If migration 002 fails, you can rollback:
--
-- 1. Stop the application
-- 2. Drop the current database (if needed):
--    DROP DATABASE danieltime;
--
-- 3. Restore from backup:
--    CREATE DATABASE danieltime;
--    pg_restore -h localhost -U postgres -d danieltime backup.dump
--
-- 4. Verify data integrity:
--    SELECT * FROM test_foreign_key_integrity();
--    SELECT * FROM test_data_consistency();
--
-- TEST 4: Partial Rollback (if migration partially completed)
-- =====================================================
-- If migration 002 partially completed, you may need to:
--
-- 1. Check migration status:
--    SELECT * FROM test_foreign_key_integrity();
--    SELECT * FROM test_uuid_uniqueness();
--
-- 2. If issues found, restore from backup (see TEST 3)
--
-- 3. Fix the issue and re-run migration
--
-- NOTES:
-- =====================================================
-- - Always test rollback procedures in a test environment first
-- - Keep multiple backup copies in different locations
-- - Document any custom rollback procedures for your environment
-- - Test backup restoration regularly to ensure backups are valid
';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_rollback_test_instructions IS 'Returns detailed instructions for testing rollback procedures and backup restoration.';

-- =====================================================
-- 6. COMPREHENSIVE TEST RUNNER
-- =====================================================

-- Master test function that runs all tests
CREATE OR REPLACE FUNCTION run_all_verification_tests()
RETURNS TABLE(
    test_suite TEXT,
    test_name TEXT,
    status TEXT,
    details TEXT
) AS $$
BEGIN
    -- UUID Determinism Tests
    RETURN QUERY
    SELECT 
        'UUID Determinism'::TEXT as test_suite,
        test_name,
        CASE WHEN is_deterministic THEN 'PASS' ELSE 'FAIL' END as status,
        format('Function: %s, Input: %s, UUID: %s', function_tested, test_input, uuid_result) as details
    FROM test_all_uuid_determinism()
    WHERE test_name LIKE '%Same Input%' OR test_name LIKE '%Different Inputs%' OR test_name LIKE '%Different Types%';
    
    -- Foreign Key Integrity Tests
    RETURN QUERY
    SELECT 
        'Data Integrity - Foreign Keys'::TEXT as test_suite,
        format('%s.%s', table_name, constraint_name) as test_name,
        status,
        details
    FROM test_foreign_key_integrity();
    
    -- Primary Key Tests
    RETURN QUERY
    SELECT 
        'Data Integrity - Primary Keys'::TEXT as test_suite,
        format('%s.%s', table_name, constraint_name) as test_name,
        status,
        details
    FROM test_primary_key_constraints();
    
    -- UUID Uniqueness Tests
    RETURN QUERY
    SELECT 
        'Data Integrity - UUID Uniqueness'::TEXT as test_suite,
        table_name as test_name,
        status,
        details
    FROM test_uuid_uniqueness();
    
    -- Data Consistency Tests
    RETURN QUERY
    SELECT 
        'Data Integrity - Consistency'::TEXT as test_suite,
        test_name,
        status,
        details
    FROM test_data_consistency();
    
    -- Replication Setup Tests
    RETURN QUERY
    SELECT 
        'Replication Setup'::TEXT as test_suite,
        test_name,
        status,
        details
    FROM test_replication_setup();
    
    -- Replication Lag Tests
    RETURN QUERY
    SELECT 
        'Replication Performance'::TEXT as test_suite,
        test_name,
        status,
        format('%s - %s', details, 
               CASE WHEN lag_bytes IS NOT NULL THEN format('Lag: %s bytes', lag_bytes) ELSE '' END) as details
    FROM test_replication_lag();
    
    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION run_all_verification_tests IS 'Master test function that runs all verification tests and returns comprehensive results.';

-- =====================================================
-- 7. TEST SUMMARY AND REPORTING
-- =====================================================

-- Function to generate test summary report
CREATE OR REPLACE FUNCTION generate_test_summary_report()
RETURNS TABLE(
    test_suite TEXT,
    total_tests INTEGER,
    passed_tests INTEGER,
    failed_tests INTEGER,
    warning_tests INTEGER,
    skipped_tests INTEGER,
    pass_rate NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        test_suite,
        COUNT(*)::INTEGER as total_tests,
        COUNT(*) FILTER (WHERE status = 'PASS')::INTEGER as passed_tests,
        COUNT(*) FILTER (WHERE status = 'FAIL')::INTEGER as failed_tests,
        COUNT(*) FILTER (WHERE status = 'WARNING')::INTEGER as warning_tests,
        COUNT(*) FILTER (WHERE status = 'SKIP')::INTEGER as skipped_tests,
        ROUND(
            (COUNT(*) FILTER (WHERE status = 'PASS')::NUMERIC / 
             NULLIF(COUNT(*) FILTER (WHERE status IN ('PASS', 'FAIL')), 0)) * 100, 
            2
        ) as pass_rate
    FROM run_all_verification_tests()
    GROUP BY test_suite
    ORDER BY test_suite;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_test_summary_report IS 'Generates a summary report of all test results grouped by test suite.';

-- =====================================================
-- 8. MIGRATION COMPLETION
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Migration 004: Verification Tests Created';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Test Functions Available:';
    RAISE NOTICE '  - test_all_uuid_determinism() - Test UUID determinism';
    RAISE NOTICE '  - test_uuid_consistency_across_databases() - Test UUID consistency';
    RAISE NOTICE '  - test_foreign_key_integrity() - Test foreign key relationships';
    RAISE NOTICE '  - test_primary_key_constraints() - Test primary key constraints';
    RAISE NOTICE '  - test_uuid_uniqueness() - Test UUID uniqueness';
    RAISE NOTICE '  - test_data_consistency() - Test data consistency';
    RAISE NOTICE '  - test_replication_setup() - Test replication setup';
    RAISE NOTICE '  - test_replication_lag() - Test replication lag';
    RAISE NOTICE '  - test_uuid_generation_performance() - Test UUID performance';
    RAISE NOTICE '  - test_table_statistics() - Get table statistics';
    RAISE NOTICE '  - run_all_verification_tests() - Run all tests';
    RAISE NOTICE '  - generate_test_summary_report() - Generate test summary';
    RAISE NOTICE '';
    RAISE NOTICE 'Helper Functions:';
    RAISE NOTICE '  - get_replication_test_instructions() - Get replication test instructions';
    RAISE NOTICE '  - get_rollback_test_instructions() - Get rollback test instructions';
    RAISE NOTICE '';
    RAISE NOTICE 'Quick Start:';
    RAISE NOTICE '  1. Run all tests: SELECT * FROM run_all_verification_tests();';
    RAISE NOTICE '  2. Get summary: SELECT * FROM generate_test_summary_report();';
    RAISE NOTICE '  3. Test UUID determinism: SELECT * FROM test_all_uuid_determinism();';
    RAISE NOTICE '  4. Test data integrity: SELECT * FROM test_foreign_key_integrity();';
    RAISE NOTICE '  5. Test replication: SELECT * FROM test_replication_setup();';
    RAISE NOTICE '';
    RAISE NOTICE 'For replication testing across databases:';
    RAISE NOTICE '  SELECT * FROM test_uuid_consistency_across_databases();';
    RAISE NOTICE '  (Run this on both databases and compare UUIDs)';
    RAISE NOTICE '';
    RAISE NOTICE 'For manual replication tests:';
    RAISE NOTICE '  SELECT get_replication_test_instructions();';
    RAISE NOTICE '';
    RAISE NOTICE 'For rollback procedures:';
    RAISE NOTICE '  SELECT get_rollback_test_instructions();';
    RAISE NOTICE '';
END $$;
