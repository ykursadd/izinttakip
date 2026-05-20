import dotenv from 'dotenv';
import pkg from 'pg';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();
const { Pool } = pkg;

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME || 'izinttakip',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    };

const pool = new Pool(poolConfig);

export async function query(text, params = []) {
  return pool.query(text, params);
}

export async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      department TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      photo_url TEXT,
      leave_balance INTEGER NOT NULL DEFAULT 0,
      graduation TEXT,
      start_date TEXT,
      phone TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS leaves (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      type TEXT,
      start_date TEXT,
      end_date TEXT,
      reason TEXT,
      report_id TEXT,
      report_name TEXT,
      report_path TEXT,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      approvals JSONB NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS health_reports (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      path TEXT NOT NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const result = await query('SELECT count(*) FROM users');
  if (Number(result.rows[0].count) === 0) {
    const users = [
      {
        id: 'u1',
        name: 'Ahmet Yılmaz',
        role: 'operator',
        department: 'Cam Kesim',
        email: 'ahmet.yilmaz@fabrikam.com',
        password: 'Password123!',
        photoUrl: null,
        leaveBalance: 14
      },
      {
        id: 'u2',
        name: 'Merve Demir',
        role: 'supervisor',
        department: 'Kalite',
        email: 'merve.demir@fabrikam.com',
        password: 'Supervisor123!',
        photoUrl: null,
        leaveBalance: 18
      },
      {
        id: 'u3',
        name: 'Emre Şahin',
        role: 'manager',
        department: 'Üretim',
        email: 'emre.sahin@fabrikam.com',
        password: 'Manager123!',
        photoUrl: null,
        leaveBalance: 21
      }
    ];

    for (const user of users) {
      await query(
        `INSERT INTO users (id, name, role, department, email, password_hash, photo_url, leave_balance)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)` ,
        [
          user.id,
          user.name,
          user.role,
          user.department,
          user.email,
          bcrypt.hashSync(user.password, 10),
          user.photoUrl,
          user.leaveBalance
        ]
      );
    }
  }
}

export default pool;
