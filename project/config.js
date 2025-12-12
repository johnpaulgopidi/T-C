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
  max: 20,                    // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,   // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
};

module.exports = dbConfig; 