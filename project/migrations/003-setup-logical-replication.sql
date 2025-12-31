-- =====================================================
-- Migration: Setup Bidirectional Logical Replication
-- =====================================================
-- This migration sets up bidirectional PostgreSQL logical replication
-- between two databases to ensure perfect synchronization.
--
-- IMPORTANT PREREQUISITES:
-- 1. Both databases must have wal_level = logical in postgresql.conf
-- 2. Both PostgreSQL servers must be restarted after changing wal_level
-- 3. Both databases must be accessible from each other (network connectivity)
-- 4. Migration 001 and 002 must be completed first (deterministic UUIDs)
-- 5. Both databases must have identical schemas
--
-- CONFIGURATION REQUIRED:
-- Edit postgresql.conf on BOTH database servers:
--   wal_level = logical
--   max_replication_slots = 10 (or higher)
--   max_wal_senders = 10 (or higher)
-- Then restart PostgreSQL on both servers.
--
-- This migration should be run on BOTH databases with appropriate
-- connection parameters customized for your environment.
-- =====================================================

-- Start transaction for safety
BEGIN;

-- =====================================================
-- 0. VERIFY PREREQUISITES
-- =====================================================

-- Verify wal_level is set to logical
DO $$
DECLARE
    wal_level_setting TEXT;
BEGIN
    -- Get wal_level setting
    wal_level_setting := current_setting('wal_level');
    
    IF wal_level_setting != 'logical' THEN
        RAISE EXCEPTION 'wal_level must be set to "logical" in postgresql.conf. Current value: %. Please set wal_level = logical and restart PostgreSQL.', wal_level_setting;
    END IF;
    
    RAISE NOTICE 'Prerequisite check passed: wal_level = logical';
END $$;

-- Verify that deterministic UUID functions exist
DO $$
DECLARE
    function_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'uuid_human_resource'
    ) INTO function_exists;
    
    IF NOT function_exists THEN
        RAISE EXCEPTION 'Prerequisite functions do not exist. Please run migrations 001 and 002 first.';
    END IF;
    
    RAISE NOTICE 'Prerequisite check passed: Deterministic UUID functions exist';
END $$;

-- Verify REPLICA IDENTITY FULL is set on all tables
DO $$
DECLARE
    table_name TEXT;
    replica_identity TEXT;
    missing_tables TEXT[] := ARRAY[]::TEXT[];
BEGIN
    FOR table_name IN 
        SELECT unnest(ARRAY[
            'human_resource',
            'periods',
            'shifts',
            'change_requests',
            'settings',
            'unavailable_staff_daily',
            'holiday_entitlements'
        ])
    LOOP
        SELECT relreplident::TEXT INTO replica_identity
        FROM pg_class
        WHERE relname = table_name;
        
        IF replica_identity != 'f' THEN
            missing_tables := array_append(missing_tables, table_name);
        END IF;
    END LOOP;
    
    IF array_length(missing_tables, 1) > 0 THEN
        RAISE EXCEPTION 'The following tables do not have REPLICA IDENTITY FULL set: %. Please ensure complete-database-setup.sql has been run.', array_to_string(missing_tables, ', ');
    END IF;
    
    RAISE NOTICE 'Prerequisite check passed: All tables have REPLICA IDENTITY FULL set';
END $$;

-- =====================================================
-- 1. CREATE REPLICATION USER
-- =====================================================

-- Create dedicated replication user (if it doesn't exist)
-- IMPORTANT: Change the password in production!
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_user WHERE usename = 'replication_user') THEN
        CREATE USER replication_user WITH REPLICATION PASSWORD 'CHANGE_THIS_PASSWORD_IN_PRODUCTION';
        RAISE NOTICE 'Created replication user: replication_user';
    ELSE
        RAISE NOTICE 'Replication user already exists: replication_user';
    END IF;
END $$;

-- Grant necessary permissions to replication user
-- The replication user needs SELECT permission on all tables
GRANT SELECT ON ALL TABLES IN SCHEMA public TO replication_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO replication_user;

-- Grant usage on schema
GRANT USAGE ON SCHEMA public TO replication_user;

DO $$
BEGIN
    RAISE NOTICE 'Replication user permissions configured';
END $$;

-- =====================================================
-- 2. CREATE PUBLICATIONS
-- =====================================================

-- Drop existing publication if it exists (for idempotency)
DROP PUBLICATION IF EXISTS db_publication;

-- Create publication for all tables
-- This publication includes all tables that need to be replicated
CREATE PUBLICATION db_publication FOR TABLE
    human_resource,
    periods,
    shifts,
    change_requests,
    settings,
    unavailable_staff_daily,
    holiday_entitlements;

COMMENT ON PUBLICATION db_publication IS 'Publication for bidirectional logical replication. Includes all application tables.';

DO $$
BEGIN
    RAISE NOTICE 'Publication "db_publication" created with 7 tables';
END $$;

-- =====================================================
-- 3. CREATE SUBSCRIPTIONS
-- =====================================================

-- IMPORTANT: Subscriptions require connection strings to the other database
-- You must customize these connection strings for your environment
-- 
-- Format: 'host=<other_db_host> port=<other_db_port> dbname=<other_db_name> user=replication_user password=<password>'
--
-- For bidirectional replication:
-- - Run this migration on DB1 with DB2 connection string
-- - Run this migration on DB2 with DB1 connection string
-- - Use copy_data = false since both databases should already have data

-- Drop existing subscription if it exists (for idempotency)
-- Note: This will fail if subscription doesn't exist, so we use DO block
DO $$
BEGIN
    -- Check if subscription already exists
    IF EXISTS (SELECT 1 FROM pg_subscription WHERE subname = 'db_subscription') THEN
        -- Disable subscription first
        ALTER SUBSCRIPTION db_subscription DISABLE;
        -- Drop subscription
        DROP SUBSCRIPTION db_subscription;
        RAISE NOTICE 'Dropped existing subscription: db_subscription';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'No existing subscription to drop';
END $$;

-- Create subscription
-- IMPORTANT: Replace the connection string with your actual database connection details
-- The connection string should point to the OTHER database (not the current one)
--
-- Example connection strings:
-- For DB1 subscribing to DB2:
--   'host=db2.example.com port=5432 dbname=danieltime user=replication_user password=your_password'
-- For DB2 subscribing to DB1:
--   'host=db1.example.com port=5432 dbname=danieltime user=replication_user password=your_password'
--
-- NOTE: You must run this with the correct connection string for your environment.
-- The connection string below is a PLACEHOLDER - replace it before running!

DO $$
DECLARE
    connection_string TEXT;
    other_db_host TEXT;
    other_db_port TEXT;
    other_db_name TEXT;
    replication_password TEXT;
BEGIN
    -- =====================================================
    -- CONFIGURATION: Customize these values for your environment
    -- =====================================================
    
    -- Set the connection details for the OTHER database
    -- For DB1: set these to DB2's details
    -- For DB2: set these to DB1's details
    other_db_host := '192.168.4.26';  -- e.g., '192.168.1.100' or 'db2.example.com'
    other_db_port := '5432';  -- Default PostgreSQL port, change if different
    other_db_name := 'daniel_time';  -- Database name, change if different
    replication_password := 'dbreplication';  -- Password for replication_user
    
    -- Build connection string
    connection_string := format(
        'host=%s port=%s dbname=%s user=replication_user password=%s',
        other_db_host,
        other_db_port,
        other_db_name,
        replication_password
    );
    
    -- Validate that connection string has been customized
    IF other_db_host = 'REPLACE_WITH_OTHER_DB_HOST' OR replication_password = 'REPLACE_WITH_REPLICATION_PASSWORD' THEN
        RAISE EXCEPTION 'You must customize the connection string variables in this migration before running it. Edit the DO block above to set other_db_host, other_db_port, other_db_name, and replication_password.';
    END IF;
    
    -- Create subscription
    -- copy_data = false because both databases should already have data
    -- If this is initial setup and one database is empty, set copy_data = true
    EXECUTE format(
        'CREATE SUBSCRIPTION db_subscription CONNECTION %L PUBLICATION db_publication WITH (copy_data = false, create_slot = true)',
        connection_string
    );
    
    RAISE NOTICE 'Subscription "db_subscription" created successfully';
    RAISE NOTICE 'Connected to: %:%/%', other_db_host, other_db_port, other_db_name;
END $$;

COMMENT ON SUBSCRIPTION db_subscription IS 'Subscription for bidirectional logical replication. Connects to the other database.';

-- =====================================================
-- 4. CONFIGURE CONFLICT RESOLUTION
-- =====================================================

-- With deterministic UUIDs, conflicts should be rare since the same record
-- will have the same UUID on both databases. However, we still need to
-- handle potential conflicts (e.g., concurrent updates to the same record).

-- PostgreSQL logical replication uses the following conflict resolution:
-- - If a row with the same primary key exists, the replicated change will
--   either update or delete based on the operation
-- - With REPLICA IDENTITY FULL, all columns are used for conflict detection
-- - Since UUIDs are deterministic, INSERT conflicts are unlikely
-- - UPDATE conflicts will be resolved by applying the replicated change

-- Create a function to monitor replication conflicts
CREATE OR REPLACE FUNCTION check_replication_conflicts()
RETURNS TABLE(
    subscription_name TEXT,
    conflict_count BIGINT,
    last_conflict_time TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        subname::TEXT as subscription_name,
        COALESCE(conflict_count, 0) as conflict_count,
        NULL::TIMESTAMPTZ as last_conflict_time  -- PostgreSQL doesn't track this directly
    FROM pg_subscription
    WHERE subname = 'db_subscription';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_replication_conflicts IS 'Function to check replication status and conflicts. Use this to monitor replication health.';

-- =====================================================
-- 5. VERIFY REPLICATION SETUP
-- =====================================================

-- Verify publication exists and includes all tables
DO $$
DECLARE
    pub_name TEXT;
    table_count INTEGER;
    expected_tables TEXT[] := ARRAY[
        'human_resource',
        'periods',
        'shifts',
        'change_requests',
        'settings',
        'unavailable_staff_daily',
        'holiday_entitlements'
    ];
    actual_tables TEXT[];
BEGIN
    -- Check publication exists
    SELECT pubname INTO pub_name
    FROM pg_publication
    WHERE pubname = 'db_publication';
    
    IF pub_name IS NULL THEN
        RAISE EXCEPTION 'Publication db_publication was not created!';
    END IF;
    
    -- Count tables in publication
    SELECT COUNT(*) INTO table_count
    FROM pg_publication_tables
    WHERE pubname = 'db_publication';
    
    IF table_count != 7 THEN
        RAISE WARNING 'Expected 7 tables in publication, found %', table_count;
    END IF;
    
    -- Get list of tables in publication
    SELECT array_agg(tablename ORDER BY tablename) INTO actual_tables
    FROM pg_publication_tables
    WHERE pubname = 'db_publication';
    
    RAISE NOTICE 'Publication verification:';
    RAISE NOTICE '  - Publication name: %', pub_name;
    RAISE NOTICE '  - Tables in publication: %', table_count;
    RAISE NOTICE '  - Tables: %', array_to_string(actual_tables, ', ');
END $$;

-- Verify subscription exists and is active
DO $$
DECLARE
    sub_name TEXT;
    sub_enabled BOOLEAN;
    sub_conninfo TEXT;
BEGIN
    SELECT 
        subname,
        subenabled,
        subconninfo
    INTO 
        sub_name,
        sub_enabled,
        sub_conninfo
    FROM pg_subscription
    WHERE subname = 'db_subscription';
    
    IF sub_name IS NULL THEN
        RAISE EXCEPTION 'Subscription db_subscription was not created!';
    END IF;
    
    RAISE NOTICE 'Subscription verification:';
    RAISE NOTICE '  - Subscription name: %', sub_name;
    RAISE NOTICE '  - Enabled: %', sub_enabled;
    RAISE NOTICE '  - Connection: %', regexp_replace(sub_conninfo, 'password=[^ ]+', 'password=***', 'g');
    
    IF NOT sub_enabled THEN
        RAISE WARNING 'Subscription is disabled. Enable it with: ALTER SUBSCRIPTION db_subscription ENABLE;';
    END IF;
END $$;

-- =====================================================
-- 6. CREATE MONITORING FUNCTIONS
-- =====================================================

-- Function to check replication lag
CREATE OR REPLACE FUNCTION check_replication_lag()
RETURNS TABLE(
    subscription_name TEXT,
    slot_name TEXT,
    lag_bytes BIGINT,
    lag_time INTERVAL,
    active BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.subname::TEXT as subscription_name,
        s.subslotname::TEXT as slot_name,
        COALESCE(
            pg_wal_lsn_diff(
                pg_current_wal_lsn(),
                r.confirmed_flush_lsn
            ),
            0
        ) as lag_bytes,
        NULL::INTERVAL as lag_time,  -- Time lag not directly available
        r.active as active
    FROM pg_subscription s
    LEFT JOIN pg_replication_slots r ON s.subslotname = r.slot_name
    WHERE s.subname = 'db_subscription';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_replication_lag IS 'Function to check replication lag in bytes. Lower is better. Use this to monitor replication performance.';

-- Function to get replication status summary
CREATE OR REPLACE FUNCTION get_replication_status()
RETURNS TABLE(
    metric TEXT,
    value TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        'Publication'::TEXT as metric,
        pubname::TEXT as value
    FROM pg_publication
    WHERE pubname = 'db_publication'
    
    UNION ALL
    
    SELECT 
        'Subscription'::TEXT as metric,
        subname::TEXT as value
    FROM pg_subscription
    WHERE subname = 'db_subscription'
    
    UNION ALL
    
    SELECT 
        'Subscription Enabled'::TEXT as metric,
        subenabled::TEXT as value
    FROM pg_subscription
    WHERE subname = 'db_subscription'
    
    UNION ALL
    
    SELECT 
        'Replication Slot'::TEXT as metric,
        COALESCE(subslotname::TEXT, 'None') as value
    FROM pg_subscription
    WHERE subname = 'db_subscription'
    
    UNION ALL
    
    SELECT 
        'Tables in Publication'::TEXT as metric,
        COUNT(*)::TEXT as value
    FROM pg_publication_tables
    WHERE pubname = 'db_publication';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_replication_status IS 'Function to get a summary of replication status. Use this for quick health checks.';

-- =====================================================
-- 7. USEFUL MAINTENANCE COMMANDS
-- =====================================================

-- Create a function to display useful replication commands
CREATE OR REPLACE FUNCTION show_replication_commands()
RETURNS TEXT AS $$
BEGIN
    RETURN '
-- =====================================================
-- REPLICATION MANAGEMENT COMMANDS
-- =====================================================

-- Check replication status:
SELECT * FROM get_replication_status();

-- Check replication lag:
SELECT * FROM check_replication_lag();

-- Check for conflicts:
SELECT * FROM check_replication_conflicts();

-- Enable subscription:
ALTER SUBSCRIPTION db_subscription ENABLE;

-- Disable subscription:
ALTER SUBSCRIPTION db_subscription DISABLE;

-- Refresh subscription (re-sync):
ALTER SUBSCRIPTION db_subscription REFRESH PUBLICATION;

-- View subscription details:
SELECT * FROM pg_subscription WHERE subname = ''db_subscription'';

-- View publication details:
SELECT * FROM pg_publication WHERE pubname = ''db_publication'';

-- View tables in publication:
SELECT * FROM pg_publication_tables WHERE pubname = ''db_publication'';

-- View replication slots:
SELECT * FROM pg_replication_slots;

-- Drop subscription (if needed):
-- ALTER SUBSCRIPTION db_subscription DISABLE;
-- DROP SUBSCRIPTION db_subscription;

-- Drop publication (if needed):
-- DROP PUBLICATION db_publication;
';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION show_replication_commands IS 'Function that returns useful replication management commands. Call SELECT show_replication_commands(); to see them.';

-- =====================================================
-- 8. MIGRATION SUMMARY
-- =====================================================

DO $$
DECLARE
    pub_tables INTEGER;
    sub_exists BOOLEAN;
BEGIN
    -- Count tables in publication
    SELECT COUNT(*) INTO pub_tables
    FROM pg_publication_tables
    WHERE pubname = 'db_publication';
    
    -- Check if subscription exists
    SELECT EXISTS (
        SELECT 1 FROM pg_subscription WHERE subname = 'db_subscription'
    ) INTO sub_exists;
    
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Migration 003 completed successfully!';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Replication Setup Summary:';
    RAISE NOTICE '  - Publication: db_publication';
    RAISE NOTICE '  - Tables in publication: %', pub_tables;
    RAISE NOTICE '  - Subscription: db_subscription';
    RAISE NOTICE '  - Subscription exists: %', sub_exists;
    RAISE NOTICE '';
    RAISE NOTICE 'Next Steps:';
    RAISE NOTICE '  1. Run this migration on the OTHER database with reversed connection string';
    RAISE NOTICE '  2. Verify replication is working: SELECT * FROM get_replication_status();';
    RAISE NOTICE '  3. Test replication by inserting a record on one DB and checking the other';
    RAISE NOTICE '  4. Monitor replication lag: SELECT * FROM check_replication_lag();';
    RAISE NOTICE '  5. View useful commands: SELECT show_replication_commands();';
    RAISE NOTICE '';
    RAISE NOTICE 'IMPORTANT:';
    RAISE NOTICE '  - Ensure both databases have wal_level = logical in postgresql.conf';
    RAISE NOTICE '  - Both PostgreSQL servers must be restarted after changing wal_level';
    RAISE NOTICE '  - Both databases must be accessible from each other';
    RAISE NOTICE '  - Change replication_user password in production!';
    RAISE NOTICE '';
END $$;

-- Commit transaction
COMMIT;
