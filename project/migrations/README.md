# Database Migration Guide

## Overview

This directory contains migration scripts for implementing **deterministic UUID generation** and **bidirectional PostgreSQL logical replication** to ensure perfect synchronization between two databases.

### Key Features

- **Deterministic UUIDs**: All UUIDs are generated using UUID v5 (RFC 4122) based on natural keys, ensuring the same record gets the same UUID across different databases
- **Bidirectional Replication**: PostgreSQL logical replication enables real-time synchronization between two databases
- **Zero Conflicts**: With deterministic UUIDs, replication conflicts are minimized since the same record will have the same UUID on both databases
- **Data Integrity**: Comprehensive validation and testing ensures data consistency

### Architecture

```
┌─────────────────┐         ┌─────────────────┐
│   Database 1    │◄────────►│   Database 2    │
│   (Primary)     │         │   (Primary)     │
│                 │         │                 │
│ • Deterministic │         │ • Deterministic │
│   UUIDs         │         │   UUIDs         │
│ • Publication   │         │ • Publication   │
│ • Subscription  │         │ • Subscription  │
└─────────────────┘         └─────────────────┘
         ▲                           ▲
         │                           │
         └───────────┬───────────────┘
                     │
              ┌──────┴──────┐
              │ Application  │
              │   (server.js)│
              └──────────────┘
```

## Migration Files

The migrations must be run in the following order:

1. **001-create-deterministic-uuid-functions.sql** - Creates UUID v5 generation functions
2. **002-migrate-existing-data-to-deterministic-uuids.sql** - Migrates existing random UUIDs to deterministic UUIDs
3. **003-setup-logical-replication.sql** - Sets up bidirectional logical replication
4. **004-verification-tests.sql** - Creates comprehensive test functions for verification

## Prerequisites

### Database Requirements

- **PostgreSQL 10+** (logical replication requires PostgreSQL 10 or higher)
- **uuid-ossp extension** (for UUID v5 support)
- Both databases must be accessible from each other (network connectivity)
- Sufficient disk space for replication logs

### PostgreSQL Configuration

Before running migration 003, you must configure PostgreSQL on **both database servers**:

1. **Edit `postgresql.conf`** on both servers:
   ```ini
   wal_level = logical
   max_replication_slots = 10
   max_wal_senders = 10
   ```

2. **Restart PostgreSQL** on both servers after making changes:
   ```bash
   # On Linux
   sudo systemctl restart postgresql
   
   # On Windows
   # Restart PostgreSQL service from Services manager
   ```

3. **Verify configuration**:
   ```sql
   SHOW wal_level;  -- Should return 'logical'
   ```

### Backup Strategy

**⚠️ CRITICAL: Always create a full database backup before running migrations!**

```bash
# Create backup before migration
pg_dump -h localhost -U postgres -d danieltime -F c -f backup_before_migration_$(date +%Y%m%d_%H%M%S).dump

# Verify backup was created
ls -lh backup_before_migration_*.dump
```

## Migration Instructions

### Step 1: Create Deterministic UUID Functions

**File**: `001-create-deterministic-uuid-functions.sql`

**Purpose**: Creates PostgreSQL functions for generating deterministic UUIDs using UUID v5 (RFC 4122).

**What it does**:
- Creates core UUID v5 generation function
- Creates table-specific UUID generation functions for all tables
- Uses a fixed application namespace UUID: `6ba7b810-9dad-11d1-80b4-00c04fd430c8`
- Creates test function to verify UUID determinism

**How to run**:
```bash
psql -h localhost -U postgres -d danieltime -f 001-create-deterministic-uuid-functions.sql
```

**Verification**:
```sql
-- Test UUID determinism
SELECT * FROM test_uuid_determinism();

-- Test specific function
SELECT uuid_human_resource('Test Staff');
SELECT uuid_human_resource('Test Staff');  -- Should return same UUID
```

**Expected output**:
```
✅ Migration 001: Deterministic UUID functions created successfully!
   - Core UUID v5 generation function created
   - Application namespace UUID: 6ba7b810-9dad-11d1-80b4-00c04fd430c8
   - 7 table-specific UUID functions created
   - Test function available: test_uuid_determinism()
```

### Step 2: Migrate Existing Data to Deterministic UUIDs

**File**: `002-migrate-existing-data-to-deterministic-uuids.sql`

**Purpose**: Converts all existing random UUIDs to deterministic UUIDs based on natural keys.

**⚠️ IMPORTANT**: 
- This migration runs in a transaction and can be rolled back if it fails
- **Create a full backup before running this migration**
- This migration will temporarily drop and recreate foreign key constraints
- Estimated time: 5-30 minutes depending on data volume

**What it does**:
1. Creates temporary mapping tables to store old UUID → new UUID mappings
2. Generates new deterministic UUIDs for all records based on natural keys
3. Updates primary keys and foreign key references in correct dependency order
4. Validates data integrity and checks for orphaned records
5. Verifies all foreign key constraints are intact

**Migration order** (respects foreign key dependencies):
1. `human_resource` (no dependencies)
2. `periods` (no dependencies)
3. `settings` (no dependencies)
4. `holiday_entitlements` (depends on human_resource)
5. `shifts` (depends on periods, human_resource)
6. `change_requests` (depends on human_resource)
7. `unavailable_staff_daily` (depends on periods)

**How to run**:
```bash
# Create backup first!
pg_dump -h localhost -U postgres -d danieltime -F c -f backup_before_migration_002.dump

# Run migration
psql -h localhost -U postgres -d danieltime -f 002-migrate-existing-data-to-deterministic-uuids.sql
```

**Verification**:
```sql
-- Check for orphaned records
SELECT * FROM test_foreign_key_integrity();

-- Verify UUID uniqueness
SELECT * FROM test_uuid_uniqueness();

-- Check data consistency
SELECT * FROM test_data_consistency();
```

**Expected output**:
```
✅ Migration 002 completed successfully!
Total records migrated: [count]
Tables migrated:
  - human_resource: [count] records
  - periods: [count] records
  - settings: [count] records
  - holiday_entitlements: [count] records
  - shifts: [count] records
  - change_requests: [count] records
  - unavailable_staff_daily: [count] records
```

**Rollback procedure** (if migration fails):
```bash
# Stop the application
# Drop and recreate database
DROP DATABASE danieltime;
CREATE DATABASE danieltime;

# Restore from backup
pg_restore -h localhost -U postgres -d danieltime backup_before_migration_002.dump
```

### Step 3: Set Up Logical Replication

**File**: `003-setup-logical-replication.sql`

**Purpose**: Sets up bidirectional PostgreSQL logical replication between two databases.

**⚠️ PREREQUISITES**:
1. Both databases must have `wal_level = logical` in `postgresql.conf`
2. Both PostgreSQL servers must be restarted after changing `wal_level`
3. Both databases must be accessible from each other
4. Migrations 001 and 002 must be completed first
5. Both databases must have identical schemas

**What it does**:
1. Creates replication user with necessary permissions
2. Creates publication for all tables
3. Creates subscription to the other database (requires connection string configuration)
4. Sets up monitoring functions for replication health
5. Configures conflict resolution

**Configuration Required**:

Before running this migration, you must edit the connection string in the migration file:

```sql
-- In 003-setup-logical-replication.sql, find this section and update:
other_db_host := 'REPLACE_WITH_OTHER_DB_HOST';  -- e.g., '192.168.1.100' or 'db2.example.com'
other_db_port := '5432';  -- Default PostgreSQL port
other_db_name := 'danieltime';  -- Database name
replication_password := 'REPLACE_WITH_REPLICATION_PASSWORD';  -- Password for replication_user
```

**How to run**:

**On Database 1** (pointing to Database 2):
```bash
# Edit migration file first to set connection string to DB2
psql -h localhost -U postgres -d danieltime -f 003-setup-logical-replication.sql
```

**On Database 2** (pointing to Database 1):
```bash
# Edit migration file first to set connection string to DB1
psql -h localhost -U postgres -d danieltime -f 003-setup-logical-replication.sql
```

**Verification**:
```sql
-- Check replication status
SELECT * FROM get_replication_status();

-- Check replication lag
SELECT * FROM check_replication_lag();

-- Check for conflicts
SELECT * FROM check_replication_conflicts();

-- View useful commands
SELECT show_replication_commands();
```

**Expected output**:
```
✅ Migration 003 completed successfully!
Replication Setup Summary:
  - Publication: db_publication
  - Tables in publication: 7
  - Subscription: db_subscription
  - Subscription exists: true
```

**Testing Replication**:

1. **Insert test on DB1**:
   ```sql
   INSERT INTO human_resource (staff_name, role) 
   VALUES ('Replication Test Staff', 'staff member')
   ON CONFLICT (staff_name) DO NOTHING;
   ```

2. **Verify on DB2** (wait a few seconds):
   ```sql
   SELECT * FROM human_resource WHERE staff_name = 'Replication Test Staff';
   ```

3. **Insert test on DB2**:
   ```sql
   INSERT INTO periods (period_name, start_date, end_date) 
   VALUES ('Replication Test Period', '2025-01-01', '2025-01-28')
   ON CONFLICT DO NOTHING;
   ```

4. **Verify on DB1** (wait a few seconds):
   ```sql
   SELECT * FROM periods WHERE period_name = 'Replication Test Period';
   ```

For more detailed test instructions:
```sql
SELECT get_replication_test_instructions();
```

### Step 4: Verification Tests

**File**: `004-verification-tests.sql`

**Purpose**: Creates comprehensive test functions for verifying the migration and replication setup.

**What it does**:
- Creates test functions for UUID determinism
- Creates test functions for data integrity
- Creates test functions for replication setup
- Creates test functions for performance
- Creates master test runner function

**How to run**:
```bash
psql -h localhost -U postgres -d danieltime -f 004-verification-tests.sql
```

**Running Tests**:

**Run all tests**:
```sql
SELECT * FROM run_all_verification_tests();
```

**Get test summary**:
```sql
SELECT * FROM generate_test_summary_report();
```

**Individual test suites**:
```sql
-- UUID determinism tests
SELECT * FROM test_all_uuid_determinism();

-- Data integrity tests
SELECT * FROM test_foreign_key_integrity();
SELECT * FROM test_primary_key_constraints();
SELECT * FROM test_uuid_uniqueness();
SELECT * FROM test_data_consistency();

-- Replication tests
SELECT * FROM test_replication_setup();
SELECT * FROM test_replication_lag();

-- Performance tests
SELECT * FROM test_uuid_generation_performance();
SELECT * FROM test_table_statistics();
```

**UUID Consistency Across Databases**:

To verify UUIDs are consistent across both databases:

1. **On Database 1**:
   ```sql
   SELECT * FROM test_uuid_consistency_across_databases();
   ```

2. **On Database 2**:
   ```sql
   SELECT * FROM test_uuid_consistency_across_databases();
   ```

3. **Compare the UUIDs** - they should be identical for the same natural keys.

## Complete Migration Workflow

### For a Fresh Setup (New Database)

1. **Create database**:
   ```bash
   createdb -h localhost -U postgres danieltime
   ```

2. **Run initial schema setup**:
   ```bash
   psql -h localhost -U postgres -d danieltime -f ../complete-database-setup.sql
   ```

3. **Run migrations in order**:
   ```bash
   psql -h localhost -U postgres -d danieltime -f 001-create-deterministic-uuid-functions.sql
   psql -h localhost -U postgres -d danieltime -f 002-migrate-existing-data-to-deterministic-uuids.sql
   psql -h localhost -U postgres -d danieltime -f 003-setup-logical-replication.sql
   psql -h localhost -U postgres -d danieltime -f 004-verification-tests.sql
   ```

### For Existing Database (Migration)

1. **Create backup**:
   ```bash
   pg_dump -h localhost -U postgres -d danieltime -F c -f backup_before_migration.dump
   ```

2. **Run migrations in order**:
   ```bash
   psql -h localhost -U postgres -d danieltime -f 001-create-deterministic-uuid-functions.sql
   psql -h localhost -U postgres -d danieltime -f 002-migrate-existing-data-to-deterministic-uuids.sql
   psql -h localhost -U postgres -d danieltime -f 003-setup-logical-replication.sql
   psql -h localhost -U postgres -d danieltime -f 004-verification-tests.sql
   ```

3. **Run verification tests**:
   ```sql
   SELECT * FROM run_all_verification_tests();
   SELECT * FROM generate_test_summary_report();
   ```

## Replication Management

### Monitoring Replication

**Check replication status**:
```sql
SELECT * FROM get_replication_status();
```

**Check replication lag**:
```sql
SELECT * FROM check_replication_lag();
```

**Check for conflicts**:
```sql
SELECT * FROM check_replication_conflicts();
```

**View subscription details**:
```sql
SELECT * FROM pg_subscription WHERE subname = 'db_subscription';
```

**View publication details**:
```sql
SELECT * FROM pg_publication WHERE pubname = 'db_publication';
SELECT * FROM pg_publication_tables WHERE pubname = 'db_publication';
```

**View replication slots**:
```sql
SELECT * FROM pg_replication_slots;
```

### Managing Subscriptions

**Enable subscription**:
```sql
ALTER SUBSCRIPTION db_subscription ENABLE;
```

**Disable subscription**:
```sql
ALTER SUBSCRIPTION db_subscription DISABLE;
```

**Refresh subscription** (re-sync):
```sql
ALTER SUBSCRIPTION db_subscription REFRESH PUBLICATION;
```

**Drop subscription** (if needed):
```sql
ALTER SUBSCRIPTION db_subscription DISABLE;
DROP SUBSCRIPTION db_subscription;
```

### Troubleshooting Replication

**Issue: Subscription not working**

1. Check subscription status:
   ```sql
   SELECT subname, subenabled, subconninfo FROM pg_subscription;
   ```

2. Check for errors in PostgreSQL logs:
   ```bash
   # Linux
   tail -f /var/log/postgresql/postgresql-*.log
   
   # Windows
   # Check Event Viewer > Applications and Services Logs > PostgreSQL
   ```

3. Verify network connectivity:
   ```bash
   # From DB1, test connection to DB2
   psql -h [DB2_HOST] -U replication_user -d danieltime
   ```

4. Check replication slot:
   ```sql
   SELECT * FROM pg_replication_slots WHERE slot_name = 'db_subscription';
   ```

**Issue: High replication lag**

1. Check lag:
   ```sql
   SELECT * FROM check_replication_lag();
   ```

2. Check WAL sender processes:
   ```sql
   SELECT * FROM pg_stat_replication;
   ```

3. Check disk space (WAL files):
   ```sql
   SELECT pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0'));
   ```

4. If lag is too high, consider:
   - Increasing `max_wal_senders`
   - Checking network bandwidth
   - Reducing write load temporarily

**Issue: Replication conflicts**

With deterministic UUIDs, conflicts should be rare. If conflicts occur:

1. Check conflict logs in PostgreSQL logs
2. Review conflict resolution strategy in `config.js`
3. Consider using `ON CONFLICT` clauses in application code

## Rollback Procedures

### Rollback Migration 002 (UUID Migration)

If migration 002 fails or needs to be rolled back:

1. **Stop the application**

2. **Restore from backup**:
   ```bash
   # Drop and recreate database
   DROP DATABASE danieltime;
   CREATE DATABASE danieltime;
   
   # Restore from backup
   pg_restore -h localhost -U postgres -d danieltime backup_before_migration_002.dump
   ```

3. **Verify data integrity**:
   ```sql
   SELECT COUNT(*) FROM human_resource;
   SELECT COUNT(*) FROM periods;
   -- etc.
   ```

### Rollback Migration 003 (Replication)

If replication setup needs to be removed:

1. **Disable and drop subscription**:
   ```sql
   ALTER SUBSCRIPTION db_subscription DISABLE;
   DROP SUBSCRIPTION db_subscription;
   ```

2. **Drop publication** (optional):
   ```sql
   DROP PUBLICATION db_publication;
   ```

3. **Remove replication user** (optional):
   ```sql
   DROP USER replication_user;
   ```

**Note**: Rolling back replication does not affect data. The deterministic UUIDs remain in place.

## Application Code Changes

After running migrations, ensure your application code uses deterministic UUIDs:

### In `server.js`

**Before** (random UUIDs):
```javascript
const newId = uuidv4();  // Random UUID
await pool.query('INSERT INTO human_resource (unique_id, staff_name) VALUES ($1, $2)', [newId, staffName]);
```

**After** (deterministic UUIDs):
```javascript
// Option 1: Let database generate UUID (recommended)
await pool.query('INSERT INTO human_resource (staff_name) VALUES ($1)', [staffName]);

// Option 2: Generate UUID in application
const newId = await pool.query('SELECT uuid_human_resource($1) as id', [staffName]);
await pool.query('INSERT INTO human_resource (unique_id, staff_name) VALUES ($1, $2)', [newId.rows[0].id, staffName]);
```

### Table Defaults

The `complete-database-setup.sql` file has been updated to use deterministic UUID functions as defaults:

```sql
CREATE TABLE human_resource (
    unique_id UUID PRIMARY KEY DEFAULT uuid_human_resource(staff_name),
    -- ...
);
```

## Configuration

### Environment Variables

You can configure replication settings via environment variables (see `config.js`):

```bash
# Replication settings
export REPLICATION_ENABLED=true
export REPLICATION_USER=replication_user
export REPLICATION_PASSWORD=your_secure_password

# Database 2 settings
export DB2_HOST=192.168.1.100
export DB2_PORT=5432
export DB2_NAME=danieltime
export DB2_USER=postgres
export DB2_PASSWORD=postgres_password

# UUID settings
export UUID_NAMESPACE=6ba7b810-9dad-11d1-80b4-00c04fd430c8
export DETERMINISTIC_UUID_ENABLED=true
```

### Application Namespace UUID

The application namespace UUID is hardcoded in the migration files:
- **Namespace UUID**: `6ba7b810-9dad-11d1-80b4-00c04fd430c8`

**⚠️ Important**: Do not change this UUID after data has been migrated. Changing it will cause all UUIDs to be different, breaking replication.

## Best Practices

1. **Always create backups** before running migrations
2. **Test migrations in a staging environment** first
3. **Run migrations during low-traffic periods** if possible
4. **Monitor replication lag** regularly
5. **Keep PostgreSQL logs** for troubleshooting
6. **Document any custom configurations** for your environment
7. **Test rollback procedures** in staging before production
8. **Monitor disk space** (WAL files can grow)
9. **Use connection pooling** in application code
10. **Keep both databases in sync** - don't disable replication for extended periods

## Troubleshooting

### Common Issues

**Issue: Migration 001 fails - "uuid-ossp extension not found"**

**Solution**:
```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

**Issue: Migration 002 fails - "UUID collision detected"**

**Solution**: This should not happen with deterministic UUIDs. Check for:
- Duplicate natural keys in your data
- Migration 001 was run correctly
- Contact support if issue persists

**Issue: Migration 003 fails - "wal_level must be set to logical"**

**Solution**:
1. Edit `postgresql.conf`: `wal_level = logical`
2. Restart PostgreSQL
3. Verify: `SHOW wal_level;`

**Issue: Subscription fails to connect**

**Solution**:
1. Verify network connectivity between databases
2. Check firewall rules
3. Verify replication user credentials
4. Check PostgreSQL `pg_hba.conf` for replication user permissions

**Issue: Replication lag is high**

**Solution**:
1. Check network bandwidth
2. Increase `max_wal_senders` in `postgresql.conf`
3. Check for long-running transactions
4. Monitor disk I/O

## Support and Resources

- **PostgreSQL Logical Replication Documentation**: https://www.postgresql.org/docs/current/logical-replication.html
- **UUID v5 (RFC 4122)**: https://tools.ietf.org/html/rfc4122
- **PostgreSQL WAL Documentation**: https://www.postgresql.org/docs/current/wal.html

## Migration Checklist

Use this checklist when running migrations:

### Pre-Migration

- [ ] Create full database backup
- [ ] Verify backup was created successfully
- [ ] Test backup restoration in test environment
- [ ] Review migration files for your environment
- [ ] Configure PostgreSQL `postgresql.conf` (wal_level = logical)
- [ ] Restart PostgreSQL after configuration changes
- [ ] Verify network connectivity between databases
- [ ] Schedule migration during maintenance window (if needed)

### Migration Execution

- [ ] Run migration 001: Create deterministic UUID functions
- [ ] Verify migration 001: Test UUID determinism
- [ ] Run migration 002: Migrate existing data
- [ ] Verify migration 002: Check data integrity
- [ ] Configure migration 003: Edit connection strings
- [ ] Run migration 003 on Database 1
- [ ] Run migration 003 on Database 2
- [ ] Verify migration 003: Test replication
- [ ] Run migration 004: Create verification tests
- [ ] Run all verification tests

### Post-Migration

- [ ] Verify application works correctly
- [ ] Monitor replication lag
- [ ] Test bidirectional replication (insert on DB1, verify on DB2)
- [ ] Test bidirectional replication (insert on DB2, verify on DB1)
- [ ] Update application code if needed
- [ ] Document any custom configurations
- [ ] Set up monitoring for replication health

## Success Criteria

Migration is successful when:

- ✅ All UUIDs are deterministic (same input = same UUID)
- ✅ Both databases have identical data
- ✅ Replication lag < 1 second under normal load
- ✅ No data loss during migration
- ✅ All foreign key relationships intact
- ✅ Application works correctly with new UUID system
- ✅ Replication handles conflicts gracefully
- ✅ All verification tests pass

---

**Last Updated**: 2025-01-XX  
**Version**: 1.0  
**PostgreSQL Version**: 10+  
**Author**: Database Migration Team
