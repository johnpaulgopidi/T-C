# Staff Rota Management System

A comprehensive staff scheduling and rota management system with PostgreSQL backend, RESTful API, and modern web interface. This system provides complete staff management, shift scheduling, time-off tracking, and detailed reporting capabilities with advanced features like callout flags and holiday entitlement warnings.

## 🎯 Key Features

### 📅 **Rota Management**
- **4-Week Period System**: Organize schedules into manageable 4-week periods
- **Interactive Rota View**: Visual calendar interface with drag-and-drop functionality
- **Multi-Select Operations**: Bulk delete and manage multiple shifts simultaneously
- **Period Navigation**: Easy navigation between different scheduling periods
- **Real-time Updates**: Live synchronization across multiple user sessions
- **Visual Flag Indicators**: Color-coded flags for different shift types and special conditions

### 👥 **Staff Management**
- **Complete Staff Profiles**: Name, role, employment dates, contracted hours, pay rates
- **Role Management**: Team leaders and staff members with different permissions
- **Active Status Control**: Enable/disable staff members without data loss
- **Employment Tracking**: Start and end date management with historical records
- **Contract History**: Complete audit trail of all staff changes
- **Color Coding**: Visual staff identification with customizable color schemes
- **Historical Snapshots**: Point-in-time data capture for historical analysis

### 🕐 **Shift Scheduling**
- **Multiple Shift Types**: Day, Night, Holiday, and custom shift types
- **Advanced Shift Flags**: 
  - Solo shifts, training, short notice, overtime
  - Payment period end, financial year end
  - **Call-out flag** (2x pay multiplier)
- **Overlap Prevention**: Automatic validation to prevent scheduling conflicts
- **Flexible Assignment**: Assign multiple staff to single shifts
- **Shift Notes**: Add detailed notes and comments to shifts
- **Bulk Operations**: Clear multiple shifts, delete selected shifts
- **Pay Calculation**: Automatic pay calculation with multipliers for special flags

### 📊 **Shift Summary & Reporting**
- **Detailed Reports**: Comprehensive shift summaries with employee breakdowns
- **Cumulative Hours**: Track total hours from financial year start to current date
- **Financial Year Logic**: Automatic UK financial year calculation (April 6th to April 5th)
- **Employee Profiles**: Individual staff member shift history and statistics
- **Date Range Filtering**: Custom date ranges for reporting
- **Export Capabilities**: View and analyze shift data in multiple formats
- **Historical Pay Calculation**: Calculate pay for any historical period

### 🏖️ **Time-Off Management**
- **Holiday Entitlements**: UK statutory holiday calculation (5.6 weeks × contracted hours ÷ 12)
- **Holiday Year Tracking**: April 6th to April 5th (UK statutory year)
- **Entitlement Management**: View and manage holiday entitlements
- **Usage Tracking**: Monitor holiday usage with remaining balance
- **Zero Hours Support**: Accrual-based tracking for flexible contracts
- **Visual Progress**: Progress bars and status indicators
- **⚠️ Holiday Warning System**: Automatic warnings when staff have fully utilized their holiday entitlement
- **Pro-rated Calculations**: Automatic pro-rating based on employment dates and hours changes

### 🔧 **Advanced Features**
- **Historical Data**: Complete audit trail of all changes
- **Snapshot System**: Point-in-time data capture for historical analysis
- **Temporal Integrity**: Maintain data consistency across time periods
- **Database Migrations**: Automated schema updates and data migrations
- **Timezone Support**: London timezone handling for accurate scheduling
- **API-First Design**: RESTful API for all operations
- **Real-time Validation**: Live validation of shift assignments and conflicts
- **Bulk Data Operations**: Efficient handling of large datasets

## 🚀 Quick Start

### Prerequisites
- Node.js (v14 or higher)
- PostgreSQL (v12 or higher)
- npm or yarn

### Installation

1. **Clone and Install**
   ```bash
   git clone <repository-url>
   cd project
   npm install
   ```

2. **Environment Setup**
   Create a `.env` file in the project root:
   ```env
   DB_USER=postgres
   DB_HOST=localhost
   DB_NAME=work_scheduler
   DB_PASSWORD=postgres123
   DB_PORT=5432
   PORT=3001
   ```

3. **Database Setup**
   ```bash
   # Create database
   createdb work_scheduler
   
   # Run complete database setup (includes all tables, views, functions, and triggers)
   psql -U postgres -d work_scheduler -f complete-database-setup.sql
   ```

4. **Start the Application**
   
   **Option 1: Use the batch script (Windows)**
   ```bash
   # Simply double-click start-server.bat from the project root
   # OR run from command line:
   start-server.bat
   ```
   
   **Option 2: Manual start**
   ```bash
   npm start
   ```

5. **Access the Application**
   Open your browser and navigate to `http://localhost:3001`

## 📡 API Endpoints

### Staff Management
- `GET /api/staff` - Get all staff members
- `GET /api/staff/:id` - Get single staff member
- `POST /api/staff` - Add new staff member
- `DELETE /api/staff/:id` - Delete staff member
- `PUT /api/staff/:id/role` - Update staff role
- `PUT /api/staff/:id/pay-rate` - Update pay rate
- `PUT /api/staff/:id/contracted-hours` - Update contracted hours
- `PUT /api/staff/:id/employment-date` - Update employment start date
- `PUT /api/staff/:id/employment-end-date` - Update employment end date
- `PUT /api/staff/:id/toggle-active` - Toggle active status
- `PUT /api/staff/:id/color-code` - Update color code
- `GET /api/staff/:id/contract-history` - Get contract history
- `GET /api/staff/:id/changes-history` - Get applied changes history
- `GET /api/staff/:id/change-requests` - Get pending change requests
- `GET /api/staff/:id/role-history` - Get role history
- `GET /api/staff/:id/color-history` - Get color history
- `DELETE /api/staff/:id/change-requests/:changeId` - Delete change request

### Shift Management
- `GET /api/shifts` - Get all shifts
- `GET /api/shifts/period/:periodId` - Get shifts for specific period
- `GET /api/shifts/staff/:staffName` - Get shifts for specific staff
- `GET /api/shifts/employee/:staffName` - Get employee shifts with flags
- `POST /api/shifts` - Create new shift
- `DELETE /api/shifts/delete` - Delete specific shifts
- `DELETE /api/shifts/clear` - Clear all shifts
- `DELETE /api/shifts/clear-cell` - Clear specific cell
- `POST /api/shifts/clear-multiple` - Clear multiple shifts
- `PUT /api/shifts/:id/solo-shift` - Toggle solo shift flag
- `PUT /api/shifts/:id/training` - Toggle training flag
- `PUT /api/shifts/:id/short-notice` - Toggle short notice flag
- `PUT /api/shifts/:id/payment-period-end` - Toggle payment period end flag
- `PUT /api/shifts/:id/overtime` - Toggle overtime flag
- `PUT /api/shifts/:id/call-out` - Toggle call-out flag (2x pay)
- `PUT /api/shifts/:id/notes` - Update shift notes

### Period Management
- `GET /api/periods` - Get all periods

### Time-Off Management
- `GET /api/time-off/holiday-entitlements` - Get holiday entitlements
- `GET /api/time-off/holiday-entitlements/:staffId` - Get staff entitlements
- `GET /api/time-off/holiday-entitlements/:staffId/status` - Check holiday entitlement status
- `POST /api/time-off/holiday-entitlements` - Create holiday entitlement
- `PUT /api/time-off/holiday-entitlements/:staffId/usage` - Update holiday usage
- `POST /api/time-off/holiday-entitlements/refresh` - Refresh all holiday entitlements
- `GET /api/time-off/summary` - Get time-off summary

### Historical Data
- `GET /api/staff/historical/:date` - Get historical staff data
- `POST /api/staff/snapshot` - Create staff snapshot
- `GET /api/staff/snapshots/stats` - Get snapshot statistics
- `GET /api/staff/:staff_name/snapshots` - Get staff snapshots
- `POST /api/staff/historical-pay` - Calculate historical pay
- `POST /api/staff/historical-holiday-pay` - Calculate historical holiday pay

### System Management
- `GET /api/test` - Test endpoint
- `GET /api/test-db` - Test database connection
- `GET /api/migrate/check-schema` - Check schema status
- `POST /api/migrate/fix-shift-types` - Fix shift types
- `POST /api/migrate/remove-extra-columns` - Remove extra columns
- `POST /api/migrate/add-color-code` - Add color code support

### Debug Endpoints
- `GET /api/debug/shifts/:id` - Get shift details for debugging

## 🗄️ Database Schema

### Core Tables
- **`human_resource`**: Staff information, roles, employment details, contracted hours, pay rates
- **`periods`**: 4-week scheduling periods for organizing rota schedules (1009 periods 2025-2100)
- **`shifts`**: Shift assignments with flags (solo, training, short notice, overtime, call-out, etc.) - **Empty by default**
- **`change_requests`**: Change request audit trail with effective dates - **Empty by default**
- **`holiday_entitlements`**: Holiday entitlement tracking per UK financial year with pro-rata calculations

### Key Features
- **Complete Audit Trail**: Every change is logged with timestamps and reasons via change_requests table
- **Data Validation**: Comprehensive constraints and overlap prevention
- **Performance Optimization**: Strategic indexing for fast queries
- **Timezone Support**: London timezone handling for accurate scheduling
- **UK Compliance**: Holiday entitlement calculations follow UK statutory requirements with pro-rata calculations
- **Flexible Schema**: Extensible design for future enhancements
- **One-File Setup**: Complete database setup in a single SQL file
- **Automatic Migrations**: Built-in database migration system
- **Pro-rata Holiday Calculations**: Automatic holiday entitlement calculation based on employment dates and contracted hours
- **Dynamic Holiday Usage**: Real-time tracking of holiday usage from shift assignments

## 🎨 User Interface

### Main Navigation
- **📅 Rota View**: Interactive calendar with shift management
- **👥 Staff Management**: Complete staff administration
- **📊 Shift Summary**: Detailed reporting and analytics
- **🏖️ Time-Off**: Holiday entitlement management

### Key UI Features
- **Responsive Design**: Works on desktop, tablet, and mobile
- **Real-time Updates**: Live synchronization across sessions
- **Intuitive Navigation**: Easy-to-use interface
- **Visual Feedback**: Clear status indicators and progress bars
- **Bulk Operations**: Efficient multi-select functionality
- **Data Export**: Multiple export formats for reporting
- **Interactive Popups**: Rich assignment dialogs with flag management
- **Warning Systems**: Automatic alerts for holiday entitlement issues

## 🔧 Development

### Available Scripts
```bash
npm start          # Start production server
npm run dev        # Development mode with auto-reload
npm test           # Run tests
npm run setup-db   # Setup database (if separate script exists)
npm run populate-db # Populate with sample data (if separate script exists)
```

### Database Setup
```bash
# Complete database setup (one command)
psql -U postgres -d work_scheduler -f complete-database-setup.sql
```

**Note**: The database setup creates:
- ✅ **11 staff members** with roles, pay rates, and color codes
- ✅ **1009 periods** from 2025-2100 for scheduling
- ✅ **Holiday entitlements** for all staff with pro-rata calculations
- ✅ **Empty shifts table** ready for shift assignments
- ✅ **Empty change_requests table** ready for audit trail

### Development Features
- **Hot Reload**: Automatic server restart on changes
- **Error Handling**: Comprehensive error logging and handling
- **API Testing**: Built-in test endpoints
- **Database Migrations**: Automated schema updates
- **Debug Tools**: Extensive debugging capabilities
- **Connection Pooling**: Efficient database connection management

## 📋 System Requirements

### Server Requirements
- **Node.js**: v14 or higher
- **PostgreSQL**: v12 or higher
- **RAM**: Minimum 2GB
- **Storage**: 1GB free space

### Browser Support
- **Chrome**: v80 or higher
- **Firefox**: v75 or higher
- **Safari**: v13 or higher
- **Edge**: v80 or higher

## 🔒 Security Features

- **Input Validation**: Comprehensive validation on all inputs
- **SQL Injection Prevention**: Parameterized queries
- **Data Integrity**: Database constraints and checks
- **Audit Trail**: Complete change tracking
- **Error Handling**: Secure error messages
- **Connection Security**: Secure database connections

## 📈 Performance

- **Database Indexing**: Optimized queries with strategic indexes
- **Connection Pooling**: Efficient database connection management
- **Caching**: Smart caching for frequently accessed data
- **Real-time Updates**: Efficient live synchronization
- **Bulk Operations**: Optimized batch processing
- **Autovacuum**: Automatic database maintenance (recommended)

## 🆕 Recent Features

### Change Request System
- **Effective Date Management**: Schedule changes for future dates
- **Audit Trail**: Complete history of all staff changes
- **Revert Functionality**: Delete applied changes and revert to previous values
- **Pending vs Applied**: Clear separation between future and current changes
- **API Integration**: Complete CRUD operations for change requests

### Pro-rata Holiday Calculations
- **Employment Date Based**: Automatic calculation based on start/end dates
- **Contracted Hours**: Pro-rata calculation based on hours worked
- **Financial Year**: UK statutory holiday year (April 6th to April 5th)
- **Dynamic Updates**: Real-time recalculation when hours change
- **Usage Tracking**: Automatic tracking from holiday shift assignments

### Call-out Flag System
- **2x Pay Multiplier**: Automatic pay calculation for call-out shifts
- **Visual Indicators**: Clear labeling in the UI
- **Database Integration**: Full database support with `call_out` column
- **API Endpoints**: Complete CRUD operations for call-out flags

### Holiday Entitlement Warning System
- **Automatic Detection**: Real-time checking of holiday entitlement status
- **Visual Warnings**: Clear warning messages when entitlement is fully utilized
- **Smart Integration**: Works with both contracted and zero-hour employees
- **API Integration**: New endpoint for checking entitlement status

## 📚 Documentation

- **HOLIDAY_ENTITLEMENT_GUIDE.md**: Comprehensive guide to holiday calculations
- **API Documentation**: Complete endpoint documentation in this README
- **Database Schema**: Detailed schema documentation in SQL files
- **Configuration Guide**: Environment setup and configuration options

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

For support and questions:
- Check the documentation in `/docs`
- Review the API endpoints
- Check the database schema files
- Contact the development team

## 🔧 Database Maintenance

### Autovacuum Recommendation
This system is designed to work with PostgreSQL's autovacuum feature. For optimal performance:

1. **Enable Autovacuum** (default in PostgreSQL):
   ```sql
   SHOW autovacuum; -- Should return 'on'
   ```

2. **Recommended Settings** in `postgresql.conf`:
   ```
   autovacuum = on
   autovacuum_vacuum_scale_factor = 0.1
   autovacuum_analyze_scale_factor = 0.05
   autovacuum_vacuum_threshold = 50
   autovacuum_naptime = 1min
   autovacuum_max_workers = 3
   ```

3. **Monitor Activity**:
   ```sql
   SELECT relname, last_autovacuum, autovacuum_count 
   FROM pg_stat_all_tables 
   WHERE schemaname = 'public' 
   ORDER BY last_autovacuum DESC;
   ```

---

**Built with ❤️ for efficient staff management**