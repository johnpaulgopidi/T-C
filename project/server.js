// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const dbConfig = require('./config');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// PostgreSQL connection configuration
const pool = new Pool(dbConfig);

// Database connection test
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
    console.error('❌ Connection details:', {
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user,
      hasPassword: !!dbConfig.password
    });
  } else {
    console.log('✅ Database connected successfully');
    console.log('📊 Connection details:', {
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user
    });
  }
});

// Test database tables exist
pool.query(`
  SELECT table_name 
  FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name IN ('shifts', 'human_resource', 'periods')
`, (err, res) => {
  if (err) {
    console.error('❌ Error checking tables:', err.message);
  } else {
    console.log('📋 Available tables:', res.rows.map(r => r.table_name));
    
    // Check if required tables exist
    const requiredTables = ['shifts', 'human_resource', 'periods'];
    const missingTables = requiredTables.filter(table => 
      !res.rows.find(r => r.table_name === table)
    );
    
    if (missingTables.length > 0) {
      console.error('❌ Missing required tables:', missingTables);
      console.error('💡 Run the database setup script: npm run setup-db');
    } else {
      console.log('✅ All required tables exist');
    }
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: 'Something went wrong on the server'
  });
});

// Validation middleware
const validateRequiredFields = (requiredFields) => {
  return (req, res, next) => {
    const missingFields = requiredFields.filter(field => !req.body[field]);
    if (missingFields.length > 0) {
      return res.status(400).json({
        error: 'Missing required fields',
        missing: missingFields,
        received: req.body
      });
    }
    next();
  };
};

// =====================================================
// JAVASCRIPT-BASED SNAPSHOT SYSTEM
// =====================================================

// In-memory storage for staff snapshots (no database required)
const staffSnapshots = new Map(); // Map<date, staffData[]>
const snapshotDates = []; // Array of dates when snapshots were taken

// Function to take a snapshot of current staff data
async function takeStaffSnapshot(snapshotDate = new Date().toISOString().split('T')[0]) {
  try {
    console.log('📸 Taking staff snapshot for date:', snapshotDate);
    
    // Get current staff data from database
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'human_resource' AND column_name = 'color_code'
    `);
    
    let query;
    if (columnCheck.rows.length > 0) {
      query = `
        SELECT 
          unique_id,
          staff_name,
          role,
          is_active,
          created_at,
          updated_at,
          pay_rate,
          contracted_hours,
          color_code
        FROM human_resource
        WHERE is_active = true
        ORDER BY staff_name
      `;
    } else {
      query = `
        SELECT 
          unique_id,
          staff_name,
          role,
          is_active,
          created_at,
          updated_at,
          pay_rate,
          contracted_hours
        FROM human_resource
        WHERE is_active = true
        ORDER BY staff_name
      `;
    }
    
    const result = await pool.query(query);
    const staffData = result.rows.map(staff => ({
      ...staff,
      snapshot_date: snapshotDate,
      snapshot_timestamp: new Date().toISOString()
    }));
    
    // Store snapshot in memory
    staffSnapshots.set(snapshotDate, staffData);
    
    // Add date to sorted array if not already present
    if (!snapshotDates.includes(snapshotDate)) {
      snapshotDates.push(snapshotDate);
      snapshotDates.sort(); // Keep dates sorted
    }
    
    console.log('✅ Snapshot taken successfully:', {
      date: snapshotDate,
      staffCount: staffData.length,
      totalSnapshots: staffSnapshots.size
    });
    
    return staffData.length;
  } catch (error) {
    console.error('❌ Error taking snapshot:', error);
    throw error;
  }
}

// Function to get staff data as of a specific date
function getStaffAsOf(targetDate) {
  try {
    console.log('🔍 Getting staff data as of:', targetDate);
    
    // Find the most recent snapshot date that is <= targetDate
    const availableDates = snapshotDates.filter(date => date <= targetDate);
    
    if (availableDates.length === 0) {
      console.log('⚠️ No snapshots available for date:', targetDate);
      return [];
    }
    
    const mostRecentDate = availableDates[availableDates.length - 1];
    const staffData = staffSnapshots.get(mostRecentDate);
    
    console.log('✅ Found staff data:', {
      targetDate,
      snapshotDate: mostRecentDate,
      staffCount: staffData ? staffData.length : 0
    });
    
    return staffData || [];
  } catch (error) {
    console.error('❌ Error getting staff data as of date:', error);
    return [];
  }
}

// Function to calculate historical pay based on role history
async function calculateHistoricalPay(staffName, calculationDate, hoursWorked = null, shiftFlags = {}) {
  try {
    console.log(`🔍 Calculating historical pay for ${staffName} on ${calculationDate}`);
    
    // Get current staff info as baseline
    const currentStaffResult = await pool.query('SELECT * FROM human_resource WHERE staff_name = $1', [staffName]);
    if (currentStaffResult.rows.length === 0) {
      throw new Error(`Staff member ${staffName} not found`);
    }
    
    const currentStaff = currentStaffResult.rows[0];
    
    // Get the most recent pay rate change before the calculation date
    // If calculationDate is just a date, we need to treat it as end of day to include changes on that date
    const endOfDay = calculationDate.includes('T') ? calculationDate : `${calculationDate}T23:59:59.999Z`;
    
    const payRateHistoryResult = await pool.query(`
      SELECT * FROM change_requests 
      WHERE staff_name = $1 
      AND change_type = 'pay_rate_change'
      AND effective_from_date <= $2::timestamp
      ORDER BY effective_from_date DESC
      LIMIT 1
    `, [staffName, endOfDay]);
    
    let effectivePayRate;
    let effectiveRateDate = currentStaff.created_at;
    
    if (payRateHistoryResult.rows.length > 0) {
      // There was a pay rate change before this date, use the rate from that change
      const payRateChange = payRateHistoryResult.rows[0];
      effectivePayRate = parseFloat(payRateChange.new_value);
      effectiveRateDate = payRateChange.changed_at;
      console.log(`📅 Found pay rate change on ${payRateChange.changed_at}: £${payRateChange.old_value} -> £${payRateChange.new_value}`);
    } else {
      // No pay rate changes before this date, need to find the original pay rate
      // Get the first pay rate change to find the original rate
      const firstPayRateChangeResult = await pool.query(`
        SELECT * FROM change_requests 
        WHERE staff_name = $1 
        AND change_type = 'pay_rate_change'
        ORDER BY effective_from_date ASC
        LIMIT 1
      `, [staffName]);
      
      if (firstPayRateChangeResult.rows.length > 0) {
        // Use the old_value from the first pay rate change (the original rate)
        const firstChange = firstPayRateChangeResult.rows[0];
        effectivePayRate = parseFloat(firstChange.old_value);
        effectiveRateDate = currentStaff.created_at;
        console.log(`📅 No pay rate changes before ${calculationDate}, using original pay rate: £${effectivePayRate}/hr`);
      } else {
        // No pay rate changes at all, use current pay rate as fallback
        effectivePayRate = parseFloat(currentStaff.pay_rate);
        effectiveRateDate = currentStaff.created_at;
        console.log(`📅 No pay rate changes found, using current pay rate as fallback: £${effectivePayRate}/hr`);
      }
    }
    
    console.log(`💰 Effective pay rate: £${effectivePayRate}/hr`);
    console.log(`🚩 Shift flags received:`, shiftFlags);
    
    const actualHours = hoursWorked || parseFloat(currentStaff.contracted_hours) || 12;
    
    // Calculate pay with multipliers based on shift flags
    let multiplier = 1.0;
    
    // Apply multipliers based on flags
    if (shiftFlags.solo_shift) {
      multiplier = Math.max(multiplier, 1.75);
    }
    
    if (shiftFlags.training || shiftFlags.short_notice) {
      multiplier = Math.max(multiplier, 1.75);
    }
    
    
    if (shiftFlags.overtime) {
      multiplier = Math.max(multiplier, 2.0);
    }
    
    const basePay = effectivePayRate * actualHours;
    const weeklyPay = basePay * multiplier;
    
    return {
      staff_name: staffName,
      effective_pay_rate: effectivePayRate,
      pay_rate: effectivePayRate.toString(),
      contracted_hours: currentStaff.contracted_hours,
      hours_worked: actualHours,
      base_pay: Math.round(basePay * 100) / 100,
      multiplier: multiplier,
      weekly_pay: Math.round(weeklyPay * 100) / 100,
      calculation_date: calculationDate,
      effective_rate_date: effectiveRateDate,
      shift_flags: shiftFlags
    };
  } catch (error) {
    console.error('❌ Error calculating historical pay:', error);
    throw error;
  }
}

// Function to calculate historical statutory holiday pay (UK)
function calculateHistoricalHolidayPay(staffName, holidayDate, weeksWorked = 52) {
  try {
    const staffData = getStaffAsOf(holidayDate);
    const staffMember = staffData.find(staff => staff.staff_name === staffName);
    
    if (!staffMember) {
      throw new Error(`Staff member ${staffName} not found for date ${holidayDate}`);
    }
    
    const weeklyPay = staffMember.pay_rate * staffMember.contracted_hours;
    const holidayPay = (weeklyPay * 5.6) / 52; // UK statutory minimum 5.6 weeks per year
    
    return {
      staff_name: staffMember.staff_name,
      holiday_date: holidayDate,
      pay_rate: staffMember.pay_rate,
      contracted_hours: staffMember.contracted_hours,
      weekly_pay: Math.round(weeklyPay * 100) / 100,
      holiday_pay: Math.round(holidayPay * 100) / 100,
      effective_rate_date: staffMember.snapshot_date
    };
  } catch (error) {
    console.error('❌ Error calculating historical holiday pay:', error);
    throw error;
  }
}


// Function to get snapshot statistics
function getSnapshotStats() {
  return {
    total_snapshots: staffSnapshots.size,
    earliest_date: snapshotDates.length > 0 ? snapshotDates[0] : null,
    latest_date: snapshotDates.length > 0 ? snapshotDates[snapshotDates.length - 1] : null,
    snapshot_dates: snapshotDates,
    memory_usage: process.memoryUsage()
  };
}

// Take initial snapshot when server starts
takeStaffSnapshot().catch(error => {
  console.error('❌ Failed to take initial snapshot:', error);
});

// API Routes

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'Server is running', 
    timestamp: new Date().toISOString(),
    status: 'healthy'
  });
});

// Get a single staff member by ID
app.get('/api/staff/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT 
        unique_id,
        staff_name,
        role,
        pay_rate,
        contracted_hours,
        employment_start_date,
        employment_end_date,
        color_code,
        is_active,
        created_at,
        updated_at
      FROM human_resource 
      WHERE unique_id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Staff member not found',
        message: 'No staff member found with the specified ID'
      });
    }
    
    res.json({
      success: true,
      data: result.rows[0]
    });
    
  } catch (err) {
    console.error('Error getting staff member:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to get staff member',
      message: err.message
    });
  }
});

// Get all staff members (current state)
app.get('/api/staff', async (req, res) => {
  try {
    console.log('👥 Fetching current staff members...');
    
    // Check if color_code column exists
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'human_resource' AND column_name = 'color_code'
    `);
    
    let query;
    if (columnCheck.rows.length > 0) {
      // color_code column exists, include it in the query
      query = `
        SELECT 
          unique_id,
          staff_name,
          role,
          is_active,
          created_at,
          updated_at,
          pay_rate,
          contracted_hours,
          color_code,
          employment_start_date,
          employment_end_date
        FROM human_resource
        ORDER BY staff_name
      `;
    } else {
      // color_code column doesn't exist, exclude it from the query
      query = `
        SELECT 
          unique_id,
          staff_name,
          role,
          is_active,
          created_at,
          updated_at,
          pay_rate,
          contracted_hours,
          employment_start_date,
          employment_end_date
        FROM human_resource
        ORDER BY staff_name
      `;
    }
    
    const result = await pool.query(query);
    console.log('✅ Staff query successful, found:', result.rows.length, 'staff members');
    
    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (err) {
    console.error('❌ Error fetching staff members:', err);
    console.error('❌ Error details:', {
      message: err.message,
      code: err.code,
      detail: err.detail,
      hint: err.hint
    });
    
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch staff members',
      message: err.message,
      details: {
        code: err.code,
        detail: err.detail,
        hint: err.hint
      }
    });
  }
});

// Get staff members as they were at a specific point in time (using JavaScript snapshots)
app.get('/api/staff/historical/:date', async (req, res) => {
  try {
    const { date } = req.params;
    console.log('👥 Fetching staff members as of:', date, '(using JavaScript snapshots)');
    
    // Validate date format
    const targetDate = new Date(date);
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format',
        message: 'Date must be in ISO format (YYYY-MM-DD)'
      });
    }
    
    const targetDateStr = targetDate.toISOString().split('T')[0];
    
    // Use the JavaScript-based snapshot system
    const historicalStaff = getStaffAsOf(targetDateStr);
    
    console.log('✅ Historical staff query successful (JavaScript snapshots), found:', historicalStaff.length, 'staff members');
    
    res.json({
      success: true,
      data: historicalStaff,
      count: historicalStaff.length,
      targetDate: targetDateStr,
      method: 'javascript_snapshots'
    });
  } catch (err) {
    console.error('❌ Error fetching historical staff members:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch historical staff members',
      message: err.message
    });
  }
});

// Take snapshot endpoint (for manual snapshots)
app.post('/api/staff/snapshot', async (req, res) => {
  try {
    const { date } = req.body;
    const snapshotDate = date || new Date().toISOString().split('T')[0];
    
    const snapshotCount = await takeStaffSnapshot(snapshotDate);
    
    res.json({
      success: true,
      message: `Snapshot taken for ${snapshotDate}`,
      snapshotCount: snapshotCount
    });
    
  } catch (error) {
    console.error('Error taking snapshot:', error);
    res.status(500).json({ error: 'Failed to take snapshot' });
  }
});

// Get snapshot statistics
app.get('/api/staff/snapshots/stats', async (req, res) => {
  try {
    const stats = getSnapshotStats();
    
    res.json({
      success: true,
      data: stats
    });
    
  } catch (error) {
    console.error('Error getting snapshot stats:', error);
    res.status(500).json({ error: 'Failed to get snapshot statistics' });
  }
});

// =====================================================
// HISTORICAL PAY CALCULATION ENDPOINTS
// =====================================================

// Check if there are any changes for a staff member before a specific date
app.post('/api/staff/has-changes-before-date', async (req, res) => {
  try {
    const { staff_name, before_date } = req.body;
    
    if (!staff_name || !before_date) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'staff_name and before_date are required'
      });
    }
    
    // Check if there are any changes in change_requests before the specified date
    const result = await pool.query(`
      SELECT COUNT(*) as change_count
      FROM change_requests 
      WHERE staff_name = $1 
      AND effective_from_date <= $2::timestamp
    `, [staff_name, before_date]);
    
    const changeCount = parseInt(result.rows[0].change_count);
    const hasChanges = changeCount > 0;
    
    res.json({
      success: true,
      has_changes: hasChanges,
      change_count: changeCount,
      message: hasChanges 
        ? `Found ${changeCount} changes for ${staff_name} before ${before_date}`
        : `No changes found for ${staff_name} before ${before_date}`
    });
    
  } catch (error) {
    console.error('❌ Error checking staff changes:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to check staff changes'
    });
  }
});

// Calculate historical weekly pay
app.post('/api/staff/historical-pay', async (req, res) => {
  try {
    const { staff_name, calculation_date, hours_worked, shift_flags } = req.body;
    
    if (!staff_name || !calculation_date) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'staff_name and calculation_date are required'
      });
    }
    
    const payCalculation = await calculateHistoricalPay(staff_name, calculation_date, hours_worked, shift_flags || {});
    
    res.json({
      success: true,
      data: payCalculation,
      message: `Historical pay calculated for ${staff_name} as of ${calculation_date}`
    });
    
  } catch (error) {
    console.error('Error calculating historical pay:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate historical pay',
      message: error.message
    });
  }
});

// Calculate historical statutory holiday pay
app.post('/api/staff/historical-holiday-pay', async (req, res) => {
  try {
    const { staff_name, holiday_date, weeks_worked = 52 } = req.body;
    
    if (!staff_name || !holiday_date) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'staff_name and holiday_date are required'
      });
    }
    
    const holidayPayCalculation = calculateHistoricalHolidayPay(staff_name, holiday_date, weeks_worked);
    
    res.json({
      success: true,
      data: holidayPayCalculation,
      message: `Historical holiday pay calculated for ${staff_name} as of ${holiday_date}`
    });
    
  } catch (error) {
    console.error('Error calculating historical holiday pay:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate historical holiday pay',
      message: error.message
    });
  }
});


// Get all snapshots for a staff member
app.get('/api/staff/:staff_name/snapshots', async (req, res) => {
  try {
    const { staff_name } = req.params;
    
    const snapshots = [];
    for (const [date, staffData] of staffSnapshots.entries()) {
      const staffMember = staffData.find(staff => staff.staff_name === staff_name);
      if (staffMember) {
        snapshots.push({
          snapshot_date: date,
          staff_data: staffMember
        });
      }
    }
    
    res.json({
      success: true,
      data: snapshots,
      count: snapshots.length,
      message: `Found ${snapshots.length} snapshots for ${staff_name}`
    });
    
  } catch (error) {
    console.error('Error getting staff snapshots:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get staff snapshots',
      message: error.message
    });
  }
});

// Add new staff member
app.post('/api/staff', 
  validateRequiredFields(['name', 'employment_start_date']),
  async (req, res) => {
  try {
    const { 
      name, 
      role = 'staff member', 
      employment_start_date,
      employment_end_date,
      contracted_hours,
      pay_rate
    } = req.body;
      
      // Validate role
      if (!['team leader', 'staff member'].includes(role)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid role',
          message: 'Role must be either "team leader" or "staff member"'
        });
      }

      // Validate employment start date
      if (!employment_start_date) {
        return res.status(400).json({
          success: false,
          error: 'Missing employment start date',
          message: 'Employment start date is required'
        });
      }
    
    const result = await pool.query(
      `INSERT INTO human_resource (
        staff_name, 
        role, 
        employment_start_date,
        employment_end_date,
        contracted_hours,
        pay_rate
      ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, role, employment_start_date, employment_end_date, contracted_hours, pay_rate]
    );
    
    const newStaff = result.rows[0];
    
    // Create holiday entitlement for the new staff member
    try {
      await pool.query('SELECT recalculate_holiday_entitlement($1, $2)', [
        newStaff.unique_id, 
        employment_end_date
      ]);
      console.log(`✅ Holiday entitlement created for new staff member: ${name}`);
    } catch (holidayError) {
      console.error(`⚠️ Warning: Failed to create holiday entitlement for ${name}:`, holidayError.message);
      // Don't fail the entire request if holiday entitlement creation fails
    }
    
      res.status(201).json({
        success: true,
        data: newStaff,
        message: 'Staff member added successfully'
      });
  } catch (err) {
    console.error('Error adding staff member:', err);
      if (err.code === '23505') { // Unique constraint violation
        res.status(409).json({
          success: false,
          error: 'Staff member already exists',
          message: 'A staff member with this name already exists'
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to add staff member',
          message: err.message
        });
      }
    }
  }
);

// Delete staff member
app.delete('/api/staff/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if staff member exists
    const checkResult = await pool.query(
      'SELECT staff_name FROM human_resource WHERE unique_id = $1',
      [id]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Staff member not found',
        message: 'No staff member found with the specified ID'
      });
    }
    
    // Check if staff member has any shifts
    const shiftsResult = await pool.query(
      'SELECT COUNT(*) as shift_count FROM shifts WHERE staff_name = $1',
      [checkResult.rows[0].staff_name]
    );
    
    if (parseInt(shiftsResult.rows[0].shift_count) > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete staff member',
        message: 'Staff member has assigned shifts and cannot be deleted'
      });
    }
    
    await pool.query('DELETE FROM human_resource WHERE unique_id = $1', [id]);
    
    res.json({
      success: true,
      message: 'Staff member deleted successfully',
      deletedStaff: checkResult.rows[0].staff_name
    });
  } catch (err) {
    console.error('Error deleting staff member:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to delete staff member',
      message: err.message
    });
  }
});

// Update staff member role
app.put('/api/staff/:id/role', 
  validateRequiredFields(['role']),
  async (req, res) => {
  try {
    const { id } = req.params;
    const { role, changed_by = 'system', reason = '', effective_from_date = null } = req.body;
    
    // Validate role
    if (!['team leader', 'staff member'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid role',
        message: 'Role must be either "team leader" or "staff member"'
      });
    }
    
    // Check if staff member exists
    const checkResult = await pool.query(
      'SELECT staff_name, role as current_role FROM human_resource WHERE unique_id = $1',
      [id]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Staff member not found',
        message: 'No staff member found with the specified ID'
      });
    }
    
    const currentRole = checkResult.rows[0].current_role;
    
    // Check if role is actually changing
    if (currentRole === role) {
      return res.status(400).json({
        success: false,
        error: 'No change detected',
        message: 'The role is already set to this value. No change needed.'
      });
    }
    
    const staffName = checkResult.rows[0].staff_name;
    
    // Determine effective date
    const effectiveDate = effective_from_date ? new Date(effective_from_date).toISOString() : new Date().toISOString();
    // Fix timezone issue: compare dates properly by adding seconds if needed
    const effectiveDateTime = effective_from_date ? 
      (effective_from_date.includes(':') && !effective_from_date.includes(':', 16) ? 
        effective_from_date + ':00' : effective_from_date) : null;
    const isImmediate = !effective_from_date || new Date(effectiveDateTime) <= new Date();

    if (isImmediate) {
      // Apply change immediately
      const result = await pool.query(
        'UPDATE human_resource SET role = $1, updated_at = (NOW() AT TIME ZONE \'Europe/London\') WHERE unique_id = $2 RETURNING *',
        [role, id]
      );
      
      // Log the change in history
      await pool.query(`
        INSERT INTO change_requests (
          staff_id, staff_name, change_type, old_value, new_value, effective_from_date, changed_by, reason
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [id, staffName, 'role_change', currentRole, role, effectiveDate, changed_by, reason]);
      
      // Take automatic snapshot after role change
      try {
        await takeStaffSnapshot();
        console.log('✅ Automatic snapshot taken after role change');
      } catch (snapshotError) {
        console.error('⚠️ Failed to take automatic snapshot after role change:', snapshotError);
      }

      res.json({
        success: true,
        data: result.rows[0],
        message: `Staff member role updated to ${role} successfully`,
        applied_immediately: true
      });
    } else {
      // Create change request for future application
      const changeRequestResult = await pool.query(`
        INSERT INTO change_requests (
          staff_id, staff_name, change_type, old_value, new_value, 
          effective_from_date, changed_by, reason
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `, [id, staffName, 'role_change', currentRole, role, effectiveDate, changed_by, reason]);

      res.json({
        success: true,
        data: changeRequestResult.rows[0],
        message: `Change request created for role update to ${role} (effective ${new Date(effective_from_date).toLocaleString()})`,
        applied_immediately: false,
        effective_date: effectiveDate
      });
    }
  } catch (err) {
    console.error('Error updating staff member role:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to update staff member role',
      message: err.message
    });
  }
});

// Get change requests for a staff member
app.get('/api/staff/:id/change-requests', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if staff member exists
    const checkResult = await pool.query(
      'SELECT staff_name FROM human_resource WHERE unique_id = $1',
      [id]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Staff member not found',
        message: 'No staff member found with the specified ID'
      });
    }
    
    // Get pending change requests (future effective dates)
    const result = await pool.query(`
      SELECT 
        id, staff_id, staff_name, change_type, old_value, new_value,
        effective_from_date, changed_at, changed_by, reason
      FROM change_requests 
      WHERE staff_id = $1 AND effective_from_date > NOW()
      ORDER BY effective_from_date ASC
    `, [id]);
    
    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (err) {
    console.error('Error getting change requests:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to get change requests',
      message: err.message
    });
  }
});


// Get role history for a staff member
app.get('/api/staff/:id/role-history', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if staff member exists
    const checkResult = await pool.query(
      'SELECT staff_name FROM human_resource WHERE unique_id = $1',
      [id]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Staff member not found',
        message: 'No staff member found with the specified ID'
      });
    }
    
    // Get role history from change_requests
    const result = await pool.query(`
      SELECT 
        cr.id,
        cr.staff_id,
        cr.staff_name,
        cr.old_value as previous_role,
        cr.new_value as new_role,
        cr.changed_at,
        cr.changed_by,
        cr.reason
      FROM change_requests cr
      WHERE cr.staff_id = $1 AND cr.change_type = 'role_change'
      ORDER BY cr.changed_at DESC
    `, [id]);
    
    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (err) {
    console.error('Error fetching role history:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch role history',
      message: err.message
    });
  }
});

// Update staff member pay rate
app.put('/api/staff/:id/pay-rate', async (req, res) => {
  try {
    const { id } = req.params;
    const { pay_rate, changed_by = 'system', reason = '', effective_from_date = null } = req.body;
    
    if (pay_rate === undefined || pay_rate === null || pay_rate < 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid pay rate',
        message: 'Pay rate must be a positive number'
      });
    }
    
    // Check if staff member exists and get current data
    const checkResult = await pool.query(`
      SELECT staff_name, pay_rate as current_pay_rate
      FROM human_resource
      WHERE unique_id = $1
    `, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Staff member not found',
        message: 'No staff member found with the specified ID'
      });
    }
    
    const currentPayRate = checkResult.rows[0].current_pay_rate || 0;
    const staffName = checkResult.rows[0].staff_name;
    
    // Check if pay rate is actually changing
    if (currentPayRate == pay_rate) {
      return res.status(400).json({
        success: false,
        error: 'No change detected',
        message: 'The pay rate is already set to this value. No change needed.'
      });
    }
    
    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Update the human_resource table directly
      await client.query(`
        UPDATE human_resource 
        SET pay_rate = $1, updated_at = (NOW() AT TIME ZONE 'Europe/London') 
        WHERE unique_id = $2
      `, [pay_rate, id]);
      
      // Log the change in history
      const effectiveDate = effective_from_date ? new Date(effective_from_date).toISOString() : new Date().toISOString();
      await client.query(`
        INSERT INTO change_requests (
          staff_id, staff_name, change_type, old_value, new_value, effective_from_date, changed_by, reason
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [id, staffName, 'pay_rate_change', currentPayRate.toString(), pay_rate.toString(), effectiveDate, changed_by, reason]);
      
      await client.query('COMMIT');
      
      // Get updated data
      const result = await pool.query(`
        SELECT * FROM human_resource WHERE unique_id = $1
      `, [id]);
      
      // Take automatic snapshot after pay rate change
      try {
        await takeStaffSnapshot();
        console.log('✅ Automatic snapshot taken after pay rate change');
      } catch (snapshotError) {
        console.error('⚠️ Failed to take automatic snapshot after pay rate change:', snapshotError);
      }
      
      res.json({
        success: true,
        data: result.rows[0],
        message: 'Pay rate updated successfully in human_resource table'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error updating staff pay rate:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to update staff pay rate',
      message: err.message
    });
  }
});

// Update staff member contracted hours
app.put('/api/staff/:id/contracted-hours', async (req, res) => {
  try {
    const { id } = req.params;
    const { contracted_hours, changed_by = 'system', reason = '', effective_from_date = null } = req.body;
    
    if (contracted_hours === undefined || contracted_hours === null || contracted_hours < 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid contracted hours',
        message: 'Contracted hours must be a positive number'
      });
    }
    
    // Check if staff member exists and get current data
    const checkResult = await pool.query(`
      SELECT staff_name, contracted_hours as current_contracted_hours
      FROM human_resource
      WHERE unique_id = $1
    `, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Staff member not found',
        message: 'No staff member found with the specified ID'
      });
    }
    
    const currentContractedHours = checkResult.rows[0].current_contracted_hours || 0;
    const staffName = checkResult.rows[0].staff_name;
    
    // Check if contracted hours are actually changing
    if (contracted_hours == currentContractedHours) {
      return res.status(400).json({
        success: false,
        error: 'No change detected',
        message: 'The contracted hours are already set to this value. No change needed.'
      });
    }
    
    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Update the human_resource table directly
      await client.query(`
        UPDATE human_resource 
        SET contracted_hours = $1, updated_at = (NOW() AT TIME ZONE 'Europe/London') 
        WHERE unique_id = $2
      `, [contracted_hours, id]);
      
      // Log the change in history
      const effectiveDate = effective_from_date ? new Date(effective_from_date).toISOString() : new Date().toISOString();
      await client.query(`
        INSERT INTO change_requests (
          staff_id, staff_name, change_type, old_value, new_value, effective_from_date, changed_by, reason
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [id, staffName, 'contracted_hours_change', currentContractedHours.toString(), contracted_hours.toString(), effectiveDate, changed_by, reason]);
      
      await client.query('COMMIT');
      
      // Get updated data
      const result = await pool.query(`
        SELECT * FROM human_resource WHERE unique_id = $1
      `, [id]);
      
      // Recalculate holiday entitlement after contracted hours change
      try {
        await pool.query('SELECT recalculate_holiday_entitlement($1, $2)', [
          id, 
          result.rows[0].employment_end_date
        ]);
        console.log('✅ Holiday entitlement recalculated after contracted hours change');
      } catch (holidayError) {
        console.error('⚠️ Failed to recalculate holiday entitlement after contracted hours change:', holidayError.message);
        // Don't fail the entire request if holiday entitlement recalculation fails
      }

      // Take automatic snapshot after contracted hours change
      try {
        await takeStaffSnapshot();
        console.log('✅ Automatic snapshot taken after contracted hours change');
      } catch (snapshotError) {
        console.error('⚠️ Failed to take automatic snapshot after contracted hours change:', snapshotError);
      }
      
      res.json({
        success: true,
        data: result.rows[0],
        message: 'Contracted hours updated successfully in human_resource table'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error updating staff contracted hours:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to update staff contracted hours',
      message: err.message
    });
  }
});

// Update staff member employment start date
app.put('/api/staff/:id/employment-date', async (req, res) => {
  try {
    const { id } = req.params;
    const { employment_start_date, changed_by = 'system', reason = '', effective_from_date = null } = req.body;
    
    if (!employment_start_date) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'employment_start_date is required'
      });
    }
    
    // Check if staff member exists and get current data
    const checkResult = await pool.query(`
      SELECT staff_name, employment_start_date as current_employment_date
      FROM human_resource
      WHERE unique_id = $1
    `, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Staff member not found',
        message: 'No staff member found with the specified ID'
      });
    }
    
    const currentDate = checkResult.rows[0].current_employment_date || '';
    const staffName = checkResult.rows[0].staff_name;
    
    if (employment_start_date === currentDate) {
      return res.json({
        success: true,
        message: 'Employment start date is already set to the requested value',
        data: { staff_name: staffName, employment_start_date: currentDate }
      });
    }
    
    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Update the human_resource table directly
      await client.query(`
        UPDATE human_resource 
        SET employment_start_date = $1, updated_at = (NOW() AT TIME ZONE 'Europe/London') 
        WHERE unique_id = $2
      `, [employment_start_date, id]);
      
      // Log the change in history
      const effectiveDate = effective_from_date ? new Date(effective_from_date).toISOString() : new Date().toISOString();
      await client.query(`
        INSERT INTO change_requests (
          staff_id, staff_name, change_type, old_value, new_value, effective_from_date, changed_by, reason
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [id, staffName, 'employment_date_change', currentDate || 'NULL', employment_start_date, effectiveDate, changed_by, reason]);
      
      await client.query('COMMIT');
      
      // Get updated data
      const result = await pool.query(`
        SELECT * FROM human_resource WHERE unique_id = $1
      `, [id]);
      
      // Take automatic snapshot after employment date change
      try {
        await takeStaffSnapshot();
        console.log('✅ Automatic snapshot taken after employment date change');
      } catch (snapshotError) {
        console.error('⚠️ Failed to take automatic snapshot after employment date change:', snapshotError);
      }
      
      res.json({
        success: true,
        data: result.rows[0],
        message: 'Employment start date updated successfully in human_resource table'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error updating staff employment start date:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to update staff employment start date',
      message: err.message
    });
  }
});

// Update staff member employment end date
app.put('/api/staff/:id/employment-end-date', async (req, res) => {
  try {
    const { id } = req.params;
    const { employment_end_date, changed_by, reason = '', effective_from_date = null } = req.body;
    
    // Check if staff member exists and get current data
    const checkResult = await pool.query(`
      SELECT staff_name, employment_end_date as current_employment_end_date
      FROM human_resource
      WHERE unique_id = $1
    `, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Staff member not found',
        message: 'No staff member found with the specified ID'
      });
    }
    
    const currentEndDate = checkResult.rows[0].current_employment_end_date || '';
    const staffName = checkResult.rows[0].staff_name;
    
    if (employment_end_date === currentEndDate) {
      return res.json({
        success: true,
        message: 'Employment end date is already set to the requested value',
        data: { staff_name: staffName, employment_end_date: currentEndDate }
      });
    }
    
    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Update the human_resource table directly
      await client.query(`
        UPDATE human_resource 
        SET employment_end_date = $1, updated_at = (NOW() AT TIME ZONE 'Europe/London') 
        WHERE unique_id = $2
      `, [employment_end_date || null, id]);
      
      // Log the change in history
      const effectiveDate = effective_from_date ? new Date(effective_from_date).toISOString() : new Date().toISOString();
      await client.query(`
        INSERT INTO change_requests (
          staff_id, staff_name, change_type, old_value, new_value, effective_from_date, changed_by, reason
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [id, staffName, 'employment_end_date_change', currentEndDate || 'NULL', employment_end_date || 'NULL', effectiveDate, changed_by, reason]);
      
      await client.query('COMMIT');
      
      // Get updated data
      const result = await pool.query(`
        SELECT * FROM human_resource WHERE unique_id = $1
      `, [id]);
      
      // Take automatic snapshot after employment end date change
      try {
        await takeStaffSnapshot();
        console.log('✅ Automatic snapshot taken after employment end date change');
      } catch (snapshotError) {
        console.error('⚠️ Failed to take automatic snapshot after employment end date change:', snapshotError);
      }
      
      res.json({
        success: true,
        data: result.rows[0],
        message: 'Employment end date updated successfully in human_resource table'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error updating staff employment end date:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to update staff employment end date',
      message: err.message
    });
  }
});

// Get contract history for a staff member
app.get('/api/staff/:id/contract-history', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if staff member exists
    const checkResult = await pool.query(
      'SELECT staff_name FROM human_resource WHERE unique_id = $1',
      [id]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Staff member not found',
        message: 'No staff member found with the specified ID'
      });
    }
    
    // Get contract history
    const result = await pool.query(`
      SELECT 
        id,
        staff_id,
        staff_name,
        contracted_hours,
        pay_rate,
        effective_from_date,
        is_current,
        created_at,
        updated_at
      FROM human_resource_contracts
      WHERE staff_id = $1
      ORDER BY effective_from_date DESC
    `, [id]);
    
    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (err) {
    console.error('Error fetching contract history:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch contract history',
      message: err.message
    });
  }
});

// Function to revert a staff change (without cascade deletion)
async function revertStaffChange(changeRequest) {
  try {
    const { staff_id, change_type, old_value, effective_from_date } = changeRequest;
    
    console.log(`🔍 Debug - revertStaffChange called with:`, {
      staff_id,
      change_type,
      old_value,
      old_value_type: typeof old_value,
      effective_from_date
    });
    
    // Find the latest change of the same type that was applied before the deleted change
    const latestChangeResult = await pool.query(`
      SELECT new_value, effective_from_date
      FROM change_requests 
      WHERE staff_id = $1 
        AND change_type = $2
        AND effective_from_date < $3
        AND effective_from_date <= (NOW() AT TIME ZONE 'Europe/London')
      ORDER BY effective_from_date DESC
      LIMIT 1
    `, [staff_id, change_type, effective_from_date]);
    
    let revertValue;
    if (latestChangeResult.rows.length > 0) {
      // Use the new_value from the latest change
      revertValue = latestChangeResult.rows[0].new_value;
      console.log(`🔄 Reverting ${change_type} for staff ${staff_id} to latest change value: ${revertValue}`);
    } else {
      // No previous change found, use the old_value from the deleted change
      revertValue = old_value;
      console.log(`🔄 No previous change found, reverting ${change_type} for staff ${staff_id} to old_value: ${revertValue} (type: ${typeof revertValue})`);
    }
    
    // Update the human_resource table with the revert value
    switch (change_type) {
      case 'role_change':
        await pool.query('UPDATE human_resource SET role = $1 WHERE unique_id = $2', [revertValue, staff_id]);
        break;
      case 'pay_rate_change':
        await pool.query('UPDATE human_resource SET pay_rate = $1 WHERE unique_id = $2', [parseFloat(revertValue), staff_id]);
        break;
      case 'contracted_hours_change':
        await pool.query('UPDATE human_resource SET contracted_hours = $1 WHERE unique_id = $2', [parseFloat(revertValue), staff_id]);
        break;
      case 'employment_date_change':
        const startDateValue = (revertValue === 'NULL' || revertValue === null || revertValue === undefined || revertValue === '') ? null : revertValue;
        console.log(`🔍 Debug - Setting employment_start_date to: ${startDateValue} (type: ${typeof startDateValue})`);
        await pool.query('UPDATE human_resource SET employment_start_date = $1 WHERE unique_id = $2', [startDateValue, staff_id]);
        break;
      case 'employment_end_date_change':
        const endDateValue = (revertValue === 'NULL' || revertValue === null || revertValue === undefined || revertValue === '') ? null : revertValue;
        console.log(`🔍 Debug - Setting employment_end_date to: ${endDateValue} (type: ${typeof endDateValue})`);
        await pool.query('UPDATE human_resource SET employment_end_date = $1 WHERE unique_id = $2', [endDateValue, staff_id]);
        break;
      case 'color_code_change':
        await pool.query('UPDATE human_resource SET color_code = $1 WHERE unique_id = $2', [revertValue, staff_id]);
        break;
      case 'active_status_change':
        await pool.query('UPDATE human_resource SET is_active = $1 WHERE unique_id = $2', [revertValue === 'true', staff_id]);
        break;
      default:
        console.warn('Unknown change type for reversion:', change_type);
    }
    
    console.log(`✅ Reverted ${change_type} for staff ${staff_id} to ${revertValue}`);
    
    return {
      revertedValue: revertValue
    };
  } catch (error) {
    console.error('❌ Error reverting staff change:', error);
    throw error;
  }
}

// Delete a change request and revert to previous state
app.delete('/api/staff/:id/change-request/:changeId', async (req, res) => {
  try {
    const { id, changeId } = req.params;
    
    // Get the change request details
    const changeResult = await pool.query(`
      SELECT * FROM change_requests 
      WHERE id = $1 AND staff_id = $2
    `, [changeId, id]);
    
    if (changeResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Change request not found',
        message: 'The specified change request does not exist'
      });
    }
    
    const changeRequest = changeResult.rows[0];
    
    // Allow deletion of all change requests (both pending and applied)
    const now = new Date();
    const effectiveDate = new Date(changeRequest.effective_from_date);
    
    let revertResult = null;
    
    // If this is an applied change, we need to revert the staff member to previous state
    if (effectiveDate <= now) {
      // This is an applied change, need to revert and delete future changes
      revertResult = await revertStaffChange(changeRequest);
    }
    
    // Delete the change request
    await pool.query('DELETE FROM change_requests WHERE id = $1', [changeId]);
    
    res.json({
      success: true,
      message: effectiveDate <= now ? 
        'Change request deleted and reverted successfully.' : 
        'Change request deleted successfully',
      data: {
        deleted_change: changeRequest,
        reverted: effectiveDate <= now,
        reverted_value: revertResult ? revertResult.revertedValue : null
      }
    });
    
  } catch (err) {
    console.error('Error deleting change request:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to delete change request',
      message: err.message
    });
  }
});

// Get all changes history for a staff member
app.get('/api/staff/:id/changes-history', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if staff member exists
    const checkResult = await pool.query(
      'SELECT staff_name FROM human_resource WHERE unique_id = $1',
      [id]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Staff member not found',
        message: 'No staff member found with the specified ID'
      });
    }
    
    // Get all changes history (only applied changes - past or current effective dates)
    const result = await pool.query(`
      SELECT 
        id,
        staff_id,
        staff_name,
        change_type,
        old_value,
        new_value,
        effective_from_date,
        changed_at,
        changed_by,
        reason
      FROM change_requests
      WHERE staff_id = $1 
        AND effective_from_date <= NOW()
      ORDER BY changed_at DESC
    `, [id]);
    
    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (err) {
    console.error('Error fetching changes history:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch changes history',
      message: err.message
    });
  }
});

// Update history field
app.put('/api/history/:id/:field', async (req, res) => {
  try {
    const { id, field } = req.params;
    const { value } = req.body;
    
    // Validate field name to prevent SQL injection
    const allowedFields = ['changed_by', 'reason'];
    if (!allowedFields.includes(field)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid field',
        message: 'Only changed_by and reason fields can be updated'
      });
    }
    
    // Update the specific field
    const result = await pool.query(`
      UPDATE change_requests 
              SET ${field} = $1, updated_at = (NOW() AT TIME ZONE 'Europe/London') 
      WHERE id = $2
      RETURNING *
    `, [value, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'History record not found',
        message: 'No history record found with the specified ID'
      });
    }
    
    res.json({
      success: true,
      data: result.rows[0],
      message: `${field} updated successfully`
    });
  } catch (err) {
    console.error('Error updating history field:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to update history field',
      message: err.message
    });
  }
});

// Toggle staff member active status
app.put('/api/staff/:id/toggle-active', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if staff member exists and get current status
    const checkResult = await pool.query(`
      SELECT staff_name, is_active 
      FROM human_resource 
      WHERE unique_id = $1
    `, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Staff member not found',
        message: 'No staff member found with the specified ID'
      });
    }
    
    const currentStatus = checkResult.rows[0].is_active;
    const staffName = checkResult.rows[0].staff_name;
    const newStatus = !currentStatus;
    
    // Update the active status
    const result = await pool.query(`
      UPDATE human_resource 
              SET is_active = $1, updated_at = (NOW() AT TIME ZONE 'Europe/London') 
      WHERE unique_id = $2 
      RETURNING *
    `, [newStatus, id]);
    
    // Get the change information from request body
    const { changed_by = 'system', reason = '', effective_from_date = null } = req.body;
    
    // Log the change in history
    const effectiveDate = effective_from_date ? new Date(effective_from_date).toISOString() : new Date().toISOString();
    await pool.query(`
      INSERT INTO change_requests (
        staff_id, staff_name, change_type, old_value, new_value, effective_from_date, changed_by, reason
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [id, staffName, 'active_status_change', currentStatus.toString(), newStatus.toString(), effectiveDate, changed_by, reason]);
    
    // Take a snapshot after the change
    await takeStaffSnapshot();
    
    res.json({
      success: true,
      data: result.rows[0],
      message: `Staff member ${newStatus ? 'activated' : 'deactivated'} successfully`
    });
  } catch (err) {
    console.error('Error toggling staff active status:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to toggle staff active status',
      message: err.message
    });
  }
});

// Get all periods
app.get('/api/periods', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM periods ORDER BY start_date');
    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (err) {
    console.error('Error fetching periods:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch periods',
      message: err.message
    });
  }
});

// Get shifts for a specific period
app.get('/api/shifts/period/:periodId', async (req, res) => {
  try {
    const { periodId } = req.params;
    
    // Validate periodId format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(periodId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid period ID format',
        message: 'Period ID must be a valid UUID'
      });
    }
    
    const result = await pool.query(`
      SELECT 
        s.id as shift_id,
        s.period_id,
        s.week_number,
        s.staff_name,
        s.shift_start_datetime,
        s.shift_end_datetime,
        s.shift_type,
        
        s.solo_shift,
        s.training,
        s.short_notice,
        s.call_out,
        s.overtime,
        s.payment_period_end,
        s.financial_year_end,
        s.notes,
        hr.role as staff_role,
        p.start_date,
        p.end_date
      FROM shifts s 
      LEFT JOIN human_resource hr ON s.staff_name = hr.staff_name 
      LEFT JOIN periods p ON s.period_id = p.period_id
      WHERE s.period_id = $1
      ORDER BY s.week_number, s.shift_start_datetime, s.staff_name
    `, [periodId]);
    
    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
      periodId: periodId
    });
  } catch (err) {
    console.error('Error fetching shifts for period:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch shifts for period',
      message: err.message
    });
  }
});

// Get all shifts
app.get('/api/shifts', async (req, res) => {
  try {
    const { from, to } = req.query;
    
    let query = `
      SELECT 
        s.id as shift_id,
        s.period_id,
        s.week_number,
        s.staff_name,
        s.shift_start_datetime,
        s.shift_end_datetime,
        s.shift_type,
        
        s.solo_shift,
        s.training,
        s.short_notice,
        s.overtime,
        s.payment_period_end,
        s.financial_year_end,
        s.notes,
        hr.role as staff_role,
        p.start_date,
        p.end_date
      FROM shifts s 
      LEFT JOIN human_resource hr ON s.staff_name = hr.staff_name 
      LEFT JOIN periods p ON s.period_id = p.period_id
    `;
    
    let params = [];
    
    // Add date filtering if from and to parameters are provided
    if (from && to) {
      query += ` WHERE DATE(s.shift_start_datetime) >= $1 AND DATE(s.shift_start_datetime) <= $2`;
      params = [from, to];
      console.log(`📊 Fetching shifts from ${from} to ${to}...`);
    } else {
      console.log('📊 Fetching all shifts...');
    }
    
    query += ` ORDER BY s.shift_start_datetime, s.staff_name`;
    
    const result = await pool.query(query, params);
    
    console.log('✅ Shifts query successful, found:', result.rows.length, 'shifts');
    
    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (err) {
    console.error('❌ Error fetching shifts:', err);
    console.error('❌ Error details:', {
      message: err.message,
      code: err.code,
      detail: err.detail,
      hint: err.hint
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to fetch shifts',
      message: err.message,
      details: {
        code: err.code,
        detail: err.detail,
        hint: err.hint
      }
    });
  }
});

// Get shifts for a specific staff member
app.get('/api/shifts/staff/:staffName', async (req, res) => {
  try {
    const { staffName } = req.params;
    
    if (!staffName || staffName.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Invalid staff name',
        message: 'Staff name is required'
      });
    }
    
    const result = await pool.query(`
      SELECT 
        s.id as shift_id,
        s.period_id,
        s.week_number,
        s.staff_name,
        s.shift_start_datetime,
        s.shift_end_datetime,
        s.shift_type,
        
        s.solo_shift,
        s.training,
        s.short_notice,
        s.overtime,
        s.payment_period_end,
        s.financial_year_end,
        s.notes,
        hr.role as staff_role,
        p.start_date,
        p.end_date
      FROM shifts s 
      LEFT JOIN human_resource hr ON s.staff_name = hr.staff_name 
      LEFT JOIN periods p ON s.period_id = p.period_id
      WHERE s.staff_name = $1
      ORDER BY s.shift_start_datetime
    `, [staffName.trim()]);
    
    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
      staffName: staffName.trim()
    });
  } catch (err) {
    console.error('Error fetching shifts for staff member:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch shifts for staff member',
      message: err.message
    });
  }
});

// Get shifts for a specific staff member within a date range
app.get('/api/shifts/employee/:staffName', async (req, res) => {
  try {
    const { staffName } = req.params;
    const { from, to } = req.query;
    
    if (!staffName || staffName.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Invalid staff name',
        message: 'Staff name is required'
      });
    }
    
    if (!from || !to) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date range',
        message: 'Both from and to dates are required'
      });
    }
    
    // Validate date format
    const fromDate = new Date(from);
    const toDate = new Date(to);
    
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format',
        message: 'Dates must be in YYYY-MM-DD format'
      });
    }
    
    console.log(`📊 Fetching shifts for ${staffName} from ${from} to ${to}`);
    
    const result = await pool.query(`
      SELECT 
        s.id as shift_id,
        s.period_id,
        s.week_number,
        s.staff_name,
        s.shift_start_datetime,
        s.shift_end_datetime,
        s.shift_type,
        s.solo_shift,
        s.training,
        s.short_notice,
        s.call_out,
        s.overtime,
        s.payment_period_end,
        s.financial_year_end,
        s.notes,
        hr.role as staff_role,
        p.start_date,
        p.end_date
      FROM shifts s 
      LEFT JOIN human_resource hr ON s.staff_name = hr.staff_name 
      LEFT JOIN periods p ON s.period_id = p.period_id
      WHERE s.staff_name = $1 
        AND DATE(s.shift_start_datetime) >= $2 
        AND DATE(s.shift_start_datetime) <= $3
      ORDER BY s.shift_start_datetime
    `, [staffName.trim(), from, to]);
    
    console.log(`📊 Found ${result.rows.length} shifts for ${staffName} in date range`);
    
    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
      staffName: staffName.trim(),
      dateRange: { from, to }
    });
  } catch (err) {
    console.error('Error fetching shifts for staff member by date range:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch shifts for staff member',
      message: err.message
    });
  }
});

// Save or update shift assignment
app.post('/api/shifts', 
  validateRequiredFields(['periodId', 'weekNumber', 'shiftStartDatetime', 'shiftType', 'staffAssignments']),
  async (req, res) => {
  try {
    const {
      periodId,
      weekNumber,
      shiftStartDatetime,
      shiftEndDatetime,
      shiftType,
      staffAssignments
    } = req.body;

    // Validate week number
    if (weekNumber < 1 || weekNumber > 4) {
      return res.status(400).json({
        success: false,
        error: 'Invalid week number',
        message: 'Week number must be between 1 and 4'
      });
    }

    // Validate shift type
    const validShiftTypes = ['Tom Day', 'Charlotte Day', 'Double Up', 'Tom Night', 'Charlotte Night', 'HOLIDAY'];
    if (!validShiftTypes.includes(shiftType)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid shift type',
        message: `Shift type must be one of: ${validShiftTypes.join(', ')}`
      });
    }

    // Validate periodId format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(periodId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid period ID format',
        message: 'Period ID must be a valid UUID'
      });
    }

    // Remove existing shifts for this period, week, datetime, and shift type
    await pool.query(
      'DELETE FROM shifts WHERE period_id = $1 AND week_number = $2 AND shift_start_datetime = $3 AND shift_type = $4',
      [periodId, weekNumber, shiftStartDatetime, shiftType]
    );

    // Create separate shift records for each staff member
    if (staffAssignments && staffAssignments.length > 0) {
      const createdShifts = [];
      
      for (const assignment of staffAssignments) {
        if (!assignment.staffName || !assignment.startTime || !assignment.endTime) {
          continue; // Skip invalid assignments
        }

        // Calculate the actual shift start and end times based on assignment
        const shiftStart = new Date(shiftStartDatetime);
        const [startHour, startMinute] = assignment.startTime.split(':');
        shiftStart.setHours(parseInt(startHour), parseInt(startMinute), 0, 0);
        
        const shiftEnd = new Date(shiftStartDatetime);
        const [endHour, endMinute] = assignment.endTime.split(':');
        shiftEnd.setHours(parseInt(endHour), parseInt(endMinute), 0, 0);
        
        // Handle overnight shifts
        if (shiftEnd < shiftStart) {
          shiftEnd.setDate(shiftEnd.getDate() + 1);
        }
          
        // Calculate total hours
        const totalHours = (shiftEnd - shiftStart) / (1000 * 60 * 60);
        
        // Determine the date for the shift
        const shiftDate = shiftStart.toISOString().split('T')[0];
        
        // Insert individual shift
        const result = await pool.query(`
          INSERT INTO shifts (
            period_id, week_number, staff_name, shift_start_datetime, shift_end_datetime, 
            shift_type, solo_shift, training, short_notice, call_out, payment_period_end, financial_year_end, notes, overtime
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *
        `, [
          periodId, 
          weekNumber, 
          assignment.staffName, 
          shiftStart.toISOString(), 
          shiftEnd.toISOString(),
          shiftType, 
          assignment.soloShift || false,
          assignment.training || false,
          assignment.shortNotice || false,
          assignment.callout || false,
          assignment.paymentPeriodEnd || false,
          assignment.financialYearEnd || false,
          assignment.notes || '',
          assignment.overtime || false
        ]);
        
        createdShifts.push(result.rows[0]);
      }
      
      res.json({
        success: true,
        data: createdShifts,
        count: createdShifts.length,
        message: 'Shifts created successfully'
      });
      
    } else {
      res.json({
        success: true,
        data: [],
        count: 0,
        message: 'No shifts to create'
      });
    }
    
  } catch (err) {
    console.error('Error saving shift:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to save shift',
      message: err.message
    });
  }
});



// Delete shift assignment
app.delete('/api/shifts/delete', 
  validateRequiredFields(['periodId', 'weekNumber', 'shiftStartDatetime', 'shiftType']),
  async (req, res) => {
  try {
    const {
      periodId,
      weekNumber,
      shiftStartDatetime,
      shiftType
    } = req.body;

      // Validate periodId format
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(periodId)) {
      return res.status(400).json({ 
          success: false,
          error: 'Invalid period ID format',
          message: 'Period ID must be a valid UUID'
        });
      }

      // Use the same date logic as the insert operation
      const shiftStart = new Date(shiftStartDatetime);
      const shiftDate = shiftStart.toISOString().split('T')[0];

      console.log('Delete request:', {
        periodId,
        weekNumber,
        shiftStartDatetime,
        shiftType,
        calculatedDate: shiftDate
      });

      // First, let's see what's actually in the database for debugging
      const debugQuery = await pool.query(`
        SELECT id, staff_name, shift_start_datetime::date as date, shift_type, week_number, period_id 
        FROM shifts 
        WHERE period_id = $1 AND week_number = $2 AND shift_type = $3
        ORDER BY shift_start_datetime::date, staff_name
      `, [periodId, weekNumber, shiftType]);

      console.log('Shifts found in database:', debugQuery.rows);

    // Find all shifts to delete (multiple staff members may be assigned)
    const shiftsToDelete = await pool.query(
        'SELECT id, staff_name, shift_start_datetime::date as date FROM shifts WHERE period_id = $1 AND week_number = $2 AND shift_start_datetime::date = $3 AND shift_type = $4',
        [periodId, weekNumber, shiftDate, shiftType]
    );

      console.log('Shifts to delete:', shiftsToDelete.rows);

    if (shiftsToDelete.rows.length > 0) {
      // Delete all shifts for this time slot and shift type (handles multiple staff)
      const result = await pool.query(
          'DELETE FROM shifts WHERE period_id = $1 AND week_number = $2 AND shift_start_datetime::date = $3 AND shift_type = $4 RETURNING id, staff_name',
          [periodId, weekNumber, shiftDate, shiftType]
      );

        console.log('Delete result:', result.rows);

      res.json({ 
          success: true,
        message: 'Shift assignments deleted successfully', 
        deletedCount: result.rows.length,
          deletedShifts: result.rows,
          debug: {
            requestedDate: shiftDate,
            foundInDatabase: debugQuery.rows.length,
            deleted: result.rows.length
          }
      });
    } else {
        // Try alternative deletion method - use shift_start_datetime instead of date
        const alternativeDelete = await pool.query(
          'DELETE FROM shifts WHERE period_id = $1 AND week_number = $2 AND shift_start_datetime::date = $3 AND shift_type = $4 RETURNING id, staff_name',
          [periodId, weekNumber, shiftDate, shiftType]
        );

        if (alternativeDelete.rows.length > 0) {
          console.log('Alternative delete successful:', alternativeDelete.rows);
          res.json({
            success: true,
            message: 'Shift assignments deleted successfully (alternative method)',
            deletedCount: alternativeDelete.rows.length,
            deletedShifts: alternativeDelete.rows,
            debug: {
              requestedDate: shiftDate,
              method: 'alternative',
              deleted: alternativeDelete.rows.length
            }
      });
    } else {
          res.json({
            success: false,
            message: 'No shift assignments found to delete',
            deletedCount: 0,
            debug: {
              requestedDate: shiftDate,
              foundInDatabase: debugQuery.rows.length,
              method: 'both failed'
            }
          });
        }
    }
  } catch (err) {
    console.error('Error deleting shift:', err);
      res.status(500).json({
        success: false,
        error: 'Failed to delete shift',
        message: err.message
      });
    }
  }
);

// Clear all shifts for a specific period and week
app.delete('/api/shifts/clear', 
  validateRequiredFields(['periodId']),
  async (req, res) => {
  try {
    const {
      periodId,
      weekNumber,
      date,
      shiftType
    } = req.body;

      // Validate periodId format
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(periodId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid period ID format',
          message: 'Period ID must be a valid UUID'
        });
      }

      console.log('Clear request:', { periodId, weekNumber, date, shiftType });

    let query = 'DELETE FROM shifts WHERE period_id = $1';
    let params = [periodId];
    let paramIndex = 2;

    // Add week number filter if provided
      if (weekNumber !== undefined && weekNumber !== null) {
        if (weekNumber < 1 || weekNumber > 4) {
          return res.status(400).json({
            success: false,
            error: 'Invalid week number',
            message: 'Week number must be between 1 and 4'
          });
        }
      query += ` AND week_number = $${paramIndex}`;
      params.push(weekNumber);
      paramIndex++;
    }

    // Add date filter if provided
    if (date) {
      query += ` AND date = $${paramIndex}`;
      params.push(date);
      paramIndex++;
    }

    // Add shift type filter if provided
    if (shiftType) {
        const validShiftTypes = ['Tom Day', 'Charlotte Day', 'Double Up', 'Tom Night', 'Charlotte Night', 'HOLIDAY'];
        if (!validShiftTypes.includes(shiftType)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid shift type',
            message: `Shift type must be one of: ${validShiftTypes.join(', ')}`
          });
        }
      query += ` AND shift_type = $${paramIndex}`;
      params.push(shiftType);
    }

    query += ' RETURNING id, staff_name, shift_type, date, start_time, end_time';

      console.log('Clear query:', query);
      console.log('Clear params:', params);

    const result = await pool.query(query, params);

      console.log('Clear result:', result.rows);

    res.json({ 
        success: true,
      message: 'Shifts cleared successfully', 
      clearedCount: result.rows.length,
      clearedShifts: result.rows
    });

  } catch (err) {
    console.error('Error clearing shifts:', err);
      res.status(500).json({
        success: false,
        error: 'Failed to clear shifts',
        message: err.message
      });
    }
  }
);

// Clear specific cell with multiple staff
app.delete('/api/shifts/clear-cell', 
  validateRequiredFields(['periodId', 'weekNumber', 'date', 'shiftType']),
  async (req, res) => {
  try {
    const {
      periodId,
      weekNumber,
      date,
      shiftType
    } = req.body;

      // Validate periodId format
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(periodId)) {
      return res.status(400).json({ 
          success: false,
          error: 'Invalid period ID format',
          message: 'Period ID must be a valid UUID'
        });
      }

      // Validate week number
      if (weekNumber < 1 || weekNumber > 4) {
        return res.status(400).json({
          success: false,
          error: 'Invalid week number',
          message: 'Week number must be between 1 and 4'
        });
      }

      // Validate shift type
      const validShiftTypes = ['Tom Day', 'Charlotte Day', 'Double Up', 'Tom Night', 'Charlotte Night', 'HOLIDAY'];
      if (!validShiftTypes.includes(shiftType)) {
      return res.status(400).json({ 
          success: false,
          error: 'Invalid shift type',
          message: `Shift type must be one of: ${validShiftTypes.join(', ')}`
        });
      }

      console.log('Clear cell request:', { periodId, weekNumber, date, shiftType });

      // First, let's see what's in the database for debugging
      const debugQuery = await pool.query(`
        SELECT id, staff_name, shift_start_datetime::date as date, shift_type, week_number, period_id 
        FROM shifts 
        WHERE period_id = $1 AND week_number = $2 AND shift_type = $3
        ORDER BY shift_start_datetime::date, staff_name
      `, [periodId, weekNumber, shiftType]);

      console.log('Shifts found for cell clear:', debugQuery.rows);

    // Clear all shifts for this specific cell
    const deleteQuery = `
      DELETE FROM shifts 
      WHERE period_id = $1 
        AND week_number = $2 
          AND shift_start_datetime::date = $3
        AND shift_type = $4 
      RETURNING id, staff_name, shift_type, shift_start_datetime::date as date
    `;
    const deleteParams = [periodId, weekNumber, date, shiftType];

      console.log('Clear cell query:', deleteQuery);
      console.log('Clear cell params:', deleteParams);

    const result = await pool.query(deleteQuery, deleteParams);

      console.log('Clear cell result:', result.rows);

    res.json({ 
        success: true,
      message: 'Cell shifts cleared successfully', 
      clearedCount: result.rows.length,
        clearedShifts: result.rows,
        debug: {
          requestedDate: date,
          foundInDatabase: debugQuery.rows.length,
          cleared: result.rows.length
        }
    });

  } catch (err) {
    console.error('Error clearing cell shifts:', err);
      res.status(500).json({
        success: false,
        error: 'Failed to clear cell shifts',
        message: err.message
      });
    }
  }
);

// Test database connection and table structure
app.get('/api/test-db', async (req, res) => {
  try {
    // Test basic connection
    const connectionTest = await pool.query('SELECT NOW()');
    
    // Check if tables exist
    const tablesQuery = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('shifts', 'human_resource', 'periods')
    `);
    
    // Check shifts table structure
    const shiftsColumns = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'shifts'
    `);
    
    // Check current data in tables
    const shiftsCount = await pool.query('SELECT COUNT(*) as count FROM shifts');
    const staffCount = await pool.query('SELECT COUNT(*) as count FROM human_resource');
    const periodsCount = await pool.query('SELECT COUNT(*) as count FROM periods');
    
    res.json({
      success: true,
      connection: 'success',
      tables: tablesQuery.rows.map(r => r.table_name),
      shiftsColumns: shiftsColumns.rows,
      dataCounts: {
        shifts: parseInt(shiftsCount.rows[0].count),
        staff: parseInt(staffCount.rows[0].count),
        periods: parseInt(periodsCount.rows[0].count)
      }
    });
  } catch (err) {
    console.error('Database test failed:', err);
    res.status(500).json({
      success: false,
      error: 'Database test failed',
      message: err.message
    });
  }
});

// Debug endpoint removed - not essential functionality

// Debug endpoint to inspect specific shift data
app.get('/api/debug/shifts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT s.*, hr.role as staff_role, p.start_date, p.end_date
      FROM shifts s 
      LEFT JOIN human_resource hr ON s.staff_name = hr.staff_name 
      LEFT JOIN periods p ON s.period_id = p.period_id
      WHERE s.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Shift not found',
        message: `No shift found with ID: ${id}`
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (err) {
    console.error('Error in debug shift by ID:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to debug shift',
      message: err.message
    });
  }
});

// Update staff member active status
app.put('/api/staff/:id/active-status', 
  validateRequiredFields(['is_active']),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { is_active } = req.body;

      // Validate UUID
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid staff ID format',
          message: 'Staff ID must be a valid UUID'
        });
      }

      // Validate boolean value
      if (typeof is_active !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'Invalid active status value',
          message: 'is_active must be a boolean value (true/false)'
        });
      }

      // Check if staff member exists
      const staffCheck = await pool.query(
        'SELECT staff_name, role FROM human_resource WHERE unique_id = $1',
        [id]
      );

      if (staffCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Staff member not found',
          message: `No staff member found with ID: ${id}`
        });
      }

      // Update active status
      const result = await pool.query(
        'UPDATE human_resource SET is_active = $1, updated_at = (NOW() AT TIME ZONE \'Europe/London\') WHERE unique_id = $2 RETURNING unique_id, staff_name, role, is_active, updated_at',
        [is_active, id]
      );

      console.log(`✅ Staff member ${result.rows[0].staff_name} active status updated to: ${is_active}`);

      res.json({
        success: true,
        message: 'Active status updated successfully',
        data: result.rows[0]
      });

    } catch (err) {
      console.error('Error updating staff active status:', err);
      res.status(500).json({
        success: false,
        error: 'Failed to update staff active status',
        message: err.message,
        details: process.env.NODE_ENV === 'development' ? err.stack : undefined
      });
    }
  }
);

// Database inspection endpoint to check current schema
app.get('/api/migrate/check-schema', async (req, res) => {
  try {
    console.log('🔍 Checking current database schema...');
    
    // Get information about the shifts table structure
    const result = await pool.query(`
      SELECT 
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns 
      WHERE table_name = 'shifts' 
      ORDER BY ordinal_position;
    `);
    
    console.log('✅ Schema check completed');
    console.log('📋 Current columns:', result.rows.map(col => col.column_name));
    
    res.json({
      success: true,
      message: 'Database schema check completed',
      columns: result.rows,
      count: result.rows.length
    });
    
  } catch (err) {
    console.error('❌ Error checking database schema:', err);
    res.status(500).json({
      success: false,
      error: 'Schema check failed',
      message: err.message
    });
  }
});

// Database migration endpoint to fix shift_type constraint and add missing columns
app.post('/api/migrate/fix-shift-types', async (req, res) => {
  try {
    console.log('🔄 Starting comprehensive database migration...');
    
    // Force add the missing columns (ignore if they already exist)
    console.log('🔄 Adding missing columns...');
    
    try {
      await pool.query('ALTER TABLE shifts ADD COLUMN total_hours DECIMAL(4,2)');
      console.log('✅ Added total_hours column');
    } catch (err) {
      if (err.code === '42701') { // column already exists
        console.log('ℹ️ total_hours column already exists');
      } else {
        throw err;
      }
    }
    
    try {
      await pool.query('ALTER TABLE shifts ADD COLUMN date DATE');
      console.log('✅ Added date column');
    } catch (err) {
      if (err.code === '42701') { // column already exists
        console.log('ℹ️ date column already exists');
      } else {
        throw err;
      }
    }
    
    try {
      await pool.query('ALTER TABLE shifts ADD COLUMN start_time TIME');
      console.log('✅ Added start_time column');
    } catch (err) {
      if (err.code === '42701') { // column already exists
        console.log('ℹ️ start_time column already exists');
      } else {
        throw err;
      }
    }
    
    try {
      await pool.query('ALTER TABLE shifts ADD COLUMN end_time TIME');
      console.log('✅ Added end_time column');
    } catch (err) {
      if (err.code === '42701') { // column already exists
        console.log('ℹ️ end_time column already exists');
      } else {
        throw err;
      }
    }
    
    try {
      await pool.query('ALTER TABLE shifts ADD COLUMN payment_period_end BOOLEAN DEFAULT FALSE');
      console.log('✅ Added payment_period_end column');
    } catch (err) {
      if (err.code === '42701') { // column already exists
        console.log('ℹ️ payment_period_end column already exists');
      } else {
        throw err;
      }
    }
    
    try {
      await pool.query('ALTER TABLE shifts ADD COLUMN financial_year_end BOOLEAN DEFAULT FALSE');
      console.log('✅ Added financial_year_end column');
    } catch (err) {
      if (err.code === '42701') { // column already exists
        console.log('ℹ️ financial_year_end column already exists');
      } else {
        throw err;
      }
    }
    
    try {
      await pool.query('ALTER TABLE shifts ADD COLUMN call_out BOOLEAN DEFAULT FALSE');
      console.log('✅ Added call_out column');
    } catch (err) {
      if (err.code === '42701') { // column already exists
        console.log('ℹ️ call_out column already exists');
      } else {
        throw err;
      }
    }
    
    // Handle constraint management safely
    console.log('🔄 Managing shift_type constraint...');
    
    try {
      // Drop the existing constraint if it exists
      await pool.query(`
        DO $$ 
        BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'shifts_shift_type_check') THEN
            ALTER TABLE shifts DROP CONSTRAINT shifts_shift_type_check;
            RAISE NOTICE 'Dropped existing shift_type constraint';
          END IF;
        END $$;
      `);
      console.log('✅ Constraint check completed');
    } catch (err) {
      console.log('ℹ️ Constraint drop handled:', err.message);
    }
    
    try {
      // Add the new constraint with updated shift types
      await pool.query(`
        ALTER TABLE shifts ADD CONSTRAINT shifts_shift_type_check 
          CHECK (shift_type IN ('Tom Day', 'Charlotte Day', 'Double Up', 'Tom Night', 'Charlotte Night', 'HOLIDAY'));
      `);
      console.log('✅ Added new shift_type constraint');
    } catch (err) {
      if (err.code === '42710') { // constraint already exists
        console.log('ℹ️ shift_type constraint already exists');
      } else {
        throw err;
      }
    }
    
    console.log('✅ Successfully completed comprehensive database migration');
    
    res.json({
      success: true,
      message: 'Database migration completed successfully',
      details: 'Added all missing columns and updated shift_type constraint'
    });
    
  } catch (err) {
    console.error('❌ Error during database migration:', err);
    res.status(500).json({
      success: false,
      error: 'Database migration failed',
      message: err.message,
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// Remove extra columns migration endpoint
app.post('/api/migrate/remove-extra-columns', async (req, res) => {
  console.log('🗑️ Removing extra columns from shifts table...');
  
  try {
    // Remove start_time column
    try {
      await pool.query('ALTER TABLE shifts DROP COLUMN IF EXISTS start_time');
      console.log('✅ Removed start_time column');
    } catch (err) {
      console.log('ℹ️ start_time column removal handled:', err.message);
    }
    
    // Remove end_time column
    try {
      await pool.query('ALTER TABLE shifts DROP COLUMN IF EXISTS end_time');
      console.log('✅ Removed end_time column');
    } catch (err) {
      console.log('ℹ️ end_time column removal handled:', err.message);
    }
    
    // Remove date column
    try {
      await pool.query('ALTER TABLE shifts DROP COLUMN IF EXISTS date');
      console.log('✅ Removed date column');
    } catch (err) {
      console.log('ℹ️ date column removal handled:', err.message);
    }
    
    // Remove total_hours column (also extra)
    try {
      await pool.query('ALTER TABLE shifts DROP COLUMN IF EXISTS total_hours');
      console.log('✅ Removed total_hours column');
    } catch (err) {
      console.log('ℹ️ total_hours column removal handled:', err.message);
    }
    
    console.log('✅ Successfully removed extra columns from shifts table');
    
    res.json({
      success: true,
      message: 'Extra columns removed successfully',
      details: 'Removed start_time, end_time, date, and total_hours columns'
    });
    
  } catch (err) {
    console.error('❌ Error removing extra columns:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to remove extra columns',
      message: err.message,
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// Clear multiple shifts endpoint
app.post('/api/shifts/clear-multiple', async (req, res) => {
  console.log('🗑️ Clearing multiple shifts from database...');
  
  try {
    const { shifts } = req.body;
    
    if (!shifts || !Array.isArray(shifts) || shifts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request',
        message: 'No shifts provided for clearing'
      });
    }
    
    console.log(`🗑️ Attempting to clear ${shifts.length} shifts...`);
    
    let clearedCount = 0;
    
    // Clear each shift individually
    for (const shift of shifts) {
      try {
        const { period_id, week_number, shift_start_datetime, shift_end_datetime, shift_type, staff_name } = shift;
        
        // Delete the shift from database
        const result = await pool.query(`
          DELETE FROM shifts 
          WHERE period_id = $1 
            AND week_number = $2 
            AND shift_start_datetime = $3 
            AND shift_end_datetime = $4 
            AND shift_type = $5 
            AND staff_name = $6
        `, [period_id, week_number, shift_start_datetime, shift_end_datetime, shift_type, staff_name]);
        
        if (result.rowCount > 0) {
          clearedCount++;
          console.log(`✅ Cleared shift: ${staff_name} on ${shift_start_datetime}`);
        } else {
          console.log(`ℹ️ No matching shift found for: ${staff_name} on ${shift_start_datetime}`);
        }
        
      } catch (error) {
        console.error(`❌ Error clearing shift:`, error);
        // Continue with other shifts even if one fails
      }
    }
    
    console.log(`✅ Successfully cleared ${clearedCount} shifts from database`);
    
    res.json({
      success: true,
      message: `Successfully cleared ${clearedCount} shifts from database`,
      cleared_count: clearedCount,
      total_requested: shifts.length
    });
    
  } catch (error) {
    console.error('❌ Error clearing multiple shifts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear shifts',
      message: error.message
    });
  }
});

// Add color_code column to human_resource table
app.post('/api/migrate/add-color-code', async (req, res) => {
  try {
    console.log('🎨 Adding color_code column to human_resource table...');
    
    // Check if color_code column already exists
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'human_resource' AND column_name = 'color_code'
    `);
    
    if (columnCheck.rows.length === 0) {
      // Add color_code column to human_resource table
      await pool.query(`
        ALTER TABLE human_resource 
        ADD COLUMN color_code VARCHAR(7) DEFAULT '#3b82f6'
      `);
      console.log('✅ color_code column added to human_resource table');
    } else {
      console.log('ℹ️ color_code column already exists');
    }
    
    // Check if change_requests table exists
    const tableCheck = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name = 'change_requests'
    `);
    
    if (tableCheck.rows.length === 0) {
      // Create change_requests table if it doesn't exist
      await pool.query(`
        CREATE TABLE change_requests (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          staff_id UUID NOT NULL REFERENCES human_resource(unique_id) ON DELETE CASCADE,
          staff_name TEXT NOT NULL,
          change_type TEXT NOT NULL,
          field_name TEXT,
          old_value TEXT,
          new_value TEXT,
          effective_from_date TIMESTAMPTZ DEFAULT NOW(),
          changed_at TIMESTAMPTZ DEFAULT NOW(),
          changed_by TEXT DEFAULT 'system',
          reason TEXT
        )
      `);
      console.log('✅ change_requests table created');
    } else {
      console.log('ℹ️ change_requests table already exists');
    }
    
    // Create indexes for change_requests table (ignore if they already exist)
    try {
      await pool.query(`
        CREATE INDEX idx_change_requests_staff_id ON change_requests(staff_id)
      `);
    } catch (err) {
      if (err.code !== '42P07') console.log('ℹ️ staff_id index already exists');
    }
    
    try {
      await pool.query(`
        CREATE INDEX idx_change_requests_staff_name ON change_requests(staff_name)
      `);
    } catch (err) {
      if (err.code !== '42P07') console.log('ℹ️ staff_name index already exists');
    }
    
    try {
      await pool.query(`
        CREATE INDEX idx_change_requests_change_type ON change_requests(change_type)
      `);
    } catch (err) {
      if (err.code !== '42P07') console.log('ℹ️ change_type index already exists');
    }
    
    try {
      await pool.query(`
        CREATE INDEX idx_change_requests_changed_at ON change_requests(changed_at)
      `);
    } catch (err) {
      if (err.code !== '42P07') console.log('ℹ️ changed_at index already exists');
    }
    
    console.log('✅ Indexes created for change_requests table');
    
    // Update existing staff members with predefined colors
    const predefinedColors = {
      'Helen': '#EE0000',
      'Fung': '#FFFF00', 
      'Anne': '#00B050',
      'Annie': '#247A00',
      'Lisa': '#CC99FF',
      'Janet': '#FF66FF',
      'Clara': '#0070C0',
      'John': '#00B0F0',
      'Vania': '#7030A0',
      'Yasser': '#C4BC96',
      'Matt': '#FFC000',
      'FW': '#935CC3',
      'HC': '#D52BD5'
    };
    
    let updatedCount = 0;
    for (const [staffName, colorCode] of Object.entries(predefinedColors)) {
      const result = await pool.query(`
        UPDATE human_resource 
        SET color_code = $1, updated_at = (NOW() AT TIME ZONE 'Europe/London')
        WHERE staff_name = $2 AND (color_code IS NULL OR color_code = '#3b82f6')
      `, [colorCode, staffName]);
      
      if (result.rowCount > 0) {
        updatedCount += result.rowCount;
        console.log(`✅ Updated ${staffName} with color ${colorCode}`);
      }
    }
    
    // Get all staff members to return
    const staffResult = await pool.query(`
      SELECT unique_id, staff_name, role, color_code
      FROM human_resource
      ORDER BY staff_name
    `);
    
    res.json({
      success: true,
      message: 'Color code column added successfully',
      count: updatedCount,
      data: staffResult.rows
    });
    
  } catch (err) {
    console.error('❌ Error adding color_code column:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to add color_code column',
      message: err.message
    });
  }
});

// Update staff member color code
app.put('/api/staff/:id/color-code', async (req, res) => {
  try {
    const { id } = req.params;
    const { color_code, changed_by = 'system', reason = '', effective_from_date = null } = req.body;

    // Validate UUID
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid staff ID format',
        message: 'Staff ID must be a valid UUID'
      });
    }

    // Validate color code format
    if (!/^#[0-9A-F]{6}$/i.test(color_code)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid color code format',
        message: 'Color code must be a valid hex color (e.g., #3b82f6)'
      });
    }
    
    // Check if staff member exists and get current color
    const staffCheck = await pool.query(
      'SELECT staff_name, role, color_code FROM human_resource WHERE unique_id = $1',
      [id]
    );

    if (staffCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Staff member not found',
        message: `No staff member found with ID: ${id}`
      });
    }

    const currentColor = staffCheck.rows[0].color_code || '#3b82f6';
    const staffName = staffCheck.rows[0].staff_name;

    // Check if color code is actually changing
    if (currentColor === color_code) {
      return res.status(400).json({
        success: false,
        error: 'No change detected',
        message: 'The color code is already set to this value. No change needed.'
      });
    }

    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Update color code
      await client.query(
        'UPDATE human_resource SET color_code = $1, updated_at = (NOW() AT TIME ZONE \'Europe/London\') WHERE unique_id = $2',
        [color_code, id]
      );
      
      // Log the change in history
      const effectiveDate = effective_from_date ? new Date(effective_from_date).toISOString() : new Date().toISOString();
      await client.query(`
        INSERT INTO change_requests (
          staff_id, staff_name, change_type, old_value, new_value, effective_from_date, changed_by, reason
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [id, staffName, 'color_code_change', currentColor, color_code, effectiveDate, changed_by, reason]);
      
      await client.query('COMMIT');
      
      // Get updated data
      const result = await pool.query(
        'SELECT unique_id, staff_name, role, color_code, updated_at FROM human_resource WHERE unique_id = $1',
        [id]
      );

      console.log(`✅ Staff member ${result.rows[0].staff_name} color code updated from ${currentColor} to ${color_code}`);

      // Take automatic snapshot after color code change
      try {
        await takeStaffSnapshot();
        console.log('✅ Automatic snapshot taken after color code change');
      } catch (snapshotError) {
        console.error('⚠️ Failed to take automatic snapshot after color code change:', snapshotError);
      }

      res.json({
        success: true,
        message: 'Color code updated successfully',
        data: result.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (err) {
    console.error('Error updating staff color code:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to update staff color code',
      message: err.message,
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// Get color code history for a staff member
app.get('/api/staff/:id/color-history', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if staff member exists
    const checkResult = await pool.query(
      'SELECT staff_name FROM human_resource WHERE unique_id = $1',
      [id]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Staff member not found',
        message: 'No staff member found with the specified ID'
      });
    }
    
    // Get color code history
    const result = await pool.query(`
      SELECT 
        id,
        staff_id,
        staff_name,
        change_type,
        old_value,
        new_value,
        effective_from_date,
        changed_at,
        changed_by,
        reason
      FROM change_requests
      WHERE staff_id = $1 AND change_type = 'color_code_change'
      ORDER BY changed_at DESC
    `, [id]);
    
    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (err) {
    console.error('Error fetching color history:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch color history',
      message: err.message
    });
  }
});

// Test timezone endpoint
app.get('/api/test-timezone', async (req, res) => {
  try {
    // Get current timezone setting
    const timezoneResult = await pool.query("SELECT current_setting('timezone') as current_timezone");
    
    // Get current time in database
    const timeResult = await pool.query("SELECT NOW() as current_time, (NOW() AT TIME ZONE 'Europe/London') as london_time");
    
    // Test creating a record
    const testResult = await pool.query(`
      INSERT INTO human_resource (staff_name, role, is_active) 
      VALUES ($1, $2, $3) 
      RETURNING unique_id, staff_name, created_at, updated_at
    `, ['TestStaff_Timezone', 'staff member', true]);
    
    const testStaff = testResult.rows[0];
    
    // Clean up test data
    await pool.query('DELETE FROM human_resource WHERE unique_id = $1', [testStaff.unique_id]);
    
    res.json({
      success: true,
      timezone: timezoneResult.rows[0].current_timezone,
      database_time: timeResult.rows[0].current_time,
      london_time: timeResult.rows[0].london_time,
      test_record: {
        created_at: testStaff.created_at,
        updated_at: testStaff.updated_at
      },
      message: 'Timezone test completed successfully'
    });
  } catch (error) {
    console.error('Error testing timezone:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to test timezone',
      message: error.message
    });
  }
});

// Update shift solo_shift flag
app.put('/api/shifts/:id/solo-shift', async (req, res) => {
  try {
    const { id } = req.params;
    const { solo_shift } = req.body;
    
    if (typeof solo_shift !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'Invalid solo_shift value',
        message: 'solo_shift must be a boolean value'
      });
    }
    
    const result = await pool.query(`
      UPDATE shifts 
      SET solo_shift = $1, updated_at = (NOW() AT TIME ZONE 'Europe/London')
      WHERE id = $2 
      RETURNING *
    `, [solo_shift, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Shift not found',
        message: 'No shift found with the specified ID'
      });
    }
    
    res.json({
      success: true,
      data: result.rows[0],
      message: `Solo shift flag ${solo_shift ? 'enabled' : 'disabled'} successfully`
    });
  } catch (err) {
    console.error('Error updating solo shift flag:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to update solo shift flag',
      message: err.message
    });
  }
});


// Update shift training flag
app.put('/api/shifts/:id/training', async (req, res) => {
  try {
    const { id } = req.params;
    const { training } = req.body;
    
    if (typeof training !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'Invalid training value',
        message: 'training must be a boolean value'
      });
    }
    
    const result = await pool.query(`
      UPDATE shifts 
      SET training = $1, updated_at = (NOW() AT TIME ZONE 'Europe/London')
      WHERE id = $2 
      RETURNING *
    `, [training, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Shift not found',
        message: 'No shift found with the specified ID'
      });
    }
    
    res.json({
      success: true,
      data: result.rows[0],
      message: `Training flag ${training ? 'enabled' : 'disabled'} successfully`
    });
  } catch (err) {
    console.error('Error updating training flag:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to update training flag',
      message: err.message
    });
  }
});

// Update shift short_notice flag
app.put('/api/shifts/:id/short-notice', async (req, res) => {
  try {
    const { id } = req.params;
    const { short_notice } = req.body;
    
    if (typeof short_notice !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'Invalid short_notice value',
        message: 'short_notice must be a boolean value'
      });
    }
    
    const result = await pool.query(`
      UPDATE shifts 
      SET short_notice = $1, updated_at = (NOW() AT TIME ZONE 'Europe/London')
      WHERE id = $2 
      RETURNING *
    `, [short_notice, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Shift not found',
        message: 'No shift found with the specified ID'
      });
    }
    
    res.json({
      success: true,
      data: result.rows[0],
      message: `Short notice flag ${short_notice ? 'enabled' : 'disabled'} successfully`
    });
  } catch (err) {
    console.error('Error updating short notice flag:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to update short notice flag',
      message: err.message
    });
  }
});

// Update shift payment_period_end flag
app.put('/api/shifts/:id/payment-period-end', async (req, res) => {
  try {
    const { id } = req.params;
    const { payment_period_end } = req.body;
    
    if (typeof payment_period_end !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'Invalid payment_period_end value',
        message: 'payment_period_end must be a boolean value'
      });
    }
    
    const result = await pool.query(`
      UPDATE shifts 
      SET payment_period_end = $1, updated_at = (NOW() AT TIME ZONE 'Europe/London')
      WHERE id = $2 
      RETURNING *
    `, [payment_period_end, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Shift not found',
        message: 'No shift found with the specified ID'
      });
    }
    
    res.json({
      success: true,
      data: result.rows[0],
      message: `Payment period end flag ${payment_period_end ? 'enabled' : 'disabled'} successfully`
    });
  } catch (err) {
    console.error('Error updating payment period end flag:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to update payment period end flag',
      message: err.message
    });
  }
});

// Update shift overtime flag
app.put('/api/shifts/:id/overtime', async (req, res) => {
  try {
    const { id } = req.params;
    const { overtime } = req.body;
    
    if (typeof overtime !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'Invalid overtime value',
        message: 'overtime must be a boolean value'
      });
    }
    
    const result = await pool.query(`
      UPDATE shifts 
      SET overtime = $1, updated_at = (NOW() AT TIME ZONE 'Europe/London')
      WHERE id = $2 
      RETURNING *
    `, [overtime, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Shift not found',
        message: 'No shift found with the specified ID'
      });
    }
    
    res.json({
      success: true,
      data: result.rows[0],
      message: `Overtime flag ${overtime ? 'enabled' : 'disabled'} successfully`
    });
  } catch (err) {
    console.error('Error updating overtime flag:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to update overtime flag',
      message: err.message
    });
  }
});

// Update shift callout flag
app.put('/api/shifts/:id/call-out', async (req, res) => {
  try {
    const { id } = req.params;
    const { call_out } = req.body;
    
    if (typeof call_out !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'Invalid call_out value',
        message: 'call_out must be a boolean value'
      });
    }
    
    const result = await pool.query(`
      UPDATE shifts 
      SET call_out = $1, updated_at = (NOW() AT TIME ZONE 'Europe/London')
      WHERE id = $2 
      RETURNING *
    `, [call_out, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Shift not found',
        message: 'No shift found with the specified ID'
      });
    }
    
    res.json({
      success: true,
      data: result.rows[0],
      message: `Callout flag ${call_out ? 'enabled' : 'disabled'} successfully`
    });
  } catch (err) {
    console.error('Error updating callout flag:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to update callout flag',
      message: err.message
    });
  }
});

// Update shift notes
app.put('/api/shifts/:id/notes', async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    
    if (typeof notes !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Invalid notes value',
        message: 'notes must be a string value'
      });
    }
    
    const result = await pool.query(`
      UPDATE shifts 
      SET notes = $1, updated_at = (NOW() AT TIME ZONE 'Europe/London')
      WHERE id = $2 
      RETURNING *
    `, [notes, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Shift not found',
        message: 'No shift found with the specified ID'
      });
    }
    
    res.json({
      success: true,
      data: result.rows[0],
      message: 'Notes updated successfully'
    });
  } catch (err) {
    console.error('Error updating notes:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to update notes',
      message: err.message
    });
  }
});

// =====================================================
// TIME-OFF MANAGEMENT API ENDPOINTS
// =====================================================


// Get holiday entitlements
app.get('/api/time-off/holiday-entitlements', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM current_holiday_entitlements
      ORDER BY staff_name
    `);
    
    res.json({
      success: true,
      data: result.rows,
      message: 'Holiday entitlements retrieved successfully'
    });
  } catch (err) {
    console.error('Error fetching holiday entitlements:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch holiday entitlements',
      message: err.message
    });
  }
});

// Get holiday entitlement for specific staff member
app.get('/api/time-off/holiday-entitlements/:staffId', async (req, res) => {
  try {
    const { staffId } = req.params;
    
    const result = await pool.query(`
      SELECT * FROM current_holiday_entitlements
      WHERE staff_id = $1
    `, [staffId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Entitlement not found',
        message: 'No holiday entitlement found for this staff member'
      });
    }
    
    res.json({
      success: true,
      data: result.rows[0],
      message: 'Holiday entitlement retrieved successfully'
    });
  } catch (err) {
    console.error('Error fetching holiday entitlement:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch holiday entitlement',
      message: err.message
    });
  }
});

// Create or update holiday entitlement
// Holiday entitlement creation endpoint removed - use recalculate endpoint instead
app.post('/api/time-off/holiday-entitlements', async (req, res) => {
  try {
    const { staff_id } = req.body;
    
    if (!staff_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'staff_id is required'
      });
    }
    
    // Redirect to recalculate endpoint
    res.json({
      success: true,
      message: 'Use PUT /api/time-off/holiday-entitlements/:staffId/recalculate instead',
      redirect: `/api/time-off/holiday-entitlements/${staff_id}/recalculate`
    });
    
    // Get current holiday year dates
    const yearResult = await pool.query('SELECT * FROM get_holiday_year_dates()');
    const { holiday_year_start, holiday_year_end } = yearResult.rows[0];
    
    // Get staff information from database if not provided
    const staffResult = await pool.query(`
      SELECT 
        staff_name,
        contracted_hours,
        employment_start_date, 
        employment_end_date 
      FROM human_resource 
      WHERE unique_id = $1
    `, [staff_id]);
    
    if (staffResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Staff not found',
        message: 'Staff member not found'
      });
    }
    
    const staff = staffResult.rows[0];
    const { 
      staff_name: db_staff_name, 
      contracted_hours: db_contracted_hours,
      employment_start_date, 
      employment_end_date 
    } = staff;
    
    // Use provided values or fall back to database values
    const finalStaffName = staff_name || db_staff_name;
    const finalContractedHours = contracted_hours_per_week || db_contracted_hours;
    
    // Calculate pro-rated entitlement considering employment dates
    const entitlementResult = await pool.query(`
      SELECT calculate_financial_year_entitlement($1, $2, $3) as days
    `, [finalContractedHours, employment_start_date, employment_end_date]);
    
    const statutory_entitlement_days = entitlementResult.rows[0].days;
    const statutory_entitlement_hours = statutory_entitlement_days * 12;
    
    // Check if entitlement already exists for this year
    const existingResult = await pool.query(`
      SELECT * FROM holiday_entitlements 
      WHERE staff_id = $1 AND holiday_year_start = $2 AND holiday_year_end = $3
    `, [staff_id, holiday_year_start, holiday_year_end]);
    
    if (existingResult.rows.length > 0) {
      // Update existing entitlement
      const result = await pool.query(`
        UPDATE holiday_entitlements 
        SET contracted_hours_per_week = $1, statutory_entitlement_days = $2, statutory_entitlement_hours = $3, is_zero_hours = $4
        WHERE staff_id = $5 AND holiday_year_start = $6 AND holiday_year_end = $7
        RETURNING *
      `, [finalContractedHours, statutory_entitlement_days, statutory_entitlement_hours, is_zero_hours, staff_id, holiday_year_start, holiday_year_end]);
      
      res.json({
        success: true,
        data: result.rows[0],
        message: 'Holiday entitlement updated successfully'
      });
    } else {
      // Create new entitlement
      const result = await pool.query(`
        INSERT INTO holiday_entitlements (
          staff_id, staff_name, holiday_year_start, holiday_year_end,
          contracted_hours_per_week, statutory_entitlement_days, statutory_entitlement_hours, is_zero_hours
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `, [staff_id, finalStaffName, holiday_year_start, holiday_year_end, finalContractedHours, statutory_entitlement_days, statutory_entitlement_hours, is_zero_hours]);
      
      res.json({
        success: true,
        data: result.rows[0],
        message: 'Holiday entitlement created successfully'
      });
    }
  } catch (err) {
    console.error('Error creating/updating holiday entitlement:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to create/update holiday entitlement',
      message: err.message
    });
  }
});

// Recalculate holiday entitlement when employment dates change
app.put('/api/time-off/holiday-entitlements/:staffId/recalculate', async (req, res) => {
  try {
    const { staffId } = req.params;
    const { employment_end_date } = req.body;
    
    // Use the database function to recalculate entitlement
    await pool.query('SELECT recalculate_holiday_entitlement($1, $2)', [staffId, employment_end_date]);
    
    // Get the updated entitlement
    const result = await pool.query(`
      SELECT * FROM current_holiday_entitlements 
      WHERE staff_id = $1
    `, [staffId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Entitlement not found',
        message: 'No current holiday entitlement found for this staff member'
      });
    }
    
    res.json({
      success: true,
      data: result.rows[0],
      message: 'Holiday entitlement recalculated successfully'
    });
    
  } catch (err) {
    console.error('Error recalculating holiday entitlement:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to recalculate holiday entitlement',
      message: err.message
    });
  }
});

// Bulk recalculate holiday entitlements for staff with early termination
app.post('/api/time-off/holiday-entitlements/recalculate-early-terminations', async (req, res) => {
  try {
    // Get current holiday year dates
    const yearResult = await pool.query('SELECT * FROM get_holiday_year_dates()');
    const { holiday_year_end } = yearResult.rows[0];
    
    // Find staff members with employment end dates before the end of the financial year
    const earlyTerminationResult = await pool.query(`
      SELECT 
        unique_id as staff_id,
        staff_name,
        employment_start_date,
        employment_end_date,
        contracted_hours,
        is_active
      FROM human_resource 
      WHERE employment_end_date IS NOT NULL 
        AND employment_end_date < $1
    `, [holiday_year_end]);
    
    const results = [];
    
    for (const staff of earlyTerminationResult.rows) {
      try {
        // Recalculate entitlement for this staff member
        await pool.query('SELECT recalculate_holiday_entitlement($1, $2)', [staff.staff_id, staff.employment_end_date]);
        
        // Get the updated entitlement
        const entitlementResult = await pool.query(`
          SELECT * FROM current_holiday_entitlements 
          WHERE staff_id = $1
        `, [staff.staff_id]);
        
        results.push({
          staff_id: staff.staff_id,
          staff_name: staff.staff_name,
          employment_end_date: staff.employment_end_date,
          is_active: staff.is_active,
          success: true,
          entitlement: entitlementResult.rows[0] || null
        });
      } catch (error) {
        results.push({
          staff_id: staff.staff_id,
          staff_name: staff.staff_name,
          employment_end_date: staff.employment_end_date,
          is_active: staff.is_active,
          success: false,
          error: error.message
        });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;
    
    res.json({
      success: true,
      data: {
        total_processed: results.length,
        successful: successCount,
        failed: failureCount,
        results: results
      },
      message: `Processed ${results.length} staff members: ${successCount} successful, ${failureCount} failed`
    });
    
  } catch (err) {
    console.error('Error bulk recalculating holiday entitlements:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to bulk recalculate holiday entitlements',
      message: err.message
    });
  }
});

// Check if staff member has fully utilized holiday entitlement
app.get('/api/time-off/holiday-entitlements/:staffId/status', async (req, res) => {
  try {
    const { staffId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        he.*,
        hr.contracted_hours,
        hr.employment_start_date,
        hr.employment_end_date,
        CASE 
          WHEN he.days_remaining <= 0 THEN true 
          ELSE false 
        END as is_fully_utilized,
        CASE 
          WHEN he.is_zero_hours THEN 'zero_hours'
          ELSE 'contracted'
        END as employee_type
      FROM current_holiday_entitlements he
      JOIN human_resource hr ON he.staff_id = hr.unique_id
      WHERE he.staff_id = $1
    `, [staffId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Holiday entitlement not found',
        message: 'No holiday entitlement found for this staff member'
      });
    }
    
    const entitlement = result.rows[0];
    
    res.json({
      success: true,
      data: {
        staff_id: entitlement.staff_id,
        staff_name: entitlement.staff_name,
        employee_type: entitlement.employee_type,
        contracted_hours: entitlement.contracted_hours,
        statutory_entitlement_days: entitlement.statutory_entitlement_days,
        days_taken: entitlement.days_taken,
        days_remaining: entitlement.days_remaining,
        is_fully_utilized: entitlement.is_fully_utilized,
        holiday_year_start: entitlement.holiday_year_start,
        holiday_year_end: entitlement.holiday_year_end
      },
      message: 'Holiday entitlement status retrieved successfully'
    });
    
  } catch (error) {
    console.error('❌ Error checking holiday entitlement status:', error);
    res.status(500).json({
      success: false,
      error: 'Database error',
      message: 'Failed to check holiday entitlement status'
    });
  }
});

// Update holiday entitlement usage (automatically calculated from time-off requests)
app.put('/api/time-off/holiday-entitlements/:staffId/usage', async (req, res) => {
  try {
    const { staffId } = req.params;
    
    // Use the database function to automatically calculate usage from time-off requests
    await pool.query('SELECT update_holiday_entitlement_usage($1)', [staffId]);
    
    // Get the updated entitlement
    const result = await pool.query(`
      SELECT * FROM current_holiday_entitlements 
      WHERE staff_id = $1
    `, [staffId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Holiday entitlement not found',
        message: 'No holiday entitlement found for this staff member'
      });
    }
    
    res.json({
      success: true,
      data: result.rows[0],
      message: 'Holiday entitlement usage updated successfully'
    });
  } catch (error) {
    console.error('❌ Error updating holiday entitlement usage:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update holiday entitlement usage',
      message: error.message
    });
  }
});

// Refresh all holiday entitlements (update taken/remaining from time-off requests)
app.post('/api/time-off/holiday-entitlements/refresh', async (req, res) => {
  try {
    // Use the database function to update all staff members' holiday usage
    await pool.query('SELECT update_all_holiday_entitlement_usage()');
    
    // Get all updated entitlements
    const result = await pool.query(`
      SELECT * FROM current_holiday_entitlements
      ORDER BY staff_name
    `);
    
    res.json({
      success: true,
      data: result.rows,
      message: 'All holiday entitlements refreshed successfully'
    });
  } catch (error) {
    console.error('❌ Error refreshing holiday entitlements:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh holiday entitlements',
      message: error.message
    });
  }
});

// Get time-off summary (redirects to holiday entitlements)
app.get('/api/time-off/summary', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM current_holiday_entitlements
      ORDER BY staff_name
    `);
    
    res.json({
      success: true,
      data: result.rows,
      message: 'Time-off summary retrieved successfully'
    });
  } catch (err) {
    console.error('Error fetching time-off summary:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch time-off summary',
      message: err.message
    });
  }
});

// 404 handler for undefined routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    message: `API endpoint ${req.method} ${req.originalUrl} does not exist`
  });
});

// Serve the main HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Background processor for change requests
async function processChangeRequests() {
  try {
    const now = new Date().toISOString();
    
    // Get all pending change requests that should be applied now
    const pendingRequests = await pool.query(`
      SELECT * FROM change_requests 
      WHERE effective_from_date <= $1
      ORDER BY effective_from_date ASC
    `, [now]);
    
    for (const request of pendingRequests.rows) {
      try {
        console.log(`🔄 Processing change request: ${request.change_type} for ${request.staff_name}`);
        
        // Apply the change based on type
        let updateQuery = '';
        let updateParams = [];
        
        switch (request.change_type) {
          case 'role_change':
            updateQuery = 'UPDATE human_resource SET role = $1, updated_at = (NOW() AT TIME ZONE \'Europe/London\') WHERE unique_id = $2';
            updateParams = [request.new_value, request.staff_id];
            break;
          case 'pay_rate_change':
            updateQuery = 'UPDATE human_resource SET pay_rate = $1, updated_at = (NOW() AT TIME ZONE \'Europe/London\') WHERE unique_id = $2';
            updateParams = [request.new_value, request.staff_id];
            break;
          case 'contracted_hours_change':
            updateQuery = 'UPDATE human_resource SET contracted_hours = $1, updated_at = (NOW() AT TIME ZONE \'Europe/London\') WHERE unique_id = $2';
            updateParams = [request.new_value, request.staff_id];
            break;
          case 'employment_date_change':
            updateQuery = 'UPDATE human_resource SET employment_start_date = $1, updated_at = (NOW() AT TIME ZONE \'Europe/London\') WHERE unique_id = $2';
            updateParams = [request.new_value, request.staff_id];
            break;
          case 'employment_end_date_change':
            updateQuery = 'UPDATE human_resource SET employment_end_date = $1, updated_at = (NOW() AT TIME ZONE \'Europe/London\') WHERE unique_id = $2';
            updateParams = [request.new_value === 'NULL' ? null : request.new_value, request.staff_id];
            break;
          case 'color_code_change':
            updateQuery = 'UPDATE human_resource SET color_code = $1, updated_at = (NOW() AT TIME ZONE \'Europe/London\') WHERE unique_id = $2';
            updateParams = [request.new_value, request.staff_id];
            break;
          case 'active_status_change':
            updateQuery = 'UPDATE human_resource SET is_active = $1, updated_at = (NOW() AT TIME ZONE \'Europe/London\') WHERE unique_id = $2';
            updateParams = [request.new_value === 'true', request.staff_id];
            break;
          default:
            console.error(`❌ Unknown change type: ${request.change_type}`);
            continue;
        }
        
        // Apply the change
        await pool.query(updateQuery, updateParams);
        
        // Log in change_requests as applied
        await pool.query(`
          INSERT INTO change_requests (
            staff_id, staff_name, change_type, old_value, new_value, 
            effective_from_date, changed_by, reason
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          request.staff_id, request.staff_name, request.change_type,
          request.old_value, request.new_value, request.effective_from_date,
          request.changed_by, request.reason
        ]);
        
        // Delete the processed change request
        await pool.query(`
          DELETE FROM change_requests 
          WHERE id = $1
        `, [request.id]);
        
        console.log(`✅ Applied change request: ${request.change_type} for ${request.staff_name}`);
        
      } catch (error) {
        console.error(`❌ Error applying change request ${request.id}:`, error);
        // Mark as failed or keep as pending for retry
      }
    }
    
  } catch (error) {
    console.error('❌ Error in change request processor:', error);
  }
}

// Run change request processor every minute
setInterval(processChangeRequests, 60000); // 60 seconds

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('API endpoints available at /api/*');
  console.log('Database connection:', pool.totalCount > 0 ? 'Active' : 'Inactive');
  console.log('🔄 Change request processor started (runs every 60 seconds)');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nReceived SIGINT. Closing server gracefully...');
  pool.end();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM. Closing server gracefully...');
  pool.end();
  process.exit(0);
}); 