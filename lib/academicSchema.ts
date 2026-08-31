import { getPool } from "@/lib/db";
import { ensureFinanceSchema } from "@/lib/finance";

/**
 * DDL do módulo acadêmico (aluno, responsável, turma).
 *
 * Fica numa lib própria porque duas libs de domínio dependem dela
 * (`academicStudents` e `academicClasses`) e o schema precisa nascer inteiro:
 * `academic_class_students` referencia aluno E turma, então criar por partes
 * quebraria dependendo de qual tela abrisse primeiro.
 *
 * Chama `ensureFinanceSchema()` antes de tudo porque as FKs apontam para
 * `finance_courses`, `finance_employees` e `finance_enrollments` — mesma lição do
 * catálogo de treinamentos, em que ler o catálogo antes de qualquer tela financeira
 * quebrava com "column does not exist".
 */

const SCHEMA = "dashboard";

/** Chave própria (não colide com coupons/metaAds) para serializar o DDL. */
const SCHEMA_ADVISORY_LOCK_KEY = 918477;

let schemaReady = false;
let schemaPromise: Promise<void> | null = null;

async function ensureAcademicSchemaOnce(): Promise<void> {
  await ensureFinanceSchema();

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // O dashboard sobe vários workers. Sem o lock, dois deles chegam juntos no
    // CREATE TABLE IF NOT EXISTS e o perdedor da corrida morre com 23505 em
    // pg_class ao tentar criar a mesma sequence — foi o que já derrubou /cupons.
    await client.query("SELECT pg_advisory_xact_lock($1)", [SCHEMA_ADVISORY_LOCK_KEY]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.academic_guardians (
        id            BIGSERIAL PRIMARY KEY,
        full_name     TEXT NOT NULL,
        cpf           TEXT,
        email         TEXT,
        phone         TEXT,
        relationship  TEXT,
        birth_date    DATE,
        notes         TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS academic_guardians_cpf_key
        ON ${SCHEMA}.academic_guardians (cpf) WHERE cpf IS NOT NULL;

      CREATE TABLE IF NOT EXISTS ${SCHEMA}.academic_students (
        id                 BIGSERIAL PRIMARY KEY,
        full_name          TEXT NOT NULL,
        cpf                TEXT,
        birth_date         DATE,
        email              TEXT,
        phone              TEXT,
        city               TEXT,
        status             TEXT NOT NULL DEFAULT 'ativo'
                           CHECK (status IN ('ativo','inativo','trancado','concluido')),
        guardian_id        BIGINT REFERENCES ${SCHEMA}.academic_guardians(id),
        lead_inscricao_id  BIGINT,
        notes              TEXT,
        created_by_user_id BIGINT,
        created_by_name    TEXT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS academic_students_cpf_key
        ON ${SCHEMA}.academic_students (cpf) WHERE cpf IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS academic_students_lead_key
        ON ${SCHEMA}.academic_students (lead_inscricao_id) WHERE lead_inscricao_id IS NOT NULL;
      -- Sem FK entre schemas (mesmo padrão de finance_enrollments.lead_inscricao_id):
      -- o lead pode ser mesclado/excluído sem derrubar o cadastro do aluno.
      CREATE INDEX IF NOT EXISTS academic_students_lead_idx
        ON ${SCHEMA}.academic_students (lead_inscricao_id) WHERE lead_inscricao_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS academic_students_status_idx
        ON ${SCHEMA}.academic_students (status);

      CREATE TABLE IF NOT EXISTS ${SCHEMA}.academic_rooms (
        id       BIGSERIAL PRIMARY KEY,
        name     TEXT NOT NULL,
        capacity INTEGER CHECK (capacity IS NULL OR capacity > 0),
        active   BOOLEAN NOT NULL DEFAULT TRUE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS academic_rooms_active_name_key
        ON ${SCHEMA}.academic_rooms (LOWER(name)) WHERE active;

      CREATE TABLE IF NOT EXISTS ${SCHEMA}.academic_classes (
        id                  BIGSERIAL PRIMARY KEY,
        name                TEXT NOT NULL,
        course_id           BIGINT REFERENCES ${SCHEMA}.finance_courses(id),
        modality            TEXT NOT NULL DEFAULT 'modular'
                            CHECK (modality IN ('modular','ciclica')),
        level               TEXT,
        start_date          DATE,
        end_date            DATE,
        capacity            INTEGER CHECK (capacity IS NULL OR capacity > 0),
        room_id             BIGINT REFERENCES ${SCHEMA}.academic_rooms(id),
        teacher_employee_id BIGINT REFERENCES ${SCHEMA}.finance_employees(id),
        status              TEXT NOT NULL DEFAULT 'planejada'
                            CHECK (status IN ('planejada','ativa','encerrada')),
        -- Ponte opcional com o "treinamento string" (lib/trainings.ts): a turma nova
        -- CONVIVE com o modelo antigo em vez de substituí-lo, para CRM, mídia paga e
        -- presença do Encontro Online continuarem contando como sempre contaram.
        training_id         TEXT,
        notes               TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS academic_classes_status_idx
        ON ${SCHEMA}.academic_classes (status);

      CREATE TABLE IF NOT EXISTS ${SCHEMA}.academic_class_schedule (
        id                  BIGSERIAL PRIMARY KEY,
        class_id            BIGINT NOT NULL REFERENCES ${SCHEMA}.academic_classes(id) ON DELETE CASCADE,
        weekday             SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
        start_time          TIME NOT NULL,
        end_time            TIME NOT NULL,
        -- Professor por linha (e não só na turma) porque revezamento semanal/quinzenal
        -- é rotina: a aula de terça pode ser de outro professor.
        teacher_employee_id BIGINT REFERENCES ${SCHEMA}.finance_employees(id),
        room_id             BIGINT REFERENCES ${SCHEMA}.academic_rooms(id),
        CONSTRAINT academic_class_schedule_time_check CHECK (end_time > start_time)
      );

      CREATE INDEX IF NOT EXISTS academic_class_schedule_class_idx
        ON ${SCHEMA}.academic_class_schedule (class_id);

      -- Aluno NA turma. Aqui o UNIQUE faz sentido (é cadastro, não evento) —
      -- ao contrário do inscricoes_v2, que usou UNIQUE em cima de envio de
      -- formulário e por isso não conseguia representar recontato.
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.academic_class_students (
        id                    BIGSERIAL PRIMARY KEY,
        class_id              BIGINT NOT NULL REFERENCES ${SCHEMA}.academic_classes(id),
        student_id            BIGINT NOT NULL REFERENCES ${SCHEMA}.academic_students(id),
        status                TEXT NOT NULL DEFAULT 'ativa'
                              CHECK (status IN ('ativa','trancada','cancelada','concluida')),
        start_date            DATE,
        end_date              DATE,
        finance_enrollment_id BIGINT REFERENCES ${SCHEMA}.finance_enrollments(id),
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (class_id, student_id)
      );

      CREATE INDEX IF NOT EXISTS academic_class_students_student_idx
        ON ${SCHEMA}.academic_class_students (student_id);

      -- A aula de verdade: uma linha por DATA, gerada a partir do número de
      -- aulas do curso pulando feriado (ver lib/lessonPlan.ts). A grade semanal
      -- (academic_class_schedule) continua descrevendo o horário padrão; esta
      -- tabela é o que aconteceu/vai acontecer, e é o que permite chamada por
      -- aula, reposição e "a turma está na aula 7 de 24".
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.academic_class_lessons (
        id                  BIGSERIAL PRIMARY KEY,
        class_id            BIGINT NOT NULL REFERENCES ${SCHEMA}.academic_classes(id) ON DELETE CASCADE,
        sequence            INTEGER NOT NULL,
        lesson_date         DATE NOT NULL,
        start_time          TIME,
        end_time            TIME,
        teacher_employee_id BIGINT REFERENCES ${SCHEMA}.finance_employees(id),
        room_id             BIGINT REFERENCES ${SCHEMA}.academic_rooms(id),
        status              TEXT NOT NULL DEFAULT 'planejada'
                            CHECK (status IN ('planejada','realizada','cancelada','reposicao')),
        topic               TEXT,
        notes               TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (class_id, sequence)
      );

      CREATE INDEX IF NOT EXISTS academic_class_lessons_date_idx
        ON ${SCHEMA}.academic_class_lessons (lesson_date);

      -- Chamada: uma linha por aluno POR AULA. A ausência de linha NÃO é falta —
      -- é chamada não lançada, e o cálculo de presença considera só o que foi
      -- lançado. Sem essa distinção, turma com quadro de 24 aulas nasceria com
      -- 100% de falta no dia em que a primeira aula fosse gerada.
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.academic_lesson_attendance (
        lesson_id  BIGINT NOT NULL REFERENCES ${SCHEMA}.academic_class_lessons(id) ON DELETE CASCADE,
        student_id BIGINT NOT NULL REFERENCES ${SCHEMA}.academic_students(id) ON DELETE CASCADE,
        status     TEXT NOT NULL CHECK (status IN ('presente','falta','justificada')),
        note       TEXT,
        marked_by  TEXT,
        marked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (lesson_id, student_id)
      );

      CREATE INDEX IF NOT EXISTS academic_lesson_attendance_student_idx
        ON ${SCHEMA}.academic_lesson_attendance (student_id);

      -- Reposição: a aula perdida e a aula onde ela vai ser reposta.
      --
      -- Nesta escola o aluno só se forma assistindo a TODAS as aulas, e a
      -- reposição normal é assistir a mesma aula (nº 5 é nº 5) numa turma
      -- paralela do mesmo curso. Guardar o par é o que permite dizer "a aula 5
      -- do Fulano está reposta" — sem ele, a presença na outra turma seria só
      -- uma linha solta de chamada, sem fechar a falta.
      --
      -- Não há coluna de situação de propósito: se a reposição aconteceu quem
      -- responde é a chamada da aula de destino.
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.academic_lesson_makeups (
        id               BIGSERIAL PRIMARY KEY,
        student_id       BIGINT NOT NULL REFERENCES ${SCHEMA}.academic_students(id) ON DELETE CASCADE,
        missed_lesson_id BIGINT NOT NULL REFERENCES ${SCHEMA}.academic_class_lessons(id) ON DELETE CASCADE,
        makeup_lesson_id BIGINT NOT NULL REFERENCES ${SCHEMA}.academic_class_lessons(id) ON DELETE CASCADE,
        created_by       TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (student_id, missed_lesson_id)
      );

      CREATE INDEX IF NOT EXISTS academic_lesson_makeups_destino_idx
        ON ${SCHEMA}.academic_lesson_makeups (makeup_lesson_id);

      -- Turma com mais de um professor. O papel importa: o titular é quem
      -- responde pela turma nos relatórios; auxiliar acompanha.
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.academic_class_teachers (
        class_id    BIGINT NOT NULL REFERENCES ${SCHEMA}.academic_classes(id) ON DELETE CASCADE,
        employee_id BIGINT NOT NULL REFERENCES ${SCHEMA}.finance_employees(id),
        role        TEXT NOT NULL DEFAULT 'titular' CHECK (role IN ('titular','auxiliar')),
        PRIMARY KEY (class_id, employee_id)
      );

      -- Uma tabela, dois usos: não gerar aula em feriado (didático) e empurrar
      -- vencimento para o próximo dia útil (financeiro).
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.academic_calendar_days (
        day    DATE PRIMARY KEY,
        kind   TEXT NOT NULL CHECK (kind IN ('feriado','recesso','letivo_extra')),
        label  TEXT,
        scope  TEXT NOT NULL DEFAULT 'ambos' CHECK (scope IN ('didatico','financeiro','ambos'))
      );

      -- Regras de campo obrigatório são dado operacional, não constante de código:
      -- a secretaria consegue endurecer ou flexibilizar o cadastro sem novo deploy.
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.academic_settings (
        key        TEXT PRIMARY KEY,
        value      JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Contrato financeiro passa a apontar para o aluno de verdade. A coluna
      -- "student" (texto) CONTINUA sendo preenchida: é dela que a conciliação por
      -- nome do relatório de mídia depende (lib/enrollmentOrigin.ts).
      ALTER TABLE ${SCHEMA}.finance_enrollments
        ADD COLUMN IF NOT EXISTS student_id BIGINT REFERENCES ${SCHEMA}.academic_students(id),
        ADD COLUMN IF NOT EXISTS class_id   BIGINT REFERENCES ${SCHEMA}.academic_classes(id),
        -- Rateio do item 4 do contrato (matrícula / material / curso). O
        -- Financeiro só conhece o total; a divisão é combinada na venda.
        ADD COLUMN IF NOT EXISTS contract_plan JSONB,
        -- Item 3 do contrato. Carga horária e turma são combinadas na venda e
        -- não existem no catálogo do Financeiro (que só tem preço e parcelas).
        ADD COLUMN IF NOT EXISTS contract_course_hours TEXT,
        ADD COLUMN IF NOT EXISTS contract_class_name   TEXT;

      -- Quadro do CONTRATANTE (item 2 do contrato). Ficavam em branco no PDF
      -- porque o cadastro do aluno nasceu só com o essencial da secretaria.
      ALTER TABLE ${SCHEMA}.academic_students
        ADD COLUMN IF NOT EXISTS rg           TEXT,
        ADD COLUMN IF NOT EXISTS profession   TEXT,
        ADD COLUMN IF NOT EXISTS company      TEXT,
        ADD COLUMN IF NOT EXISTS landline     TEXT,
        ADD COLUMN IF NOT EXISTS address      TEXT,
        ADD COLUMN IF NOT EXISTS neighborhood TEXT,
        ADD COLUMN IF NOT EXISTS state        TEXT,
        ADD COLUMN IF NOT EXISTS zip          TEXT;

      CREATE INDEX IF NOT EXISTS finance_enrollments_student_idx
        ON ${SCHEMA}.finance_enrollments (student_id) WHERE student_id IS NOT NULL;

      -- Modo de cobrança da parcela. Nasce 'manual' porque boleto recorrente no
      -- Mercado Pago exige redirecionar o pagador ao init_point do preapproval_plan
      -- (ver docs/plano-substituicao-sponte.md §6) — enquanto isso não existir,
      -- toda mensalidade é baixada à mão. 'recorrente' fica reservado para a Fase 9,
      -- para ligar a automação sem migração nova.
      ALTER TABLE ${SCHEMA}.finance_revenues
        ADD COLUMN IF NOT EXISTS charge_mode TEXT NOT NULL DEFAULT 'manual',
        ADD COLUMN IF NOT EXISTS charge_provider TEXT,
        ADD COLUMN IF NOT EXISTS charge_ref TEXT;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'finance_revenues_charge_mode_check'
            AND conrelid = '${SCHEMA}.finance_revenues'::regclass
        ) THEN
          ALTER TABLE ${SCHEMA}.finance_revenues
            ADD CONSTRAINT finance_revenues_charge_mode_check
            CHECK (charge_mode IN ('manual','link','recorrente'));
        END IF;
      END
      $$;
    `);

    await client.query("COMMIT");
    schemaReady = true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureAcademicSchema(): Promise<void> {
  if (schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = ensureAcademicSchemaOnce().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

export const ACADEMIC_SCHEMA = SCHEMA;
