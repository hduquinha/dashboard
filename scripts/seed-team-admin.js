// Cria ou atualiza o usuario Administrador inicial em dashboard.team_members.
//
// Uso:
//   TEAM_ADMIN_EMAIL=foo@bar.com TEAM_ADMIN_PASSWORD=senha TEAM_ADMIN_NAME="Nome" \
//     node scripts/seed-team-admin.js
//
// Roda uma unica vez (idempotente: se o email ja existir, atualiza a senha/role/nome).

const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

const SUPER_MASTER_EMAILS = (process.env.DASHBOARD_SUPER_MASTER_EMAILS || "henrique@escolavozup.com")
  .split(/[,\n;]/)
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean);

async function main() {
  const email = (process.env.TEAM_ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.TEAM_ADMIN_PASSWORD || "";
  const name = (process.env.TEAM_ADMIN_NAME || "").trim() || "Administrador";

  if (!email || !password) {
    console.error("TEAM_ADMIN_EMAIL e TEAM_ADMIN_PASSWORD sao obrigatorios.");
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL nao configurada.");
    process.exit(1);
  }

  const sslDisabled = process.env.PG_SSL === "false";
  const pool = new Pool({
    connectionString,
    ssl: sslDisabled ? false : { rejectUnauthorized: false },
  });

  try {
    await pool.query(`
      CREATE SCHEMA IF NOT EXISTS dashboard;
      CREATE TABLE IF NOT EXISTS dashboard.team_members (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        active BOOLEAN NOT NULL DEFAULT true,
        priority_level INTEGER NOT NULL DEFAULT 0,
        permissions JSONB,
        instituto_up_only BOOLEAN NOT NULL DEFAULT false,
        distribution_position INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      ALTER TABLE dashboard.team_members
        ADD COLUMN IF NOT EXISTS priority_level INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS permissions JSONB,
        ADD COLUMN IF NOT EXISTS instituto_up_only BOOLEAN NOT NULL DEFAULT false;

      ALTER TABLE dashboard.team_members
        DROP CONSTRAINT IF EXISTS team_members_role_check;

      ALTER TABLE dashboard.team_members
        ADD CONSTRAINT team_members_role_check
        CHECK (role IN ('super_master', 'admin', 'member'));
    `);

    const passwordHash = await bcrypt.hash(password, 12);
    const role = SUPER_MASTER_EMAILS.includes(email) ? "super_master" : "admin";
    const priorityLevel = role === "super_master" ? 100 : 60;

    const { rows } = await pool.query(
      `INSERT INTO dashboard.team_members (email, name, password_hash, role, priority_level, active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name,
         password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role,
         priority_level = EXCLUDED.priority_level,
         active = true,
         updated_at = NOW()
       RETURNING id, email, name, role`,
      [email, name, passwordHash, role, priorityLevel]
    );

    console.log("Admin pronto:", rows[0]);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Falha ao criar admin:", error);
  process.exit(1);
});
