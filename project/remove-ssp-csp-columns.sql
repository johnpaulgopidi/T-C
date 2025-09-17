-- Remove SSP and CSP columns from shifts table
-- This script removes the ssp and csp columns that were added for time-off management
-- The shift_type column will still support 'SSP' and 'CSP' values for pay calculation

-- Remove the ssp column
ALTER TABLE shifts DROP COLUMN IF EXISTS ssp;

-- Remove the csp column  
ALTER TABLE shifts DROP COLUMN IF EXISTS csp;

-- Verify the columns have been removed
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'shifts' 
AND column_name IN ('ssp', 'csp', 'time_off_type')
ORDER BY column_name;

-- Show updated table structure
SELECT '✅ SSP and CSP columns removed successfully!' as status;

-- Show current shifts table columns
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'shifts' 
ORDER BY ordinal_position;
