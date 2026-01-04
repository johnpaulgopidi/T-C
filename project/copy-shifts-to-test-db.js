// Script to copy shifts data from danieltime database to test database
// Since key columns are deterministic, UUIDs will be the same in both databases
const { Pool } = require('pg');
const config = require('./config');

// Source database (danieltime)
const sourceDbConfig = {
  ...config.db,
  database: 'danieltime',
};

// Destination database (test)
const destDbConfig = {
  ...config.db,
  database: 'test',
};

const sourcePool = new Pool(sourceDbConfig);
const destPool = new Pool(destDbConfig);

async function copyShifts() {
  let sourceClient, destClient;
  
  try {
    console.log('🔄 Starting shifts data copy from danieltime to test database...\n');
    
    // Connect to both databases
    console.log('📡 Connecting to databases...');
    console.log(`   Source: ${sourceDbConfig.database} @ ${sourceDbConfig.host}:${sourceDbConfig.port}`);
    console.log(`   Destination: ${destDbConfig.database} @ ${destDbConfig.host}:${destDbConfig.port}\n`);
    
    sourceClient = await sourcePool.connect();
    destClient = await destPool.connect();
    
    // Check if shifts table exists in both databases
    console.log('1️⃣ Verifying tables exist...');
    const sourceTableCheck = await sourceClient.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'shifts'
      ) as exists;
    `);
    
    const destTableCheck = await destClient.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'shifts'
      ) as exists;
    `);
    
    if (!sourceTableCheck.rows[0].exists) {
      throw new Error('Shifts table does not exist in source database (danieltime)');
    }
    
    if (!destTableCheck.rows[0].exists) {
      throw new Error('Shifts table does not exist in destination database (test)');
    }
    
    console.log('✅ Tables verified\n');
    
    // Get count of shifts in source database
    console.log('2️⃣ Counting shifts in source database...');
    const sourceCount = await sourceClient.query('SELECT COUNT(*) as count FROM shifts');
    const totalShifts = parseInt(sourceCount.rows[0].count);
    console.log(`   Found ${totalShifts} shifts in danieltime database\n`);
    
    if (totalShifts === 0) {
      console.log('⚠️  No shifts to copy. Exiting...');
      return;
    }
    
    // Get count of shifts in destination database
    const destCount = await destClient.query('SELECT COUNT(*) as count FROM shifts');
    const existingShifts = parseInt(destCount.rows[0].count);
    console.log(`   Found ${existingShifts} shifts in test database\n`);
    
    // Fetch all shifts from source database
    console.log('3️⃣ Fetching shifts from source database...');
    const shiftsResult = await sourceClient.query(`
      SELECT 
        id,
        period_id,
        week_number,
        staff_name,
        shift_start_datetime,
        shift_end_datetime,
        shift_type,
        solo_shift,
        training,
        short_notice,
        call_out,
        payment_period_end,
        financial_year_end,
        overtime,
        notes,
        created_at,
        updated_at
      FROM shifts
      ORDER BY shift_start_datetime
    `);
    
    console.log(`   Fetched ${shiftsResult.rows.length} shifts\n`);
    
    // Verify foreign key dependencies exist in destination
    console.log('4️⃣ Verifying foreign key dependencies...');
    
    // Check periods
    const periodIds = [...new Set(shiftsResult.rows.map(s => s.period_id))];
    const periodsCheck = await destClient.query(`
      SELECT period_id 
      FROM periods 
      WHERE period_id = ANY($1::uuid[])
    `, [periodIds]);
    
    const missingPeriods = periodIds.filter(pid => 
      !periodsCheck.rows.some(p => p.period_id === pid)
    );
    
    if (missingPeriods.length > 0) {
      console.log(`   ⚠️  Warning: ${missingPeriods.length} period(s) missing in test database:`);
      missingPeriods.forEach(pid => console.log(`      - ${pid}`));
      console.log('   These shifts will be skipped if foreign key constraints are enforced.\n');
    } else {
      console.log(`   ✅ All ${periodIds.length} periods exist in test database\n`);
    }
    
    // Check staff (human_resource)
    const staffNames = [...new Set(shiftsResult.rows.map(s => s.staff_name))];
    const staffCheck = await destClient.query(`
      SELECT staff_name 
      FROM human_resource 
      WHERE staff_name = ANY($1::text[])
    `, [staffNames]);
    
    const missingStaff = staffNames.filter(name => 
      !staffCheck.rows.some(s => s.staff_name === name)
    );
    
    if (missingStaff.length > 0) {
      console.log(`   ⚠️  Warning: ${missingStaff.length} staff member(s) missing in test database:`);
      missingStaff.forEach(name => console.log(`      - ${name}`));
      console.log('   These shifts will be skipped if foreign key constraints are enforced.\n');
    } else {
      console.log(`   ✅ All ${staffNames.length} staff members exist in test database\n`);
    }
    
    // Insert shifts into destination database
    console.log('5️⃣ Copying shifts to destination database...');
    
    let inserted = 0;
    let skipped = 0;
    let errors = 0;
    
    // Use batch insert for better performance
    const batchSize = 100;
    for (let i = 0; i < shiftsResult.rows.length; i += batchSize) {
      const batch = shiftsResult.rows.slice(i, i + batchSize);
      
      for (const shift of batch) {
        try {
          // Use INSERT ... ON CONFLICT DO NOTHING since UUIDs are deterministic
          // This will skip shifts that already exist
          const insertResult = await destClient.query(`
            INSERT INTO shifts (
              id,
              period_id,
              week_number,
              staff_name,
              shift_start_datetime,
              shift_end_datetime,
              shift_type,
              solo_shift,
              training,
              short_notice,
              call_out,
              payment_period_end,
              financial_year_end,
              overtime,
              notes,
              created_at,
              updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            ON CONFLICT (id) DO NOTHING
          `, [
            shift.id,
            shift.period_id,
            shift.week_number,
            shift.staff_name,
            shift.shift_start_datetime,
            shift.shift_end_datetime,
            shift.shift_type,
            shift.solo_shift,
            shift.training,
            shift.short_notice,
            shift.call_out,
            shift.payment_period_end,
            shift.financial_year_end,
            shift.overtime,
            shift.notes,
            shift.created_at,
            shift.updated_at
          ]);
          
          if (insertResult.rowCount > 0) {
            inserted++;
          } else {
            skipped++;
          }
        } catch (error) {
          errors++;
          console.error(`   ❌ Error inserting shift ${shift.id}: ${error.message}`);
          
          // If it's a foreign key constraint error, log it but continue
          if (error.code === '23503') {
            // Foreign key violation - expected if dependencies are missing
            console.error(`      (Foreign key constraint - missing period or staff member)`);
          }
        }
      }
      
      // Progress update
      const processed = Math.min(i + batchSize, shiftsResult.rows.length);
      process.stdout.write(`\r   Progress: ${processed}/${shiftsResult.rows.length} shifts processed (${inserted} inserted, ${skipped} skipped, ${errors} errors)`);
    }
    
    console.log('\n');
    
    // Verify final count
    console.log('6️⃣ Verifying copy operation...');
    const finalCount = await destClient.query('SELECT COUNT(*) as count FROM shifts');
    const finalShifts = parseInt(finalCount.rows[0].count);
    
    console.log(`\n📊 Summary:`);
    console.log(`   Source shifts: ${totalShifts}`);
    console.log(`   Destination shifts before: ${existingShifts}`);
    console.log(`   Destination shifts after: ${finalShifts}`);
    console.log(`   New shifts inserted: ${inserted}`);
    console.log(`   Shifts skipped (already exist): ${skipped}`);
    console.log(`   Errors: ${errors}`);
    console.log(`   Net change: +${finalShifts - existingShifts}\n`);
    
    if (inserted > 0) {
      console.log('✅ Shifts copied successfully!');
    } else if (skipped === totalShifts) {
      console.log('ℹ️  All shifts already exist in test database (no new data to copy)');
    } else {
      console.log('⚠️  Copy completed with some issues. Please review the errors above.');
    }
    
  } catch (error) {
    console.error('\n❌ Fatal error copying shifts:');
    console.error(`   ${error.message}`);
    if (error.code) {
      console.error(`   Error code: ${error.code}`);
    }
    if (error.detail) {
      console.error(`   Detail: ${error.detail}`);
    }
    process.exit(1);
  } finally {
    if (sourceClient) {
      sourceClient.release();
    }
    if (destClient) {
      destClient.release();
    }
    await sourcePool.end();
    await destPool.end();
  }
}

// Run the copy operation
copyShifts()
  .then(() => {
    console.log('\n✅ Copy operation completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Copy operation failed:', error);
    process.exit(1);
  });
