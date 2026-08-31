/**
 * Contrato digital de matrícula: geração, quadro de resumo, link de
 * assinatura, via impressa e trilha de evidências.
 *
 * Como isto se encaixa no resto do sistema:
 *
 * - o contrato **nasce da matrícula** (`finance_enrollments`), não do lead.
 *   Registrar a venda no CRM já cria a matrícula (ver `lib/leadSales.ts`), e é
 *   ali que `syncContractOnSale()` é chamado;
 * - o texto vem de `lib/contractTemplate.ts` (o contrato real da escola) e o
 *   PDF de `lib/contractDocument.ts`. Aqui só mora o estado;
 * - existem **dois caminhos de assinatura**, e os dois terminam com o mesmo
 *   arquivo guardado no banco: eletrônica (o aluno assina pelo link) e em
 *   papel (imprime, assina à caneta, a escola digitaliza e anexa).
 *
 * Invariante que segura o arquivo: **contrato assinado é imutável.** Corrigir a
 * venda depois não reescreve o que a pessoa aceitou — gera uma versão nova e
 * deixa a anterior no histórico. Por isso o snapshot é congelado em JSONB e o
 * arquivo assinado é guardado, e não regerado sob demanda.
 */

import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "@/lib/db";
import { ensureAcademicSchema } from "@/lib/academicSchema";
import { requiresGuardian } from "@/lib/academicRules";
import { getSaleByEnrollmentId, getSaleContractCourse } from "@/lib/leadSales";
import { moveLeadToClientBoard } from "@/lib/commercial";
import { listEnrollmentParticipants } from "@/lib/enrollmentParticipants";
import { buildContractPdf, type ContractEvidence, type ContractPdfVariant } from "@/lib/contractDocument";
import type { ContractPlanSplit } from "@/lib/contractProfile";
import {
  addMonths,
  dateInMonth,
  findPaymentMethodIdByName,
  getEnrollmentById,
  monthToDate,
  splitInstallments,
  updateEnrollment,
  type EnrollmentScheduleItem,
} from "@/lib/finance";
import {
  EMPTY_CONTRACT_COMPANY,
  VOZUP_CONTRACT_COMPANY,
  hashContractFile,
  hashContractSnapshot,
  contractClosing,
  buildPlanRows,
  normalizePlan,
  planToChargeTerms,
  planTotal,
  renderContractClauses,
  type ContractBlock,
  type ContractCompany,
  type ContractCourse,
  type ContractPlanRow,
  type ContractSnapshot,
  type ContractCoStudent,
  type ContractStudent,
} from "@/lib/contractTemplate";
import { isEmailAddress, maskEmail, sendEmail } from "@/lib/email";
import { otpEmailHtml, otpEmailText, signedCopyHtml, signedCopyText } from "@/lib/contractEmails";
import {
  CONTRACT_LINK_DAYS,
  MAX_SIGN_FAILURES,
  MIN_READING_SECONDS,
  SCANNED_UPLOAD_MAX_BYTES,
  SCANNED_UPLOAD_MIME_TYPES,
  OTP_TTL_MINUTES,
  generateOtp,
  hashOtp,
  SIGN_FAILURE_WINDOW_MINUTES,
  SIGN_REJECTION_MESSAGES,
  evaluateSignAttempt,
  missingContractFields,
  type ContractSignerRole,
  type ContractStatus,
  type SignRejectionReason,
} from "@/lib/contractRules";
import type { DashboardUser } from "@/lib/auth";

const SCHEMA = "dashboard";
/** Chave própria de advisory lock — não pode colidir com finance/academic/coupons. */
const SCHEMA_ADVISORY_LOCK_KEY = 918702;
const COMPANY_SETTINGS_KEY = "empresa";

export type SignatureKind = "eletronica" | "papel";

export const CONTRACT_ACCEPTANCE_TEXT =
  "Declaro que li o contrato na íntegra, que os dados informados são meus e verdadeiros, e que aceito eletronicamente todas as suas cláusulas.";

let schemaReady = false;
let schemaPromise: Promise<void> | null = null;

async function ensureContractsSchemaOnce(): Promise<void> {
  // O schema acadêmico já garante o financeiro, e é dele que vêm
  // `finance_enrollments.student_id` e as tabelas de aluno/responsável lidas
  // aqui. Sem isto, abrir /contratos antes de /alunos quebrava com
  // "column does not exist".
  await ensureAcademicSchema();

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [SCHEMA_ADVISORY_LOCK_KEY]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.contracts (
        id                BIGSERIAL PRIMARY KEY,
        enrollment_id     BIGINT NOT NULL REFERENCES ${SCHEMA}.finance_enrollments(id) ON DELETE CASCADE,
        version           INTEGER NOT NULL DEFAULT 1,
        status            TEXT NOT NULL DEFAULT 'pendente'
                          CHECK (status IN ('pendente','assinado','cancelado')),
        token             TEXT NOT NULL UNIQUE,
        lead_inscricao_id BIGINT,
        student_id        BIGINT,
        signer_name       TEXT NOT NULL,
        signer_cpf        TEXT,
        signer_email      TEXT,
        signer_phone      TEXT,
        signer_role       TEXT NOT NULL DEFAULT 'aluno'
                          CHECK (signer_role IN ('aluno','responsavel')),
        student_name      TEXT,
        course_name       TEXT,
        amount            NUMERIC NOT NULL DEFAULT 0,
        snapshot          JSONB NOT NULL,
        snapshot_hash     TEXT NOT NULL,
        expires_at        TIMESTAMPTZ,
        first_opened_at   TIMESTAMPTZ,
        signed_at         TIMESTAMPTZ,
        signed_name       TEXT,
        signed_cpf        TEXT,
        signed_ip         TEXT,
        signed_user_agent TEXT,
        cpf_verified      BOOLEAN NOT NULL DEFAULT FALSE,
        signed_file       BYTEA,
        signed_file_hash  TEXT,
        canceled_at       TIMESTAMPTZ,
        canceled_reason   TEXT,
        created_by_id     BIGINT,
        created_by_name   TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Uma matrícula tem no máximo UM contrato aguardando assinatura. Assinados
      -- e cancelados acumulam de propósito: correção de venda depois da
      -- assinatura vira versão nova, e as duas precisam sobreviver no histórico.
      CREATE UNIQUE INDEX IF NOT EXISTS contracts_pending_per_enrollment
        ON ${SCHEMA}.contracts (enrollment_id) WHERE status = 'pendente';
      CREATE INDEX IF NOT EXISTS contracts_enrollment_idx ON ${SCHEMA}.contracts (enrollment_id);
      CREATE INDEX IF NOT EXISTS contracts_status_idx ON ${SCHEMA}.contracts (status);
      CREATE INDEX IF NOT EXISTS contracts_lead_idx
        ON ${SCHEMA}.contracts (lead_inscricao_id) WHERE lead_inscricao_id IS NOT NULL;

      -- Assinatura em papel (imprime, assina à caneta, escola digitaliza e anexa).
      ALTER TABLE ${SCHEMA}.contracts
        ADD COLUMN IF NOT EXISTS otp_hash        TEXT,
        ADD COLUMN IF NOT EXISTS otp_expires_at  TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS otp_attempts    INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS otp_sent_to     TEXT,
        ADD COLUMN IF NOT EXISTS otp_verified_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS signed_copy_sent_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS signature_kind TEXT,
        ADD COLUMN IF NOT EXISTS signed_file_mime TEXT,
        ADD COLUMN IF NOT EXISTS signed_file_name TEXT,
        ADD COLUMN IF NOT EXISTS sale_amount NUMERIC;

      CREATE TABLE IF NOT EXISTS ${SCHEMA}.contract_events (
        id           BIGSERIAL PRIMARY KEY,
        contract_id  BIGINT NOT NULL REFERENCES ${SCHEMA}.contracts(id) ON DELETE CASCADE,
        type         TEXT NOT NULL,
        at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actor_id     BIGINT,
        actor_name   TEXT,
        ip           TEXT,
        user_agent   TEXT,
        metadata     JSONB NOT NULL DEFAULT '{}'::jsonb
      );

      CREATE INDEX IF NOT EXISTS contract_events_contract_idx
        ON ${SCHEMA}.contract_events (contract_id, at DESC);
    `);

    // Dados da escola já nascem preenchidos com o que está no contrato em papel
    // — obrigar a redigitar CNPJ e endereço que já conhecemos só produziria
    // contrato com lacuna no primeiro uso.
    await client.query(
      `INSERT INTO ${SCHEMA}.finance_settings (key, value)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO NOTHING`,
      [COMPANY_SETTINGS_KEY, JSON.stringify(VOZUP_CONTRACT_COMPANY)]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureContractsSchema(): Promise<void> {
  if (schemaReady) return;
  schemaPromise ??= ensureContractsSchemaOnce()
    .then(() => {
      schemaReady = true;
    })
    .catch((error) => {
      schemaPromise = null;
      throw error;
    });
  await schemaPromise;
}

// ── Dados da empresa (CONTRATADA) ────────────────────────────────

function normalizeCompany(value: unknown): ContractCompany {
  const raw = (value ?? {}) as Record<string, unknown>;
  const text = (key: string, fallback = ""): string => {
    const candidate = raw[key];
    return typeof candidate === "string" && candidate.trim() ? candidate.trim() : fallback;
  };
  return {
    name: text("name"),
    // Instalações antigas gravaram só `name`; a linha da assinatura cai nele.
    legalName: text("legalName", text("name")),
    cnpj: text("cnpj"),
    address: text("address"),
    neighborhood: text("neighborhood"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    forum: text("forum"),
    email: text("email"),
    phone: text("phone"),
    website: text("website"),
    instagram: text("instagram"),
    representativeName: text("representativeName"),
    representativeRole: text("representativeRole"),
    signatureImage: dataUri(raw.signatureImage),
  };
}

/**
 * Só aceita PNG/JPEG em data URI, e com teto de tamanho.
 *
 * A imagem entra num JSONB que é lido a cada contrato gerado: qualquer coisa
 * fora disso (SVG com script, arquivo de 5 MB) vira string vazia, e a linha da
 * CONTRATADA sai em branco em vez de quebrar a emissão.
 */
function dataUri(value: unknown): string {
  if (typeof value !== "string") return "";
  const clean = value.trim();
  if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(clean)) return "";
  return clean.length > 700_000 ? "" : clean;
}

export async function getContractCompany(): Promise<ContractCompany> {
  await ensureContractsSchema();
  const { rows } = await getPool().query<{ value: unknown }>(
    `SELECT value FROM ${SCHEMA}.finance_settings WHERE key = $1`,
    [COMPANY_SETTINGS_KEY]
  );
  return rows[0] ? normalizeCompany(rows[0].value) : { ...EMPTY_CONTRACT_COMPANY };
}

export async function saveContractCompany(
  user: DashboardUser | null | undefined,
  input: Partial<ContractCompany>
): Promise<ContractCompany> {
  await ensureContractsSchema();
  const company = normalizeCompany({ ...EMPTY_CONTRACT_COMPANY, ...input });
  await getPool().query(
    `INSERT INTO ${SCHEMA}.finance_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [COMPANY_SETTINGS_KEY, JSON.stringify(company)]
  );
  void user;
  return company;
}

// ── Snapshot: o que o contrato congela ───────────────────────────

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isoDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return typeof value === "string" ? value.slice(0, 10) : null;
}

interface ResolvedPeople {
  student: ContractStudent;
  signer: ContractSigner;
  studentId: number | null;
}

interface ContractSigner {
  name: string;
  cpf: string | null;
  email: string | null;
  phone: string | null;
  role: ContractSignerRole;
}

/**
 * Quem é o aluno e quem assina.
 *
 * Ordem de preferência: o **aluno cadastrado** (dado conferido pela
 * secretaria) vem antes do payload do lead (dado que a pessoa digitou num
 * formulário). Aluno menor de idade assina pelo responsável legal — e é o
 * responsável, não o menor, que fica como CONTRATANTE na assinatura.
 *
 * Campos que só existem no papel (RG, endereço completo, profissão) vêm vazios
 * e são preenchidos na tela antes de enviar. Vazio aqui é honesto: o sistema
 * não inventa dado de documento.
 */
const STUDENT_CONTRACT_COLUMNS = `
  s.id, s.full_name, s.cpf, s.email, s.phone, s.birth_date, s.city,
  s.rg, s.profession, s.company, s.landline, s.address, s.neighborhood,
  s.state, s.zip,
  g.full_name AS guardian_name, g.cpf AS guardian_cpf,
  g.email AS guardian_email, g.phone AS guardian_phone
`;

/** Quadro do item 2 a partir da ficha do aluno. */
function contractStudentFromRow(row: Record<string, unknown>, fallbackName: string): ContractStudent {
  return {
    name: String(row.full_name ?? fallbackName),
    cpf: cleanText(row.cpf),
    birthDate: isoDate(row.birth_date),
    email: cleanText(row.email),
    phone: cleanText(row.landline),
    mobile: cleanText(row.phone),
    city: cleanText(row.city),
    rg: cleanText(row.rg),
    profession: cleanText(row.profession),
    company: cleanText(row.company),
    address: cleanText(row.address),
    neighborhood: cleanText(row.neighborhood),
    state: cleanText(row.state),
    zip: cleanText(row.zip),
  };
}

async function resolvePeople(
  enrollmentId: number,
  fallbackName: string,
  leadInscricaoId: number | null
): Promise<ResolvedPeople> {
  const pool = getPool();

  const { rows: studentRows } = await pool.query<Record<string, unknown>>(
    `SELECT ${STUDENT_CONTRACT_COLUMNS}
       FROM ${SCHEMA}.finance_enrollments e
       JOIN ${SCHEMA}.academic_students s ON s.id = e.student_id
       LEFT JOIN ${SCHEMA}.academic_guardians g ON g.id = s.guardian_id
      WHERE e.id = $1`,
    [enrollmentId]
  );

  const emptyAddress = {
    rg: null,
    profession: null,
    company: null,
    address: null,
    neighborhood: null,
    state: null,
    zip: null,
  };

  const row = studentRows[0];
  if (row) {
    const birthDate = isoDate(row.birth_date);
    // O quadro do item 2 vem inteiro do cadastro: desde 08/2026 o vendedor
    // preenche RG, profissão, empresa e endereço na própria tela da venda.
    const student = contractStudentFromRow(row, fallbackName);

    if (requiresGuardian(birthDate) && cleanText(row.guardian_name)) {
      return {
        student,
        studentId: Number(row.id),
        signer: {
          name: String(row.guardian_name),
          cpf: cleanText(row.guardian_cpf),
          email: cleanText(row.guardian_email),
          phone: cleanText(row.guardian_phone),
          role: "responsavel",
        },
      };
    }

    return {
      student,
      studentId: Number(row.id),
      signer: {
        name: student.name,
        cpf: student.cpf,
        email: student.email,
        phone: student.mobile,
        role: "aluno",
      },
    };
  }

  if (leadInscricaoId) {
    const { rows } = await pool.query<Record<string, unknown>>(
      `SELECT NULLIF(TRIM(COALESCE(i.payload->>'nome', i.payload->>'name', '')), '') AS nome,
              NULLIF(TRIM(COALESCE(i.payload->>'telefone', i.payload->>'phone', i.payload->>'celular', '')), '') AS telefone,
              NULLIF(TRIM(COALESCE(i.payload->>'email', '')), '') AS email,
              NULLIF(TRIM(COALESCE(i.payload->>'cpf', i.payload->>'documento', i.payload->>'document', '')), '') AS cpf,
              NULLIF(TRIM(COALESCE(i.payload->>'cidade', i.payload->>'city', '')), '') AS cidade,
              NULLIF(TRIM(COALESCE(i.payload->>'profissao_area', i.payload->>'profissao', i.payload->>'occupation', '')), '') AS profissao,
              NULLIF(TRIM(COALESCE(i.payload->>'empresa', i.payload->>'company', '')), '') AS empresa
         FROM inscricoes.inscricoes i
        WHERE i.id = $1`,
      [leadInscricaoId]
    );
    const lead = rows[0];
    if (lead) {
      const name = cleanText(lead.nome) ?? fallbackName;
      const student: ContractStudent = {
        ...emptyAddress,
        name,
        cpf: cleanText(lead.cpf),
        birthDate: null,
        email: cleanText(lead.email),
        phone: null,
        mobile: cleanText(lead.telefone),
        city: cleanText(lead.cidade),
        profession: cleanText(lead.profissao),
        company: cleanText(lead.empresa),
      };
      return {
        student,
        studentId: null,
        signer: {
          name,
          cpf: student.cpf,
          email: student.email,
          phone: student.mobile,
          role: "aluno",
        },
      };
    }
  }

  const student: ContractStudent = {
    ...emptyAddress,
    name: fallbackName,
    cpf: null,
    birthDate: null,
    email: null,
    phone: null,
    mobile: null,
    city: null,
  };
  return {
    student,
    studentId: null,
    signer: { name: fallbackName, cpf: null, email: null, phone: null, role: "aluno" },
  };
}

/**
 * Rateio do item 4 gravado na matrícula. Devolve null quando a venda não foi
 * dividida — é o caso de tudo que foi registrado antes de 08/2026.
 */
/** Lê o rateio gravado na matrícula. Zerado ou ausente vira null. */
function parsePlanSplitValue(raw: unknown): ContractPlanSplit | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const num = (key: string) => {
    const parsed = Number(value[key]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  const split = { matricula: num("matricula"), material: num("material"), curso: num("curso") };
  return split.matricula + split.material + split.curso > 0 ? split : null;
}

async function getContractPlanSplit(
  enrollmentId: number
): Promise<{ matricula: number; material: number; curso: number } | null> {
  const { rows } = await getPool().query<{ contract_plan: unknown }>(
    `SELECT contract_plan FROM ${SCHEMA}.finance_enrollments WHERE id = $1`,
    [enrollmentId]
  );
  return parsePlanSplitValue(rows[0]?.contract_plan);
}

/**
 * Carga horária e turma deduzidas da matrícula.
 *
 * Carga horária = nº de aulas × horas por aula, do cadastro do curso. Turma =
 * a que o aluno foi alocado no fechamento. Quando o curso não tem esses números
 * (cadastro antigo), devolve null e o contrato mostra o campo vazio em vez de
 * inventar carga horária.
 *
 * **Curso sem nº de aulas é imersão**: não há encontro semanal para contar, e
 * o campo de horas vale como carga horária total ("25 horas"). Escrever
 * "2 aulas · 25 horas" num contrato de imersão de fim de semana descreve algo
 * que não existe.
 */
async function getEnrollmentCourseInfo(
  enrollmentId: number
): Promise<{ hours: string | null; className: string | null }> {
  const { rows } = await getPool().query<{
    lessons_count: number | null;
    lesson_hours: string | number | null;
    class_name: string | null;
  }>(
    `SELECT fc.lessons_count, fc.lesson_hours, ac.name AS class_name
       FROM ${SCHEMA}.finance_enrollments e
       LEFT JOIN ${SCHEMA}.finance_courses fc ON fc.id = e.course_id
       LEFT JOIN ${SCHEMA}.academic_classes ac ON ac.id = e.class_id
      WHERE e.id = $1`,
    [enrollmentId]
  );

  const row = rows[0];
  if (!row) return { hours: null, className: null };

  const lessons = row.lessons_count === null ? null : Number(row.lessons_count);
  const perLesson = row.lesson_hours === null ? null : Number(row.lesson_hours);

  return { hours: courseHoursLabel(lessons, perLesson), className: row.class_name ?? null };
}

/** "24 aulas · 48 horas"; imersão (sem nº de aulas) sai só como "25 horas". */
function courseHoursLabel(lessons: number | null, perLesson: number | null): string | null {
  if (lessons && lessons > 0) {
    return perLesson && perLesson > 0
      ? `${lessons} aulas · ${formatHours(lessons * perLesson)} horas`
      : `${lessons} aulas`;
  }
  return perLesson && perLesson > 0 ? `${formatHours(perLesson)} horas` : null;
}

/** "48" e não "48.0"; "1,5" com vírgula, que é como se lê em português. */
function formatHours(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(".", ",");
}

/**
 * Quadro, treinamento e valor de cada aluno adicional da matrícula (o caso do
 * casal em um contrato só). Participante sem ficha ainda gravada fica de fora:
 * é melhor o contrato sair com um aluno do que com um quadro em branco.
 */
async function resolveCoStudents(enrollmentId: number): Promise<ContractCoStudent[]> {
  const participants = await listEnrollmentParticipants(enrollmentId);
  if (participants.length === 0) return [];

  const pool = getPool();
  const result: ContractCoStudent[] = [];
  for (const participant of participants) {
    if (!participant.studentId) continue;
    const { rows } = await pool.query<Record<string, unknown>>(
      `SELECT ${STUDENT_CONTRACT_COLUMNS}
         FROM ${SCHEMA}.academic_students s
         LEFT JOIN ${SCHEMA}.academic_guardians g ON g.id = s.guardian_id
        WHERE s.id = $1`,
      [participant.studentId]
    );
    if (!rows[0]) continue;

    // Carga horária do treinamento DELE, pela mesma regra do aluno pagador
    // (nº de aulas × horas, ou só as horas quando é imersão).
    const { rows: courseRows } = await pool.query<{
      lessons_count: number | null;
      lesson_hours: string | number | null;
    }>(
      `SELECT lessons_count, lesson_hours FROM ${SCHEMA}.finance_courses WHERE id = $1`,
      [participant.courseId]
    );

    result.push({
      student: contractStudentFromRow(rows[0], participant.courseName ?? "Aluno"),
      course: {
        name: participant.courseName ?? "",
        hours: courseHoursLabel(
          courseRows[0]?.lessons_count === null || courseRows[0]?.lessons_count === undefined
            ? null
            : Number(courseRows[0].lessons_count),
          courseRows[0]?.lesson_hours === null || courseRows[0]?.lesson_hours === undefined
            ? null
            : Number(courseRows[0].lesson_hours)
        ),
        className: participant.className,
      },
      amount: participant.amount,
    });
  }
  return result;
}

export interface ContractDraft {
  snapshot: ContractSnapshot;
  studentId: number | null;
  leadInscricaoId: number | null;
  saleAmount: number;
}

/**
 * Monta (sem gravar) o conteúdo do contrato de uma matrícula.
 *
 * O plano financeiro nasce com **tudo em CURSO**: é o que o Financeiro sabe. A
 * separação entre matrícula, material didático e curso é decisão comercial que
 * a secretaria faz na tela — inventar um rateio aqui seria escrever no
 * contrato um número que ninguém combinou.
 */
export async function buildContractDraft(
  enrollmentId: number,
  overrideSplit?: ContractPlanSplit | null
): Promise<ContractDraft> {
  await ensureContractsSchema();

  const sale = await getSaleByEnrollmentId(enrollmentId);
  if (!sale) {
    throw new Error("Matrícula não encontrada.");
  }

  const leadInscricaoId = Number.isFinite(sale.leadId) && sale.leadId > 0 ? sale.leadId : null;
  const people = await resolvePeople(enrollmentId, sale.student, leadInscricaoId);
  const company = await getContractCompany();
  // Entrada e mensais são coisas diferentes no cronograma: a parcela 0 é a
  // entrada paga no ato. O quadro do item 4 precisa dessa separação — juntas,
  // o contrato prometeria "11x de R$ 772,73" onde a cobrança é entrada de
  // R$ 1.500 mais 10x de R$ 700.
  const entrada = sale.schedule.find((item) => item.number === 0) ?? null;
  const mensais = sale.schedule.filter((item) => item.number !== 0);
  const first = mensais[0] ?? sale.schedule[0] ?? null;
  const installments = Math.max(1, mensais.length || sale.installments);
  /** Data do que é cobrado no ato: a entrada, ou a 1ª parcela quando não há. */
  const atDate = entrada?.dueDate ?? first?.dueDate ?? null;

  // Item 3 preenchido sozinho: carga horária vem do cadastro do curso (nº de
  // aulas × horas por aula) e a turma, da turma em que o aluno foi matriculado.
  // O texto gravado na venda continua valendo quando existe — é a exceção
  // digitada à mão, e exceção manda em automatismo.
  const courseInfo = await getSaleContractCourse(enrollmentId);
  const auto = await getEnrollmentCourseInfo(enrollmentId);
  const course: ContractCourse = {
    name: sale.courseName ?? "",
    hours: courseInfo.hours || auto.hours,
    className: courseInfo.className || auto.className,
  };

  // Rateio combinado na venda (matrícula / material / curso). Sem ele — vendas
  // antigas, ou registradas fora do modal — cai no comportamento anterior: tudo
  // em CURSO, que é o que o Financeiro sabe.
  const split = overrideSplit ?? (await getContractPlanSplit(enrollmentId));
  const paymentMethod = first?.paymentMethodName ?? first?.cardBrandName ?? null;
  const rows = buildPlanRows({
    // Sem rateio — venda antiga ou registrada fora do modal — vale o
    // comportamento anterior: tudo em CURSO, que é o que o Financeiro sabe.
    rateio: split ?? { matricula: 0, material: 0, curso: sale.amount },
    downPayment: entrada?.amount ?? 0,
    installments,
    paymentMethod,
    entryMethod: entrada?.paymentMethodName ?? entrada?.cardBrandName ?? paymentMethod,
    firstDueDate: first?.dueDate ?? null,
    atDate,
  });

  const plan: ContractPlanRow[] = normalizePlan(rows);

  const coStudents = await resolveCoStudents(enrollmentId);

  const snapshot: ContractSnapshot = {
    company,
    student: people.student,
    signer: people.signer,
    course,
    plan,
    ...(coStudents.length > 0 ? { coStudents } : {}),
    notes: sale.notes,
    saleDate: sale.saleDate,
    generatedAt: new Date().toISOString(),
  };

  return { snapshot, studentId: people.studentId, leadInscricaoId, saleAmount: sale.amount };
}

// ── Eventos ──────────────────────────────────────────────────────

export type ContractEventType =
  | "created"
  | "updated"
  | "link_reissued"
  | "opened"
  | "signed"
  | "signed_on_paper"
  | "sign_rejected"
  | "otp_sent"
  | "otp_failed"
  | "signed_copy_sent"
  | "signed_copy_failed"
  | "printed"
  | "canceled"
  | "sale_changed"
  | "downloaded";

interface LogEventInput {
  contractId: number;
  type: ContractEventType;
  actor?: DashboardUser | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

async function logContractEvent(
  executor: PoolClient | ReturnType<typeof getPool>,
  input: LogEventInput
): Promise<void> {
  await executor.query(
    `INSERT INTO ${SCHEMA}.contract_events (contract_id, type, actor_id, actor_name, ip, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      input.contractId,
      input.type,
      input.actor?.id ?? null,
      input.actor?.name ?? input.actor?.email ?? null,
      input.ip ?? null,
      input.userAgent ?? null,
      JSON.stringify(input.metadata ?? {}),
    ]
  );
}

// ── Leitura ──────────────────────────────────────────────────────

export interface ContractSummary {
  id: number;
  enrollmentId: number;
  version: number;
  status: ContractStatus;
  signatureKind: SignatureKind | null;
  token: string;
  leadInscricaoId: number | null;
  studentId: number | null;
  signerName: string;
  signerCpf: string | null;
  signerEmail: string | null;
  signerPhone: string | null;
  signerRole: ContractSignerRole;
  studentName: string | null;
  courseName: string | null;
  /** Total do plano financeiro do contrato. */
  amount: number;
  /** Valor da matrícula no Financeiro — a tela compara os dois. */
  saleAmount: number | null;
  /** Entrada registrada no Financeiro — o quadro pode ter nascido sem essa linha. */
  saleDownPayment: number;
  expiresAt: string | null;
  firstOpenedAt: string | null;
  signedAt: string | null;
  signedName: string | null;
  cpfVerified: boolean;
  signedFileHash: string | null;
  signedFileName: string | null;
  canceledAt: string | null;
  canceledReason: string | null;
  createdByName: string | null;
  createdAt: string;
  /** Venda mudou depois de assinada — a tela precisa gritar isso. */
  outdated: boolean;
  /** O que ainda falta preencher para poder assinar. */
  missingFields: string[];
  snapshot: ContractSnapshot;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : null;
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const SUMMARY_COLUMNS = `
  c.id, c.enrollment_id, c.version, c.status, c.signature_kind, c.token, c.lead_inscricao_id,
  c.student_id, c.signer_name, c.signer_cpf, c.signer_email, c.signer_phone, c.signer_role,
  c.student_name, c.course_name, c.amount, c.sale_amount, c.expires_at, c.first_opened_at,
  c.signed_at, c.signed_name, c.cpf_verified, c.signed_file_hash, c.signed_file_name,
  c.canceled_at, c.canceled_reason, c.created_by_name, c.created_at, c.snapshot,
  (SELECT e.down_payment_amount FROM ${SCHEMA}.finance_enrollments e WHERE e.id = c.enrollment_id)
    AS sale_down_payment,
  (c.status = 'assinado' AND EXISTS (
     SELECT 1 FROM ${SCHEMA}.contract_events ev
      WHERE ev.contract_id = c.id AND ev.type = 'sale_changed' AND ev.at > c.signed_at
   )) AS outdated
`;

function mapSummary(row: Record<string, unknown>): ContractSummary {
  const snapshot = row.snapshot as ContractSnapshot;
  return {
    id: Number(row.id),
    enrollmentId: Number(row.enrollment_id),
    version: Number(row.version) || 1,
    status: String(row.status) as ContractStatus,
    signatureKind: (row.signature_kind as SignatureKind | null) ?? null,
    token: String(row.token),
    leadInscricaoId: row.lead_inscricao_id === null ? null : Number(row.lead_inscricao_id),
    studentId: row.student_id === null ? null : Number(row.student_id),
    signerName: String(row.signer_name ?? ""),
    signerCpf: (row.signer_cpf as string | null) ?? null,
    signerEmail: (row.signer_email as string | null) ?? null,
    signerPhone: (row.signer_phone as string | null) ?? null,
    signerRole: (row.signer_role as ContractSignerRole) ?? "aluno",
    studentName: (row.student_name as string | null) ?? null,
    courseName: (row.course_name as string | null) ?? null,
    amount: num(row.amount),
    saleAmount: row.sale_amount === null || row.sale_amount === undefined ? null : num(row.sale_amount),
    saleDownPayment: num(row.sale_down_payment),
    expiresAt: toIso(row.expires_at),
    firstOpenedAt: toIso(row.first_opened_at),
    signedAt: toIso(row.signed_at),
    signedName: (row.signed_name as string | null) ?? null,
    cpfVerified: row.cpf_verified === true,
    signedFileHash: (row.signed_file_hash as string | null) ?? null,
    signedFileName: (row.signed_file_name as string | null) ?? null,
    canceledAt: toIso(row.canceled_at),
    canceledReason: (row.canceled_reason as string | null) ?? null,
    createdByName: (row.created_by_name as string | null) ?? null,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    outdated: row.outdated === true,
    missingFields: snapshot ? missingContractFields(snapshot) : [],
    snapshot,
  };
}

export interface ListContractsFilters {
  status?: ContractStatus | "todos";
  search?: string | null;
  limit?: number;
}

export async function listContracts(filters: ListContractsFilters = {}): Promise<ContractSummary[]> {
  await ensureContractsSchema();

  const values: unknown[] = [];
  const where: string[] = [];

  if (filters.status && filters.status !== "todos") {
    values.push(filters.status);
    where.push(`c.status = $${values.length}`);
  }

  const search = (filters.search ?? "").trim();
  if (search) {
    values.push(`%${search}%`);
    values.push(`%${search.replace(/\D/g, "")}%`);
    where.push(
      `(c.signer_name ILIKE $${values.length - 1}
        OR c.student_name ILIKE $${values.length - 1}
        OR c.course_name ILIKE $${values.length - 1}
        OR (NULLIF(REGEXP_REPLACE(COALESCE(c.signer_cpf, ''), '\\D', '', 'g'), '') ILIKE $${values.length}))`
    );
  }

  const limit = Math.min(500, Math.max(1, filters.limit ?? 200));
  const { rows } = await getPool().query(
    `SELECT ${SUMMARY_COLUMNS}
       FROM ${SCHEMA}.contracts c
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY CASE c.status WHEN 'pendente' THEN 0 WHEN 'assinado' THEN 1 ELSE 2 END,
               c.created_at DESC
      LIMIT ${limit}`,
    values
  );

  return rows.map(mapSummary);
}

export async function getContractById(id: number): Promise<ContractSummary | null> {
  await ensureContractsSchema();
  const { rows } = await getPool().query(
    `SELECT ${SUMMARY_COLUMNS} FROM ${SCHEMA}.contracts c WHERE c.id = $1`,
    [id]
  );
  if (!rows[0]) return null;
  const summary = mapSummary(rows[0]);
  return { ...summary, snapshot: await withCurrentCompany(summary.snapshot, summary.status) };
}

/** Contrato vigente de uma matrícula: o pendente, ou o último assinado. */
export async function getContractForEnrollment(enrollmentId: number): Promise<ContractSummary | null> {
  await ensureContractsSchema();
  const { rows } = await getPool().query(
    `SELECT ${SUMMARY_COLUMNS}
       FROM ${SCHEMA}.contracts c
      WHERE c.enrollment_id = $1 AND c.status <> 'cancelado'
      ORDER BY CASE c.status WHEN 'pendente' THEN 0 ELSE 1 END, c.version DESC
      LIMIT 1`,
    [enrollmentId]
  );
  return rows[0] ? mapSummary(rows[0]) : null;
}

export interface ContractEventRecord {
  id: number;
  type: ContractEventType;
  at: string;
  actorName: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
}

export async function listContractEvents(contractId: number): Promise<ContractEventRecord[]> {
  await ensureContractsSchema();
  const { rows } = await getPool().query<Record<string, unknown>>(
    `SELECT id, type, at, actor_name, ip, user_agent, metadata
       FROM ${SCHEMA}.contract_events
      WHERE contract_id = $1
      ORDER BY at ASC, id ASC`,
    [contractId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    type: String(row.type) as ContractEventType,
    at: toIso(row.at) ?? "",
    actorName: (row.actor_name as string | null) ?? null,
    ip: (row.ip as string | null) ?? null,
    userAgent: (row.user_agent as string | null) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  }));
}

// ── Escrita ──────────────────────────────────────────────────────

function newToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Referência curta e irreversível do link, para citar no termo de evidências. */
function linkReference(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16).toUpperCase();
}

/** Colunas denormalizadas que a listagem usa — sempre derivadas do snapshot. */
function denormalized(snapshot: ContractSnapshot) {
  return {
    signerName: snapshot.signer.name,
    signerCpf: snapshot.signer.cpf,
    signerEmail: snapshot.signer.email,
    signerPhone: snapshot.signer.phone ?? snapshot.student.mobile,
    signerRole: snapshot.signer.role,
    studentName: snapshot.student.name,
    courseName: snapshot.course.name,
    amount: planTotal(snapshot.plan),
  };
}

export interface CreateContractOptions {
  reason?: string;
  linkDays?: number;
  /**
   * Rateio escolhido na hora de gerar (matrícula / material / curso). Quando
   * vem, MANDA sobre o que foi combinado na venda — é como o contrato passa a
   * ter total próprio, diferente da matrícula.
   *
   * Divergir é permitido por decisão do usuário (25/08/2026), mas nunca em
   * silêncio: quem gera vê o aviso na tela, e a diferença fica registrada no
   * evento do contrato.
   */
  planSplit?: ContractPlanSplit | null;
}

/**
 * Cria o contrato pendente de uma matrícula. Se já houver um pendente, ele é
 * **atualizado** (não duplicado) — o índice parcial no banco garante isso
 * mesmo com dois cliques simultâneos. O que a secretaria já preencheu no
 * quadro de resumo é preservado.
 */
export async function createContractForEnrollment(
  user: DashboardUser | null | undefined,
  enrollmentId: number,
  options: CreateContractOptions = {}
): Promise<ContractSummary> {
  const draft = await buildContractDraft(enrollmentId, options.planSplit ?? null);

  // Contrato incompleto não pode nascer. Antes, ele nascia e só era recusado na
  // hora de assinar — o cliente recebia o link, clicava e lia "o contrato ainda
  // não está pronto", sem ninguém na escola saber por quê. Agora quem descobre
  // é quem gera, com a lista do que falta.
  const missing = missingContractFields(draft.snapshot);
  if (missing.length > 0) {
    throw new Error(
      `O contrato não pode ser gerado: falta ${missing.join(", ")}. ` +
        "Complete o cadastro do aluno (ou os dados da escola em Contratos → Dados da empresa) e gere de novo."
    );
  }

  const linkDays = Math.max(1, Math.min(365, options.linkDays ?? CONTRACT_LINK_DAYS));

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: existingRows } = await client.query<{ id: string; snapshot: ContractSnapshot }>(
      `SELECT id, snapshot FROM ${SCHEMA}.contracts
        WHERE enrollment_id = $1 AND status = 'pendente'
        FOR UPDATE`,
      [enrollmentId]
    );

    const { rows: versionRows } = await client.query<{ next: string }>(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM ${SCHEMA}.contracts WHERE enrollment_id = $1`,
      [enrollmentId]
    );
    const nextVersion = Number(versionRows[0]?.next ?? 1);

    let contractId: number;
    if (existingRows[0]) {
      contractId = Number(existingRows[0].id);
      const previous = existingRows[0].snapshot;

      // Regerar por causa de correção de venda não pode apagar RG, endereço e
      // rateio que a secretaria digitou: o que veio da venda é atualizado, o
      // que foi preenchido à mão fica.
      //
      // O quadro do CURSO é a exceção: nome e carga horária são derivados do
      // cadastro do curso e do que foi combinado na venda, e preservar o valor
      // anterior fazia o contrato pendente NUNCA acompanhar uma correção —
      // arrumar o curso de "2 aulas · 25 horas" para "25 horas" e corrigir a
      // venda deixava o contrato exatamente como estava. Só a turma continua
      // preservada: é o campo que a secretaria digita quando não existe turma
      // cadastrada, e o sistema não tem de onde deduzi-la.
      const snapshot: ContractSnapshot = {
        ...draft.snapshot,
        student: { ...draft.snapshot.student, ...stripNulls(previous.student) },
        signer: { ...draft.snapshot.signer, ...stripNulls(previous.signer) },
        course: {
          ...draft.snapshot.course,
          className: previous.course.className ?? draft.snapshot.course.className,
        },
        notes: previous.notes ?? draft.snapshot.notes,
      };
      const fields = denormalized(snapshot);

      await client.query(
        `UPDATE ${SCHEMA}.contracts
            SET lead_inscricao_id = $2, student_id = $3, signer_name = $4, signer_cpf = $5,
                signer_email = $6, signer_phone = $7, signer_role = $8, student_name = $9,
                course_name = $10, amount = $11, sale_amount = $12, snapshot = $13::jsonb,
                snapshot_hash = $14, expires_at = NOW() + ($15 || ' days')::interval, updated_at = NOW()
          WHERE id = $1`,
        [
          contractId,
          draft.leadInscricaoId,
          draft.studentId,
          fields.signerName,
          fields.signerCpf,
          fields.signerEmail,
          fields.signerPhone,
          fields.signerRole,
          fields.studentName,
          fields.courseName,
          fields.amount,
          draft.saleAmount,
          JSON.stringify(snapshot),
          hashContractSnapshot(snapshot),
          String(linkDays),
        ]
      );
      await logContractEvent(client, {
        contractId,
        type: "updated",
        actor: user,
        metadata: { reason: options.reason ?? "contrato regerado" },
      });
    } else {
      const fields = denormalized(draft.snapshot);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO ${SCHEMA}.contracts
           (enrollment_id, version, token, lead_inscricao_id, student_id, signer_name, signer_cpf,
            signer_email, signer_phone, signer_role, student_name, course_name, amount, sale_amount,
            snapshot, snapshot_hash, expires_at, created_by_id, created_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16,
                 NOW() + ($17 || ' days')::interval, $18, $19)
         RETURNING id`,
        [
          enrollmentId,
          nextVersion,
          newToken(),
          draft.leadInscricaoId,
          draft.studentId,
          fields.signerName,
          fields.signerCpf,
          fields.signerEmail,
          fields.signerPhone,
          fields.signerRole,
          fields.studentName,
          fields.courseName,
          fields.amount,
          draft.saleAmount,
          JSON.stringify(draft.snapshot),
          hashContractSnapshot(draft.snapshot),
          String(linkDays),
          user?.id ?? null,
          user?.name ?? user?.email ?? null,
        ]
      );
      contractId = Number(rows[0].id);
      await logContractEvent(client, {
        contractId,
        type: "created",
        actor: user,
        metadata: { reason: options.reason ?? "contrato gerado", version: nextVersion },
      });
    }

    await client.query("COMMIT");
    const created = await getContractById(contractId);
    if (!created) throw new Error("Contrato não encontrado após a criação.");
    return created;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Só o que foi de fato preenchido sobrescreve o valor vindo da venda. */
function stripNulls<T extends object>(value: T | null | undefined): Partial<T> {
  if (!value) return {};
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item !== null && item !== undefined && item !== "") result[key] = item;
  }
  return result as Partial<T>;
}

/**
 * Chamado quando a venda é registrada ou corrigida no CRM.
 *
 * - venda nova → contrato pendente nasce junto;
 * - venda corrigida com contrato ainda pendente → o pendente é regerado;
 * - venda corrigida **depois de assinada** → o assinado NÃO é tocado. Fica
 *   registrado um evento `sale_changed`, a tela marca o contrato como
 *   desatualizado e a decisão de gerar contrato novo é humana.
 *
 * Nunca lança: falha aqui não pode derrubar o registro da venda.
 */
export async function syncContractOnSale(
  user: DashboardUser | null | undefined,
  enrollmentId: number,
  options: { saleWasUpdated: boolean } = { saleWasUpdated: false }
): Promise<ContractSummary | null> {
  try {
    await ensureContractsSchema();
    const pool = getPool();

    const { rows } = await pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM ${SCHEMA}.contracts
        WHERE enrollment_id = $1 AND status <> 'cancelado'
        ORDER BY CASE status WHEN 'pendente' THEN 0 ELSE 1 END, version DESC
        LIMIT 1`,
      [enrollmentId]
    );
    const current = rows[0];

    if (current && current.status === "assinado") {
      if (options.saleWasUpdated) {
        await logContractEvent(pool, {
          contractId: Number(current.id),
          type: "sale_changed",
          actor: user,
          metadata: { note: "A venda foi corrigida depois da assinatura deste contrato." },
        });
      }
      return getContractById(Number(current.id));
    }

    return await createContractForEnrollment(user, enrollmentId, {
      reason: options.saleWasUpdated ? "venda corrigida no CRM" : "venda registrada no CRM",
    });
  } catch (error) {
    // Documento incompleto é caso ESPERADO na primeira passada: o contrato é
    // sincronizado dentro do registro da venda, antes de a ficha do aluno
    // existir. A rota chama de novo depois de gravar o aluno e a turma, e aí
    // ele nasce completo — por isso este caso não vira erro no log.
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("O contrato não pode ser gerado")) {
      console.info("[contracts] contrato da matrícula", enrollmentId, "ainda incompleto:", message);
    } else {
      console.error("[contracts] falha ao sincronizar contrato da matrícula", enrollmentId, error);
    }
    return null;
  }
}

export interface UpdateContractInput {
  student?: Partial<ContractStudent>;
  signer?: Partial<ContractSigner>;
  course?: Partial<ContractCourse>;
  plan?: ContractPlanRow[];
  /**
   * Alunos adicionais do contrato. Lista inteira, não merge — é como a tela
   * manda o quadro de cada pessoa, e casar linha a linha exigiria um id que o
   * formulário não tem. Ausente preserva o que já está no contrato.
   */
  coStudents?: ContractCoStudent[];
  notes?: string | null;
  /**
   * O resto do financeiro da matrícula — o que não cabe no quadro do item 4 mas
   * é parte da mesma cobrança. Vive aqui, e não numa chamada ao Financeiro,
   * porque quem edita contrato não tem necessariamente `view.finance`: em
   * 27/08/2026, duas das três pessoas com acesso a Contratos não tinham.
   */
  charge?: ContractChargeInput;
}

/** Campos financeiros da matrícula editáveis pela tela de contratos. */
export interface ContractChargeInput {
  saleDate?: string | null;
  sellerId?: number | null;
  branchId?: number | null;
  cardBrandId?: number | null;
}

/** Estado financeiro da matrícula do contrato, para a tela abrir preenchida. */
export interface ContractChargeState {
  saleDate: string;
  sellerId: number | null;
  /**
   * Nome do que está gravado. A tela usa para manter na lista o vendedor (ou a
   * unidade) que saiu do cadastro — sem isso, abrir o quadro e salvar apagaria
   * em silêncio o vendedor de uma venda antiga.
   */
  sellerName: string | null;
  branchId: number | null;
  branchName: string | null;
  cardBrandId: number | null;
  cardBrandName: string | null;
  /** Maior que zero trava a edição do plano: renegociação é do editor de /matriculas. */
  paymentCount: number;
}

/**
 * O financeiro da matrícula do contrato, sob a permissão de CONTRATOS.
 * Sem isto a tela teria de chamar `/api/finance/*` e quebrar para quem só
 * gerencia contrato.
 */
export async function getContractCharge(contractId: number): Promise<ContractChargeState | null> {
  const contract = await getContractById(contractId);
  if (!contract) return null;
  const enrollment = await getEnrollmentById(contract.enrollmentId);
  if (!enrollment) return null;
  return {
    saleDate: enrollment.saleDate,
    sellerId: enrollment.sellerId,
    sellerName: enrollment.sellerName,
    branchId: enrollment.branchId,
    branchName: enrollment.branchName,
    cardBrandId: enrollment.cardBrandId,
    cardBrandName: enrollment.cardBrandName,
    paymentCount: enrollment.paymentCount,
  };
}

/**
 * Preenche o quadro de resumo antes do envio — RG, endereço, turma, carga
 * horária e o rateio entre matrícula, material e curso. Só vale enquanto o
 * contrato está pendente: assinado é imutável.
 */
/**
 * O quadro do item 4 mandando na cobrança de verdade.
 *
 * Até aqui a edição do quadro só reescrevia o documento: dava para corrigir
 * "24x" para "48x" no papel e a matrícula continuava gerando 24 boletos. Quem
 * vendia por fora (link do Asaas) tinha de anotar "ajustar no CRM" e ir mexer
 * em outra tela — quando lembrava.
 *
 * Só roda quando os TERMOS mudam (valor, entrada, nº de parcelas, forma ou 1º
 * vencimento). Corrigir o nome do aluno ou a carga horária não pode regerar
 * cronograma nenhum.
 *
 * **Matrícula com pagamento registrado não passa por aqui.** Renegociar saldo
 * com parcela já recebida tem regra própria (as recebidas ficam protegidas e o
 * resto é recalculado, ver `updateEnrollment`), e o editor de /matriculas é
 * quem sabe conduzir isso — este quadro não tem como expressar "essas três já
 * foram pagas".
 */
async function applyPlanToEnrollment(
  enrollmentId: number,
  plan: ContractPlanRow[],
  charge: ContractChargeInput | undefined,
  planChanged: boolean
): Promise<void> {
  const terms = planToChargeTerms(plan);
  if (!(terms.totalAmount > 0)) {
    throw new Error("O plano financeiro está zerado — informe pelo menos o valor do CURSO.");
  }

  const enrollment = await getEnrollmentById(enrollmentId);
  if (!enrollment) throw new Error("Matrícula deste contrato não encontrada.");

  // Vendedor, unidade, bandeira e data da venda: `undefined` preserva o que já
  // está gravado — a tela manda só o que ela pergunta.
  const saleDate = charge?.saleDate?.slice(0, 10) || enrollment.saleDate;
  const sellerId = charge?.sellerId === undefined ? enrollment.sellerId : charge.sellerId;
  const branchId = charge?.branchId === undefined ? enrollment.branchId : charge.branchId;
  const cardBrandId = charge?.cardBrandId === undefined ? enrollment.cardBrandId : charge.cardBrandId;
  const chargeChanged =
    saleDate !== enrollment.saleDate ||
    sellerId !== enrollment.sellerId ||
    branchId !== enrollment.branchId ||
    cardBrandId !== enrollment.cardBrandId;

  // Nada mudou de fato: sair antes de mexer no cronograma. `updateEnrollment`
  // apaga e regera as parcelas, e fazer isso à toa é destruir por nada.
  if (!planChanged && !chargeChanged) return;

  if (enrollment.paymentCount > 0) {
    throw new Error(
      "Esta matrícula já tem pagamento registrado: corrija o plano em Matrículas, onde as parcelas já recebidas ficam protegidas."
    );
  }
  if (terms.downPayment > terms.totalAmount) {
    throw new Error("O que é cobrado no ato não pode ser maior que o total do contrato.");
  }

  // Sem correspondência no cadastro, fica a forma que já estava: trocar por uma
  // errada seria pior que não trocar.
  const paymentMethodId =
    (await findPaymentMethodIdByName(terms.paymentMethod)) ?? enrollment.paymentMethodId;
  // Bandeira só faz sentido em forma parcelada (é ela que escolhe a taxa da
  // maquininha); nas outras é ruído gravado.
  const brandForSchedule = cardBrandId;
  const entryMethodId = (await findPaymentMethodIdByName(terms.entryMethod)) ?? paymentMethodId;

  // Vencimentos: o quadro diz a data exata da 1ª mensal, e as seguintes caem no
  // mesmo dia dos meses seguintes. Sem data no quadro, vale o mês que a
  // matrícula já tinha — o cronograma não pode nascer sem vencimento.
  const firstDue = terms.firstDueDate ?? dateInMonth(monthToDate(enrollment.firstMonth), 1) ?? saleDate;
  const firstMonth = firstDue.slice(0, 7);
  const dueDay = Number.parseInt(firstDue.slice(8, 10), 10) || 1;
  const atDate = terms.atDate ?? saleDate;

  const schedule: EnrollmentScheduleItem[] = [];
  if (terms.downPayment > 0) {
    schedule.push({
      amount: terms.downPayment,
      type: "entrada",
      dueDate: atDate,
      paymentMethodId: entryMethodId,
      cardBrandId: null,
    });
  }
  const mensais = splitInstallments(
    Math.round((terms.totalAmount - terms.downPayment) * 100) / 100,
    terms.installments
  );
  mensais.forEach((amount, index) => {
    schedule.push({
      amount,
      type: "parcela",
      dueDate: dateInMonth(monthToDate(addMonths(firstMonth, index)), dueDay) ?? firstDue,
      paymentMethodId,
      cardBrandId: brandForSchedule,
    });
  });

  // Tudo o que o quadro não conhece é devolvido como está: `updateEnrollment`
  // reescreve a matrícula inteira, e omitir um campo aqui apagaria vendedor,
  // turma ou unidade de negócio sem ninguém ter pedido.
  await updateEnrollment(enrollmentId, {
    student: enrollment.student,
    // businessUnit fica de fora de propósito: `updateEnrollment` conserva a que
    // já está gravada quando o campo não vem, e o contrato não pergunta empresa.
    courseId: enrollment.courseId,
    classId: enrollment.classId,
    totalAmount: terms.totalAmount,
    downPaymentAmount: terms.downPayment,
    installments: terms.installments,
    paymentMethodId,
    cardBrandId: brandForSchedule,
    firstMonth,
    saleDate,
    sellerId,
    // Trocar o vendedor sem informar percentual faz `updateEnrollment` usar o
    // padrão do vendedor novo — que é o certo: a comissão é dele agora.
    commissionPct: sellerId === enrollment.sellerId ? enrollment.commissionPct : null,
    branchId,
    notes: enrollment.notes,
    schedule,
  });
}

/** Dois quadros combinam a mesma cobrança? É o que decide se a matrícula é mexida. */
function sameChargeTerms(a: ContractPlanRow[], b: ContractPlanRow[]): boolean {
  const left = planToChargeTerms(a);
  const right = planToChargeTerms(b);
  return (
    left.totalAmount === right.totalAmount &&
    left.downPayment === right.downPayment &&
    left.installments === right.installments &&
    left.paymentMethod === right.paymentMethod &&
    left.entryMethod === right.entryMethod &&
    left.firstDueDate === right.firstDueDate &&
    left.atDate === right.atDate
  );
}

export async function updateContract(
  user: DashboardUser | null | undefined,
  contractId: number,
  input: UpdateContractInput
): Promise<ContractSummary> {
  await ensureContractsSchema();
  const contract = await getContractById(contractId);
  if (!contract) throw new Error("Contrato não encontrado.");
  if (contract.status !== "pendente") {
    throw new Error("Só dá para editar um contrato que ainda não foi assinado.");
  }

  const previous = contract.snapshot;
  const snapshot: ContractSnapshot = {
    ...previous,
    student: { ...previous.student, ...(input.student ?? {}) },
    signer: { ...previous.signer, ...(input.signer ?? {}) },
    course: { ...previous.course, ...(input.course ?? {}) },
    plan: input.plan ? normalizePlan(input.plan) : previous.plan,
    coStudents: input.coStudents ?? previous.coStudents,
    notes: input.notes === undefined ? previous.notes : input.notes,
  };

  // Quem assina para si mesmo é o próprio aluno: manter dois cadastros do
  // mesmo ser humano divergindo dentro do contrato seria fonte de erro.
  if (snapshot.signer.role === "aluno") {
    snapshot.signer = {
      ...snapshot.signer,
      name: snapshot.student.name,
      cpf: snapshot.student.cpf,
      email: snapshot.student.email,
      phone: snapshot.student.mobile ?? snapshot.student.phone,
    };
  }

  // A cobrança vem ANTES do documento: se o Financeiro recusar (matrícula com
  // pagamento registrado, plano zerado), nada é gravado e o contrato continua
  // batendo com as parcelas. O inverso deixaria o papel prometendo 48x com 24
  // boletos no banco.
  const planChanged = Boolean(input.plan) && !sameChargeTerms(previous.plan, snapshot.plan);
  if (planChanged || input.charge) {
    await applyPlanToEnrollment(contract.enrollmentId, snapshot.plan, input.charge, planChanged);
  }

  const fields = denormalized(snapshot);
  await getPool().query(
    `UPDATE ${SCHEMA}.contracts
        SET signer_name = $2, signer_cpf = $3, signer_email = $4, signer_phone = $5,
            signer_role = $6, student_name = $7, course_name = $8, amount = $9,
            snapshot = $10::jsonb, snapshot_hash = $11, updated_at = NOW()
      WHERE id = $1`,
    [
      contractId,
      fields.signerName,
      fields.signerCpf,
      fields.signerEmail,
      fields.signerPhone,
      fields.signerRole,
      fields.studentName,
      fields.courseName,
      fields.amount,
      JSON.stringify(snapshot),
      hashContractSnapshot(snapshot),
    ]
  );

  await logContractEvent(getPool(), {
    contractId,
    type: "updated",
    actor: user,
    metadata: { reason: "quadro de resumo preenchido" },
  });

  const updated = await getContractById(contractId);
  if (!updated) throw new Error("Contrato não encontrado após a atualização.");
  return updated;
}

export async function cancelContract(
  user: DashboardUser | null | undefined,
  contractId: number,
  reason: string
): Promise<ContractSummary> {
  await ensureContractsSchema();
  const contract = await getContractById(contractId);
  if (!contract) throw new Error("Contrato não encontrado.");
  if (contract.status === "cancelado") return contract;

  await getPool().query(
    `UPDATE ${SCHEMA}.contracts
        SET status = 'cancelado', canceled_at = NOW(), canceled_reason = $2, updated_at = NOW()
      WHERE id = $1`,
    [contractId, cleanText(reason)]
  );
  await logContractEvent(getPool(), {
    contractId,
    type: "canceled",
    actor: user,
    metadata: { reason: cleanText(reason), previousStatus: contract.status },
  });

  const updated = await getContractById(contractId);
  if (!updated) throw new Error("Contrato não encontrado após o cancelamento.");
  return updated;
}

/** Link vencido ou vazado: troca o token e reinicia o prazo. */
export async function reissueContractLink(
  user: DashboardUser | null | undefined,
  contractId: number,
  linkDays = CONTRACT_LINK_DAYS
): Promise<ContractSummary> {
  await ensureContractsSchema();
  const contract = await getContractById(contractId);
  if (!contract) throw new Error("Contrato não encontrado.");
  if (contract.status !== "pendente") {
    throw new Error("Só contrato pendente tem link de assinatura.");
  }

  await getPool().query(
    `UPDATE ${SCHEMA}.contracts
        SET token = $2, expires_at = NOW() + ($3 || ' days')::interval, updated_at = NOW()
      WHERE id = $1`,
    [contractId, newToken(), String(Math.max(1, Math.min(365, linkDays)))]
  );
  await logContractEvent(getPool(), { contractId, type: "link_reissued", actor: user });

  const updated = await getContractById(contractId);
  if (!updated) throw new Error("Contrato não encontrado após a reemissão.");
  return updated;
}

/**
 * Contrato assinado: o card do lead sai do funil de prospecção e vai para o
 * quadro de **Clientes** do Kanban, onde a operação faz o acompanhamento e
 * oferece os outros produtos. É a assinatura — não o registro da venda — que
 * marca o fim da negociação, então é daqui que o card se move.
 *
 * Nunca lança e roda FORA da transação: a assinatura já está gravada e é
 * válida por si só; arrumar o Kanban é consequência dela, não parte do ato.
 */
async function moveLeadCardToClientBoard(
  user: DashboardUser | null | undefined,
  contractId: number
): Promise<void> {
  try {
    const { rows } = await getPool().query<{ lead_inscricao_id: string | number | null }>(
      `SELECT lead_inscricao_id FROM ${SCHEMA}.contracts WHERE id = $1`,
      [contractId]
    );
    const leadId = Number(rows[0]?.lead_inscricao_id ?? 0);
    // Contrato lançado direto no Financeiro, sem lead de origem: não há card.
    if (!Number.isInteger(leadId) || leadId < 1) return;
    await moveLeadToClientBoard(user, leadId);
  } catch (error) {
    console.error("[contracts] falha ao mover o lead para o quadro de Clientes:", error);
  }
}

/**
 * Mesma lista de `contractRules`, reexportada aqui só por compatibilidade.
 *
 * Era uma cópia com valores próprios — e o teto de tamanho logo abaixo era um
 * `20 * 1024 * 1024` escrito à mão. Resultado: subir o limite num lugar não
 * subia no outro, e o arquivo passava pela validação da rota para morrer duas
 * linhas depois com uma mensagem diferente.
 */
export const SCANNED_CONTRACT_MIME_TYPES = SCANNED_UPLOAD_MIME_TYPES;

/**
 * Assinatura em papel: a escola imprime, o aluno assina à caneta, alguém
 * digitaliza e anexa aqui.
 *
 * O arquivo digitalizado passa a ser a via oficial — é ele que aparece no
 * "Ver PDF". Não há termo de evidências: a prova é a assinatura de próprio
 * punho no papel, e quem anexou fica registrado na trilha.
 */
export async function registerPaperSignature(
  user: DashboardUser | null | undefined,
  contractId: number,
  input: { file: Buffer; mime: string; filename: string; signedDate?: string | null; signerName?: string | null }
): Promise<ContractSummary> {
  await ensureContractsSchema();

  if (!SCANNED_CONTRACT_MIME_TYPES.includes(input.mime)) {
    throw new Error("Anexe o contrato assinado em PDF, JPG, PNG ou WEBP.");
  }
  if (input.file.length === 0) {
    throw new Error("Arquivo vazio.");
  }
  if (input.file.length > SCANNED_UPLOAD_MAX_BYTES) {
    throw new Error(
      `Arquivo muito grande (máximo ${Math.round(SCANNED_UPLOAD_MAX_BYTES / 1024 / 1024)} MB).`
    );
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ status: string; signer_name: string }>(
      `SELECT status, signer_name FROM ${SCHEMA}.contracts WHERE id = $1 FOR UPDATE`,
      [contractId]
    );
    const current = rows[0];
    if (!current) throw new Error("Contrato não encontrado.");
    if (current.status === "assinado") {
      throw new Error("Este contrato já está assinado.");
    }
    if (current.status === "cancelado") {
      throw new Error("Contrato cancelado não pode receber assinatura.");
    }

    const signedAt = input.signedDate?.match(/^\d{4}-\d{2}-\d{2}$/)
      ? `${input.signedDate}T12:00:00.000Z`
      : new Date().toISOString();
    const fileHash = hashContractFile(input.file);

    await client.query(
      `UPDATE ${SCHEMA}.contracts
          SET status = 'assinado', signature_kind = 'papel', signed_at = $2,
              signed_name = $3, signed_file = $4, signed_file_hash = $5,
              signed_file_mime = $6, signed_file_name = $7, cpf_verified = FALSE, updated_at = NOW()
        WHERE id = $1`,
      [
        contractId,
        signedAt,
        cleanText(input.signerName) ?? current.signer_name,
        input.file,
        fileHash,
        input.mime,
        input.filename.slice(0, 180),
      ]
    );

    await logContractEvent(client, {
      contractId,
      type: "signed_on_paper",
      actor: user,
      metadata: { fileHash, mime: input.mime, filename: input.filename, signedAt },
    });

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  await moveLeadCardToClientBoard(user, contractId);

  const updated = await getContractById(contractId);
  if (!updated) throw new Error("Contrato não encontrado após anexar a via assinada.");
  return updated;
}

// ── Lado público (sem login) ─────────────────────────────────────

export interface PublicContractView {
  id: number;
  version: number;
  status: ContractStatus;
  signatureKind: SignatureKind | null;
  courseName: string;
  signerName: string;
  studentName: string;
  signerRole: ContractSignerRole;
  amount: number;
  companyName: string;
  clauses: ContractBlock[];
  snapshot: ContractSnapshot;
  closing: string;
  expiresAt: string | null;
  signedAt: string | null;
  documentReady: boolean;
  acceptanceText: string;
  /** Primeira abertura do link: a página conta o tempo mínimo a partir daqui. */
  openedAt: string | null;
  minReadingSeconds: number;
}

interface TokenRow {
  id: string;
  version: string;
  status: string;
  signature_kind: string | null;
  snapshot: ContractSnapshot;
  signer_cpf: string | null;
  signer_name: string;
  student_name: string | null;
  signer_role: string;
  course_name: string | null;
  amount: string;
  expires_at: Date | null;
  signed_at: Date | null;
  first_opened_at: Date | null;
  otp_hash: string | null;
  otp_expires_at: Date | null;
  otp_attempts: number | string | null;
  otp_sent_to: string | null;
  otp_verified_at: Date | null;
}

/**
 * Busca pelo token do link.
 *
 * O formato é validado antes de tocar o banco para que lixo na URL vire 404
 * barato, sem consulta. O token tem 192 bits de entropia (`randomBytes(24)`),
 * então adivinhar não é caminho de ataque viável.
 */
async function findByToken(token: string): Promise<TokenRow | null> {
  const clean = token.trim();
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(clean)) return null;

  await ensureContractsSchema();
  const { rows } = await getPool().query<TokenRow>(
    `SELECT id, version, status, signature_kind, snapshot, signer_cpf, signer_name, student_name,
            signer_role, course_name, amount, expires_at, signed_at, first_opened_at,
            otp_hash, otp_expires_at, otp_attempts, otp_sent_to, otp_verified_at
       FROM ${SCHEMA}.contracts
      WHERE token = $1
      LIMIT 1`,
    [clean]
  );

  return rows[0] ?? null;
}

/**
 * Enquanto o contrato está PENDENTE, o bloco da escola é sempre o atual.
 *
 * O congelamento do snapshot existe para proteger o que foi **acordado** — e
 * nada foi acordado antes da assinatura. Quem a escola é (razão social, CNPJ,
 * endereço, telefone, quem assina por ela) não é cláusula negociada: é
 * identificação da parte, e sair errada num contrato que ninguém assinou ainda
 * é só dado velho.
 *
 * Foi o que aconteceu com os contratos criados antes de existir o campo do
 * representante: ficariam para sempre sem a assinatura da escola, mesmo depois
 * de ela ser cadastrada.
 *
 * Assinado é outra história: ali o snapshot é intocável, custe o que custar.
 */
async function withCurrentCompany(
  snapshot: ContractSnapshot,
  status: string
): Promise<ContractSnapshot> {
  if (status !== "pendente") return snapshot;
  try {
    const company = await getContractCompany();
    return { ...snapshot, company };
  } catch {
    // Falha ao ler as configurações não pode impedir de ver o contrato.
    return snapshot;
  }
}

/** Estado do código do jeito que `evaluateSignAttempt` espera receber. */
function otpStateOf(row: TokenRow) {
  return {
    hash: row.otp_hash,
    expiresAt: toIso(row.otp_expires_at),
    attempts: Number(row.otp_attempts ?? 0),
    verifiedAt: toIso(row.otp_verified_at),
  };
}

export async function getContractByToken(token: string): Promise<PublicContractView | null> {
  const row = await findByToken(token);
  if (!row) return null;

  const snapshot = await withCurrentCompany(row.snapshot, String(row.status));

  return {
    id: Number(row.id),
    version: Number(row.version) || 1,
    status: String(row.status) as ContractStatus,
    signatureKind: (row.signature_kind as SignatureKind | null) ?? null,
    courseName: row.course_name ?? snapshot.course.name,
    signerName: row.signer_name,
    studentName: row.student_name ?? snapshot.student.name,
    signerRole: (row.signer_role as ContractSignerRole) ?? "aluno",
    amount: num(row.amount),
    companyName: snapshot.company.name,
    clauses: renderContractClauses(snapshot, { digitalSignature: true }),
    snapshot,
    closing: contractClosing(snapshot),
    expiresAt: toIso(row.expires_at),
    signedAt: toIso(row.signed_at),
    documentReady: missingContractFields(snapshot).length === 0,
    acceptanceText: CONTRACT_ACCEPTANCE_TEXT,
    // Null na primeira visita: a página registra a abertura DEPOIS desta
    // consulta, e o cliente cai no relógio do próprio carregamento. O servidor
    // sempre mede a partir de um instante anterior ao do cliente, então quem
    // passa no contador da página passa também na checagem do servidor.
    openedAt: toIso(row.first_opened_at),
    minReadingSeconds: MIN_READING_SECONDS,
  };
}

/** Primeira abertura do link vira evidência: prova que o texto foi exibido antes do aceite. */
export async function registerContractOpened(
  token: string,
  context: { ip: string | null; userAgent: string | null }
): Promise<void> {
  const row = await findByToken(token);
  if (!row || row.status !== "pendente") return;

  const contractId = Number(row.id);
  const pool = getPool();
  await pool.query(
    `UPDATE ${SCHEMA}.contracts SET first_opened_at = COALESCE(first_opened_at, NOW()) WHERE id = $1`,
    [contractId]
  );
  await logContractEvent(pool, {
    contractId,
    type: "opened",
    ip: context.ip,
    userAgent: context.userAgent,
    metadata: { firstOpen: row.first_opened_at === null },
  });
}

/**
 * Emite e envia o código de verificação para o e-mail do cadastro.
 *
 * O endereço vem do CONTRATO, nunca do que a pessoa digita na página: enviar
 * para onde o visitante mandar transformaria o segundo fator em teatro. Se a
 * escola cadastrou o e-mail errado, quem corrige é a escola, no CRM.
 */
export async function sendContractOtp(
  token: string,
  context: { ip: string | null; userAgent: string | null }
): Promise<SendOtpResult> {
  const row = await findByToken(token);
  if (!row) return { ok: false, reason: "nao_encontrado", message: "Contrato não encontrado." };
  if (row.status !== "pendente") {
    return { ok: false, reason: "indisponivel", message: "Este contrato não está mais aberto para assinatura." };
  }

  const contractId = Number(row.id);
  const target = row.snapshot.signer.email ?? "";
  if (!isEmailAddress(target)) {
    return {
      ok: false,
      reason: "sem_email",
      message: "O cadastro deste contrato está sem e-mail. Fale com a escola para incluir o seu.",
    };
  }

  // Reenvio em rajada: cada pedido gera código NOVO, então sem trava daria para
  // encher a caixa de entrada de quem nem pediu.
  const { rows: recent } = await getPool().query<{ total: string }>(
    `SELECT COUNT(*) AS total FROM ${SCHEMA}.contract_events
      WHERE contract_id = $1 AND type = 'otp_sent' AND at > NOW() - INTERVAL '10 minutes'`,
    [contractId]
  );
  if (Number(recent[0]?.total ?? 0) >= 3) {
    return {
      ok: false,
      reason: "muitos_envios",
      message: "Já enviamos vários códigos agora há pouco. Confira seu e-mail e a caixa de spam.",
    };
  }

  const code = generateOtp();
  const company = row.snapshot.company.name || "a escola";
  const delivery = await sendEmail({
    to: target,
    subject: `Seu código para assinar o contrato: ${code}`,
    text: otpEmailText(code, row.snapshot.signer.name, company),
    html: otpEmailHtml(code, row.snapshot.signer.name, company),
  });

  if (!delivery.ok) {
    await logContractEvent(getPool(), {
      contractId,
      type: "otp_failed",
      ip: context.ip,
      userAgent: context.userAgent,
      metadata: { stage: "envio", reason: delivery.reason, detail: delivery.message },
    }).catch(() => undefined);
    return {
      ok: false,
      reason: "falha_envio",
      message: "Não consegui enviar o código agora. Tente de novo em instantes.",
    };
  }

  // Só grava DEPOIS de o e-mail sair: gravar antes deixaria o contrato exigindo
  // um código que ninguém recebeu.
  await getPool().query(
    `UPDATE ${SCHEMA}.contracts
        SET otp_hash = $2, otp_expires_at = NOW() + ($3 || ' minutes')::interval,
            otp_attempts = 0, otp_sent_to = $4, otp_verified_at = NULL, updated_at = NOW()
      WHERE id = $1`,
    [contractId, hashOtp(code), String(OTP_TTL_MINUTES), target]
  );

  await logContractEvent(getPool(), {
    contractId,
    type: "otp_sent",
    ip: context.ip,
    userAgent: context.userAgent,
    // O código NÃO entra no log — a trilha de auditoria é lida por gente da
    // escola, e quem lê não pode conseguir assinar no lugar do aluno.
    metadata: { to: maskEmail(target), providerId: delivery.id, ttlMinutes: OTP_TTL_MINUTES },
  });

  return { ok: true, maskedEmail: maskEmail(target), ttlMinutes: OTP_TTL_MINUTES };
}

/**
 * Manda a via assinada para o e-mail do aluno.
 *
 * É a peça mais barata e mais valiosa do conjunto probatório: cria uma cópia
 * do documento assinado **fora do controle da escola**, na caixa de entrada de
 * quem assinou. Quem não assinou reclama ao receber; quem assinou e depois
 * negar terá que explicar por que guardou o e-mail calado.
 */
export async function deliverSignedCopy(
  contractId: number,
  snapshot: ContractSnapshot,
  evidence: ContractEvidence,
  file: Buffer
): Promise<void> {
  const target = snapshot.signer.email ?? "";
  if (!isEmailAddress(target)) {
    await logContractEvent(getPool(), {
      contractId,
      type: "signed_copy_failed",
      metadata: { reason: "sem_email" },
    }).catch(() => undefined);
    return;
  }

  const contractNumber = `${contractId}/${evidence.version}`;
  const signedAtBr = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(evidence.signedAt));

  const body = {
    signerName: evidence.signerName,
    courseName: snapshot.course.name,
    company: snapshot.company.name,
    contractNumber,
    signedAt: `${signedAtBr} (horário de Brasília)`,
  };

  const delivery = await sendEmail({
    to: target,
    subject: `Contrato assinado — ${snapshot.course.name}`,
    text: signedCopyText(body),
    html: signedCopyHtml(body),
    attachments: [
      { filename: `contrato-${contractId}-assinado.pdf`, content: file },
    ],
  });

  if (delivery.ok) {
    await getPool()
      .query(`UPDATE ${SCHEMA}.contracts SET signed_copy_sent_at = NOW() WHERE id = $1`, [contractId])
      .catch(() => undefined);
  }

  await logContractEvent(getPool(), {
    contractId,
    type: delivery.ok ? "signed_copy_sent" : "signed_copy_failed",
    metadata: delivery.ok
      ? { to: maskEmail(target), providerId: delivery.id }
      : { to: maskEmail(target), reason: delivery.reason, detail: delivery.message },
  }).catch(() => undefined);
}

export type SendOtpResult =
  | { ok: true; maskedEmail: string; ttlMinutes: number }
  | {
      ok: false;
      reason: "nao_encontrado" | "indisponivel" | "sem_email" | "muitos_envios" | "falha_envio";
      message: string;
    };

export type SignContractResult =
  | { ok: true; contractId: number }
  | { ok: false; reason: SignRejectionReason | "nao_encontrado"; message: string };

/**
 * Registra a assinatura eletrônica: valida, monta o PDF com o termo de
 * evidências e guarda o arquivo. Tudo dentro de uma transação com `FOR UPDATE`
 * — dois cliques no botão não podem gerar duas assinaturas.
 */
export async function signContractByToken(
  token: string,
  input: {
    name: string;
    cpf: string;
    accepted: boolean;
    reachedEnd: boolean;
    otpCode: string;
    ip: string | null;
    userAgent: string | null;
  }
): Promise<SignContractResult> {
  const row = await findByToken(token);
  if (!row) {
    return { ok: false, reason: "nao_encontrado", message: "Contrato não encontrado." };
  }

  const contractId = Number(row.id);
  // Mesmo bloco de escola que a pessoa viu na tela: é daqui que sai o PDF
  // assinado e o hash do conteúdo, então tem que ser o mesmo texto.
  const snapshot = await withCurrentCompany(row.snapshot, String(row.status));

  const { rows: failureRows } = await getPool().query<{ total: string }>(
    `SELECT COUNT(*) AS total
       FROM ${SCHEMA}.contract_events
      WHERE contract_id = $1
        AND type = 'sign_rejected'
        AND at > NOW() - ($2 || ' minutes')::interval`,
    [contractId, String(SIGN_FAILURE_WINDOW_MINUTES)]
  );
  if (Number(failureRows[0]?.total ?? 0) >= MAX_SIGN_FAILURES) {
    return {
      ok: false,
      reason: "muitas_tentativas",
      message: SIGN_REJECTION_MESSAGES.muitas_tentativas,
    };
  }

  const decision = evaluateSignAttempt(
    {
      status: String(row.status) as ContractStatus,
      expiresAt: toIso(row.expires_at),
      signerCpf: row.signer_cpf,
      documentReady: missingContractFields(snapshot).length === 0,
      openedAt: toIso(row.first_opened_at),
      otp: otpStateOf(row),
    },
    {
      name: input.name,
      cpf: input.cpf,
      accepted: input.accepted,
      reachedEnd: input.reachedEnd,
      otpCode: input.otpCode,
    }
  );

  if (!decision.ok) {
    // Código errado gasta uma tentativa. Sem isso o teto de 5 seria decorativo
    // e daria para varrer o milhão de combinações no mesmo código.
    if (decision.reason === "otp_invalido") {
      await getPool()
        .query(
          `UPDATE ${SCHEMA}.contracts SET otp_attempts = otp_attempts + 1, updated_at = NOW()
            WHERE id = $1`,
          [contractId]
        )
        .catch(() => undefined);
      await logContractEvent(getPool(), {
        contractId,
        type: "otp_failed",
        ip: input.ip,
        userAgent: input.userAgent,
        metadata: { attempts: Number(row.otp_attempts ?? 0) + 1 },
      }).catch(() => undefined);
    }
    await logContractEvent(getPool(), {
      contractId,
      type: "sign_rejected",
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: { reason: decision.reason },
    }).catch(() => undefined);
    return { ok: false, reason: decision.reason, message: decision.message };
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows: locked } = await client.query<{ status: string }>(
      `SELECT status FROM ${SCHEMA}.contracts WHERE id = $1 FOR UPDATE`,
      [contractId]
    );
    if (!locked[0] || locked[0].status !== "pendente") {
      await client.query("ROLLBACK");
      return { ok: false, reason: "ja_assinado", message: "Este contrato já foi assinado." };
    }

    const signedAt = new Date().toISOString();
    const evidence: ContractEvidence = {
      contractId,
      version: Number(row.version) || 1,
      signedAt,
      signerName: decision.name,
      signerCpf: decision.cpf,
      cpfVerified: decision.cpfVerified,
      ip: input.ip,
      userAgent: input.userAgent,
      openedAt: toIso(row.first_opened_at),
      linkReference: linkReference(token),
      contentHash: hashContractSnapshot(snapshot),
      acceptanceText: CONTRACT_ACCEPTANCE_TEXT,
      readingSeconds: decision.readingSeconds,
      minReadingSeconds: MIN_READING_SECONDS,
      reachedEnd: input.reachedEnd,
      otpVerified: decision.otpVerified,
      otpSentTo: row.otp_sent_to,
    };

    const file = await buildContractPdf({
      snapshot,
      contractId,
      version: evidence.version,
      variant: "digital",
      evidence,
    });
    const fileHash = hashContractFile(file);

    await client.query(
      `UPDATE ${SCHEMA}.contracts
          SET status = 'assinado', signature_kind = 'eletronica', signed_at = $2, signed_name = $3,
              signed_cpf = $4, signed_ip = $5, signed_user_agent = $6, cpf_verified = $7,
              signed_file = $8, signed_file_hash = $9, signed_file_mime = 'application/pdf',
              updated_at = NOW()
        WHERE id = $1`,
      [
        contractId,
        signedAt,
        decision.name,
        decision.cpf,
        input.ip,
        input.userAgent,
        decision.cpfVerified,
        file,
        fileHash,
      ]
    );

    // Código consumido: some do banco no mesmo COMMIT da assinatura, para não
    // ficar reutilizável nem legível depois.
    await client.query(
      `UPDATE ${SCHEMA}.contracts
          SET otp_hash = NULL, otp_expires_at = NULL, otp_verified_at = COALESCE(otp_verified_at, NOW())
        WHERE id = $1`,
      [contractId]
    );

    await logContractEvent(client, {
      contractId,
      type: "signed",
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: {
        signerName: decision.name,
        cpfVerified: decision.cpfVerified,
        contentHash: evidence.contentHash,
        fileHash,
        linkReference: evidence.linkReference,
        readingSeconds: evidence.readingSeconds,
        reachedEnd: evidence.reachedEnd,
        otpVerified: evidence.otpVerified,
        otpSentTo: evidence.otpSentTo ? maskEmail(evidence.otpSentTo) : null,
      },
    });

    await client.query("COMMIT");

    // DEPOIS do COMMIT, e fora da transação: a via assinada vai para o e-mail
    // do aluno. Falhar aqui não pode desfazer a assinatura — o contrato já
    // existe e é válido; o que se perde é a cópia automática, que fica
    // registrada como falha e pode ser reenviada pelo CRM.
    void deliverSignedCopy(contractId, snapshot, evidence, file).catch(() => undefined);

    // Quem assinou é o aluno, sem sessão no dashboard: o movimento entra na
    // linha do tempo sem autor, com o motivo no payload.
    await moveLeadCardToClientBoard(null, contractId);

    return { ok: true, contractId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

// ── Arquivo ──────────────────────────────────────────────────────

export interface ContractFile {
  file: Buffer;
  filename: string;
  mime: string;
  signed: boolean;
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * O arquivo do contrato.
 *
 * Assinado (eletrônico ou digitalizado) devolve o arquivo guardado — a via
 * oficial, que não se regenera. Pendente devolve a prévia gerada na hora, na
 * variante pedida: `digital` (para ler/conferir) ou `impressao` (com as linhas
 * de assinatura e testemunhas para assinar à caneta).
 */
export async function getContractFile(
  contractId: number,
  variant: ContractPdfVariant = "digital"
): Promise<ContractFile | null> {
  await ensureContractsSchema();
  const { rows } = await getPool().query<{
    version: string;
    status: string;
    snapshot: ContractSnapshot;
    signed_file: Buffer | null;
    signed_file_mime: string | null;
    signer_name: string;
  }>(
    `SELECT version, status, snapshot, signed_file, signed_file_mime, signer_name
       FROM ${SCHEMA}.contracts WHERE id = $1`,
    [contractId]
  );
  const row = rows[0];
  if (!row) return null;

  const slug = slugify(row.signer_name) || "matricula";

  if (row.signed_file) {
    const mime = row.signed_file_mime ?? "application/pdf";
    return {
      file: row.signed_file,
      filename: `contrato-${contractId}-${slug}-assinado.${EXTENSION_BY_MIME[mime] ?? "pdf"}`,
      mime,
      signed: true,
    };
  }

  // Contrato ainda não assinado: o PDF sai com os dados atuais da escola. O
  // caminho do arquivo ASSINADO já saiu acima, lendo `signed_file` do banco —
  // aquele nunca é regerado, então nada aqui alcança um contrato fechado.
  const file = await buildContractPdf({
    snapshot: await withCurrentCompany(row.snapshot, row.status),
    contractId,
    version: Number(row.version) || 1,
    variant,
    evidence: null,
  });
  return {
    file,
    filename: `contrato-${contractId}-${slug}${variant === "impressao" ? "-para-assinar" : ""}.pdf`,
    mime: "application/pdf",
    signed: false,
  };
}

export async function getContractFileByToken(token: string): Promise<ContractFile | null> {
  const row = await findByToken(token);
  if (!row) return null;
  return getContractFile(Number(row.id), "digital");
}

export async function registerContractDownload(
  contractId: number,
  context: {
    actor?: DashboardUser | null;
    ip?: string | null;
    userAgent?: string | null;
    type?: ContractEventType;
  }
): Promise<void> {
  await logContractEvent(getPool(), {
    contractId,
    type: context.type ?? "downloaded",
    actor: context.actor ?? null,
    ip: context.ip ?? null,
    userAgent: context.userAgent ?? null,
  }).catch(() => undefined);
}

export interface EnrollmentWithoutContract {
  enrollmentId: number;
  student: string;
  courseName: string | null;
  amount: number;
  saleDate: string | null;
  sellerName: string | null;
  /**
   * Rateio já combinado no fechamento da venda. É ELE o valor padrão da tela de
   * gerar contrato — jogar tudo em "curso" apagaria a matrícula e o material que
   * o vendedor separou, e obrigaria a redigitar.
   *
   * `null` quando a venda não combinou rateio (venda antiga ou lançada fora do
   * modal): aí o padrão é o valor da matrícula inteiro em curso, e a pessoa
   * ajusta como quiser.
   */
  planSplit: ContractPlanSplit | null;
}

/**
 * Matrículas que ainda não têm contrato válido — a fila do botão "Gerar
 * contrato".
 *
 * Contrato CANCELADO não conta como existente: cancelar é justamente o caminho
 * para refazer, e sem esta regra a matrícula sumiria da fila e ninguém
 * conseguiria gerar o novo.
 */
export async function listEnrollmentsWithoutContract(): Promise<EnrollmentWithoutContract[]> {
  await ensureContractsSchema();
  const { rows } = await getPool().query<{
    id: string;
    student: string;
    course_name: string | null;
    total_amount: string;
    sale_date: string | null;
    seller_name: string | null;
    contract_plan: unknown;
  }>(
    `SELECT e.id, e.student, c.name AS course_name, e.total_amount,
            e.sale_date::text AS sale_date, s.name AS seller_name,
            e.contract_plan
       FROM ${SCHEMA}.finance_enrollments e
       LEFT JOIN ${SCHEMA}.finance_courses c ON c.id = e.course_id
       LEFT JOIN ${SCHEMA}.finance_sellers s ON s.id = e.seller_id
      WHERE NOT EXISTS (
        SELECT 1 FROM ${SCHEMA}.contracts ct
         WHERE ct.enrollment_id = e.id AND ct.status <> 'cancelado'
      )
      ORDER BY e.sale_date DESC NULLS LAST, e.id DESC
      LIMIT 200`
  );
  return rows.map((row) => ({
    enrollmentId: Number(row.id),
    student: row.student,
    courseName: row.course_name,
    amount: Number(row.total_amount) || 0,
    saleDate: row.sale_date,
    sellerName: row.seller_name,
    planSplit: parsePlanSplitValue(row.contract_plan),
  }));
}
