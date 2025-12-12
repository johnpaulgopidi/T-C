-- Add SSP and CSP shift types to the shifts table
-- This script updates the shift_type constraint to include SSP and CSP

-- First, drop the existing constraint
ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_shift_type_check;

-- Add the new constraint with SSP and CSP included
ALTER TABLE shifts ADD CONSTRAINT shifts_shift_type_check 
CHECK (shift_type IN ('Tom Day', 'Charlotte Day', 'Double Up', 'Tom Night', 'Charlotte Night', 'HOLIDAY', 'SSP', 'CSP'));

-- Verify the constraint was added successfully
SELECT 
    conname as constraint_name,
    pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint 
WHERE conname = 'shifts_shift_type_check';

-- Show current shift types in the database
SELECT DISTINCT shift_type 
FROM shifts 
ORDER BY shift_type;

-- Show completion message
SELECT '✅ SSP and CSP shift types added successfully!' as status;
