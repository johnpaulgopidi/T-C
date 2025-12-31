-- =====================================================
-- Migration: Migrate Existing Data to Deterministic UUIDs
-- =====================================================
-- This migration converts all existing random UUIDs to deterministic
-- UUIDs based on natural keys, ensuring the same record gets the
-- same UUID across different databases.
--
-- IMPORTANT: This migration should be run in a transaction and
-- requires a full database backup before execution.
-- =====================================================

-- Start transaction for safety
BEGIN;

-- =====================================================
-- 0. VERIFY PREREQUISITES
-- =====================================================

-- Verify that UUID generation functions exist
DO $$
DECLARE
    function_exists BOOLEAN;
BEGIN
    -- Check if uuid_human_resource function exists
    SELECT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'uuid_human_resource'
    ) INTO function_exists;
    
    IF NOT function_exists THEN
        RAISE EXCEPTION 'Prerequisite function uuid_human_resource() does not exist. Please run migration 001 first.';
    END IF;
    
    RAISE NOTICE 'Prerequisites verified. UUID generation functions are available.';
END $$;

-- =====================================================
-- 1. CREATE TEMPORARY MAPPING TABLES
-- =====================================================

-- Mapping table for human_resource
CREATE TEMPORARY TABLE IF NOT EXISTS uuid_mapping_human_resource (
    old_uuid UUID NOT NULL,
    new_uuid UUID NOT NULL,
    staff_name TEXT NOT NULL,
    PRIMARY KEY (old_uuid)
);

-- Mapping table for periods
CREATE TEMPORARY TABLE IF NOT EXISTS uuid_mapping_periods (
    old_uuid UUID NOT NULL,
    new_uuid UUID NOT NULL,
    period_name TEXT NOT NULL,
    start_date DATE NOT NULL,
    PRIMARY KEY (old_uuid)
);

-- Mapping table for settings
CREATE TEMPORARY TABLE IF NOT EXISTS uuid_mapping_settings (
    old_uuid UUID NOT NULL,
    new_uuid UUID NOT NULL,
    type_of_setting TEXT NOT NULL,
    PRIMARY KEY (old_uuid)
);

-- Mapping table for holiday_entitlements
CREATE TEMPORARY TABLE IF NOT EXISTS uuid_mapping_holiday_entitlements (
    old_uuid UUID NOT NULL,
    new_uuid UUID NOT NULL,
    staff_id_old UUID NOT NULL,
    holiday_year_start DATE NOT NULL,
    PRIMARY KEY (old_uuid)
);

-- Mapping table for shifts
CREATE TEMPORARY TABLE IF NOT EXISTS uuid_mapping_shifts (
    old_uuid UUID NOT NULL,
    new_uuid UUID NOT NULL,
    period_id_old UUID NOT NULL,
    staff_name TEXT NOT NULL,
    shift_start_datetime TIMESTAMPTZ NOT NULL,
    shift_type TEXT NOT NULL,
    PRIMARY KEY (old_uuid)
);

-- Mapping table for change_requests
CREATE TEMPORARY TABLE IF NOT EXISTS uuid_mapping_change_requests (
    old_uuid UUID NOT NULL,
    new_uuid UUID NOT NULL,
    staff_id_old UUID NOT NULL,
    change_type TEXT NOT NULL,
    field_name TEXT,
    changed_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (old_uuid)
);

-- Mapping table for unavailable_staff_daily
CREATE TEMPORARY TABLE IF NOT EXISTS uuid_mapping_unavailable_staff_daily (
    old_uuid UUID NOT NULL,
    new_uuid UUID NOT NULL,
    period_id_old UUID NOT NULL,
    date DATE NOT NULL,
    PRIMARY KEY (old_uuid)
);

-- =====================================================
-- 2. DISABLE FOREIGN KEY CONSTRAINTS TEMPORARILY
-- =====================================================

-- Note: PostgreSQL doesn't support disabling constraints directly
-- We'll need to drop and recreate them, or use a different approach
-- For safety, we'll work with constraints enabled but update in correct order

-- =====================================================
-- 3. MIGRATE human_resource (NO DEPENDENCIES)
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE 'Migrating human_resource table...';
END $$;

-- Generate new deterministic UUIDs and store mappings
INSERT INTO uuid_mapping_human_resource (old_uuid, new_uuid, staff_name)
SELECT 
    unique_id as old_uuid,
    uuid_human_resource(staff_name) as new_uuid,
    staff_name
FROM human_resource
ON CONFLICT (old_uuid) DO NOTHING;

-- Check for UUID collisions (shouldn't happen with deterministic UUIDs, but verify)
DO $$
DECLARE
    collision_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO collision_count
    FROM (
        SELECT new_uuid, COUNT(*) as cnt
        FROM uuid_mapping_human_resource
        GROUP BY new_uuid
        HAVING COUNT(*) > 1
    ) collisions;
    
    IF collision_count > 0 THEN
        RAISE EXCEPTION 'UUID collision detected in human_resource table! Collision count: %', collision_count;
    END IF;
END $$;

-- Drop foreign key constraints that reference human_resource FIRST
-- This allows us to update primary keys and foreign keys independently
ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_staff_name_fkey;
ALTER TABLE holiday_entitlements DROP CONSTRAINT IF EXISTS holiday_entitlements_staff_id_fkey;
ALTER TABLE change_requests DROP CONSTRAINT IF EXISTS change_requests_staff_id_fkey;

-- Drop unique constraint on staff_name and primary key
-- Note: staff_name unique constraint must be dropped after foreign key that depends on it
ALTER TABLE human_resource DROP CONSTRAINT IF EXISTS human_resource_staff_name_key;
ALTER TABLE human_resource DROP CONSTRAINT IF EXISTS human_resource_pkey;

-- Set replica identity to allow updates if table is part of logical replication
-- This is needed if the table publishes updates via logical replication
ALTER TABLE human_resource REPLICA IDENTITY FULL;

-- Update primary key in human_resource FIRST
UPDATE human_resource hr
SET unique_id = mapping.new_uuid
FROM uuid_mapping_human_resource mapping
WHERE hr.unique_id = mapping.old_uuid;

-- Recreate primary key constraint
ALTER TABLE human_resource ADD PRIMARY KEY (unique_id);
ALTER TABLE human_resource ADD CONSTRAINT human_resource_staff_name_key UNIQUE (staff_name);

-- Now update foreign key references in dependent tables
UPDATE holiday_entitlements he
SET staff_id = mapping.new_uuid
FROM uuid_mapping_human_resource mapping
WHERE he.staff_id = mapping.old_uuid;

UPDATE change_requests cr
SET staff_id = mapping.new_uuid
FROM uuid_mapping_human_resource mapping
WHERE cr.staff_id = mapping.old_uuid;

-- Recreate foreign key constraints
ALTER TABLE holiday_entitlements 
    ADD CONSTRAINT holiday_entitlements_staff_id_fkey 
    FOREIGN KEY (staff_id) REFERENCES human_resource(unique_id) ON DELETE CASCADE;
    
ALTER TABLE change_requests 
    ADD CONSTRAINT change_requests_staff_id_fkey 
    FOREIGN KEY (staff_id) REFERENCES human_resource(unique_id) ON DELETE CASCADE;

-- Recreate foreign key constraint for shifts.staff_name
-- Note: staff_name is a TEXT field, not UUID, so it doesn't need migration
ALTER TABLE shifts 
    ADD CONSTRAINT shifts_staff_name_fkey 
    FOREIGN KEY (staff_name) REFERENCES human_resource(staff_name) ON DELETE CASCADE;

DO $$
DECLARE
    record_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO record_count FROM uuid_mapping_human_resource;
    RAISE NOTICE 'human_resource migration completed. Migrated % records.', record_count;
END $$;

-- =====================================================
-- 4. MIGRATE periods (NO DEPENDENCIES)
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE 'Migrating periods table...';
END $$;

-- Generate new deterministic UUIDs and store mappings
INSERT INTO uuid_mapping_periods (old_uuid, new_uuid, period_name, start_date)
SELECT 
    period_id as old_uuid,
    uuid_period(period_name, start_date) as new_uuid,
    period_name,
    start_date
FROM periods
ON CONFLICT (old_uuid) DO NOTHING;

-- Check for UUID collisions
DO $$
DECLARE
    collision_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO collision_count
    FROM (
        SELECT new_uuid, COUNT(*) as cnt
        FROM uuid_mapping_periods
        GROUP BY new_uuid
        HAVING COUNT(*) > 1
    ) collisions;
    
    IF collision_count > 0 THEN
        RAISE EXCEPTION 'UUID collision detected in periods table! Collision count: %', collision_count;
    END IF;
END $$;

-- Drop foreign key constraints that reference periods.period_id FIRST
ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_period_id_fkey;
ALTER TABLE unavailable_staff_daily DROP CONSTRAINT IF EXISTS unavailable_staff_daily_period_id_fkey;

-- Update primary key in periods FIRST
ALTER TABLE periods DROP CONSTRAINT IF EXISTS periods_pkey;

-- Set replica identity to allow updates if table is part of logical replication
ALTER TABLE periods REPLICA IDENTITY FULL;

UPDATE periods p
SET period_id = mapping.new_uuid
FROM uuid_mapping_periods mapping
WHERE p.period_id = mapping.old_uuid;

ALTER TABLE periods ADD PRIMARY KEY (period_id);

-- Now update foreign key references in dependent tables
UPDATE shifts s
SET period_id = mapping.new_uuid
FROM uuid_mapping_periods mapping
WHERE s.period_id = mapping.old_uuid;

UPDATE unavailable_staff_daily usd
SET period_id = mapping.new_uuid
FROM uuid_mapping_periods mapping
WHERE usd.period_id = mapping.old_uuid;

-- Recreate foreign key constraints
ALTER TABLE shifts 
    ADD CONSTRAINT shifts_period_id_fkey 
    FOREIGN KEY (period_id) REFERENCES periods(period_id) ON DELETE CASCADE;
    
ALTER TABLE unavailable_staff_daily 
    ADD CONSTRAINT unavailable_staff_daily_period_id_fkey 
    FOREIGN KEY (period_id) REFERENCES periods(period_id) ON DELETE CASCADE;

DO $$
DECLARE
    record_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO record_count FROM uuid_mapping_periods;
    RAISE NOTICE 'periods migration completed. Migrated % records.', record_count;
END $$;

-- =====================================================
-- 5. MIGRATE settings (NO DEPENDENCIES)
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE 'Migrating settings table...';
END $$;

-- Generate new deterministic UUIDs and store mappings
INSERT INTO uuid_mapping_settings (old_uuid, new_uuid, type_of_setting)
SELECT 
    setting_id as old_uuid,
    uuid_setting(type_of_setting) as new_uuid,
    type_of_setting
FROM settings
ON CONFLICT (old_uuid) DO NOTHING;

-- Check for UUID collisions
DO $$
DECLARE
    collision_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO collision_count
    FROM (
        SELECT new_uuid, COUNT(*) as cnt
        FROM uuid_mapping_settings
        GROUP BY new_uuid
        HAVING COUNT(*) > 1
    ) collisions;
    
    IF collision_count > 0 THEN
        RAISE EXCEPTION 'UUID collision detected in settings table! Collision count: %', collision_count;
    END IF;
END $$;

-- Update primary key in settings
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_pkey;

-- Set replica identity to allow updates if table is part of logical replication
ALTER TABLE settings REPLICA IDENTITY FULL;

UPDATE settings s
SET setting_id = mapping.new_uuid
FROM uuid_mapping_settings mapping
WHERE s.setting_id = mapping.old_uuid;

ALTER TABLE settings ADD PRIMARY KEY (setting_id);

DO $$
DECLARE
    record_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO record_count FROM uuid_mapping_settings;
    RAISE NOTICE 'settings migration completed. Migrated % records.', record_count;
END $$;

-- =====================================================
-- 6. MIGRATE holiday_entitlements (DEPENDS ON human_resource)
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE 'Migrating holiday_entitlements table...';
END $$;

-- Generate new deterministic UUIDs and store mappings
-- Note: staff_id has already been updated to new UUIDs in step 3
INSERT INTO uuid_mapping_holiday_entitlements (old_uuid, new_uuid, staff_id_old, holiday_year_start)
SELECT 
    entitlement_id as old_uuid,
    uuid_holiday_entitlement(he.staff_id, he.holiday_year_start) as new_uuid,
    he.staff_id as staff_id_old,
    he.holiday_year_start
FROM holiday_entitlements he
ON CONFLICT (old_uuid) DO NOTHING;

-- Check for UUID collisions
DO $$
DECLARE
    collision_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO collision_count
    FROM (
        SELECT new_uuid, COUNT(*) as cnt
        FROM uuid_mapping_holiday_entitlements
        GROUP BY new_uuid
        HAVING COUNT(*) > 1
    ) collisions;
    
    IF collision_count > 0 THEN
        RAISE EXCEPTION 'UUID collision detected in holiday_entitlements table! Collision count: %', collision_count;
    END IF;
END $$;

-- Update primary key in holiday_entitlements
ALTER TABLE holiday_entitlements DROP CONSTRAINT IF EXISTS holiday_entitlements_pkey;

-- Set replica identity to allow updates if table is part of logical replication
ALTER TABLE holiday_entitlements REPLICA IDENTITY FULL;

UPDATE holiday_entitlements he
SET entitlement_id = mapping.new_uuid
FROM uuid_mapping_holiday_entitlements mapping
WHERE he.entitlement_id = mapping.old_uuid;

ALTER TABLE holiday_entitlements ADD PRIMARY KEY (entitlement_id);

DO $$
DECLARE
    record_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO record_count FROM uuid_mapping_holiday_entitlements;
    RAISE NOTICE 'holiday_entitlements migration completed. Migrated % records.', record_count;
END $$;

-- =====================================================
-- 7. MIGRATE shifts (DEPENDS ON periods, human_resource)
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE 'Migrating shifts table...';
END $$;

-- Generate new deterministic UUIDs and store mappings
-- Note: period_id has already been updated to new UUIDs in step 4
-- Handle duplicates by including old UUID in seed for duplicates
WITH shift_duplicates AS (
    SELECT 
        s.id,
        s.period_id,
        s.staff_name,
        s.shift_start_datetime,
        s.shift_type,
        ROW_NUMBER() OVER (PARTITION BY s.period_id, s.staff_name, s.shift_start_datetime, s.shift_type ORDER BY s.id) as dup_num
    FROM shifts s
)
INSERT INTO uuid_mapping_shifts (old_uuid, new_uuid, period_id_old, staff_name, shift_start_datetime, shift_type)
SELECT 
    sd.id as old_uuid,
    CASE 
        -- For duplicates (dup_num > 1), include the old UUID in the seed to ensure uniqueness
        WHEN sd.dup_num > 1
        THEN generate_deterministic_uuid('shift', 
            sd.period_id::TEXT || ':' || 
            sd.staff_name || ':' || 
            sd.shift_start_datetime::TEXT || ':' || 
            sd.shift_type || ':' || 
            sd.id::TEXT)
        ELSE uuid_shift(sd.period_id, sd.staff_name, sd.shift_start_datetime, sd.shift_type)
    END as new_uuid,
    sd.period_id as period_id_old,
    sd.staff_name,
    sd.shift_start_datetime,
    sd.shift_type
FROM shift_duplicates sd
ON CONFLICT (old_uuid) DO NOTHING;

-- Check for UUID collisions
DO $$
DECLARE
    collision_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO collision_count
    FROM (
        SELECT new_uuid, COUNT(*) as cnt
        FROM uuid_mapping_shifts
        GROUP BY new_uuid
        HAVING COUNT(*) > 1
    ) collisions;
    
    IF collision_count > 0 THEN
        RAISE EXCEPTION 'UUID collision detected in shifts table! Collision count: %', collision_count;
    END IF;
END $$;

-- Update primary key in shifts
-- Note: shifts_staff_name_fkey was already dropped and recreated in human_resource section
ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_pkey;

-- Set replica identity to allow updates if table is part of logical replication
ALTER TABLE shifts REPLICA IDENTITY FULL;

UPDATE shifts s
SET id = mapping.new_uuid
FROM uuid_mapping_shifts mapping
WHERE s.id = mapping.old_uuid;

ALTER TABLE shifts ADD PRIMARY KEY (id);

-- Note: shifts_staff_name_fkey was already recreated in human_resource section

DO $$
DECLARE
    record_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO record_count FROM uuid_mapping_shifts;
    RAISE NOTICE 'shifts migration completed. Migrated % records.', record_count;
END $$;

-- =====================================================
-- 8. MIGRATE change_requests (DEPENDS ON human_resource)
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE 'Migrating change_requests table...';
END $$;

-- Generate new deterministic UUIDs and store mappings
-- Note: staff_id has already been updated to new UUIDs in step 3
INSERT INTO uuid_mapping_change_requests (old_uuid, new_uuid, staff_id_old, change_type, field_name, changed_at)
SELECT 
    id as old_uuid,
    uuid_change_request(cr.staff_id, cr.change_type, COALESCE(cr.field_name, ''), cr.changed_at) as new_uuid,
    cr.staff_id as staff_id_old,
    cr.change_type,
    cr.field_name,
    cr.changed_at
FROM change_requests cr
ON CONFLICT (old_uuid) DO NOTHING;

-- Check for UUID collisions
DO $$
DECLARE
    collision_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO collision_count
    FROM (
        SELECT new_uuid, COUNT(*) as cnt
        FROM uuid_mapping_change_requests
        GROUP BY new_uuid
        HAVING COUNT(*) > 1
    ) collisions;
    
    IF collision_count > 0 THEN
        RAISE EXCEPTION 'UUID collision detected in change_requests table! Collision count: %', collision_count;
    END IF;
END $$;

-- Update primary key in change_requests
ALTER TABLE change_requests DROP CONSTRAINT IF EXISTS change_requests_pkey;

-- Set replica identity to allow updates if table is part of logical replication
ALTER TABLE change_requests REPLICA IDENTITY FULL;

UPDATE change_requests cr
SET id = mapping.new_uuid
FROM uuid_mapping_change_requests mapping
WHERE cr.id = mapping.old_uuid;

ALTER TABLE change_requests ADD PRIMARY KEY (id);

DO $$
DECLARE
    record_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO record_count FROM uuid_mapping_change_requests;
    RAISE NOTICE 'change_requests migration completed. Migrated % records.', record_count;
END $$;

-- =====================================================
-- 9. MIGRATE unavailable_staff_daily (DEPENDS ON periods)
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE 'Migrating unavailable_staff_daily table...';
END $$;

-- Generate new deterministic UUIDs and store mappings
-- Note: period_id has already been updated to new UUIDs in step 4
INSERT INTO uuid_mapping_unavailable_staff_daily (old_uuid, new_uuid, period_id_old, date)
SELECT 
    id as old_uuid,
    uuid_unavailable_staff_daily(usd.period_id, usd.date) as new_uuid,
    usd.period_id as period_id_old,
    usd.date
FROM unavailable_staff_daily usd
ON CONFLICT (old_uuid) DO NOTHING;

-- Check for UUID collisions
DO $$
DECLARE
    collision_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO collision_count
    FROM (
        SELECT new_uuid, COUNT(*) as cnt
        FROM uuid_mapping_unavailable_staff_daily
        GROUP BY new_uuid
        HAVING COUNT(*) > 1
    ) collisions;
    
    IF collision_count > 0 THEN
        RAISE EXCEPTION 'UUID collision detected in unavailable_staff_daily table! Collision count: %', collision_count;
    END IF;
END $$;

-- Update primary key in unavailable_staff_daily
ALTER TABLE unavailable_staff_daily DROP CONSTRAINT IF EXISTS unavailable_staff_daily_pkey;

-- Set replica identity to allow updates if table is part of logical replication
ALTER TABLE unavailable_staff_daily REPLICA IDENTITY FULL;

UPDATE unavailable_staff_daily usd
SET id = mapping.new_uuid
FROM uuid_mapping_unavailable_staff_daily mapping
WHERE usd.id = mapping.old_uuid;

ALTER TABLE unavailable_staff_daily ADD PRIMARY KEY (id);

DO $$
DECLARE
    record_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO record_count FROM uuid_mapping_unavailable_staff_daily;
    RAISE NOTICE 'unavailable_staff_daily migration completed. Migrated % records.', record_count;
END $$;

-- =====================================================
-- 10. VALIDATE DATA INTEGRITY
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE 'Validating data integrity...';
END $$;

-- Check for orphaned records
DO $$
DECLARE
    orphaned_shifts INTEGER;
    orphaned_change_requests INTEGER;
    orphaned_holiday_entitlements INTEGER;
    orphaned_unavailable_staff_daily INTEGER;
BEGIN
    -- Check for orphaned shifts (period_id or staff_name doesn't exist)
    SELECT COUNT(*) INTO orphaned_shifts
    FROM shifts s
    WHERE NOT EXISTS (
        SELECT 1 FROM periods p WHERE p.period_id = s.period_id
    ) OR NOT EXISTS (
        SELECT 1 FROM human_resource hr WHERE hr.staff_name = s.staff_name
    );
    
    IF orphaned_shifts > 0 THEN
        RAISE WARNING 'Found % orphaned shifts', orphaned_shifts;
    END IF;
    
    -- Check for orphaned change_requests
    SELECT COUNT(*) INTO orphaned_change_requests
    FROM change_requests cr
    WHERE NOT EXISTS (
        SELECT 1 FROM human_resource hr WHERE hr.unique_id = cr.staff_id
    );
    
    IF orphaned_change_requests > 0 THEN
        RAISE WARNING 'Found % orphaned change_requests', orphaned_change_requests;
    END IF;
    
    -- Check for orphaned holiday_entitlements
    SELECT COUNT(*) INTO orphaned_holiday_entitlements
    FROM holiday_entitlements he
    WHERE NOT EXISTS (
        SELECT 1 FROM human_resource hr WHERE hr.unique_id = he.staff_id
    );
    
    IF orphaned_holiday_entitlements > 0 THEN
        RAISE WARNING 'Found % orphaned holiday_entitlements', orphaned_holiday_entitlements;
    END IF;
    
    -- Check for orphaned unavailable_staff_daily
    SELECT COUNT(*) INTO orphaned_unavailable_staff_daily
    FROM unavailable_staff_daily usd
    WHERE NOT EXISTS (
        SELECT 1 FROM periods p WHERE p.period_id = usd.period_id
    );
    
    IF orphaned_unavailable_staff_daily > 0 THEN
        RAISE WARNING 'Found % orphaned unavailable_staff_daily records', orphaned_unavailable_staff_daily;
    END IF;
    
    RAISE NOTICE 'Data integrity validation completed.';
END $$;

-- =====================================================
-- 11. VERIFY FOREIGN KEY CONSTRAINTS
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE 'Verifying foreign key constraints...';
END $$;

-- Verify all foreign key constraints are intact
DO $$
DECLARE
    constraint_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO constraint_count
    FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY'
    AND table_schema = 'public'
    AND table_name IN ('shifts', 'change_requests', 'holiday_entitlements', 'unavailable_staff_daily');
    
    RAISE NOTICE 'Found % foreign key constraints', constraint_count;
    
    -- Expected constraints:
    -- shifts: period_id -> periods.period_id, staff_name -> human_resource.staff_name
    -- change_requests: staff_id -> human_resource.unique_id
    -- holiday_entitlements: staff_id -> human_resource.unique_id
    -- unavailable_staff_daily: period_id -> periods.period_id
    
    IF constraint_count < 4 THEN
        RAISE WARNING 'Expected at least 4 foreign key constraints, found %', constraint_count;
    END IF;
END $$;

-- =====================================================
-- 12. CLEANUP TEMPORARY TABLES
-- =====================================================

-- Drop temporary mapping tables
DROP TABLE IF EXISTS uuid_mapping_human_resource;
DROP TABLE IF EXISTS uuid_mapping_periods;
DROP TABLE IF EXISTS uuid_mapping_settings;
DROP TABLE IF EXISTS uuid_mapping_holiday_entitlements;
DROP TABLE IF EXISTS uuid_mapping_shifts;
DROP TABLE IF EXISTS uuid_mapping_change_requests;
DROP TABLE IF EXISTS uuid_mapping_unavailable_staff_daily;

-- =====================================================
-- 13. MIGRATION SUMMARY
-- =====================================================

DO $$
DECLARE
    total_migrated INTEGER;
BEGIN
    -- Count total records migrated
    SELECT 
        (SELECT COUNT(*) FROM human_resource) +
        (SELECT COUNT(*) FROM periods) +
        (SELECT COUNT(*) FROM settings) +
        (SELECT COUNT(*) FROM holiday_entitlements) +
        (SELECT COUNT(*) FROM shifts) +
        (SELECT COUNT(*) FROM change_requests) +
        (SELECT COUNT(*) FROM unavailable_staff_daily)
    INTO total_migrated;
    
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Migration 002 completed successfully!';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Total records migrated: %', total_migrated;
    RAISE NOTICE '';
    RAISE NOTICE 'Tables migrated:';
    RAISE NOTICE '  - human_resource: % records', (SELECT COUNT(*) FROM human_resource);
    RAISE NOTICE '  - periods: % records', (SELECT COUNT(*) FROM periods);
    RAISE NOTICE '  - settings: % records', (SELECT COUNT(*) FROM settings);
    RAISE NOTICE '  - holiday_entitlements: % records', (SELECT COUNT(*) FROM holiday_entitlements);
    RAISE NOTICE '  - shifts: % records', (SELECT COUNT(*) FROM shifts);
    RAISE NOTICE '  - change_requests: % records', (SELECT COUNT(*) FROM change_requests);
    RAISE NOTICE '  - unavailable_staff_daily: % records', (SELECT COUNT(*) FROM unavailable_staff_daily);
    RAISE NOTICE '';
    RAISE NOTICE 'All UUIDs are now deterministic!';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '  1. Verify data integrity manually';
    RAISE NOTICE '  2. Test application functionality';
    RAISE NOTICE '  3. Proceed with migration 003 (logical replication setup)';
    RAISE NOTICE '';
END $$;

-- Commit transaction
COMMIT;
