// Database configuration
// You can override these settings with environment variables:
// DB_USER, DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT

const dbConfig = {
  user: process.env.DB_USER || 'postgres',           // Your PostgreSQL username (usually 'postgres')
  host: process.env.DB_HOST || 'localhost',          // Your PostgreSQL host
  database: process.env.DB_NAME || 'danieltime',     // Default database name
  password: process.env.DB_PASSWORD || 'postgres123',  // Your PostgreSQL password (set during installation)
  port: parseInt(process.env.DB_PORT) || 5432,       // PostgreSQL default port
  // Optional: connection pool settings
  max: 30,                    // Maximum number of clients in the pool (increased for batch operations)
  idleTimeoutMillis: 30000,   // Close idle clients after 30 seconds
  connectionTimeoutMillis: 15000, // Return an error after 15 seconds if connection could not be established
  statement_timeout: 30000,   // Maximum time a query can run (30 seconds)
  allowExitOnIdle: true,      // Allow pool to close when idle
};

// Replication configuration
// You can override these settings with environment variables:
// REPLICATION_ENABLED, REPLICATION_USER, REPLICATION_PASSWORD, 
// DB2_HOST, DB2_PORT, DB2_NAME, DB2_USER, DB2_PASSWORD,
// PUBLICATION_NAME, SUBSCRIPTION_NAME, CONFLICT_RESOLUTION

const replicationConfig = {
  // Enable/disable replication
  enabled: process.env.REPLICATION_ENABLED === 'true' || false,
  
  // Replication user credentials (dedicated user for replication)
  replicationUser: process.env.REPLICATION_USER || 'replication_user',
  replicationPassword: process.env.REPLICATION_PASSWORD || 'replication_password',
  
  // Primary database configuration (current database)
  primary: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'danieltime',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres123',
  },
  
  // Secondary database configuration (replica/peer database)
  secondary: {
    host: process.env.DB2_HOST || 'localhost',
    port: parseInt(process.env.DB2_PORT) || 5433,  // Different port for second DB
    database: process.env.DB2_NAME || 'danieltime',
    user: process.env.DB2_USER || 'postgres',
    password: process.env.DB2_PASSWORD || 'postgres123',
  },
  
  // Publication and subscription names
  publicationName: process.env.PUBLICATION_NAME || 'db_publication',
  subscriptionName: process.env.SUBSCRIPTION_NAME || 'db_subscription',
  
  // Conflict resolution strategy
  // Options: 'last_update_wins', 'first_update_wins', 'custom'
  conflictResolution: process.env.CONFLICT_RESOLUTION || 'last_update_wins',
  
  // Replication settings
  copyData: process.env.REPLICATION_COPY_DATA === 'true' || false,  // Copy existing data on subscription creation
  createSlot: process.env.REPLICATION_CREATE_SLOT === 'true' || true,  // Create replication slot automatically
  
  // Monitoring settings
  monitorLag: process.env.MONITOR_REPLICATION_LAG === 'true' || true,  // Monitor replication lag
  lagThreshold: parseInt(process.env.REPLICATION_LAG_THRESHOLD) || 1000,  // Alert if lag exceeds this (milliseconds)
};

// Deterministic UUID configuration
// UUID v5 namespace for the application (RFC 4122)
// This namespace UUID should remain constant across all deployments
const uuidConfig = {
  // Application namespace UUID for UUID v5 generation
  // This is a fixed UUID that identifies this application
  // Format: 6ba7b810-9dad-11d1-80b4-00c04fd430c8 (example - replace with your own)
  applicationNamespace: process.env.UUID_NAMESPACE || '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  
  // Enable deterministic UUID generation
  deterministicEnabled: process.env.DETERMINISTIC_UUID_ENABLED !== 'false',  // Default: true
};

module.exports = {
  db: dbConfig,
  replication: replicationConfig,
  uuid: uuidConfig,
}; 