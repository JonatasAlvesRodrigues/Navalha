const { Pool } = require('pg');
require('dotenv').config();

const fallbackDatabaseUrl = 'postgresql://postgres@localhost:5432/barbearia';
const connectionString = process.env.DATABASE_URL || fallbackDatabaseUrl;

const pool = new Pool({
  connectionString,
});

pool.on('error', (error) => {
  console.error('[DB] Erro inesperado no pool:', error.message);
});

module.exports = pool;
