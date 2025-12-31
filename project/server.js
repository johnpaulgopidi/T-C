// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const dbConfig = config.db;

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// PostgreSQL connection configuration
const pool = new Pool(dbConfig);

// Handle pool errors
pool.on('error', (err, client) => {
  console.error('❌ Unexpected error on idle client', err);
  process.exit(-1);
});

// Handle connection errors with retry logic
// Note: The 'connect' event fires for every new connection created in the pool.
// This is normal behavior - the pool creates connections as needed for concurrent requests.
// We'll only log the first connection to reduce console noise.
let firstConnectionLogged = false;
pool.on('connect', (client) => {
  if (!firstConnectionLogged) {
    console.log('✅ Database connection pool initialized');
    firstConnectionLogged = true;
  }
});

// Database connection test with retry
async function testDatabaseConnection(retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const result = await pool.query('SELECT NOW()');
      console.log('✅ Database connected successfully');
      console.log('📊 Connection details:', {
        host: dbConfig.host,
        port: dbConfig.port,
        database: dbConfig.database,
        user: dbConfig.user
      });
      return true;
    } catch (err) {
      console.error(`❌ Database connection attempt ${i + 1}/${retries} failed:`, err.message);
      if (i < retries - 1) {
        console.log(`⏳ Retrying in 2 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        console.error('❌ Connection details:', {
          host: dbConfig.host,
          port: dbConfig.port,
          database: dbConfig.database,
          user: dbConfig.user,
          hasPassword: !!dbConfig.password
        });
      }
    }
  }
  return false;
}

// Test connection
testDatabaseConnection();

// Helper function to execute queries with retry logic
async function executeQueryWithRetry(query, params, retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      const result = await pool.query(query, params);
      return result;
    } catch (err) {
      const isLastAttempt = i === retries - 1;
      const isConnectionError = err.code === 'ECONNRESET' || 
                                err.code === 'ETIMEDOUT' || 
                                err.message.includes('Connection terminated') ||
                                err.message.includes('timeout');
      
      if (isConnectionError && !isLastAttempt) {
        console.warn(`⚠️ Connection error on attempt ${i + 1}/${retries}, retrying...`, err.message);
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); // Exponential backoff
        continue;
      }
      
      throw err; // Re-throw if not a connection error or last attempt
    }
  }
}

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


// Server-side cache for historical pay rates (in-memory cache)
const historicalPayRateCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Function to get cache key
function getCacheKey(staffName, calculationDate) {
  return `${staffName}-${calculationDate}`;
}

// Function to calculate historical pay based on role history (optimized)
async function calculateHistoricalPay(staffName, calculationDate, hoursWorked = null, shiftFlags = {}) {
  try {
    // Check cache first
    const cacheKey = getCacheKey(staffName, calculationDate);
    const cached = historicalPayRateCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      // Return cached result with updated hours/flags if needed
      const result = { ...cached.data };
      if (hoursWorked !== null) result.hours_worked = hoursWorked;
      if (Object.keys(shiftFlags).length > 0) {
        result.shift_flags = shiftFlags;
        // Recalculate pay with new flags
        const multiplier = calculateMultiplier(shiftFlags);
        result.multiplier = multiplier;
        result.weekly_pay = Math.round((result.effective_pay_rate * (hoursWorked || result.hours_worked)) * multiplier * 100) / 100;
      }
      return result;
    }
    
    // Get current staff info and pay rate history in a single optimized query
    const endOfDay = calculationDate.includes('T') ? calculationDate : `${calculationDate}T23:59:59.999Z`;
    
    // Combined query to get staff info and pay rate history in one go (using subqueries for simplicity)
    const combinedResult = await executeQueryWithRetry(`
      SELECT 
        s.*,
        (SELECT new_value FROM change_requests 
         WHERE staff_name = $1 
         AND change_type = 'pay_rate_change'
         AND effective_from_date <= $2::timestamp
         ORDER BY effective_from_date DESC
         LIMIT 1) as recent_pay_rate,
        (SELECT changed_at FROM change_requests 
         WHERE staff_name = $1 
         AND change_type = 'pay_rate_change'
         AND effective_from_date <= $2::timestamp
         ORDER BY effective_from_date DESC
         LIMIT 1) as recent_pay_rate_changed_at,
        (SELECT old_value FROM change_requests 
         WHERE staff_name = $1 
         AND change_type = 'pay_rate_change'
         ORDER BY effective_from_date ASC
         LIMIT 1) as original_pay_rate
      FROM human_resource s
      WHERE s.staff_name = $1
    `, [staffName, endOfDay]);
    
    if (combinedResult.rows.length === 0) {
      throw new Error(`Staff member ${staffName} not found`);
    }
    
    const row = combinedResult.rows[0];
    const currentStaff = row;
    
    let effectivePayRate;
    let effectiveRateDate = currentStaff.created_at;
    
    if (row.recent_pay_rate) {
      // There was a pay rate change before this date
      effectivePayRate = parseFloat(row.recent_pay_rate);
      effectiveRateDate = row.recent_pay_rate_changed_at || currentStaff.created_at;
    } else if (row.original_pay_rate) {
      // No changes before this date, use original rate
      effectivePayRate = parseFloat(row.original_pay_rate);
      effectiveRateDate = currentStaff.created_at;
    } else {
      // No pay rate changes at all, use current pay rate
      effectivePayRate = parseFloat(currentStaff.pay_rate);
      effectiveRateDate = currentStaff.created_at;
    }
    
    const actualHours = hoursWorked || parseFloat(currentStaff.contracted_hours) || 12;
    
    // Calculate pay with multipliers based on shift flags
    const multiplier = calculateMultiplier(shiftFlags);
    
    const basePay = effectivePayRate * actualHours;
    const weeklyPay = basePay * multiplier;
    
    const result = {
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
    
    // Cache the result (without shift flags for base rate)
    if (Object.keys(shiftFlags).length === 0) {
      historicalPayRateCache.set(cacheKey, {
        data: { ...result },
        timestamp: Date.now()
      });
    }
    
    return result;
  } catch (error) {
    console.error('❌ Error calculating historical pay:', error);
    throw error;
  }
}

// Helper function to calculate multiplier from shift flags
function calculateMultiplier(shiftFlags) {
  let multiplier = 1.0;
  
  if (shiftFlags.solo_shift) {
    multiplier = Math.max(multiplier, 1.75);
  }
  
  if (shiftFlags.training || shiftFlags.short_notice) {
    multiplier = Math.max(multiplier, 1.75);
  }
  
  if (shiftFlags.call_out) {
    multiplier = Math.max(multiplier, 2.0);
  }
  
  if (shiftFlags.overtime) {
    multiplier = Math.max(multiplier, 2.0);
  }
  
  return multiplier;
}

// Function to calculate historical statutory holiday pay (UK)
async function calculateHistoricalHolidayPay(staffName, holidayDate, weeksWorked = 52) {
  try {
    const endOfDay = holidayDate.includes('T') ? holidayDate : `${holidayDate}T23:59:59.999Z`;
    
    // Query to get staff info and historical pay rate/contracted hours
    const combinedResult = await executeQueryWithRetry(`
      SELECT 
        s.*,
        (SELECT new_value FROM change_requests 
         WHERE staff_name = $1 
         AND change_type = 'pay_rate_change'
         AND effective_from_date <= $2::timestamp
         ORDER BY effective_from_date DESC
         LIMIT 1) as recent_pay_rate,
        (SELECT changed_at FROM change_requests 
         WHERE staff_name = $1 
         AND change_type = 'pay_rate_change'
         AND effective_from_date <= $2::timestamp
         ORDER BY effective_from_date DESC
         LIMIT 1) as recent_pay_rate_changed_at,
        (SELECT new_value FROM change_requests 
         WHERE staff_name = $1 
         AND change_type = 'contracted_hours_change'
         AND effective_from_date <= $2::timestamp
         ORDER BY effective_from_date DESC
         LIMIT 1) as recent_contracted_hours
      FROM human_resource s
      WHERE s.staff_name = $1
    `, [staffName, endOfDay]);
    
    if (combinedResult.rows.length === 0) {
      throw new Error(`Staff member ${staffName} not found`);
    }
    
    const row = combinedResult.rows[0];
    const currentStaff = row;
    
    // Determine effective pay rate
    let effectivePayRate;
    let effectiveRateDate = currentStaff.created_at;
    
    if (row.recent_pay_rate) {
      effectivePayRate = parseFloat(row.recent_pay_rate);
      effectiveRateDate = row.recent_pay_rate_changed_at || currentStaff.created_at;
    } else {
      // No changes before this date, use current pay rate
      effectivePayRate = parseFloat(currentStaff.pay_rate);
      effectiveRateDate = currentStaff.created_at;
    }
    
    // Determine effective contracted hours
    let effectiveContractedHours;
    if (row.recent_contracted_hours) {
      effectiveContractedHours = parseFloat(row.recent_contracted_hours);
    } else {
      effectiveContractedHours = parseFloat(currentStaff.contracted_hours) || 0;
    }
    
    const weeklyPay = effectivePayRate * effectiveContractedHours;
    const holidayPay = (weeklyPay * 5.6) / 52; // UK statutory minimum 5.6 weeks per year
    
    return {
      staff_name: staffName,
      holiday_date: holidayDate,
      pay_rate: effectivePayRate,
      contracted_hours: effectiveContractedHours,
      weekly_pay: Math.round(weeklyPay * 100) / 100,
      holiday_pay: Math.round(holidayPay * 100) / 100,
      effective_rate_date: effectiveRateDate
    };
  } catch (error) {
    console.error('❌ Error calculating historical holiday pay:', error);
    throw error;
  }
}



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
// IMPORTANT: Specific routes must come BEFORE parameterized routes
// Get all change requests (global) - must be before /api/staff/:id
app.get('/api/staff/change-requests', async (req, res) => {
  try {
    console.log('📋 Fetching all change requests...');
    
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
      WHERE effective_from_date > NOW()
      ORDER BY changed_at DESC
    `);
    
    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (err) {
    console.error('Error fetching all change requests:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch change requests',
      message: err.message
    });
  }
});

// Get all changes history (global) - must be before /api/staff/:id
app.get('/api/staff/changes-history', async (req, res) => {
  try {
    console.log('📋 Fetching all changes history...');
    
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
      WHERE effective_from_date <= NOW()
      ORDER BY changed_at DESC
    `);
    
    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (err) {
    console.error('Error fetching all changes history:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch changes history',
      message: err.message
    });
  }
});

// Get staff member by ID - must come AFTER specific routes
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

// Calculate historical weekly pay (single)
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

// Batch endpoint for historical pay rates (optimized for performance)
app.post('/api/staff/batch-historical-pay', async (req, res) => {
  try {
    const { requests } = req.body;
    
    if (!Array.isArray(requests) || requests.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request',
        message: 'requests must be a non-empty array'
      });
    }
    
    // Limit batch size to prevent overwhelming the database
    const maxBatchSize = 50;
    const batch = requests.slice(0, maxBatchSize);
    
    console.log(`📊 Processing batch of ${batch.length} historical pay rate requests`);
    
    // Process requests in smaller concurrent batches to avoid connection pool exhaustion
    const concurrentLimit = 5; // Process 5 at a time
    const results = new Map();
    
    for (let i = 0; i < batch.length; i += concurrentLimit) {
      const chunk = batch.slice(i, i + concurrentLimit);
      const chunkPromises = chunk.map(async (request) => {
        const { staff_name, calculation_date } = request;
        const key = `${staff_name}-${calculation_date}`;
        
        try {
          const payCalculation = await calculateHistoricalPay(staff_name, calculation_date);
          results.set(key, {
            success: true,
            pay_rate: payCalculation.effective_pay_rate,
            data: payCalculation
          });
        } catch (error) {
          console.error(`❌ Error calculating pay for ${staff_name} on ${calculation_date}:`, error.message);
          results.set(key, {
            success: false,
            error: error.message,
            pay_rate: null
          });
        }
      });
      
      await Promise.all(chunkPromises);
    }
    
    // Convert Map to object for JSON response
    const resultsObj = {};
    results.forEach((value, key) => {
      resultsObj[key] = value;
    });
    
    res.json({
      success: true,
      data: resultsObj,
      count: results.size,
      message: `Processed ${results.size} historical pay rate requests`
    });
    
  } catch (error) {
    console.error('Error processing batch historical pay:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process batch historical pay',
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
    
    const holidayPayCalculation = await calculateHistoricalHolidayPay(staff_name, holiday_date, weeks_worked);
    
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

// Add new staff member
app.post('/api/staff', 
  validateRequiredFields(['name', 'employment_start_date', 'contracted_hours', 'pay_rate']),
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

      // Validate contracted hours
      if (!contracted_hours || isNaN(parseFloat(contracted_hours)) || parseFloat(contracted_hours) < 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid contracted hours',
          message: 'Contracted hours must be a valid number (0 or greater)'
        });
      }

      // Validate pay rate
      if (!pay_rate || isNaN(parseFloat(pay_rate)) || parseFloat(pay_rate) < 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid pay rate',
          message: 'Pay rate must be a valid number (0 or greater)'
        });
      }
    
    const result = await pool.query(
      `INSERT INTO human_resource (
        unique_id,
        staff_name, 
        role, 
        employment_start_date,
        employment_end_date,
        contracted_hours,
        pay_rate
      ) VALUES (uuid_human_resource($1), $1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, role, employment_start_date, employment_end_date, contracted_hours, pay_rate]
    );
    
    const newStaff = result.rows[0];
    
    // Create holiday entitlement for the new staff member
    try {
      await pool.query('SELECT recalculate_holiday_entitlement($1, $2)', [
        newStaff.unique_id, 
        employment_end_date
      ]);
      
      // Verify holiday entitlement was created
      const entitlementCheck = await pool.query(
        'SELECT COUNT(*) as entitlement_count FROM holiday_entitlements WHERE staff_id = $1',
        [newStaff.unique_id]
      );
      
      if (parseInt(entitlementCheck.rows[0].entitlement_count) > 0) {
        console.log(`✅ Holiday entitlement created for new staff member: ${name}`);
      } else {
        console.warn(`⚠️ Warning: Holiday entitlement was not created for new staff member: ${name}`);
      }
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
    
    // Check if staff member has any shifts (for logging purposes)
    const shiftsResult = await pool.query(
      'SELECT COUNT(*) as shift_count FROM shifts WHERE staff_name = $1',
      [checkResult.rows[0].staff_name]
    );
    
    const shiftCount = parseInt(shiftsResult.rows[0].shift_count);
    if (shiftCount > 0) {
      console.log(`⚠️ Deleting staff member ${checkResult.rows[0].staff_name} with ${shiftCount} assigned shifts. Shifts will be cascade deleted.`);
    }
    
    // Delete staff member - this will cascade to shifts and holiday_entitlements due to ON DELETE CASCADE
    await pool.query('DELETE FROM human_resource WHERE unique_id = $1', [id]);
    
    // Verify shifts were deleted
    const shiftsCheck = await pool.query(
      'SELECT COUNT(*) as shift_count FROM shifts WHERE staff_name = $1',
      [checkResult.rows[0].staff_name]
    );
    
    if (parseInt(shiftsCheck.rows[0].shift_count) > 0) {
      console.warn(`⚠️ Warning: Shifts still exist for deleted staff member ${checkResult.rows[0].staff_name}`);
    } else if (shiftCount > 0) {
      console.log(`✅ ${shiftCount} shifts successfully cascade deleted for staff member: ${checkResult.rows[0].staff_name}`);
    }
    
    // Verify holiday entitlements were deleted
    const holidayCheck = await pool.query(
      'SELECT COUNT(*) as entitlement_count FROM holiday_entitlements WHERE staff_id = $1',
      [id]
    );
    
    if (parseInt(holidayCheck.rows[0].entitlement_count) > 0) {
      console.warn(`⚠️ Warning: Holiday entitlements still exist for deleted staff member ${checkResult.rows[0].staff_name}`);
    } else {
      console.log(`✅ Holiday entitlements successfully deleted for staff member: ${checkResult.rows[0].staff_name}`);
    }
    
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

// Helper function to validate change requests before insertion
async function validateChangeRequest(staffId, changeType, oldValue, newValue) {
  const warnings = [];
  const errors = [];
  
  // Map change types to human_resource table columns
  const changeTypeToColumn = {
    'role_change': 'role',
    'pay_rate_change': 'pay_rate',
    'contracted_hours_change': 'contracted_hours',
    'employment_date_change': 'employment_start_date',
    'employment_end_date_change': 'employment_end_date',
    'color_code_change': 'color_code',
    'active_status_change': 'is_active'
  };
  
  const columnName = changeTypeToColumn[changeType];
  if (!columnName) {
    errors.push(`Unknown change type: ${changeType}`);
    return { warnings, errors, isValid: false };
  }
  
  // Check for duplicate change requests (same change_type, old_value, new_value for same staff)
  const duplicateCheck = await pool.query(`
    SELECT COUNT(*) as duplicate_count
    FROM change_requests
    WHERE staff_id = $1
      AND change_type = $2
      AND old_value = $3
      AND new_value = $4
  `, [staffId, changeType, oldValue || 'NULL', newValue || 'NULL']);
  
  const duplicateCount = parseInt(duplicateCheck.rows[0].duplicate_count);
  if (duplicateCount > 0) {
    warnings.push(`Warning: ${duplicateCount} duplicate change request(s) already exist with the same change type, old value, and new value.`);
  }
  
  // Check if new_value matches current value in human_resource table
  const currentValueResult = await pool.query(`
    SELECT ${columnName} as current_value
    FROM human_resource
    WHERE unique_id = $1
  `, [staffId]);
  
  if (currentValueResult.rows.length === 0) {
    errors.push('Staff member not found in human_resource table');
    return { warnings, errors, isValid: false };
  }
  
  const currentValue = currentValueResult.rows[0].current_value;
  
  // Normalize values for comparison (handle nulls, booleans, numbers, dates)
  const normalizeValue = (val) => {
    if (val === null || val === undefined || val === 'NULL' || val === '') return null;
    if (typeof val === 'boolean') return val.toString();
    if (typeof val === 'number') return val.toString();
    if (val instanceof Date) return val.toISOString().split('T')[0];
    return val.toString().trim();
  };
  
  const normalizedCurrent = normalizeValue(currentValue);
  const normalizedNew = normalizeValue(newValue);
  
  console.log(`🔍 Validation for ${changeType}: currentValue=${currentValue} (type: ${typeof currentValue}), newValue=${newValue} (type: ${typeof newValue})`);
  console.log(`🔍 Normalized: current="${normalizedCurrent}", new="${normalizedNew}"`);
  
  // Special handling for boolean fields
  if (changeType === 'active_status_change') {
    const currentBool = currentValue === true || currentValue === 'true' || currentValue === 1;
    const newBool = newValue === 'true' || newValue === true || newValue === 1;
    if (currentBool === newBool) {
      console.log(`❌ Validation failed: boolean values match (${currentBool} === ${newBool})`);
      errors.push(`The new value (${newValue}) matches the current value in human_resource table (${currentValue}). No change will occur.`);
      return { warnings, errors, isValid: false };
    }
  } else if (normalizedCurrent === normalizedNew) {
    console.log(`❌ Validation failed: normalized values match ("${normalizedCurrent}" === "${normalizedNew}")`);
    errors.push(`The new value (${newValue}) matches the current value in human_resource table (${currentValue}). No change will occur.`);
    return { warnings, errors, isValid: false };
  }
  
  console.log(`✅ Validation passed for ${changeType}`);
  return { warnings, errors, isValid: true };
}

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
    const staffName = checkResult.rows[0].staff_name;
    
    // Validate change request before proceeding
    const validation = await validateChangeRequest(id, 'role_change', currentRole, role);
    
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Change request validation failed',
        message: validation.errors.join(' '),
        warnings: validation.warnings
      });
    }
    
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
      try {
        const insertResult = await pool.query(`
          INSERT INTO change_requests (
            id, staff_id, staff_name, change_type, field_name, old_value, new_value, effective_from_date, changed_at, changed_by, reason
          ) VALUES (uuid_change_request($1, $3, 'role', $6), $1, $2, $3, 'role', $4, $5, $6, $6, $7, $8)
          RETURNING id
        `, [id, staffName, 'role_change', currentRole, role, effectiveDate, changed_by, reason]);
        console.log(`✅ Change request inserted for role change: ${insertResult.rows[0].id}`);
      } catch (insertError) {
        console.error('❌ Error inserting change request for role change:', insertError);
        throw insertError;
      }
      
      res.json({
        success: true,
        data: result.rows[0],
        message: `Staff member role updated to ${role} successfully`,
        applied_immediately: true,
        warnings: validation.warnings.length > 0 ? validation.warnings : undefined
      });
    } else {
      // Create change request for future application
      try {
        const changeRequestResult = await pool.query(`
          INSERT INTO change_requests (
            id, staff_id, staff_name, change_type, field_name, old_value, new_value, 
            effective_from_date, changed_at, changed_by, reason
          ) VALUES (uuid_change_request($1, $3, 'role', $6), $1, $2, $3, 'role', $4, $5, $6, $6, $7, $8)
          RETURNING *
        `, [id, staffName, 'role_change', currentRole, role, effectiveDate, changed_by, reason]);
        console.log(`✅ Change request inserted for future role change: ${changeRequestResult.rows[0].id}`);

        res.json({
          success: true,
          data: changeRequestResult.rows[0],
          message: `Change request created for role update to ${role} (effective ${new Date(effective_from_date).toLocaleString()})`,
          applied_immediately: false,
          effective_date: effectiveDate,
          warnings: validation.warnings.length > 0 ? validation.warnings : undefined
        });
      } catch (insertError) {
        console.error('❌ Error inserting change request for future role change:', insertError);
        throw insertError;
      }
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
    
    // Validate change request before proceeding
    const validation = await validateChangeRequest(id, 'pay_rate_change', currentPayRate.toString(), pay_rate.toString());
    
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Change request validation failed',
        message: validation.errors.join(' '),
        warnings: validation.warnings
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
      try {
        const insertResult = await client.query(`
          INSERT INTO change_requests (
            id, staff_id, staff_name, change_type, field_name, old_value, new_value, effective_from_date, changed_at, changed_by, reason
          ) VALUES (uuid_change_request($1, $3, 'pay_rate', $6), $1, $2, $3, 'pay_rate', $4, $5, $6, $6, $7, $8)
          RETURNING id
        `, [id, staffName, 'pay_rate_change', currentPayRate.toString(), pay_rate.toString(), effectiveDate, changed_by, reason]);
        console.log(`✅ Change request inserted for pay rate change: ${insertResult.rows[0].id}`);
      } catch (insertError) {
        console.error('❌ Error inserting change request for pay rate change:', insertError);
        throw insertError;
      }
      
      await client.query('COMMIT');
      
      // Get updated data
      const result = await pool.query(`
        SELECT * FROM human_resource WHERE unique_id = $1
      `, [id]);
      
      res.json({
        success: true,
        data: result.rows[0],
        message: 'Pay rate updated successfully in human_resource table',
        warnings: validation.warnings.length > 0 ? validation.warnings : undefined
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
    
    // Validate change request before proceeding
    const validation = await validateChangeRequest(id, 'contracted_hours_change', currentContractedHours.toString(), contracted_hours.toString());
    
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Change request validation failed',
        message: validation.errors.join(' '),
        warnings: validation.warnings
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
      try {
        const insertResult = await client.query(`
          INSERT INTO change_requests (
            id, staff_id, staff_name, change_type, field_name, old_value, new_value, effective_from_date, changed_at, changed_by, reason
          ) VALUES (uuid_change_request($1, $3, 'contracted_hours', $6), $1, $2, $3, 'contracted_hours', $4, $5, $6, $6, $7, $8)
          RETURNING id
        `, [id, staffName, 'contracted_hours_change', currentContractedHours.toString(), contracted_hours.toString(), effectiveDate, changed_by, reason]);
        console.log(`✅ Change request inserted for contracted hours change: ${insertResult.rows[0].id}`);
      } catch (insertError) {
        console.error('❌ Error inserting change request for contracted hours change:', insertError);
        throw insertError;
      }
      
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

      res.json({
        success: true,
        data: result.rows[0],
        message: 'Contracted hours updated successfully in human_resource table',
        warnings: validation.warnings.length > 0 ? validation.warnings : undefined
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
    
    // Validate change request before proceeding
    const validation = await validateChangeRequest(id, 'employment_date_change', currentDate || 'NULL', employment_start_date);
    
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Change request validation failed',
        message: validation.errors.join(' '),
        warnings: validation.warnings
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
      try {
        const insertResult = await client.query(`
          INSERT INTO change_requests (
            id, staff_id, staff_name, change_type, field_name, old_value, new_value, effective_from_date, changed_at, changed_by, reason
          ) VALUES (uuid_change_request($1, $3, 'employment_start_date', $6), $1, $2, $3, 'employment_start_date', $4, $5, $6, $6, $7, $8)
          RETURNING id
        `, [id, staffName, 'employment_date_change', currentDate || 'NULL', employment_start_date, effectiveDate, changed_by, reason]);
        console.log(`✅ Change request inserted for employment date change: ${insertResult.rows[0].id}`);
      } catch (insertError) {
        console.error('❌ Error inserting change request for employment date change:', insertError);
        throw insertError;
      }
      
      await client.query('COMMIT');
      
      // Get updated data
      const result = await pool.query(`
        SELECT * FROM human_resource WHERE unique_id = $1
      `, [id]);
      
      res.json({
        success: true,
        data: result.rows[0],
        message: 'Employment start date updated successfully in human_resource table',
        warnings: validation.warnings.length > 0 ? validation.warnings : undefined
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
    
    // Validate change request before proceeding
    const validation = await validateChangeRequest(id, 'employment_end_date_change', currentEndDate || 'NULL', employment_end_date || 'NULL');
    
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Change request validation failed',
        message: validation.errors.join(' '),
        warnings: validation.warnings
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
      try {
        const insertResult = await client.query(`
          INSERT INTO change_requests (
            id, staff_id, staff_name, change_type, field_name, old_value, new_value, effective_from_date, changed_at, changed_by, reason
          ) VALUES (uuid_change_request($1, $3, 'employment_end_date', $6), $1, $2, $3, 'employment_end_date', $4, $5, $6, $6, $7, $8)
          RETURNING id
        `, [id, staffName, 'employment_end_date_change', currentEndDate || 'NULL', employment_end_date || 'NULL', effectiveDate, changed_by, reason]);
        console.log(`✅ Change request inserted for employment end date change: ${insertResult.rows[0].id}`);
      } catch (insertError) {
        console.error('❌ Error inserting change request for employment end date change:', insertError);
        throw insertError;
      }
      
      await client.query('COMMIT');
      
      // Get updated data
      const result = await pool.query(`
        SELECT * FROM human_resource WHERE unique_id = $1
      `, [id]);
      
      res.json({
        success: true,
        data: result.rows[0],
        message: 'Employment end date updated successfully in human_resource table',
        warnings: validation.warnings.length > 0 ? validation.warnings : undefined
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
    
    console.log(`🔍 DELETE request - Staff ID: ${id}, Change ID: ${changeId}`);
    
    // Get the change request details - try with explicit UUID casting
    let changeResult = await pool.query(`
      SELECT * FROM change_requests 
      WHERE id::text = $1 AND staff_id::text = $2
    `, [changeId, id]);
    
    // If not found, try without staff_id constraint (in case of ID mismatch)
    if (changeResult.rows.length === 0) {
      console.log(`⚠️ Not found with staff_id constraint, trying without...`);
      changeResult = await pool.query(`
        SELECT * FROM change_requests 
        WHERE id::text = $1
      `, [changeId]);
      
      // If found but staff_id doesn't match, return error
      if (changeResult.rows.length > 0 && changeResult.rows[0].staff_id.toString() !== id) {
        console.log(`❌ Change found but staff_id mismatch: ${changeResult.rows[0].staff_id} vs ${id}`);
        return res.status(403).json({
          success: false,
          error: 'Change request belongs to different staff member',
          message: 'The specified change request does not belong to this staff member'
        });
      }
    }
    
    if (changeResult.rows.length === 0) {
      // Log all change requests for this staff to help debug
      const allChanges = await pool.query(`
        SELECT id, staff_id, change_type, effective_from_date 
        FROM change_requests 
        WHERE staff_id::text = $1
      `, [id]);
      console.log(`❌ Change request not found. Available changes for staff ${id}:`, allChanges.rows);
      
      return res.status(404).json({
        success: false,
        error: 'Change request not found',
        message: 'The specified change request does not exist'
      });
    }
    
    const changeRequest = changeResult.rows[0];
    const actualChangeId = changeRequest.id; // Use the actual ID from database
    
    console.log(`✅ Found change request: ${actualChangeId}, type: ${changeRequest.change_type}`);
    
    // Allow deletion of all change requests (both pending and applied)
    const now = new Date();
    const effectiveDate = new Date(changeRequest.effective_from_date);
    
    let revertResult = null;
    
    // If this is an applied change, we need to revert the staff member to previous state
    if (effectiveDate <= now) {
      // This is an applied change, need to revert and delete future changes
      revertResult = await revertStaffChange(changeRequest);
    }
    
    // Delete the change request using the actual ID from database
    await pool.query('DELETE FROM change_requests WHERE id = $1', [actualChangeId]);
    
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
    const checkResult = await executeQueryWithRetry(
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
    const result = await executeQueryWithRetry(`
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

// Routes moved to before /api/staff/:id to prevent route conflicts

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
    
    console.log(`🔄 Toggle active status: ${staffName} from ${currentStatus} to ${newStatus}`);
    
    // Get the change information from request body
    const { changed_by = 'system', reason = '', effective_from_date = null } = req.body;
    
    // Validate change request before proceeding
    console.log(`🔍 Validating change request for ${staffName}...`);
    const validation = await validateChangeRequest(id, 'active_status_change', currentStatus.toString(), newStatus.toString());
    
    if (!validation.isValid) {
      console.log(`❌ Validation failed for ${staffName}:`, validation.errors);
      return res.status(400).json({
        success: false,
        error: 'Change request validation failed',
        message: validation.errors.join(' '),
        warnings: validation.warnings
      });
    }
    
    console.log(`✅ Validation passed for ${staffName}`);
    
    // Update the active status
    console.log(`🔄 Updating human_resource table for ${staffName}...`);
    const result = await pool.query(`
      UPDATE human_resource 
              SET is_active = $1, updated_at = (NOW() AT TIME ZONE 'Europe/London') 
      WHERE unique_id = $2 
      RETURNING *
    `, [newStatus, id]);
    console.log(`✅ human_resource updated for ${staffName}`);
    
    // Log the change in history
    const effectiveDate = effective_from_date ? new Date(effective_from_date).toISOString() : new Date().toISOString();
    console.log(`📝 Inserting change request for ${staffName} with values:`, {
      staff_id: id,
      staff_name: staffName,
      change_type: 'active_status_change',
      old_value: currentStatus.toString(),
      new_value: newStatus.toString(),
      effective_from_date: effectiveDate,
      changed_by,
      reason
    });
    
    try {
      const insertResult = await pool.query(`
        INSERT INTO change_requests (
          id, staff_id, staff_name, change_type, field_name, old_value, new_value, effective_from_date, changed_at, changed_by, reason
        ) VALUES (uuid_change_request($1, $3, 'is_active', $6), $1, $2, $3, 'is_active', $4, $5, $6, $6, $7, $8)
        RETURNING id
      `, [id, staffName, 'active_status_change', currentStatus.toString(), newStatus.toString(), effectiveDate, changed_by, reason]);
      console.log(`✅ Change request inserted for active status change: ${insertResult.rows[0].id}`);
    } catch (insertError) {
      console.error('❌ Error inserting change request for active status change:', insertError);
      console.error('❌ Error details:', {
        message: insertError.message,
        code: insertError.code,
        detail: insertError.detail,
        stack: insertError.stack
      });
      throw insertError;
    }
    
    // Verify the change request was inserted
    const verifyResult = await pool.query(`
      SELECT id FROM change_requests 
      WHERE staff_id = $1 
        AND change_type = 'active_status_change'
        AND old_value = $2
        AND new_value = $3
        AND effective_from_date = $4
      ORDER BY changed_at DESC
      LIMIT 1
    `, [id, currentStatus.toString(), newStatus.toString(), effectiveDate]);
    
    if (verifyResult.rows.length > 0) {
      console.log(`✅ Verified change request exists: ${verifyResult.rows[0].id}`);
    } else {
      console.error(`❌ WARNING: Change request was not found after insertion!`);
    }
    
    res.json({
      success: true,
      data: result.rows[0],
      message: `Staff member ${newStatus ? 'activated' : 'deactivated'} successfully`,
      warnings: validation.warnings.length > 0 ? validation.warnings : undefined,
      change_request_id: verifyResult.rows.length > 0 ? verifyResult.rows[0].id : null
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
    
    const result = await executeQueryWithRetry(`
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
    const { from, to } = req.query;
    
    if (!staffName || staffName.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Invalid staff name',
        message: 'Staff name is required'
      });
    }
    
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
    `;
    
    let params = [staffName.trim()];
    
    // Add date filtering if from and to parameters are provided
    if (from && to) {
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
      
      query += ` AND DATE(s.shift_start_datetime) >= $2 AND DATE(s.shift_start_datetime) <= $3`;
      params.push(from, to);
      console.log(`📊 Fetching shifts for ${staffName} from ${from} to ${to}`);
    } else {
      console.log(`📊 Fetching all shifts for ${staffName}`);
    }
    
    query += ` ORDER BY s.shift_start_datetime`;
    
    const result = await pool.query(query, params);
    
    console.log(`📊 Found ${result.rows.length} shifts for ${staffName}${from && to ? ` in date range ${from} to ${to}` : ''}`);
    
    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
      staffName: staffName.trim(),
      dateRange: from && to ? { from, to } : null
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

// Get sick leave shifts (SSP and CSP) for all staff members - Summary format
app.get('/api/shifts/sick-leave', async (req, res) => {
  try {
    console.log('🏥 Fetching sick leave shifts (SSP & CSP) summary...');
    
    // Calculate current financial year dates
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    
    let financialYearStart, financialYearEnd;
    
    // Financial year runs from April 6th to April 5th next year
    const month = currentDate.getMonth(); // 0-based (0=Jan, 3=Apr)
    const day = currentDate.getDate();
    const isOnOrAfterApril6 = (month > 3) || (month === 3 && day >= 6);
    if (isOnOrAfterApril6) {
      // On or after April 6th - we're in the current financial year
      financialYearStart = new Date(currentYear, 3, 6); // April 6th current year
      financialYearEnd = new Date(currentYear + 1, 3, 5); // April 5th next year
    } else {
      // Before April 6th - we're in the previous financial year
      financialYearStart = new Date(currentYear - 1, 3, 6); // April 6th previous year
      financialYearEnd = new Date(currentYear, 3, 5); // April 5th current year
    }
    
    // Format dates for SQL query
    const formatDate = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    
    const fromDate = formatDate(financialYearStart);
    const toDate = formatDate(financialYearEnd);
    
    console.log(`📅 Financial Year: ${fromDate} to ${toDate}`);
    
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
        p.period_name,
        p.start_date,
        p.end_date
      FROM shifts s 
      LEFT JOIN human_resource hr ON s.staff_name = hr.staff_name 
      LEFT JOIN periods p ON s.period_id = p.period_id
      WHERE s.shift_type IN ('SSP', 'CSP')
        AND DATE(s.shift_start_datetime) >= $1 
        AND DATE(s.shift_start_datetime) <= $2
      ORDER BY s.staff_name, s.shift_start_datetime DESC
    `, [fromDate, toDate]);
    
    console.log(`✅ Found ${result.rows.length} sick leave shifts`);
    
    // Group shifts by staff member and calculate summary statistics
    const staffSummaries = {};
    result.rows.forEach(shift => {
      if (!staffSummaries[shift.staff_name]) {
        staffSummaries[shift.staff_name] = {
          name: shift.staff_name,
          role: shift.staff_role || 'Staff Member',
          totalShifts: 0,
          sspShifts: 0,
          cspShifts: 0,
          totalHours: 0,
          cumulativeHours: 0,
          totalPay: 0,
          shifts: []
        };
      }
      
      const hours = (new Date(shift.shift_end_datetime) - new Date(shift.shift_start_datetime)) / (1000 * 60 * 60);
      staffSummaries[shift.staff_name].totalShifts += 1;
      staffSummaries[shift.staff_name].totalHours += hours;
      staffSummaries[shift.staff_name].shifts.push(shift);
      
      if (shift.shift_type === 'SSP') {
        staffSummaries[shift.staff_name].sspShifts += 1;
      } else if (shift.shift_type === 'CSP') {
        staffSummaries[shift.staff_name].cspShifts += 1;
      }
    });
    
    // Calculate cumulative hours and pay for each staff member
    const summaries = Object.values(staffSummaries).map(summary => {
      // Calculate cumulative hours (same as total for sick leave)
      summary.cumulativeHours = summary.totalHours;
      
      // Calculate pay based on role and hours (simplified calculation)
      // This would need to be updated with actual pay rates
      const hourlyRate = summary.role === 'Manager' ? 25 : 15; // Example rates
      summary.totalPay = summary.totalHours * hourlyRate;
      
      return summary;
    });
    
    // Calculate overall totals
    const totals = summaries.reduce((acc, summary) => {
      acc.totalShifts += summary.totalShifts;
      acc.totalSsp += summary.sspShifts;
      acc.totalCsp += summary.cspShifts;
      acc.totalHours += summary.totalHours;
      acc.totalPay += summary.totalPay;
      return acc;
    }, { totalShifts: 0, totalSsp: 0, totalCsp: 0, totalHours: 0, totalPay: 0 });
    
    res.json({
      success: true,
      summaries: summaries,
      totals: totals,
      count: result.rows.length
    });
  } catch (err) {
    console.error('❌ Error fetching sick leave shifts:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sick leave shifts',
      message: err.message
    });
  }
});

// Get current financial year dates based on financial_year_end flags
app.get('/api/financial-year/dates', async (req, res) => {
  try {
    console.log('📅 Fetching current financial year dates from flags...');
    
    // Find the most recent financial year end date from shifts
    const result = await pool.query(`
      SELECT 
        DATE(shift_start_datetime) as fy_end_date
      FROM shifts
      WHERE financial_year_end = true
        AND DATE(shift_start_datetime) <= CURRENT_DATE
      ORDER BY shift_start_datetime DESC
      LIMIT 1
    `);
    
    let financialYearStart, financialYearEnd;
    
    if (result.rows.length > 0 && result.rows[0].fy_end_date) {
      // Use the financial year end date from flags
      const fyEndDate = new Date(result.rows[0].fy_end_date);
      financialYearStart = new Date(fyEndDate);
      financialYearStart.setDate(financialYearStart.getDate() + 1); // Day after FY end = April 6th
      financialYearEnd = new Date(financialYearStart);
      financialYearEnd.setFullYear(financialYearEnd.getFullYear() + 1);
      financialYearEnd.setDate(financialYearEnd.getDate() - 1); // April 5th next year
      
      console.log(`📅 Financial year from flags: ${financialYearStart.toISOString().split('T')[0]} to ${financialYearEnd.toISOString().split('T')[0]}`);
    } else {
      // Fallback to calculating based on current date
      const currentDate = new Date();
      const currentYear = currentDate.getFullYear();
      const month = currentDate.getMonth();
      const day = currentDate.getDate();
      const isOnOrAfterApril6 = (month > 3) || (month === 3 && day >= 6);
      
      if (isOnOrAfterApril6) {
        financialYearStart = new Date(currentYear, 3, 6);
        financialYearEnd = new Date(currentYear + 1, 3, 5);
      } else {
        financialYearStart = new Date(currentYear - 1, 3, 6);
        financialYearEnd = new Date(currentYear, 3, 5);
      }
      
      console.log(`📅 Financial year calculated (no flags found): ${financialYearStart.toISOString().split('T')[0]} to ${financialYearEnd.toISOString().split('T')[0]}`);
    }
    
    // Format dates
    const formatDate = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    
    res.json({
      success: true,
      financialYearStart: formatDate(financialYearStart),
      financialYearEnd: formatDate(financialYearEnd),
      fromFlags: result.rows.length > 0
    });
  } catch (err) {
    console.error('❌ Error fetching financial year dates:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch financial year dates',
      message: err.message
    });
  }
});

// Save or update shift assignment
app.post('/api/shifts', 
  validateRequiredFields(['periodId', 'weekNumber', 'shiftStartDatetime', 'shiftType', 'staffAssignments']),
  async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const {
      periodId,
      weekNumber,
      shiftStartDatetime,
      shiftEndDatetime,
      shiftType,
      staffAssignments,
      removedShiftIds = [], // IDs of shifts to delete
      newAssignments = [] // Only new assignments (without shiftId) to insert
    } = req.body;

    // Validate week number
    if (weekNumber < 1 || weekNumber > 4) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({
        success: false,
        error: 'Invalid week number',
        message: 'Week number must be between 1 and 4'
      });
    }

    // Validate shift type
    const validShiftTypes = ['Tom Day', 'Charlotte Day', 'Double Up', 'Tom Night', 'Charlotte Night', 'HOLIDAY', 'SSP', 'CSP'];
    if (!validShiftTypes.includes(shiftType)) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({
        success: false,
        error: 'Invalid shift type',
        message: `Shift type must be one of: ${validShiftTypes.join(', ')}`
      });
    }

    // Validate periodId format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(periodId)) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({
        success: false,
        error: 'Invalid period ID format',
        message: 'Period ID must be a valid UUID'
      });
    }

    // Handle time-off cells differently - create single record with multiple staff
    if (staffAssignments && staffAssignments.length > 0) {
      const createdShifts = [];
      
      // Check if this is a time-off cell (HOLIDAY, SSP, or CSP)
      const isTimeOffCell = ['HOLIDAY', 'SSP', 'CSP'].includes(shiftType);
      
      // Validate that we have at least one valid assignment
      const firstAssignment = staffAssignments.find(a => a.staffName && a.startTime && a.endTime);
      if (!firstAssignment) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(400).json({
          success: false,
          error: 'Invalid assignments',
          message: 'At least one valid assignment is required'
        });
      }
      
      // Extract the date directly from shiftStartDatetime (which comes from frontend as ISO string)
      // The frontend sends shiftStartDatetime in ISO format (e.g., "2025-12-10T20:00:00.000Z")
      // Extract the date part (YYYY-MM-DD) to match what's stored in the database
      let shiftDate;
      if (typeof shiftStartDatetime === 'string' && shiftStartDatetime.includes('T')) {
        // If it's an ISO string, extract the date part directly
        shiftDate = shiftStartDatetime.split('T')[0];
      } else {
        // Fallback: parse as Date and extract UTC date components
        const shiftStartDateObj = new Date(shiftStartDatetime);
        const year = shiftStartDateObj.getUTCFullYear();
        const month = String(shiftStartDateObj.getUTCMonth() + 1).padStart(2, '0');
        const day = String(shiftStartDateObj.getUTCDate()).padStart(2, '0');
        shiftDate = `${year}-${month}-${day}`;
      }
      
      // Efficient approach: Only delete removed shifts and insert new ones
      // This avoids unnecessary delete/re-insert operations for unchanged shifts
      // If removedShiftIds/newAssignments not provided, fall back to old behavior (delete all, insert all)
      const useEfficientMode = Array.isArray(removedShiftIds) && Array.isArray(newAssignments);
      
      console.log('🔄 Shift update mode:', useEfficientMode ? 'EFFICIENT (delete removed, insert new only)' : 'FULL REPLACE (delete all, insert all)');
      console.log('🔄 Update details:', {
        periodId,
        weekNumber,
        shiftDate,
        shiftType,
        removedShiftIds: removedShiftIds || [],
        removedCount: removedShiftIds ? removedShiftIds.length : 0,
        newAssignmentsCount: newAssignments ? newAssignments.length : 0,
        totalAssignments: staffAssignments.length
      });
      
      if (useEfficientMode) {
        // Step 1: Delete only the shifts that were removed (by their IDs)
        if (removedShiftIds && removedShiftIds.length > 0) {
          const deleteQuery = 'DELETE FROM shifts WHERE id = ANY($1::uuid[]) RETURNING id, staff_name, shift_start_datetime::date as date, shift_type';
          const deleteResult = await client.query(deleteQuery, [removedShiftIds]);
          
          if (deleteResult.rows.length > 0) {
            console.log(`✅ Deleted ${deleteResult.rows.length} removed shift(s):`, deleteResult.rows.map(r => ({ id: r.id, staff: r.staff_name, date: r.date, type: r.shift_type })));
          } else {
            console.log('⚠️ No shifts found to delete (IDs may not exist)');
          }
        } else {
          console.log('ℹ️ No shifts to delete (removedShiftIds is empty)');
        }
        
        // Step 2: Insert only new assignments (those without shiftId)
        // IMPORTANT: If newAssignments is provided (even if empty), use it exclusively
        // This ensures we don't accidentally insert existing shifts when only deleting
        let assignmentsToInsert = [];
        
        if (Array.isArray(newAssignments)) {
          // Use newAssignments if explicitly provided (even if empty array)
          // This means the frontend has explicitly calculated which assignments are new
          assignmentsToInsert = newAssignments;
          console.log(`➕ Using newAssignments array (explicitly provided): ${assignmentsToInsert.length} assignment(s) to insert`);
          
          // Double-check: filter out any assignments that somehow have shiftId (shouldn't happen, but safety check)
          assignmentsToInsert = assignmentsToInsert.filter(a => !a.shiftId);
          if (assignmentsToInsert.length < newAssignments.length) {
            console.warn(`⚠️ Filtered out ${newAssignments.length - assignmentsToInsert.length} assignment(s) that had shiftId (shouldn't be in newAssignments)`);
          }
        } else {
          // Fallback: newAssignments not provided, filter staffAssignments for those without shiftId
          // This is for backward compatibility
          assignmentsToInsert = staffAssignments.filter(a => !a.shiftId || a.shiftId === null || a.shiftId === undefined);
          console.log(`➕ Fallback mode: Filtered ${assignmentsToInsert.length} new assignment(s) from staffAssignments (newAssignments not provided)`);
        }
        
        console.log(`➕ Final: Inserting ${assignmentsToInsert.length} new shift(s)`);
        if (assignmentsToInsert.length > 0) {
          console.log(`➕ Assignments to insert:`, assignmentsToInsert.map(a => ({ 
            staffName: a.staffName, 
            shiftId: a.shiftId,
            startTime: a.startTime,
            endTime: a.endTime
          })));
        } else {
          console.log(`ℹ️ No new assignments to insert (all remaining shifts already exist in database)`);
        }
        
        // Create separate shift records for each new assignment
        for (const assignment of assignmentsToInsert) {
        if (!assignment.staffName || !assignment.startTime || !assignment.endTime) {
          console.warn('⚠️ Skipping invalid assignment:', assignment);
          continue; // Skip invalid assignments
        }

        // Validate that the staff member exists in the database
        const staffCheck = await client.query(
          'SELECT staff_name FROM human_resource WHERE staff_name = $1 AND is_active = true',
          [assignment.staffName]
        );
        
        if (staffCheck.rows.length === 0) {
          await client.query('ROLLBACK');
          client.release();
          console.error(`❌ Staff member '${assignment.staffName}' not found in database`);
          return res.status(400).json({
            success: false,
            error: 'Invalid staff member',
            message: `Staff member '${assignment.staffName}' does not exist or is not active`
          });
        }

        // Calculate the actual shift start and end times based on assignment
        const assignmentShiftStart = new Date(shiftStartDatetime);
        const [assignmentStartHour, assignmentStartMinute] = assignment.startTime.split(':');
        assignmentShiftStart.setHours(parseInt(assignmentStartHour), parseInt(assignmentStartMinute), 0, 0);
        
        const assignmentShiftEnd = new Date(shiftStartDatetime);
        const [assignmentEndHour, assignmentEndMinute] = assignment.endTime.split(':');
        assignmentShiftEnd.setHours(parseInt(assignmentEndHour), parseInt(assignmentEndMinute), 0, 0);
        
        // Handle overnight shifts
        if (assignmentShiftEnd < assignmentShiftStart) {
          assignmentShiftEnd.setDate(assignmentShiftEnd.getDate() + 1);
        }
          
        // Calculate total hours
        const totalHours = (assignmentShiftEnd - assignmentShiftStart) / (1000 * 60 * 60);
        
        // Determine shift type for this specific assignment
        // For time-off cells, use individual assignment's CSP/SSP flags
        let assignmentShiftType = shiftType;
        if (isTimeOffCell) {
          if (assignment.csp) {
            assignmentShiftType = 'CSP';
          } else if (assignment.ssp) {
            assignmentShiftType = 'SSP';
          } else {
            // Default to the cell's shift type if no flags are set
            assignmentShiftType = shiftType;
          }
        }
        
        // Insert individual shift record
        const result = await client.query(`
          INSERT INTO shifts (
            id, period_id, week_number, staff_name, shift_start_datetime, shift_end_datetime, 
            shift_type, solo_shift, training, short_notice, call_out, payment_period_end, financial_year_end, notes, overtime
          ) VALUES (uuid_shift($1, $3, $4::timestamptz, $6), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *
        `, [
          periodId, 
          weekNumber, 
          assignment.staffName, 
          assignmentShiftStart.toISOString(), 
          assignmentShiftEnd.toISOString(),
          assignmentShiftType, 
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
        console.log(`✅ Created shift record for ${assignment.staffName} (${assignmentShiftType})`);
      }
      } else {
        // Fallback: Old behavior - delete all shifts for this cell, then insert all
        // This is used for backward compatibility or when efficient mode data is not available
        console.log('🔄 Using full replace mode (backward compatibility)');
        
        // Extract staff names from assignments for deletion
        const staffNames = staffAssignments.map(a => a.staffName).filter(Boolean);
        
        // Delete all shifts for this cell
        let deleteQuery;
        let deleteParams;
        
        if (isTimeOffCell) {
          if (staffNames.length > 0) {
            deleteQuery = `DELETE FROM shifts 
              WHERE period_id = $1 
              AND week_number = $2 
              AND shift_start_datetime::date = $3 
              AND shift_type IN ($4, $5, $6)
              AND staff_name = ANY($7::text[])
              RETURNING id, staff_name, shift_start_datetime::date as date, shift_type`;
            deleteParams = [periodId, weekNumber, shiftDate, 'HOLIDAY', 'SSP', 'CSP', staffNames];
          } else {
            deleteQuery = 'DELETE FROM shifts WHERE period_id = $1 AND week_number = $2 AND shift_start_datetime::date = $3 AND shift_type IN ($4, $5, $6) RETURNING id, staff_name, shift_start_datetime::date as date, shift_type';
            deleteParams = [periodId, weekNumber, shiftDate, 'HOLIDAY', 'SSP', 'CSP'];
          }
        } else {
          if (staffNames.length > 0) {
            deleteQuery = `DELETE FROM shifts 
              WHERE period_id = $1 
              AND week_number = $2 
              AND shift_start_datetime::date = $3 
              AND shift_type = $4
              AND staff_name = ANY($5::text[])
              RETURNING id, staff_name, shift_start_datetime::date as date, shift_type`;
            deleteParams = [periodId, weekNumber, shiftDate, shiftType, staffNames];
          } else {
            deleteQuery = 'DELETE FROM shifts WHERE period_id = $1 AND week_number = $2 AND shift_start_datetime::date = $3 AND shift_type = $4 RETURNING id, staff_name, shift_start_datetime::date as date, shift_type';
            deleteParams = [periodId, weekNumber, shiftDate, shiftType];
          }
        }
        
        const deleteResult = await client.query(deleteQuery, deleteParams);
        if (deleteResult.rows.length > 0) {
          console.log(`✅ Deleted ${deleteResult.rows.length} existing shift(s) for full replace:`, deleteResult.rows.map(r => ({ id: r.id, staff: r.staff_name, date: r.date, type: r.shift_type })));
        }
        
        // Insert all assignments
        for (const assignment of staffAssignments) {
          if (!assignment.staffName || !assignment.startTime || !assignment.endTime) {
            console.warn('⚠️ Skipping invalid assignment:', assignment);
            continue;
          }

          // Validate that the staff member exists
          const staffCheck = await client.query(
            'SELECT staff_name FROM human_resource WHERE staff_name = $1 AND is_active = true',
            [assignment.staffName]
          );
          
          if (staffCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            client.release();
            console.error(`❌ Staff member '${assignment.staffName}' not found in database`);
            return res.status(400).json({
              success: false,
              error: 'Invalid staff member',
              message: `Staff member '${assignment.staffName}' does not exist or is not active`
            });
          }

          // Calculate shift times
          const assignmentShiftStart = new Date(shiftStartDatetime);
          const [assignmentStartHour, assignmentStartMinute] = assignment.startTime.split(':');
          assignmentShiftStart.setHours(parseInt(assignmentStartHour), parseInt(assignmentStartMinute), 0, 0);
          
          const assignmentShiftEnd = new Date(shiftStartDatetime);
          const [assignmentEndHour, assignmentEndMinute] = assignment.endTime.split(':');
          assignmentShiftEnd.setHours(parseInt(assignmentEndHour), parseInt(assignmentEndMinute), 0, 0);
          
          if (assignmentShiftEnd < assignmentShiftStart) {
            assignmentShiftEnd.setDate(assignmentShiftEnd.getDate() + 1);
          }
          
          let assignmentShiftType = shiftType;
          if (isTimeOffCell) {
            if (assignment.csp) {
              assignmentShiftType = 'CSP';
            } else if (assignment.ssp) {
              assignmentShiftType = 'SSP';
            } else {
              assignmentShiftType = shiftType;
            }
          }
          
          // Insert shift record
          const result = await client.query(`
            INSERT INTO shifts (
              id, period_id, week_number, staff_name, shift_start_datetime, shift_end_datetime, 
              shift_type, solo_shift, training, short_notice, call_out, payment_period_end, financial_year_end, notes, overtime
            ) VALUES (uuid_shift($1, $3, $4::timestamptz, $6), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *
          `, [
            periodId, 
            weekNumber, 
            assignment.staffName, 
            assignmentShiftStart.toISOString(), 
            assignmentShiftEnd.toISOString(),
            assignmentShiftType, 
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
          console.log(`✅ Created shift record for ${assignment.staffName} (${assignmentShiftType})`);
        }
      }
      
      await client.query('COMMIT');
      client.release();
      
      // Build response message
      let message = 'Shifts updated successfully';
      const deletedCount = removedShiftIds ? removedShiftIds.length : 0;
      const insertedCount = createdShifts.length;
      
      if (deletedCount > 0 && insertedCount > 0) {
        message = `Deleted ${deletedCount} shift(s) and inserted ${insertedCount} new shift(s)`;
      } else if (deletedCount > 0) {
        message = `Deleted ${deletedCount} shift(s)`;
      } else if (insertedCount > 0) {
        message = `Inserted ${insertedCount} new shift(s)`;
      } else {
        message = 'No changes needed (all shifts unchanged)';
      }
      
      if (isTimeOffCell && staffAssignments.length > 1) {
        console.log(`✅ ${message} for time-off cell with multiple staff`);
      } else {
        console.log(`✅ ${message}`);
      }
      
      res.json({
        success: true,
        data: createdShifts,
        count: createdShifts.length,
        deletedCount: deletedCount,
        insertedCount: insertedCount,
        message: message
      });
      
    } else {
      await client.query('COMMIT');
      client.release();
      res.json({
        success: true,
        data: [],
        count: 0,
        message: 'No shifts to create'
      });
    }
    
  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
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
        const validShiftTypes = ['Tom Day', 'Charlotte Day', 'Double Up', 'Tom Night', 'Charlotte Night', 'HOLIDAY', 'SSP', 'CSP'];
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
      const validShiftTypes = ['Tom Day', 'Charlotte Day', 'Double Up', 'Tom Night', 'Charlotte Night', 'HOLIDAY', 'SSP', 'CSP'];
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

// Clear shifts directly (for frontend compatibility)
app.delete('/api/shifts/clear-direct', 
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

    console.log('Clear direct request:', { periodId, weekNumber, date, shiftType });

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
      query += ` AND shift_start_datetime::date = $${paramIndex}`;
      params.push(date);
      paramIndex++;
    }

    // Add shift type filter if provided
    if (shiftType) {
      const validShiftTypes = ['Tom Day', 'Charlotte Day', 'Double Up', 'Tom Night', 'Charlotte Night', 'HOLIDAY', 'SSP', 'CSP'];
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

    query += ' RETURNING id, staff_name, shift_type, shift_start_datetime::date as date';

    console.log('Clear direct query:', query);
    console.log('Clear direct params:', params);

    const result = await pool.query(query, params);

    console.log('Clear direct result:', result.rows);

    res.json({ 
      success: true,
      message: 'Shifts cleared successfully', 
      clearedCount: result.rows.length,
      clearedShifts: result.rows
    });

  } catch (err) {
    console.error('Error clearing shifts directly:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to clear shifts',
      message: err.message
    });
  }
});

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
          id UUID PRIMARY KEY DEFAULT uuid_change_request(staff_id, change_type, field_name, changed_at),
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
    
    // CRITICAL: Create index on effective_from_date for fast queries in processor
    try {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_change_requests_effective_from_date ON change_requests(effective_from_date)
      `);
      console.log('✅ Index created: idx_change_requests_effective_from_date (CRITICAL for performance)');
    } catch (err) {
      if (err.code !== '42P07') {
        console.log('ℹ️ effective_from_date index already exists');
      }
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

    // Validate change request before proceeding
    const validation = await validateChangeRequest(id, 'color_code_change', currentColor, color_code);
    
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Change request validation failed',
        message: validation.errors.join(' '),
        warnings: validation.warnings
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
      try {
        const insertResult = await client.query(`
          INSERT INTO change_requests (
            id, staff_id, staff_name, change_type, field_name, old_value, new_value, effective_from_date, changed_at, changed_by, reason
          ) VALUES (uuid_change_request($1, $3, 'color_code', $6), $1, $2, $3, 'color_code', $4, $5, $6, $6, $7, $8)
          RETURNING id
        `, [id, staffName, 'color_code_change', currentColor, color_code, effectiveDate, changed_by, reason]);
        console.log(`✅ Change request inserted for color code change: ${insertResult.rows[0].id}`);
      } catch (insertError) {
        console.error('❌ Error inserting change request for color code change:', insertError);
        throw insertError;
      }
      
      await client.query('COMMIT');
      
      // Get updated data
      const result = await pool.query(
        'SELECT unique_id, staff_name, role, color_code, updated_at FROM human_resource WHERE unique_id = $1',
        [id]
      );

      console.log(`✅ Staff member ${result.rows[0].staff_name} color code updated from ${currentColor} to ${color_code}`);

      res.json({
        success: true,
        message: 'Color code updated successfully',
        data: result.rows[0],
        warnings: validation.warnings.length > 0 ? validation.warnings : undefined
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
      INSERT INTO human_resource (unique_id, staff_name, role, is_active) 
      VALUES (uuid_human_resource($1), $1, $2, $3) 
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
      WHERE is_active = true
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

// Sync holiday entitlements for all staff members
app.post('/api/time-off/holiday-entitlements/sync-all', async (req, res) => {
  try {
    // Get all active staff members
    const staffResult = await pool.query(`
      SELECT unique_id, staff_name, employment_end_date 
      FROM human_resource 
      WHERE is_active = true
    `);
    
    const syncResults = [];
    let successCount = 0;
    let errorCount = 0;
    
    for (const staff of staffResult.rows) {
      try {
        // Recalculate holiday entitlement for this staff member
        await pool.query('SELECT recalculate_holiday_entitlement($1, $2)', [
          staff.unique_id, 
          staff.employment_end_date
        ]);
        
        // Verify entitlement was created/updated
        const entitlementCheck = await pool.query(
          'SELECT COUNT(*) as entitlement_count FROM holiday_entitlements WHERE staff_id = $1',
          [staff.unique_id]
        );
        
        if (parseInt(entitlementCheck.rows[0].entitlement_count) > 0) {
          syncResults.push({
            staff_id: staff.unique_id,
            staff_name: staff.staff_name,
            status: 'success',
            message: 'Holiday entitlement synced successfully'
          });
          successCount++;
        } else {
          syncResults.push({
            staff_id: staff.unique_id,
            staff_name: staff.staff_name,
            status: 'warning',
            message: 'No holiday entitlement found after sync'
          });
          errorCount++;
        }
      } catch (error) {
        syncResults.push({
          staff_id: staff.unique_id,
          staff_name: staff.staff_name,
          status: 'error',
          message: error.message
        });
        errorCount++;
      }
    }
    
    res.json({
      success: true,
      message: `Holiday entitlements sync completed. ${successCount} successful, ${errorCount} errors`,
      data: {
        total_staff: staffResult.rows.length,
        successful: successCount,
        errors: errorCount,
        results: syncResults
      }
    });
    
  } catch (err) {
    console.error('Error syncing holiday entitlements:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to sync holiday entitlements',
      message: err.message
    });
  }
});

// Comprehensive sync endpoint that checks human_resource table and updates holiday_entitlements
app.post('/api/time-off/holiday-entitlements/check-and-sync', async (req, res) => {
  try {
    console.log('🔍 Starting comprehensive holiday entitlements check and sync...');
    
    // Get all staff members (both active and inactive)
    const allStaffResult = await pool.query(`
      SELECT 
        unique_id, 
        staff_name, 
        employment_start_date,
        employment_end_date,
        contracted_hours,
        is_active
      FROM human_resource 
      ORDER BY staff_name
    `);
    
    // Get all existing holiday entitlements
    const existingEntitlementsResult = await pool.query(`
      SELECT 
        staff_id, 
        staff_name,
        holiday_year_start,
        holiday_year_end
      FROM holiday_entitlements 
      ORDER BY staff_name
    `);
    
    const existingEntitlements = new Map();
    existingEntitlementsResult.rows.forEach(entitlement => {
      const key = `${entitlement.staff_id}_${entitlement.holiday_year_start}`;
      existingEntitlements.set(key, entitlement);
    });
    
    const syncResults = [];
    let createdCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    
    // Process each staff member
    for (const staff of allStaffResult.rows) {
      try {
        console.log(`Processing staff: ${staff.staff_name} (ID: ${staff.unique_id})`);
        
        // Skip staff with null contracted_hours (they should be fixed separately)
        if (staff.contracted_hours === null) {
          syncResults.push({
            staff_id: staff.unique_id,
            staff_name: staff.staff_name,
            status: 'skipped',
            message: 'Skipped - contracted_hours is null (needs manual fix)',
            action: 'none'
          });
          skippedCount++;
          continue;
        }
        
        // Recalculate holiday entitlement for this staff member
        await pool.query('SELECT recalculate_holiday_entitlement($1, $2)', [
          staff.unique_id, 
          staff.employment_end_date
        ]);
        
        // Check if entitlement was created or updated
        const entitlementCheck = await pool.query(`
          SELECT 
            entitlement_id,
            statutory_entitlement_days,
            statutory_entitlement_hours,
            created_at,
            updated_at
          FROM holiday_entitlements 
          WHERE staff_id = $1
          ORDER BY created_at DESC
          LIMIT 1
        `, [staff.unique_id]);
        
        if (entitlementCheck.rows.length > 0) {
          const entitlement = entitlementCheck.rows[0];
          const isNew = entitlement.created_at.getTime() === entitlement.updated_at.getTime();
          
          syncResults.push({
            staff_id: staff.unique_id,
            staff_name: staff.staff_name,
            status: 'success',
            message: isNew ? 'Holiday entitlement created' : 'Holiday entitlement updated',
            action: isNew ? 'created' : 'updated',
            entitlement_days: entitlement.statutory_entitlement_days,
            entitlement_hours: entitlement.statutory_entitlement_hours
          });
          
          if (isNew) {
            createdCount++;
          } else {
            updatedCount++;
          }
        } else {
          syncResults.push({
            staff_id: staff.unique_id,
            staff_name: staff.staff_name,
            status: 'error',
            message: 'Failed to create/update holiday entitlement',
            action: 'failed'
          });
          errorCount++;
        }
        
      } catch (error) {
        console.error(`Error processing staff ${staff.staff_name}:`, error.message);
        syncResults.push({
          staff_id: staff.unique_id,
          staff_name: staff.staff_name,
          status: 'error',
          message: error.message,
          action: 'failed'
        });
        errorCount++;
      }
    }
    
    // Check for orphaned holiday entitlements (staff deleted but entitlements remain)
    const activeStaffIds = new Set(allStaffResult.rows.map(staff => staff.unique_id));
    const orphanedEntitlements = existingEntitlementsResult.rows.filter(
      entitlement => !activeStaffIds.has(entitlement.staff_id)
    );
    
    // Delete orphaned entitlements
    for (const orphaned of orphanedEntitlements) {
      try {
        await pool.query('DELETE FROM holiday_entitlements WHERE staff_id = $1', [orphaned.staff_id]);
        syncResults.push({
          staff_id: orphaned.staff_id,
          staff_name: orphaned.staff_name,
          status: 'success',
          message: 'Orphaned holiday entitlement deleted',
          action: 'deleted'
        });
        deletedCount++;
      } catch (error) {
        syncResults.push({
          staff_id: orphaned.staff_id,
          staff_name: orphaned.staff_name,
          status: 'error',
          message: `Failed to delete orphaned entitlement: ${error.message}`,
          action: 'failed'
        });
        errorCount++;
      }
    }
    
    // Get final statistics
    const finalStats = await pool.query(`
      SELECT 
        COUNT(*) as total_staff,
        COUNT(*) FILTER (WHERE is_active = true) as active_staff,
        COUNT(*) FILTER (WHERE contracted_hours IS NOT NULL) as staff_with_hours
      FROM human_resource
    `);
    
    const finalEntitlementStats = await pool.query(`
      SELECT COUNT(*) as total_entitlements
      FROM holiday_entitlements
    `);
    
    console.log('✅ Comprehensive sync completed');
    
    res.json({
      success: true,
      message: `Comprehensive holiday entitlements check and sync completed`,
      data: {
        summary: {
          total_staff: finalStats.rows[0].total_staff,
          active_staff: finalStats.rows[0].active_staff,
          staff_with_hours: finalStats.rows[0].staff_with_hours,
          total_entitlements: finalEntitlementStats.rows[0].total_entitlements,
          created: createdCount,
          updated: updatedCount,
          deleted: deletedCount,
          skipped: skippedCount,
          errors: errorCount
        },
        results: syncResults
      }
    });
    
  } catch (err) {
    console.error('Error in comprehensive sync:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to perform comprehensive sync',
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
          entitlement_id, staff_id, staff_name, holiday_year_start, holiday_year_end,
          contracted_hours_per_week, statutory_entitlement_days, statutory_entitlement_hours, is_zero_hours
        ) VALUES (uuid_holiday_entitlement($1, $3), $1, $2, $3, $4, $5, $6, $7, $8)
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

// Note: Moved 404 handler to the very end of API route registrations

// Serve the main HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Background processor for change requests (OPTIMIZED)
async function processChangeRequests() {
  const client = await pool.connect();
  try {
    // Set a longer statement timeout for this operation (60 seconds)
    await client.query('SET statement_timeout = 60000');
    await client.query('BEGIN');
    
    const now = new Date().toISOString();
    
    // OPTIMIZED: Get pending change requests with LIMIT to prevent timeouts
    // Process in batches of 50 to avoid overwhelming the database
    // Filter to only recent changes (last 7 days) to avoid processing old stale requests
    const pendingRequests = await client.query(`
      SELECT * FROM change_requests 
      WHERE effective_from_date <= $1
        AND effective_from_date > NOW() - INTERVAL '7 days'
      ORDER BY effective_from_date ASC
      LIMIT 50
    `, [now]);
    
    if (pendingRequests.rows.length === 0) {
      await client.query('COMMIT');
      return;
    }
    
    console.log(`🔄 Processing ${pendingRequests.rows.length} change requests...`);
    
    // Process changes in batches using a transaction
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
        
        // Check if the change has already been applied (for immediate changes)
        let alreadyApplied = false;
        if (request.change_type === 'active_status_change') {
          const currentStatusCheck = await client.query(
            'SELECT is_active FROM human_resource WHERE unique_id = $1',
            [request.staff_id]
          );
          if (currentStatusCheck.rows.length > 0) {
            const currentStatus = currentStatusCheck.rows[0].is_active;
            const expectedStatus = request.new_value === 'true';
            if (currentStatus === expectedStatus) {
              alreadyApplied = true;
              console.log(`ℹ️ Change request ${request.change_type} for ${request.staff_name} already applied, skipping...`);
            }
          }
        } else if (request.change_type === 'role_change') {
          const currentRoleCheck = await client.query(
            'SELECT role FROM human_resource WHERE unique_id = $1',
            [request.staff_id]
          );
          if (currentRoleCheck.rows.length > 0) {
            const currentRole = currentRoleCheck.rows[0].role;
            if (currentRole === request.new_value) {
              alreadyApplied = true;
              console.log(`ℹ️ Change request ${request.change_type} for ${request.staff_name} already applied, skipping...`);
            }
          }
        } else if (request.change_type === 'pay_rate_change') {
          const currentPayRateCheck = await client.query(
            'SELECT pay_rate FROM human_resource WHERE unique_id = $1',
            [request.staff_id]
          );
          if (currentPayRateCheck.rows.length > 0) {
            const currentPayRate = parseFloat(currentPayRateCheck.rows[0].pay_rate);
            const expectedPayRate = parseFloat(request.new_value);
            if (Math.abs(currentPayRate - expectedPayRate) < 0.01) {
              alreadyApplied = true;
              console.log(`ℹ️ Change request ${request.change_type} for ${request.staff_name} already applied, skipping...`);
            }
          }
        } else if (request.change_type === 'contracted_hours_change') {
          const currentHoursCheck = await client.query(
            'SELECT contracted_hours FROM human_resource WHERE unique_id = $1',
            [request.staff_id]
          );
          if (currentHoursCheck.rows.length > 0) {
            const currentHours = parseFloat(currentHoursCheck.rows[0].contracted_hours);
            const expectedHours = parseFloat(request.new_value);
            if (Math.abs(currentHours - expectedHours) < 0.01) {
              alreadyApplied = true;
              console.log(`ℹ️ Change request ${request.change_type} for ${request.staff_name} already applied, skipping...`);
            }
          }
        } else if (request.change_type === 'color_code_change') {
          const currentColorCheck = await client.query(
            'SELECT color_code FROM human_resource WHERE unique_id = $1',
            [request.staff_id]
          );
          if (currentColorCheck.rows.length > 0) {
            const currentColor = currentColorCheck.rows[0].color_code;
            if (currentColor === request.new_value) {
              alreadyApplied = true;
              console.log(`ℹ️ Change request ${request.change_type} for ${request.staff_name} already applied, skipping...`);
            }
          }
        }
        
        if (!alreadyApplied) {
          // Apply the change
          await client.query(updateQuery, updateParams);
          console.log(`✅ Applied change request: ${request.change_type} for ${request.staff_name}`);
        }
        
        // IMPORTANT: Do NOT delete change requests - keep them as history
        // The change request serves as an audit trail even after being applied
        // Only delete if explicitly requested or after a retention period
        
      } catch (error) {
        console.error(`❌ Error applying change request ${request.id}:`, error);
        // Continue processing other requests even if one fails
      }
    }
    
    await client.query('COMMIT');
    console.log(`✅ Completed processing ${pendingRequests.rows.length} change requests`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error in change request processor:', error);
  } finally {
    client.release();
  }
}

// Run change request processor every minute
setInterval(processChangeRequests, 60000); // 60 seconds

// =====================================================
// DATABASE SETUP ENDPOINTS
// =====================================================

// Create settings table
app.post('/api/setup/create-settings-table', async (req, res) => {
  try {
    console.log('🔧 Creating settings table...');
    
    // Create settings table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        setting_id UUID PRIMARY KEY DEFAULT uuid_setting(type_of_setting),
        type_of_setting TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT (NOW() AT TIME ZONE 'Europe/London'),
        updated_at TIMESTAMPTZ DEFAULT (NOW() AT TIME ZONE 'Europe/London')
      )
    `);
    
    // Create indexes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_settings_type ON settings(type_of_setting)
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_settings_updated_at ON settings(updated_at)
    `);
    
    // Create trigger for updated_at
    await pool.query(`
      DROP TRIGGER IF EXISTS update_settings_updated_at ON settings
    `);
    
    await pool.query(`
      CREATE TRIGGER update_settings_updated_at 
        BEFORE UPDATE ON settings 
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
    `);
    
    // Insert default settings
    await pool.query(`
      INSERT INTO settings (setting_id, type_of_setting, value) VALUES
        (uuid_setting('Flat rate for SSP per week'), 'Flat rate for SSP per week', '109.40'),
        (uuid_setting('Flat rate for CSP'), 'Flat rate for CSP', '49')
      ON CONFLICT (type_of_setting) DO NOTHING
    `);
    
    res.json({
      success: true,
      message: 'Settings table created successfully with default values'
    });
  } catch (error) {
    console.error('❌ Error creating settings table:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create settings table',
      details: error.message
    });
  }
});

// =====================================================
// SETTINGS API ENDPOINTS
// =====================================================

// Get all settings
app.get('/api/settings', async (req, res) => {
  try {
    console.log('⚙️ Fetching settings...');
    
    const result = await pool.query(`
      SELECT setting_id, type_of_setting, value, created_at, updated_at
      FROM settings
      ORDER BY type_of_setting
    `);
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('❌ Error fetching settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch settings',
      details: error.message
    });
  }
});

// Update a setting
app.put('/api/settings', async (req, res) => {
  try {
    const { type_of_setting, value } = req.body;
    
    if (!type_of_setting || value === undefined) {
      return res.status(400).json({
        success: false,
        error: 'type_of_setting and value are required'
      });
    }
    
    console.log(`⚙️ Updating setting: ${type_of_setting} = ${value}`);
    
    const result = await pool.query(`
      INSERT INTO settings (setting_id, type_of_setting, value)
      VALUES (uuid_setting($1), $1, $2)
      ON CONFLICT (type_of_setting)
      DO UPDATE SET 
        value = EXCLUDED.value,
        updated_at = NOW() AT TIME ZONE 'Europe/London'
      RETURNING setting_id, type_of_setting, value, created_at, updated_at
    `, [type_of_setting, value]);
    
    res.json({
      success: true,
      data: result.rows[0],
      message: 'Setting updated successfully'
    });
  } catch (error) {
    console.error('❌ Error updating setting:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update setting',
      details: error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('API endpoints available at /api/*');
  console.log('Database connection:', pool.totalCount > 0 ? 'Active' : 'Inactive');
  console.log('🔄 Change request processor started (runs every 60 seconds)');
});

// =====================================================
// UNAVAILABLE STAFF API ENDPOINTS
// =====================================================

// Get unavailable staff for a specific period and date
app.get('/api/unavailable-staff/period/:periodId/date/:date', async (req, res) => {
  try {
    const { periodId, date } = req.params;
    
    // Validate periodId format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(periodId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid period ID format',
        message: 'Period ID must be a valid UUID'
      });
    }
    
    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format',
        message: 'Date must be in YYYY-MM-DD format'
      });
    }
    
    const result = await pool.query(`
      SELECT 
        us.id,
        us.period_id,
        us.date,
        us.unavailable,
        us.notes,
        us.created_at,
        us.updated_at,
        p.period_name,
        p.start_date,
        p.end_date
      FROM unavailable_staff_daily us
      LEFT JOIN periods p ON us.period_id = p.period_id
      WHERE us.period_id = $1 AND us.date = $2
    `, [periodId, date]);
    
    if (result.rows.length === 0) {
      // Return empty unavailable list if no record exists
      return res.json({
        success: true,
        data: {
          id: null,
          period_id: periodId,
          date: date,
          unavailable: '',
          notes: '',
          created_at: null,
          updated_at: null,
          period_name: null,
          start_date: null,
          end_date: null
        },
        message: 'No unavailable staff record found for this period and date'
      });
    }
    
    res.json({
      success: true,
      data: result.rows[0],
      message: 'Unavailable staff retrieved successfully'
    });
  } catch (err) {
    console.error('Error fetching unavailable staff:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch unavailable staff',
      message: err.message
    });
  }
});

// Get all unavailable staff for a specific period (batch endpoint for performance)
app.get('/api/unavailable-staff/period/:periodId', async (req, res) => {
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
    
    // Get period date range first
    const periodResult = await executeQueryWithRetry(
      'SELECT start_date, end_date FROM periods WHERE period_id = $1',
      [periodId]
    );
    
    if (periodResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Period not found',
        message: 'No period found with the specified ID'
      });
    }
    
    const { start_date, end_date } = periodResult.rows[0];
    
    // Fetch all unavailable staff for the entire period in one query
    const result = await executeQueryWithRetry(`
      SELECT 
        us.id,
        us.period_id,
        us.date,
        us.unavailable,
        us.notes,
        us.created_at,
        us.updated_at
      FROM unavailable_staff_daily us
      WHERE us.period_id = $1
        AND us.date >= $2::date
        AND us.date <= $3::date
      ORDER BY us.date
    `, [periodId, start_date, end_date]);
    
    // Convert to a map for easy lookup by date
    const unavailableMap = {};
    result.rows.forEach(row => {
      unavailableMap[row.date] = {
        id: row.id,
        period_id: row.period_id,
        date: row.date,
        unavailable: row.unavailable || '',
        notes: row.notes || '',
        created_at: row.created_at,
        updated_at: row.updated_at
      };
    });
    
    res.json({
      success: true,
      data: unavailableMap,
      count: result.rows.length,
      message: 'Unavailable staff retrieved successfully'
    });
  } catch (err) {
    console.error('Error fetching unavailable staff:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch unavailable staff',
      message: err.message
    });
  }
});

// Update unavailable staff for a specific period and date
app.put('/api/unavailable-staff/period/:periodId/date/:date', async (req, res) => {
  try {
    const { periodId, date } = req.params;
    const { unavailable, notes } = req.body;
    
    // Log immediately when request is received
    console.log('📥 PUT /api/unavailable-staff/period/:periodId/date/:date - Request received');
    console.log('📥 Request body:', JSON.stringify(req.body));
    console.log('📥 Request params:', { periodId, date });
    
    // Validate periodId format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(periodId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid period ID format',
        message: 'Period ID must be a valid UUID'
      });
    }
    
    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format',
        message: 'Date must be in YYYY-MM-DD format'
      });
    }
    
    // Handle undefined/null values first
    const unavailableStr = unavailable ?? '';
    const notesStr = notes ?? '';
    
    // Validate unavailable is a string (after handling null/undefined)
    if (typeof unavailableStr !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Invalid unavailable value',
        message: 'Unavailable must be a string (comma-separated staff names)'
      });
    }
    
    // Validate notes if provided
    if (notesStr && typeof notesStr !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Invalid notes value',
        message: 'Notes must be a string'
      });
    }
    
    // Trim the values to check if they're empty
    const trimmedUnavailable = unavailableStr.trim();
    const trimmedNotes = notesStr.trim();
    
    // Log the received values for debugging (ALWAYS log, even in production for debugging)
    console.log('🔍 Update unavailable staff request:', {
      periodId,
      date,
      unavailable: JSON.stringify(unavailable),
      unavailableRaw: unavailable,
      unavailableType: typeof unavailable,
      unavailableIsNull: unavailable === null,
      unavailableIsUndefined: unavailable === undefined,
      unavailableStr: JSON.stringify(unavailableStr),
      unavailableStrLength: unavailableStr.length,
      trimmedUnavailable: JSON.stringify(trimmedUnavailable),
      trimmedUnavailableLength: trimmedUnavailable.length,
      isEmptyCheck1: !trimmedUnavailable,
      isEmptyCheck2: trimmedUnavailable === '',
      isEmptyCheck3: trimmedUnavailable.length === 0,
      notes: JSON.stringify(notes),
      trimmedNotes: JSON.stringify(trimmedNotes)
    });
    
    // Check if period exists
    const periodCheck = await pool.query(`
      SELECT period_id FROM periods WHERE period_id = $1
    `, [periodId]);
    
    if (periodCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Period not found',
        message: 'No period found with the specified ID'
      });
    }
    
    // If unavailable is empty (no staff selected), delete the row instead of updating
    // We delete regardless of notes, as clearing all staff means clearing the unavailable entry
    // Check multiple ways to ensure we catch empty strings
    const isEmpty1 = !trimmedUnavailable;
    const isEmpty2 = trimmedUnavailable === '';
    const isEmpty3 = trimmedUnavailable.length === 0;
    const isEmpty4 = trimmedUnavailable.replace(/\s/g, '') === '';
    const isEmpty = isEmpty1 || isEmpty2 || isEmpty3 || isEmpty4;
    
    console.log('🔍 Empty check results:', {
      isEmpty1,
      isEmpty2,
      isEmpty3,
      isEmpty4,
      finalIsEmpty: isEmpty,
      willDelete: isEmpty
    });
    
    if (isEmpty) {
      console.log('🗑️ Unavailable is empty - deleting row from database');
      console.log('🗑️ Delete query parameters:', { periodId, date, dateType: typeof date });
      
      // First check if the record exists
      const checkResult = await pool.query(`
        SELECT id, period_id, date, unavailable, notes 
        FROM unavailable_staff_daily
        WHERE period_id = $1 AND date = $2::date
      `, [periodId, date]);
      
      console.log('🗑️ Records found before delete:', checkResult.rows.length, checkResult.rows);
      
      // Delete the row
      const deleteResult = await pool.query(`
        DELETE FROM unavailable_staff_daily
        WHERE period_id = $1 AND date = $2::date
        RETURNING *
      `, [periodId, date]);
      
      console.log('🗑️ Delete result:', {
        rowsDeleted: deleteResult.rows.length,
        deletedRow: deleteResult.rows[0] || null
      });
      
      // Verify deletion
      const verifyResult = await pool.query(`
        SELECT id FROM unavailable_staff_daily
        WHERE period_id = $1 AND date = $2::date
      `, [periodId, date]);
      
      console.log('🗑️ Verification after delete - records remaining:', verifyResult.rows.length);
      
      if (deleteResult.rows.length > 0) {
        res.json({
          success: true,
          data: null,
          message: 'Unavailable staff record deleted successfully'
        });
      } else {
        // No record existed, which is fine
        console.log('ℹ️ No record existed to delete');
        res.json({
          success: true,
          data: null,
          message: 'No unavailable staff record to delete'
        });
      }
    } else {
      // Use UPSERT to insert or update
      const result = await pool.query(`
        INSERT INTO unavailable_staff_daily (id, period_id, date, unavailable, notes)
        VALUES (uuid_unavailable_staff_daily($1, $2::date), $1, $2, $3, $4)
        ON CONFLICT (period_id, date)
        DO UPDATE SET 
          unavailable = EXCLUDED.unavailable,
          notes = EXCLUDED.notes,
          updated_at = (NOW() AT TIME ZONE 'Europe/London')
        RETURNING *
      `, [periodId, date, trimmedUnavailable, trimmedNotes]);
      
      res.json({
        success: true,
        data: result.rows[0],
        message: 'Unavailable staff updated successfully'
      });
    }
  } catch (err) {
    console.error('Error updating unavailable staff:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to update unavailable staff',
      message: err.message
    });
  }
});

// Get all active staff names for dropdown
app.get('/api/active-staff', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT staff_name, color_code, role
      FROM human_resource 
      WHERE is_active = true 
      ORDER BY staff_name
    `);
    
    res.json({
      success: true,
      data: result.rows,
      message: 'Active staff retrieved successfully'
    });
  } catch (err) {
    console.error('Error fetching active staff:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch active staff',
      message: err.message
    });
  }
});

// 404 handler for undefined API routes (must be last)
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    message: `API endpoint ${req.method} ${req.originalUrl} does not exist`
  });
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