const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL nao definida. Configure a conexao do banco no ambiente.');
}

const useSsl =
  /supabase\.co|pooler\.supabase\.com/i.test(connectionString) ||
  String(process.env.DB_SSL || '').toLowerCase() === 'true';

const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (error) => {
  console.error('[DB] Erro inesperado no pool:', error.message);
});

module.exports = pool;
