import { getPool } from "@/lib/db";
import { ensureFinanceSchema } from "@/lib/finance";
import { upsertStudentContractProfile } from "@/lib/academicStudents";
import type { ContractStudentProfile } from "@/lib/contractProfile";

/**
 * Alunos ADICIONAIS de uma matrícula — o caso do casal (ou da dupla de amigos)
 * que compra junto e tem **um contrato só**, pago por uma pessoa.
 *
 * O aluno que paga continua sendo a matrícula: é dele o `student_id`, o
 * `course_id` e o `total_amount` que o Financeiro cobra. Esta tabela guarda
 * quem entra junto, com o treinamento e o valor de cada um. O valor do pagador
 * é o que sobra do total (ver `payerAmount`) — assim a soma fecha sozinha e
 * não existe a possibilidade de o contrato dizer um número e a cobrança outro.
 *
 * O quadro pessoal (RG, endereço, profissão) não é copiado para cá: cada
 * participante tem ficha em `academic_students`, a mesma do aluno pagador. Sem
 * isso, a segunda pessoa existiria só dentro do PDF e não seria aluna da
 * escola — não entraria em turma nem apareceria em `/alunos`.
 */

const SCHEMA = "dashboard";

let schemaReady = false;

export interface EnrollmentParticipantInput {
  /** Quadro do contrato da segunda pessoa — as mesmas regras do pagador. */
  profile: ContractStudentProfile;
  /**
   * Lead do CRM desta pessoa, quando ela já é um lead. É o que permite puxar a
   * ficha pronta na venda e manter o vínculo depois: a ficha de aluno nasce
   * amarrada ao lead dela, não ao de quem paga.
   */
  leadInscricaoId?: number | null;
  /** Treinamento dela, que pode ser diferente do treinamento do pagador. */
  courseId: number;
  /** Quanto do total do contrato é o curso desta pessoa. */
  amount: number;
  /** Turma dela no item 3 — texto livre, como a do pagador. */
  className?: string | null;
  /**
   * Turma DE VERDADE (`academic_classes`) desta pessoa. Comprar junto não
   * obriga a estudar no mesmo horário, então cada participante tem a sua. É
   * este id — e não o texto de `className` — que coloca a pessoa no diário de
   * classe; sem ele o segundo aluno do contrato existia só dentro do PDF.
   */
  classId?: number | null;
}

export interface EnrollmentParticipant {
  id: number;
  studentId: number | null;
  leadInscricaoId: number | null;
  courseId: number | null;
  courseName: string | null;
  amount: number;
  className: string | null;
  classId: number | null;
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export async function ensureEnrollmentParticipantsSchema(): Promise<void> {
  if (schemaReady) return;
  await ensureFinanceSchema();

  await getPool().query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.finance_enrollment_participants (
      id            BIGSERIAL PRIMARY KEY,
      enrollment_id BIGINT NOT NULL
                    REFERENCES ${SCHEMA}.finance_enrollments(id) ON DELETE CASCADE,
      student_id    BIGINT,
      lead_inscricao_id BIGINT,
      course_id     BIGINT,
      amount        NUMERIC NOT NULL DEFAULT 0,
      class_name    TEXT,
      sort          INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Tabela criada antes desta coluna existir (22/08/2026, primeira versão do
    -- contrato de casal) continua válida: a coluna entra sem migração manual.
    ALTER TABLE ${SCHEMA}.finance_enrollment_participants
      ADD COLUMN IF NOT EXISTS lead_inscricao_id BIGINT,
      ADD COLUMN IF NOT EXISTS class_name TEXT,
      ADD COLUMN IF NOT EXISTS class_id BIGINT;

    CREATE INDEX IF NOT EXISTS idx_enrollment_participants_enrollment
      ON ${SCHEMA}.finance_enrollment_participants (enrollment_id);
  `);

  schemaReady = true;
}

export async function listEnrollmentParticipants(
  enrollmentId: number
): Promise<EnrollmentParticipant[]> {
  await ensureEnrollmentParticipantsSchema();
  const { rows } = await getPool().query(
    `SELECT p.id, p.student_id, p.lead_inscricao_id, p.course_id, p.amount, p.class_name, p.class_id,
            c.name AS course_name
       FROM ${SCHEMA}.finance_enrollment_participants p
       LEFT JOIN ${SCHEMA}.finance_courses c ON c.id = p.course_id
      WHERE p.enrollment_id = $1
      ORDER BY p.sort, p.id`,
    [enrollmentId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    studentId: row.student_id === null ? null : Number(row.student_id),
    leadInscricaoId: row.lead_inscricao_id === null ? null : Number(row.lead_inscricao_id),
    courseId: row.course_id === null ? null : Number(row.course_id),
    courseName: (row.course_name as string | null) ?? null,
    amount: num(row.amount),
    className: (row.class_name as string | null) ?? null,
    classId: row.class_id === null ? null : Number(row.class_id),
  }));
}

/** Soma dos alunos adicionais — o que NÃO é do pagador. */
export async function participantsTotal(enrollmentId: number): Promise<number> {
  const participants = await listEnrollmentParticipants(enrollmentId);
  return round2(participants.reduce((sum, item) => sum + item.amount, 0));
}

/**
 * O que sobra para o pagador depois dos alunos adicionais. Nunca negativo: um
 * contrato que cobra do pagador menos do que zero seria um erro de digitação
 * virando documento assinado.
 */
export function payerAmount(total: number, participants: Array<{ amount: number }>): number {
  const others = participants.reduce((sum, item) => sum + num(item.amount), 0);
  return Math.max(0, round2(total - others));
}

/**
 * Reescreve a lista de alunos adicionais da matrícula.
 *
 * Substituição inteira, e não merge: a tela manda sempre o combinado atual, e
 * casar linha a linha exigiria um id estável que o formulário não tem. Cada
 * participante ganha (ou reencontra pelo CPF) a ficha de aluno antes — é ela
 * que o contrato lê para montar o quadro dele.
 */
export async function replaceEnrollmentParticipants(
  enrollmentId: number,
  participants: EnrollmentParticipantInput[],
  actor: { id?: number | null; name?: string | null } = {}
): Promise<void> {
  await ensureEnrollmentParticipantsSchema();

  const studentIds: Array<number | null> = [];
  for (const participant of participants) {
    // Com lead escolhido na venda, a ficha nasce amarrada a ELE — é o que
    // mantém o histórico do co-aluno ligado ao card dele no CRM. Sem lead, o
    // reencontro é pelo CPF, como o de quem já era aluno e voltou.
    studentIds.push(
      await upsertStudentContractProfile(
        participant.leadInscricaoId ?? null,
        participant.profile,
        actor
      )
    );
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM ${SCHEMA}.finance_enrollment_participants WHERE enrollment_id = $1`,
      [enrollmentId]
    );
    for (const [index, participant] of participants.entries()) {
      await client.query(
        `INSERT INTO ${SCHEMA}.finance_enrollment_participants
           (enrollment_id, student_id, lead_inscricao_id, course_id, amount, class_name, class_id, sort)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          enrollmentId,
          studentIds[index],
          participant.leadInscricaoId ?? null,
          participant.courseId || null,
          round2(num(participant.amount)),
          participant.className?.trim() || null,
          participant.classId && participant.classId > 0 ? participant.classId : null,
          index,
        ]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
