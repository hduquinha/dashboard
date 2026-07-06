import bcrypt from "bcryptjs";
import { getPool } from "@/lib/db";
import {
  DEFAULT_PRIORITY_BY_ROLE,
  defaultPermissionsForRole,
  effectivePermissionsForRole,
  normalizePermissionList,
  normalizeTeamRole,
  type PermissionKey,
  type TeamRole,
} from "@/lib/permissions";

const SCHEMA = "dashboard";
const BCRYPT_ROUNDS = 12;

export interface TeamMember {
  id: number;
  email: string;
  name: string;
  role: TeamRole;
  active: boolean;
  priorityLevel: number;
  permissions: PermissionKey[];
  distributionPosition: number;
  /** Quando true, a secao "Leads VozUP" fica oculta e /vozup bloqueado para este usuario. */
  institutoUpOnly: boolean;
  createdAt: string;
  updatedAt: string;
}

interface TeamMemberRow {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  role: TeamRole;
  active: boolean;
  priority_level: number;
  permissions: unknown;
  distribution_position: number;
  instituto_up_only: boolean;
  created_at: string;
  updated_at: string;
}

function mapRow(row: TeamMemberRow): TeamMember {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: normalizeTeamRole(row.role),
    active: row.active,
    priorityLevel: Number(row.priority_level) || DEFAULT_PRIORITY_BY_ROLE[normalizeTeamRole(row.role)],
    permissions: effectivePermissionsForRole(row.role, row.permissions, {
      institutoUpOnly: row.instituto_up_only,
    }),
    distributionPosition: row.distribution_position,
    institutoUpOnly: row.instituto_up_only,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function configuredSuperMasterEmails(): string[] {
  const configured = process.env.DASHBOARD_SUPER_MASTER_EMAILS?.trim();
  const raw = configured && configured.length > 0 ? configured : "henrique@escolavozup.com";
  return raw
    .split(/[,\n;]/)
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean);
}

let schemaReady = false;

export async function ensureTeamSchema(): Promise<void> {
  if (schemaReady) {
    return;
  }

  await getPool().query(`
    CREATE SCHEMA IF NOT EXISTS ${SCHEMA};

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.team_members (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      active BOOLEAN NOT NULL DEFAULT true,
      priority_level INTEGER NOT NULL DEFAULT 0,
      permissions JSONB,
      distribution_position INTEGER NOT NULL DEFAULT 0,
      instituto_up_only BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    ALTER TABLE ${SCHEMA}.team_members
      ADD COLUMN IF NOT EXISTS priority_level INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS permissions JSONB,
      ADD COLUMN IF NOT EXISTS instituto_up_only BOOLEAN NOT NULL DEFAULT false;

    ALTER TABLE ${SCHEMA}.team_members
      DROP CONSTRAINT IF EXISTS team_members_role_check;

    ALTER TABLE ${SCHEMA}.team_members
      ADD CONSTRAINT team_members_role_check
      CHECK (role IN ('super_master', 'admin', 'member'));

    CREATE INDEX IF NOT EXISTS idx_team_members_active ON ${SCHEMA}.team_members(active);
    CREATE INDEX IF NOT EXISTS idx_team_members_role ON ${SCHEMA}.team_members(role);
    CREATE INDEX IF NOT EXISTS idx_team_members_priority ON ${SCHEMA}.team_members(priority_level DESC);
  `);

  const superMasterEmails = configuredSuperMasterEmails();
  if (superMasterEmails.length > 0) {
    await getPool().query(
      `UPDATE ${SCHEMA}.team_members
       SET role = 'super_master',
           priority_level = GREATEST(priority_level, $2),
           updated_at = NOW()
       WHERE LOWER(email) = ANY($1::text[])`,
      [superMasterEmails, DEFAULT_PRIORITY_BY_ROLE.super_master]
    );
  }

  schemaReady = true;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function authenticateTeamMember(email: string, password: string): Promise<TeamMember | null> {
  await ensureTeamSchema();
  const { rows } = await getPool().query<TeamMemberRow>(
    `SELECT * FROM ${SCHEMA}.team_members WHERE email = $1 AND active = true LIMIT 1`,
    [normalizeEmail(email)]
  );
  const row = rows[0];
  if (!row) {
    return null;
  }

  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) {
    return null;
  }

  return mapRow(row);
}

export async function listTeamMembers(options: { activeOnly?: boolean } = {}): Promise<TeamMember[]> {
  await ensureTeamSchema();
  const where = options.activeOnly ? "WHERE active = true" : "";
  const { rows } = await getPool().query<TeamMemberRow>(
    `SELECT * FROM ${SCHEMA}.team_members ${where} ORDER BY name ASC`
  );
  return rows.map(mapRow);
}

export async function getTeamMemberById(id: number): Promise<TeamMember | null> {
  await ensureTeamSchema();
  const { rows } = await getPool().query<TeamMemberRow>(
    `SELECT * FROM ${SCHEMA}.team_members WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function getTeamMemberByEmail(email: string): Promise<TeamMember | null> {
  await ensureTeamSchema();
  const { rows } = await getPool().query<TeamMemberRow>(
    `SELECT * FROM ${SCHEMA}.team_members WHERE email = $1 LIMIT 1`,
    [normalizeEmail(email)]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export interface CreateTeamMemberInput {
  email: string;
  name: string;
  password: string;
  role: TeamRole;
  priorityLevel?: number;
  permissions?: PermissionKey[];
  institutoUpOnly?: boolean;
}

export async function createTeamMember(input: CreateTeamMemberInput): Promise<TeamMember> {
  await ensureTeamSchema();
  const role = normalizeTeamRole(input.role);
  const permissions = input.permissions
    ? normalizePermissionList(input.permissions)
    : defaultPermissionsForRole(role, { institutoUpOnly: input.institutoUpOnly ?? false });
  const priorityLevel = Number.isFinite(input.priorityLevel)
    ? Number(input.priorityLevel)
    : DEFAULT_PRIORITY_BY_ROLE[role];
  const passwordHash = await hashPassword(input.password);
  const { rows } = await getPool().query<TeamMemberRow>(
    `INSERT INTO ${SCHEMA}.team_members (
       email, name, password_hash, role, priority_level, permissions, instituto_up_only
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     RETURNING *`,
    [
      normalizeEmail(input.email),
      input.name.trim(),
      passwordHash,
      role,
      priorityLevel,
      JSON.stringify(permissions),
      input.institutoUpOnly ?? false,
    ]
  );
  return mapRow(rows[0]);
}

export interface UpdateTeamMemberInput {
  name?: string;
  role?: TeamRole;
  active?: boolean;
  password?: string;
  priorityLevel?: number;
  permissions?: PermissionKey[];
  distributionPosition?: number;
  institutoUpOnly?: boolean;
}

export async function updateTeamMember(id: number, input: UpdateTeamMemberInput): Promise<TeamMember> {
  await ensureTeamSchema();

  const sets: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) {
    values.push(input.name.trim());
    sets.push(`name = $${values.length}`);
  }
  if (input.role !== undefined) {
    values.push(normalizeTeamRole(input.role));
    sets.push(`role = $${values.length}`);
  }
  if (input.active !== undefined) {
    values.push(input.active);
    sets.push(`active = $${values.length}`);
  }
  if (input.distributionPosition !== undefined) {
    values.push(input.distributionPosition);
    sets.push(`distribution_position = $${values.length}`);
  }
  if (input.priorityLevel !== undefined) {
    values.push(input.priorityLevel);
    sets.push(`priority_level = $${values.length}`);
  }
  if (input.permissions !== undefined) {
    values.push(JSON.stringify(normalizePermissionList(input.permissions)));
    sets.push(`permissions = $${values.length}::jsonb`);
  }
  if (input.institutoUpOnly !== undefined) {
    values.push(input.institutoUpOnly);
    sets.push(`instituto_up_only = $${values.length}`);
  }
  if (input.password !== undefined) {
    values.push(await hashPassword(input.password));
    sets.push(`password_hash = $${values.length}`);
  }

  if (sets.length === 0) {
    const existing = await getTeamMemberById(id);
    if (!existing) {
      throw new Error("Integrante da equipe nao encontrado.");
    }
    return existing;
  }

  sets.push(`updated_at = NOW()`);
  values.push(id);

  const { rows } = await getPool().query<TeamMemberRow>(
    `UPDATE ${SCHEMA}.team_members SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
    values
  );

  if (!rows[0]) {
    throw new Error("Integrante da equipe nao encontrado.");
  }

  return mapRow(rows[0]);
}
