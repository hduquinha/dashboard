import { getPool, listInscricoesByIds } from "@/lib/db";
import { ACADEMIC_SCHEMA as SCHEMA, ensureAcademicSchema } from "@/lib/academicSchema";
import { SALE_STAGE_KEY } from "@/lib/saleStage";
import {
  DEFAULT_ACADEMIC_REGISTRATION_RULES,
  isValidCpf,
  normalizeCpf,
  summarizeRoster,
  validateStudentRegistration,
} from "@/lib/academicRules";
import type { PoolClient } from "pg";
import { parsePayload } from "@/lib/parsePayload";
import type { ContractGuardian, ContractStudentProfile } from "@/lib/contractProfile";
export {
  ALLOCATION_LABELS,
  ageOn,
  allocationState,
  formatCpf,
  isValidCpf,
  normalizeCpf,
  requiresGuardian,
  summarizeRoster,
  type AllocationState,
} from "@/lib/academicRules";

import type {
  AcademicGuardian,
  AcademicGuardianInput,
  AcademicRosterSummary,
  AcademicRegistrationRules,
  AcademicStudent,
  AcademicStudentClass,
  AcademicStudentFilters,
  AcademicStudentInput,
  AcademicStudentCandidate,
  AcademicUnlinkedEnrollment,
  StudentStatus,
} from "@/types/academic";

/**
 * Cadastro de aluno matriculado e responsável legal.
 *
 * A distinção que o `inscricoes_v2` errou e que aqui é regra: **aluno é cadastro**
 * (uma linha por pessoa, corrigível ao longo do tempo), **envio de formulário é
 * evento** (uma linha por envio, imutável, em `inscricoes.inscricoes`). Por isso o
 * aluno guarda `lead_inscricao_id` apontando para o evento de origem em vez de tentar
 * ser os dois ao mesmo tempo.
 */

/* ── Persistência ────────────────────────────────────────────────────────── */

interface StudentRow {
  id: string | number;
  full_name: string;
  cpf: string | null;
  birth_date: Date | string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  status: string;
  guardian_id: string | number | null;
  lead_inscricao_id: string | number | null;
  notes: string | null;
  created_by_name: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  guardian_full_name: string | null;
  guardian_cpf: string | null;
  guardian_email: string | null;
  guardian_phone: string | null;
  guardian_relationship: string | null;
  guardian_birth_date: Date | string | null;
  guardian_notes: string | null;
  guardian_created_at: Date | string | null;
  guardian_updated_at: Date | string | null;
  contracts_count: string | number;
  classes: unknown;
}

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function isoStamp(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString();
  return typeof value === "string" ? value : value.toISOString();
}

function normalizeStatus(value: unknown): StudentStatus {
  return value === "inativo" || value === "trancado" || value === "concluido" ? value : "ativo";
}

function cleanText(value: unknown, max = 240): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text.slice(0, max) : null;
}

function studentFromRow(row: StudentRow): AcademicStudent {
  const guardian: AcademicGuardian | null = row.guardian_id
    ? {
        id: Number(row.guardian_id),
        fullName: row.guardian_full_name ?? "",
        cpf: row.guardian_cpf,
        email: row.guardian_email,
        phone: row.guardian_phone,
        relationship: row.guardian_relationship,
        birthDate: isoDate(row.guardian_birth_date),
        notes: row.guardian_notes,
        createdAt: isoStamp(row.guardian_created_at),
        updatedAt: isoStamp(row.guardian_updated_at),
      }
    : null;

  const classes: AcademicStudentClass[] = Array.isArray(row.classes)
    ? (row.classes as Array<Record<string, unknown>>).map((item) => ({
        linkId: Number(item.link_id),
        classId: Number(item.class_id),
        className: String(item.class_name ?? ""),
        status: (item.status as AcademicStudentClass["status"]) ?? "ativa",
        startDate: isoDate(item.start_date as string | null),
        endDate: isoDate(item.end_date as string | null),
        financeEnrollmentId:
          item.finance_enrollment_id === null || item.finance_enrollment_id === undefined
            ? null
            : Number(item.finance_enrollment_id),
      }))
    : [];

  return {
    id: Number(row.id),
    fullName: row.full_name,
    cpf: row.cpf,
    birthDate: isoDate(row.birth_date),
    email: row.email,
    phone: row.phone,
    city: row.city,
    status: normalizeStatus(row.status),
    guardianId: row.guardian_id === null ? null : Number(row.guardian_id),
    guardian,
    leadInscricaoId: row.lead_inscricao_id === null ? null : Number(row.lead_inscricao_id),
    notes: row.notes,
    createdByName: row.created_by_name,
    createdAt: isoStamp(row.created_at),
    updatedAt: isoStamp(row.updated_at),
    classes,
    contractsCount: Number(row.contracts_count) || 0,
  };
}

const STUDENT_SELECT = `
  SELECT s.id, s.full_name, s.cpf, s.birth_date, s.email, s.phone, s.city, s.status,
         s.guardian_id, s.lead_inscricao_id, s.notes, s.created_by_name,
         s.created_at, s.updated_at,
         g.full_name AS guardian_full_name, g.cpf AS guardian_cpf, g.email AS guardian_email,
         g.phone AS guardian_phone, g.relationship AS guardian_relationship,
         g.birth_date AS guardian_birth_date, g.notes AS guardian_notes,
         g.created_at AS guardian_created_at, g.updated_at AS guardian_updated_at,
         COALESCE(contracts.total, 0) AS contracts_count,
         COALESCE(turmas.items, '[]'::jsonb) AS classes
  FROM ${SCHEMA}.academic_students s
  LEFT JOIN ${SCHEMA}.academic_guardians g ON g.id = s.guardian_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS total
    FROM ${SCHEMA}.finance_enrollments fe
    WHERE fe.student_id = s.id
  ) contracts ON TRUE
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
             'link_id', cs.id,
             'class_id', c.id,
             'class_name', c.name,
             'status', cs.status,
             'start_date', cs.start_date,
             'end_date', cs.end_date,
             'finance_enrollment_id', cs.finance_enrollment_id
           ) ORDER BY cs.created_at DESC) AS items
    FROM ${SCHEMA}.academic_class_students cs
    JOIN ${SCHEMA}.academic_classes c ON c.id = cs.class_id
    WHERE cs.student_id = s.id
  ) turmas ON TRUE
`;

export async function listStudents(filters: AcademicStudentFilters = {}): Promise<AcademicStudent[]> {
  await ensureAcademicSchema();

  const conditions: string[] = [];
  const values: unknown[] = [];

  const search = cleanText(filters.search, 120);
  if (search) {
    values.push(`%${search}%`);
    values.push(`%${normalizeCpf(search) ?? search}%`);
    conditions.push(
      `(s.full_name ILIKE $${values.length - 1} OR s.email ILIKE $${values.length - 1}
        OR s.phone ILIKE $${values.length - 1} OR COALESCE(s.cpf,'') ILIKE $${values.length})`
    );
  }

  if (filters.status) {
    values.push(filters.status);
    conditions.push(`s.status = $${values.length}`);
  }

  if (filters.classId) {
    values.push(filters.classId);
    conditions.push(
      `EXISTS (SELECT 1 FROM ${SCHEMA}.academic_class_students cs
               WHERE cs.student_id = s.id AND cs.class_id = $${values.length} AND cs.status = 'ativa')`
    );
  }

  if (filters.flag === "sem_turma") {
    conditions.push(
      `NOT EXISTS (SELECT 1 FROM ${SCHEMA}.academic_class_students cs
                   WHERE cs.student_id = s.id AND cs.status = 'ativa')
       AND EXISTS (SELECT 1 FROM ${SCHEMA}.finance_enrollments fe
                   WHERE fe.student_id = s.id)`
    );
  } else if (filters.flag === "sem_lead") {
    conditions.push("s.lead_inscricao_id IS NULL");
  } else if (filters.flag === "menor_sem_responsavel") {
    // 18 anos em dias é aproximação boa o suficiente para um filtro de tela; a regra
    // exata (requiresGuardian) roda no servidor ao salvar.
    conditions.push("s.guardian_id IS NULL AND s.birth_date IS NOT NULL AND s.birth_date > (CURRENT_DATE - INTERVAL '18 years')");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await getPool().query<StudentRow>(
    `${STUDENT_SELECT} ${where} ORDER BY s.full_name ASC LIMIT 500`,
    values
  );
  return rows.map(studentFromRow);
}

export async function getStudentById(id: number): Promise<AcademicStudent | null> {
  await ensureAcademicSchema();
  const { rows } = await getPool().query<StudentRow>(`${STUDENT_SELECT} WHERE s.id = $1`, [id]);
  return rows[0] ? studentFromRow(rows[0]) : null;
}

async function upsertGuardian(client: PoolClient, input: AcademicGuardianInput): Promise<number> {
  const cpf = normalizeCpf(input.cpf);
  if (!isValidCpf(cpf)) {
    throw new Error("CPF do responsável é inválido.");
  }
  const name = cleanText(input.fullName);
  if (!name) {
    throw new Error("Informe o nome do responsável.");
  }

  // Irmãos na mesma escola compartilham responsável: casar por CPF evita criar dois
  // cadastros da mesma pessoa e manter o contrato preso ao errado.
  if (cpf) {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM ${SCHEMA}.academic_guardians WHERE cpf = $1 LIMIT 1`,
      [cpf]
    );
    if (existing.rows[0]) {
      const id = Number(existing.rows[0].id);
      await client.query(
        `UPDATE ${SCHEMA}.academic_guardians
         SET full_name = $2,
             email = COALESCE($3, email),
             phone = COALESCE($4, phone),
             relationship = COALESCE($5, relationship),
             birth_date = COALESCE($6, birth_date),
             notes = COALESCE($7, notes),
             updated_at = NOW()
         WHERE id = $1`,
        [
          id,
          name,
          cleanText(input.email),
          cleanText(input.phone),
          cleanText(input.relationship, 60),
          input.birthDate ?? null,
          cleanText(input.notes, 1000),
        ]
      );
      return id;
    }
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO ${SCHEMA}.academic_guardians (full_name, cpf, email, phone, relationship, birth_date, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      name,
      cpf,
      cleanText(input.email),
      cleanText(input.phone),
      cleanText(input.relationship, 60),
      input.birthDate ?? null,
      cleanText(input.notes, 1000),
    ]
  );
  return Number(inserted.rows[0].id);
}

async function insertStudent(
  client: PoolClient,
  input: AcademicStudentInput,
  actor: { id?: number | null; name?: string | null }
): Promise<number> {
  const cpf = normalizeCpf(input.cpf);
  if (cpf) {
    const clash = await client.query<{ id: string; full_name: string }>(
      `SELECT id, full_name FROM ${SCHEMA}.academic_students WHERE cpf = $1 LIMIT 1`,
      [cpf]
    );
    if (clash.rows[0]) {
      throw new Error(`Já existe aluno com este CPF: ${clash.rows[0].full_name}.`);
    }
  }

  const guardianId = input.guardian
    ? await upsertGuardian(client, input.guardian)
    : input.guardianId ?? null;

  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO ${SCHEMA}.academic_students
       (full_name, cpf, birth_date, email, phone, city, status, guardian_id,
        lead_inscricao_id, notes, created_by_user_id, created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id`,
    [
      cleanText(input.fullName),
      cpf,
      input.birthDate || null,
      cleanText(input.email),
      cleanText(input.phone, 40),
      cleanText(input.city, 120),
      normalizeStatus(input.status),
      guardianId,
      input.leadInscricaoId ?? null,
      cleanText(input.notes, 2000),
      actor.id ?? null,
      actor.name ?? null,
    ]
  );
  return Number(rows[0].id);
}

/**
 * Liga um contrato legado/recém-fechado ao cadastro criado na mesma transação.
 *
 * O lock impede duas pessoas de abrirem a mesma pendência e criarem dois alunos. Se
 * a secretaria escolheu um lead para uma matrícula antiga sem `lead_inscricao_id`,
 * esse é o momento em que o vínculo deixa de ser palpite por nome e passa a ser uma
 * decisão humana registrada no contrato.
 */
async function attachEnrollmentToStudent(
  client: PoolClient,
  enrollmentId: number | null | undefined,
  studentId: number,
  leadInscricaoId: number | null
): Promise<void> {
  if (!enrollmentId) return;

  const enrollment = await client.query<{
    id: string;
    student_id: string | null;
    lead_inscricao_id: string | null;
  }>(
    `SELECT id, student_id, lead_inscricao_id
     FROM ${SCHEMA}.finance_enrollments
     WHERE id = $1
     FOR UPDATE`,
    [enrollmentId]
  );
  const row = enrollment.rows[0];
  if (!row) throw new Error("Contrato financeiro não encontrado.");

  const currentStudentId = row.student_id === null ? null : Number(row.student_id);
  if (currentStudentId !== null && currentStudentId !== studentId) {
    throw new Error("Este contrato já foi vinculado a outro aluno.");
  }

  const currentLeadId = row.lead_inscricao_id === null ? null : Number(row.lead_inscricao_id);
  if (currentLeadId !== null && leadInscricaoId === null) {
    throw new Error("Este contrato já tem um lead de origem; use esse lead para criar o aluno.");
  }
  if (currentLeadId !== null && leadInscricaoId !== null && currentLeadId !== leadInscricaoId) {
    throw new Error("O lead escolhido não é o mesmo que já está vinculado a este contrato.");
  }

  await client.query(
    `UPDATE ${SCHEMA}.finance_enrollments
     SET student_id = $2,
         lead_inscricao_id = COALESCE(lead_inscricao_id, $3)
     WHERE id = $1`,
    [enrollmentId, studentId, leadInscricaoId]
  );
}

function assertStudentInput(input: AcademicStudentInput, rules: AcademicRegistrationRules): void {
  if (!cleanText(input.fullName)) {
    throw new Error("Informe o nome do aluno.");
  }
  if (!isValidCpf(input.cpf)) {
    throw new Error("CPF do aluno é inválido.");
  }
  const registrationError = validateStudentRegistration(input, rules);
  if (registrationError) throw new Error(registrationError);
}

const REGISTRATION_RULES_KEY = "registration_rules";

function normalizeRegistrationRules(value: unknown): AcademicRegistrationRules {
  const stored = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(
    Object.entries(DEFAULT_ACADEMIC_REGISTRATION_RULES).map(([key, fallback]) => [
      key,
      typeof stored[key] === "boolean" ? stored[key] : fallback,
    ])
  ) as unknown as AcademicRegistrationRules;
}

export async function getAcademicRegistrationRules(): Promise<AcademicRegistrationRules> {
  await ensureAcademicSchema();
  const { rows } = await getPool().query<{ value: unknown }>(
    `SELECT value FROM ${SCHEMA}.academic_settings WHERE key = $1`,
    [REGISTRATION_RULES_KEY]
  );
  return normalizeRegistrationRules(rows[0]?.value);
}

export async function updateAcademicRegistrationRules(
  input: Partial<AcademicRegistrationRules>
): Promise<AcademicRegistrationRules> {
  await ensureAcademicSchema();
  const current = await getAcademicRegistrationRules();
  const next = normalizeRegistrationRules({ ...current, ...input });
  await getPool().query(
    `INSERT INTO ${SCHEMA}.academic_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [REGISTRATION_RULES_KEY, JSON.stringify(next)]
  );
  return next;
}

export async function createStudent(
  input: AcademicStudentInput,
  actor: { id?: number | null; name?: string | null } = {},
  financeEnrollmentId?: number | null
): Promise<number> {
  await ensureAcademicSchema();
  const rules = await getAcademicRegistrationRules();
  assertStudentInput(input, rules);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const id = await insertStudent(client, input, actor);
    await attachEnrollmentToStudent(client, financeEnrollmentId, id, input.leadInscricaoId ?? null);
    await client.query("COMMIT");
    return id;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function updateStudent(id: number, input: AcademicStudentInput): Promise<void> {
  await ensureAcademicSchema();
  const rules = await getAcademicRegistrationRules();
  assertStudentInput(input, rules);

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const cpf = normalizeCpf(input.cpf);
    if (cpf) {
      const clash = await client.query<{ id: string }>(
        `SELECT id FROM ${SCHEMA}.academic_students WHERE cpf = $1 AND id <> $2 LIMIT 1`,
        [cpf, id]
      );
      if (clash.rows[0]) throw new Error("Já existe outro aluno com este CPF.");
    }

    const guardianId = input.guardian
      ? await upsertGuardian(client, input.guardian)
      : input.guardianId ?? null;
    const updated = await client.query(
      `UPDATE ${SCHEMA}.academic_students
       SET full_name = $2, cpf = $3, birth_date = $4, email = $5, phone = $6, city = $7,
           status = $8, guardian_id = $9, notes = $10, updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [
        id,
        cleanText(input.fullName),
        cpf,
        input.birthDate || null,
        cleanText(input.email),
        cleanText(input.phone, 40),
        cleanText(input.city, 120),
        normalizeStatus(input.status),
        guardianId,
        cleanText(input.notes, 2000),
      ]
    );
    if (updated.rowCount === 0) throw new Error("Aluno não encontrado.");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteStudent(id: number): Promise<void> {
  await ensureAcademicSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const contracts = await client.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM ${SCHEMA}.finance_enrollments WHERE student_id = $1`,
      [id]
    );
    if (Number(contracts.rows[0]?.total ?? "0") > 0) {
      throw new Error("Este aluno tem contrato no Financeiro. Desvincule o contrato antes de excluir.");
    }

    await client.query(`DELETE FROM ${SCHEMA}.academic_class_students WHERE student_id = $1`, [id]);
    const removed = await client.query(`DELETE FROM ${SCHEMA}.academic_students WHERE id = $1 RETURNING id`, [id]);
    if (removed.rowCount === 0) throw new Error("Aluno não encontrado.");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * O lead já fechou negócio?
 *
 * Vale o estado de AGORA, não o histórico: mover o card para Fechado e voltar é
 * rotina (negociação que não fechou, repique), e há lead que passou quatro vezes
 * por lá e hoje está em Desinteresse — contar o histórico ofereceria essa gente
 * como candidata a aluno. Conta: estar em Fechado; ter avançado para a etapa
 * `won` (pós-venda, "Follow-Up" no Funil VozUP), que só se alcança fechando; ou
 * ter matrícula no Financeiro, caso a venda exista sem o card ter sido movido.
 */
async function leadReachedSale(inscricaoId: number): Promise<boolean> {
  const { rows } = await getPool().query<{ fechou: boolean }>(
    `
      SELECT (
        EXISTS (
          SELECT 1
          FROM ${SCHEMA}.commercial_leads cl
          LEFT JOIN ${SCHEMA}.funnel_stages fs
            ON fs.funnel_id = cl.funnel_id AND fs.key = cl.commercial_stage
          LEFT JOIN ${SCHEMA}.funnels f ON f.id = cl.funnel_id
          WHERE cl.inscricao_id = $1
            AND COALESCE(f.is_triage, false) = false
            AND (cl.commercial_stage = $2 OR fs.kind = 'won')
        )
        OR EXISTS (
          SELECT 1 FROM ${SCHEMA}.finance_enrollments fe
          WHERE fe.lead_inscricao_id = $1
        )
      ) AS fechou
    `,
    [inscricaoId, SALE_STAGE_KEY]
  );
  return rows[0]?.fechou ?? false;
}

/**
 * Converte um lead do CRM em aluno, herdando o que já está no payload.
 *
 * **A ficha de aluno nasce depois da venda, nunca antes.** Regra da operação: o
 * lead vira aluno quando chega em "Fechado" — é nesse momento que a secretaria
 * coleta CPF e e-mail (obrigatórios para emitir cobrança). Converter lead de topo
 * de funil encheria o cadastro de gente que ainda não comprou, e é por isso que
 * 94% dos leads da base não têm CPF: os formulários de captação não pedem.
 *
 * Quem precisa cadastrar alguém que nunca passou pelo funil (aluno antigo,
 * indicação direta) usa o cadastro direto, que não exige lead.
 *
 * O vínculo (`lead_inscricao_id`) é a razão de existir desta função: sem ele, a
 * jornada lead → aluno → mensalidade só poderia ser remontada por nome, que é o
 * mesmo palpite que hoje limita o relatório de mídia paga.
 */
export async function createStudentFromLead(
  inscricaoId: number,
  actor: { id?: number | null; name?: string | null } = {},
  overrides: Partial<AcademicStudentInput> = {},
  financeEnrollmentId?: number | null
): Promise<number> {
  await ensureAcademicSchema();

  const lead = (await listInscricoesByIds([inscricaoId]))[0];
  if (!lead) {
    throw new Error("Lead não encontrado.");
  }

  if (!(await leadReachedSale(inscricaoId))) {
    throw new Error(
      "Este lead ainda não chegou na etapa \"Fechado\" e não tem venda registrada. A ficha de aluno nasce depois do fechamento — se for um aluno que não veio do funil, use o cadastro direto."
    );
  }

  const payload = (lead.payload ?? {}) as Record<string, unknown>;
  const parsedPayload = parsePayload(payload);
  const payloadCpf = normalizeCpf(payload.cpf ?? payload.documento ?? payload.document);

  const input: AcademicStudentInput = {
    fullName: cleanText(overrides.fullName) ?? lead.nome ?? "Sem nome",
    cpf: normalizeCpf(overrides.cpf) ?? payloadCpf,
    birthDate: overrides.birthDate || parsedPayload.data_nascimento || null,
    email: cleanText(overrides.email) ?? parsedPayload.email ?? null,
    phone: cleanText(overrides.phone, 40) ?? lead.telefone,
    city: cleanText(overrides.city, 120) ?? lead.cidade,
    status: overrides.status ?? "ativo",
    guardian: overrides.guardian ?? null,
    guardianId: overrides.guardianId ?? null,
    leadInscricaoId: inscricaoId,
    notes: overrides.notes ?? null,
  };
  const rules = await getAcademicRegistrationRules();
  assertStudentInput(input, rules);

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ id: string; full_name: string }>(
      `SELECT id, full_name FROM ${SCHEMA}.academic_students WHERE lead_inscricao_id = $1 LIMIT 1`,
      [inscricaoId]
    );
    if (existing.rows[0]) {
      throw new Error(`Este lead já virou aluno: ${existing.rows[0].full_name}.`);
    }

    const id = await insertStudent(client, input, actor);
    await attachEnrollmentToStudent(client, financeEnrollmentId, id, inscricaoId);
    // Se a venda foi registrada antes de a secretaria abrir a ficha acadêmica,
    // o vínculo duro é recuperado pelo mesmo lead_id — nunca por nome.
    await client.query(
      `UPDATE ${SCHEMA}.finance_enrollments
       SET student_id = $1
       WHERE lead_inscricao_id = $2 AND student_id IS NULL`,
      [id, inscricaoId]
    );
    await client.query("COMMIT");
    return id;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Leads prontos para virar aluno: fecharam negócio e ainda não têm ficha.
 *
 * Substitui a busca livre por qualquer lead do CRM. Buscar no funil inteiro
 * convidava a converter gente de topo — que não tem CPF nem comprou — e a
 * tentativa só falhava no "Salvar", depois de a secretaria já ter digitado tudo.
 */
export async function listStudentCandidates(search?: string): Promise<AcademicStudentCandidate[]> {
  await ensureAcademicSchema();

  const term = cleanText(search, 120);
  const values: unknown[] = [SALE_STAGE_KEY];
  let searchClause = "";
  if (term) {
    values.push(`%${term}%`);
    values.push(`%${normalizeCpf(term) ?? term}%`);
    searchClause = `AND (
      COALESCE(i.payload->>'nome', i.payload->>'name', '') ILIKE $${values.length - 1}
      OR COALESCE(i.payload->>'telefone', i.payload->>'phone', '') ILIKE $${values.length - 1}
      OR COALESCE(i.payload->>'cpf', '') ILIKE $${values.length}
    )`;
  }

  const { rows } = await getPool().query<{
    id: string;
    nome: string | null;
    telefone: string | null;
    email: string | null;
    cpf: string | null;
    stage_label: string | null;
    enrollment_id: string | null;
    course_name: string | null;
    closed_at: Date | string | null;
  }>(
    `
      SELECT i.id,
             NULLIF(TRIM(COALESCE(i.payload->>'nome', i.payload->>'name', '')), '') AS nome,
             NULLIF(TRIM(COALESCE(i.payload->>'telefone', i.payload->>'phone', '')), '') AS telefone,
             NULLIF(TRIM(COALESCE(i.payload->>'email', '')), '') AS email,
             NULLIF(TRIM(COALESCE(i.payload->>'cpf', i.payload->>'documento', '')), '') AS cpf,
             fs.label AS stage_label,
             fe.id AS enrollment_id,
             fc.name AS course_name,
             cl.closed_at
      FROM inscricoes.inscricoes i
      LEFT JOIN ${SCHEMA}.commercial_leads cl ON cl.inscricao_id = i.id
      LEFT JOIN ${SCHEMA}.funnel_stages fs
        ON fs.funnel_id = cl.funnel_id AND fs.key = cl.commercial_stage
      LEFT JOIN ${SCHEMA}.funnels f ON f.id = cl.funnel_id
      LEFT JOIN ${SCHEMA}.finance_enrollments fe
        ON fe.lead_inscricao_id = i.id AND fe.student_id IS NULL
      LEFT JOIN ${SCHEMA}.finance_courses fc ON fc.id = fe.course_id
      WHERE COALESCE(i.payload->>'dashboard_excluido', '') <> 'true'
        AND COALESCE(i.payload->>'dashboard_merged_into', '') = ''
        AND NOT EXISTS (
          SELECT 1 FROM ${SCHEMA}.academic_students s WHERE s.lead_inscricao_id = i.id
        )
        -- "Passou por Fechado alguma vez" seria sinal fraco demais: mover o card
        -- para Fechado e voltar é rotina (negociação que não fechou, repique) —
        -- há lead que passou 4 vezes e hoje está em Desinteresse. Vale o estado
        -- de agora: está em Fechado, ou fechou e avançou para o pós-venda
        -- (etapa kind=won, que no Funil VozUP se chama "Follow-Up"), ou tem venda
        -- registrada no Financeiro. E vale só em FUNIL DE TRABALHO: o funil de
        -- Triagem tem uma etapa kind=won chamada "Qualificado", que significa
        -- "o contato presta", não "comprou" — sem este corte, lista fria
        -- qualificada aparecia como candidata a aluno.
        AND (
          (COALESCE(f.is_triage, false) = false AND (cl.commercial_stage = $1 OR fs.kind = 'won'))
          OR fe.id IS NOT NULL
        )
        ${searchClause}
      ORDER BY cl.closed_at DESC NULLS LAST, i.criado_em DESC
      LIMIT 50
    `,
    values
  );

  return rows.map((row) => ({
    inscricaoId: Number(row.id),
    name: row.nome,
    phone: row.telefone,
    email: row.email,
    cpf: normalizeCpf(row.cpf),
    stageLabel: row.stage_label,
    enrollmentId: row.enrollment_id === null ? null : Number(row.enrollment_id),
    courseName: row.course_name,
  }));
}

/** Contratos que ainda precisam virar (ou ser ligados a) um aluno acadêmico. */
export async function listUnlinkedAcademicEnrollments(): Promise<AcademicUnlinkedEnrollment[]> {
  await ensureAcademicSchema();
  const { rows } = await getPool().query<{
    id: string;
    student: string;
    course_name: string | null;
    sale_date: Date | string;
    lead_inscricao_id: string | null;
  }>(
    `SELECT fe.id, fe.student, fc.name AS course_name, fe.sale_date, fe.lead_inscricao_id
     FROM ${SCHEMA}.finance_enrollments fe
     LEFT JOIN ${SCHEMA}.finance_courses fc ON fc.id = fe.course_id
     WHERE fe.student_id IS NULL
     ORDER BY fe.sale_date ASC, fe.id ASC`
  );

  const leadIds = rows
    .map((row) => (row.lead_inscricao_id === null ? null : Number(row.lead_inscricao_id)))
    .filter((id): id is number => id !== null && Number.isFinite(id));
  const leads = leadIds.length > 0 ? await listInscricoesByIds(leadIds) : [];
  const leadsById = new Map(leads.map((lead) => [lead.id, lead]));

  return rows.map((row) => {
    const leadId = row.lead_inscricao_id === null ? null : Number(row.lead_inscricao_id);
    const lead = leadId === null ? null : leadsById.get(leadId) ?? null;
    return {
      id: Number(row.id),
      studentName: row.student,
      courseName: row.course_name,
      saleDate: isoDate(row.sale_date) ?? "",
      leadInscricaoId: leadId,
      leadName: lead?.nome ?? null,
      leadPhone: lead?.telefone ?? null,
    };
  });
}

/** Resumo de alunos por turma, com a linha própria de "aguardando alocação". */
export async function getRosterSummary(): Promise<AcademicRosterSummary> {
  await ensureAcademicSchema();
  const { rows } = await getPool().query<{
    id: string;
    contracts_count: number;
    classes: unknown;
  }>(
    `SELECT s.id,
            COUNT(DISTINCT fe.id)::int AS contracts_count,
            COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
              'classId', c.id,
              'className', c.name,
              'status', cs.status
            )) FILTER (WHERE c.id IS NOT NULL), '[]'::jsonb) AS classes
     FROM ${SCHEMA}.academic_students s
     LEFT JOIN ${SCHEMA}.finance_enrollments fe ON fe.student_id = s.id
     LEFT JOIN ${SCHEMA}.academic_class_students cs ON cs.student_id = s.id
     LEFT JOIN ${SCHEMA}.academic_classes c ON c.id = cs.class_id
     GROUP BY s.id`
  );

  // O resumo não reutiliza listStudents(): a tela limita a listagem a 500 linhas,
  // enquanto um relatório precisa continuar fechando quando a escola passar disso.
  return summarizeRoster(
    rows.map((row) => ({
      contractsCount: Number(row.contracts_count) || 0,
      classes: Array.isArray(row.classes)
        ? (row.classes as Array<Record<string, unknown>>).map((item) => ({
            classId: Number(item.classId),
            className: String(item.className ?? ""),
            status: String(item.status ?? ""),
          }))
        : [],
    }))
  );
}


/**
 * Cria ou atualiza a ficha do aluno com o quadro do contrato, na hora da venda.
 *
 * Fica separado de `createStudentFromLead` porque aqui a venda está sendo
 * registrada **agora**: exigir que o lead já esteja fechado (a checagem que
 * aquela função faz) seria uma corrida contra o próprio fluxo. E é upsert de
 * verdade — o vendedor pode corrigir a venda depois, e a segunda passada tem
 * que atualizar a ficha, não estourar "este lead já virou aluno".
 *
 * Só sobrescreve campo que veio preenchido: quem já tem endereço cadastrado
 * pela secretaria não perde o endereço porque o vendedor deixou em branco.
 */
export async function upsertStudentContractProfile(
  /**
   * Lead de origem, quando existe. `null` é a segunda pessoa de um contrato de
   * casal: ela entra pela venda, não por formulário, e não pode herdar o lead
   * do pagador — herdando, o upsert reencontraria a ficha DELE pelo lead e
   * gravaria os dados de uma pessoa por cima dos da outra.
   */
  inscricaoId: number | null,
  profile: ContractStudentProfile,
  actor: { id?: number | null; name?: string | null } = {},
  financeEnrollmentId?: number | null
): Promise<number> {
  await ensureAcademicSchema();
  const cpf = normalizeCpf(profile.cpf);

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    // O vínculo forte é o lead; o CPF é o reencontro de quem já era aluno e
    // voltou a comprar por outro lead.
    //
    // O terceiro critério é a ficha que a PRÓPRIA matrícula já usa, e ele
    // existe por um caso concreto: a regularização em um clique cria a ficha só
    // com o nome, sem CPF e sem lead. Completar o cadastro depois não casava
    // com nada e nascia uma SEGUNDA ficha da mesma pessoa — uma no diário da
    // turma, outra no contrato. Vem por último de propósito: CPF igual continua
    // sendo a mesma pessoa, mesmo que a matrícula aponte para outra ficha.
    const found = await client.query<{ id: string }>(
      `SELECT id FROM ${SCHEMA}.academic_students
        WHERE ($1::bigint IS NOT NULL AND lead_inscricao_id = $1)
           OR ($2::text IS NOT NULL AND cpf = $2)
           OR ($3::bigint IS NOT NULL AND id = (
                 SELECT student_id FROM ${SCHEMA}.finance_enrollments WHERE id = $3
               ))
        ORDER BY (lead_inscricao_id IS NOT DISTINCT FROM $1) DESC,
                 ($2::text IS NOT NULL AND cpf = $2) DESC
        LIMIT 1`,
      [inscricaoId, cpf, financeEnrollmentId ?? null]
    );

    let studentId: number;
    if (found.rows[0]) {
      studentId = Number(found.rows[0].id);
      await client.query(
        `UPDATE ${SCHEMA}.academic_students SET
           full_name    = COALESCE(NULLIF($2, ''), full_name),
           cpf          = COALESCE($3, cpf),
           birth_date   = COALESCE($4::date, birth_date),
           email        = COALESCE($5, email),
           phone        = COALESCE($6, phone),
           city         = COALESCE($7, city),
           rg           = COALESCE($8, rg),
           profession   = COALESCE($9, profession),
           company      = COALESCE($10, company),
           landline     = COALESCE($11, landline),
           address      = COALESCE($12, address),
           neighborhood = COALESCE($13, neighborhood),
           state        = COALESCE($14, state),
           zip          = COALESCE($15, zip),
           lead_inscricao_id = COALESCE(lead_inscricao_id, $1),
           updated_at   = NOW()
         WHERE id = $16`,
        [
          inscricaoId,
          profile.fullName,
          cpf,
          profile.birthDate,
          profile.email,
          profile.phone,
          profile.city,
          profile.rg,
          profile.profession,
          profile.company,
          profile.landline,
          profile.address,
          profile.neighborhood,
          profile.state,
          profile.zip,
          studentId,
        ]
      );
    } else {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO ${SCHEMA}.academic_students
           (full_name, cpf, birth_date, email, phone, city, status, lead_inscricao_id,
            rg, profession, company, landline, address, neighborhood, state, zip,
            created_by_user_id, created_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,'ativo',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING id`,
        [
          profile.fullName,
          cpf,
          profile.birthDate,
          profile.email,
          profile.phone,
          profile.city,
          inscricaoId,
          profile.rg,
          profile.profession,
          profile.company,
          profile.landline,
          profile.address,
          profile.neighborhood,
          profile.state,
          profile.zip,
          actor.id ?? null,
          actor.name ?? null,
        ]
      );
      studentId = Number(inserted.rows[0].id);
    }

    // Responsável legal do aluno menor. Reaproveita o mesmo `upsertGuardian` do
    // cadastro manual — é ele que casa irmãos pelo CPF em vez de criar duas
    // vezes a mesma mãe. Só grava quando veio preenchido: venda de aluno maior
    // não pode apagar o responsável de quem já tinha um.
    if (profile.guardian?.fullName?.trim() && normalizeCpf(profile.guardian.cpf)) {
      const guardianId = await upsertGuardian(client, {
        fullName: profile.guardian.fullName,
        cpf: profile.guardian.cpf,
        email: profile.guardian.email,
        phone: profile.guardian.phone,
        relationship: profile.guardian.relationship,
        birthDate: profile.guardian.birthDate,
      });
      await client.query(`UPDATE ${SCHEMA}.academic_students SET guardian_id = $1 WHERE id = $2`, [
        guardianId,
        studentId,
      ]);
    }

    if (financeEnrollmentId) {
      await client.query(
        `UPDATE ${SCHEMA}.finance_enrollments SET student_id = $1 WHERE id = $2`,
        [studentId, financeEnrollmentId]
      );
    }

    await client.query("COMMIT");
    return studentId;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}


/**
 * Quadro do contrato para a tela da venda: o que já se sabe do aluno.
 *
 * Ordem de preferência: ficha do aluno (se ele já existe) → dados do lead. O
 * vendedor não deve redigitar o que o CRM já tem — cada campo redigitado é uma
 * chance a mais de o contrato sair com telefone diferente do cadastro.
 */
/**
 * Quadro do contrato de um aluno pelo id da ficha — é como a tela da venda
 * reabre os dados da segunda pessoa do contrato de casal, que não tem lead.
 */
export async function getContractProfileForStudent(
  studentId: number
): Promise<ContractStudentProfile | null> {
  await ensureAcademicSchema();
  const { rows } = await getPool().query<Record<string, unknown>>(
    `SELECT s.full_name, s.cpf, s.birth_date, s.email, s.phone, s.city, s.rg, s.profession, s.company,
            s.landline, s.address, s.neighborhood, s.state, s.zip,
            g.full_name AS guardian_full_name, g.cpf AS guardian_cpf, g.email AS guardian_email,
            g.phone AS guardian_phone, g.relationship AS guardian_relationship,
            g.birth_date AS guardian_birth_date
       FROM ${SCHEMA}.academic_students s
       LEFT JOIN ${SCHEMA}.academic_guardians g ON g.id = s.guardian_id
      WHERE s.id = $1`,
    [studentId]
  );
  const row = rows[0];
  if (!row) return null;

  return {
    fullName: cleanText(row.full_name) ?? "",
    cpf: normalizeCpf(row.cpf),
    rg: cleanText(row.rg),
    birthDate: isoDate(row.birth_date as string | null),
    profession: cleanText(row.profession),
    company: cleanText(row.company),
    landline: cleanText(row.landline),
    phone: cleanText(row.phone),
    email: cleanText(row.email),
    address: cleanText(row.address),
    neighborhood: cleanText(row.neighborhood),
    city: cleanText(row.city),
    state: cleanText(row.state),
    zip: cleanText(row.zip),
    guardian: guardianFromRow(row),
  };
}

/** Quadro do responsável a partir das colunas `guardian_*` de uma consulta. */
function guardianFromRow(row: Record<string, unknown>): ContractGuardian | null {
  const fullName = cleanText(row.guardian_full_name);
  if (!fullName) return null;
  return {
    fullName,
    cpf: normalizeCpf(row.guardian_cpf),
    email: cleanText(row.guardian_email),
    phone: cleanText(row.guardian_phone),
    relationship: cleanText(row.guardian_relationship),
    birthDate: isoDate(row.guardian_birth_date as string | null),
  };
}

export async function getContractProfileForLead(
  inscricaoId: number
): Promise<ContractStudentProfile> {
  await ensureAcademicSchema();

  const { rows } = await getPool().query<Record<string, unknown>>(
    `SELECT s.full_name, s.cpf, s.birth_date, s.email, s.phone, s.city, s.rg, s.profession, s.company,
            s.landline, s.address, s.neighborhood, s.state, s.zip,
            g.full_name AS guardian_full_name, g.cpf AS guardian_cpf, g.email AS guardian_email,
            g.phone AS guardian_phone, g.relationship AS guardian_relationship,
            g.birth_date AS guardian_birth_date
       FROM ${SCHEMA}.academic_students s
       LEFT JOIN ${SCHEMA}.academic_guardians g ON g.id = s.guardian_id
      WHERE s.lead_inscricao_id = $1
      LIMIT 1`,
    [inscricaoId]
  );

  const lead = (await listInscricoesByIds([inscricaoId]))[0];
  const payload = (lead?.payload ?? {}) as Record<string, unknown>;
  const parsed = parsePayload(payload);
  const text = (value: unknown): string | null => {
    const trimmed = typeof value === "string" ? value.trim() : "";
    return trimmed.length > 0 ? trimmed : null;
  };

  const row = rows[0];
  const isoBirth = row?.birth_date
    ? new Date(row.birth_date as string).toISOString().slice(0, 10)
    : null;

  return {
    fullName: text(row?.full_name) ?? lead?.nome ?? "",
    cpf: normalizeCpf(row?.cpf) ?? normalizeCpf(payload.cpf ?? payload.documento ?? payload.document),
    rg: text(row?.rg),
    birthDate: isoBirth ?? text(parsed.data_nascimento),
    profession: text(row?.profession),
    company: text(row?.company),
    landline: text(row?.landline),
    phone: text(row?.phone) ?? lead?.telefone ?? null,
    email: text(row?.email) ?? text(parsed.email),
    address: text(row?.address),
    neighborhood: text(row?.neighborhood),
    city: text(row?.city) ?? lead?.cidade ?? null,
    state: text(row?.state),
    zip: text(row?.zip),
    guardian: row ? guardianFromRow(row) : null,
  };
}
