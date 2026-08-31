-- 022_academic_core.sql
--
-- Fase 1 da substituição do Sponte: cadastro de aluno matriculado, responsável
-- legal, turma, grade de horário, sala e calendário. Ver o desenho completo e o
-- porquê de cada decisão em docs/plano-substituicao-sponte.md §7.
--
-- Duas regras que este schema materializa:
--
-- 1. ALUNO É CADASTRO, ENVIO DE FORMULÁRIO É EVENTO. O erro do `inscricoes_v2`
--    (migração 002) foi usar UNIQUE (pessoa, treinamento) em cima de envio de
--    formulário — com isso, reenvio da mesma pessoa virava upsert e as métricas de
--    "repetidos"/"recontatos" não tinham como existir. Aqui o UNIQUE só aparece em
--    academic_class_students (aluno na turma), que é cadastro de verdade.
--
-- 2. ALUNO-NA-TURMA ≠ CONTRATO FINANCEIRO. A venda fecha o contrato antes de a
--    logística encaixar o aluno num horário, e trocar de turma no meio do contrato é
--    rotina. Se fossem a mesma coisa, cada troca de horário viraria
--    "cancelamento + nova matrícula" no Financeiro.
--
-- O DDL idempotente equivalente vive em lib/academicSchema.ts
-- (ensureAcademicSchema) — este arquivo existe para o histórico do schema.

CREATE TABLE IF NOT EXISTS dashboard.academic_guardians (
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
  ON dashboard.academic_guardians (cpf) WHERE cpf IS NOT NULL;

CREATE TABLE IF NOT EXISTS dashboard.academic_students (
  id                 BIGSERIAL PRIMARY KEY,
  full_name          TEXT NOT NULL,
  cpf                TEXT,
  birth_date         DATE,
  email              TEXT,
  phone              TEXT,
  city               TEXT,
  status             TEXT NOT NULL DEFAULT 'ativo'
                     CHECK (status IN ('ativo','inativo','trancado','concluido')),
  guardian_id        BIGINT REFERENCES dashboard.academic_guardians(id),
  -- Sem FK entre schemas, igual a finance_enrollments.lead_inscricao_id.
  lead_inscricao_id  BIGINT,
  notes              TEXT,
  created_by_user_id BIGINT,
  created_by_name    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS academic_students_cpf_key
  ON dashboard.academic_students (cpf) WHERE cpf IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS academic_students_lead_key
  ON dashboard.academic_students (lead_inscricao_id) WHERE lead_inscricao_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS academic_students_lead_idx
  ON dashboard.academic_students (lead_inscricao_id) WHERE lead_inscricao_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS academic_students_status_idx
  ON dashboard.academic_students (status);

CREATE TABLE IF NOT EXISTS dashboard.academic_rooms (
  id       BIGSERIAL PRIMARY KEY,
  name     TEXT NOT NULL,
  capacity INTEGER CHECK (capacity IS NULL OR capacity > 0),
  active   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS academic_rooms_active_name_key
  ON dashboard.academic_rooms (LOWER(name)) WHERE active;

CREATE TABLE IF NOT EXISTS dashboard.academic_classes (
  id                  BIGSERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  course_id           BIGINT REFERENCES dashboard.finance_courses(id),
  modality            TEXT NOT NULL DEFAULT 'modular'
                      CHECK (modality IN ('modular','ciclica')),
  level               TEXT,
  start_date          DATE,
  end_date            DATE,
  capacity            INTEGER CHECK (capacity IS NULL OR capacity > 0),
  room_id             BIGINT REFERENCES dashboard.academic_rooms(id),
  teacher_employee_id BIGINT REFERENCES dashboard.finance_employees(id),
  status              TEXT NOT NULL DEFAULT 'planejada'
                      CHECK (status IN ('planejada','ativa','encerrada')),
  -- Ponte com o "treinamento string" de lib/trainings.ts: a turma convive com o
  -- modelo antigo em vez de substituí-lo (CRM, mídia paga e presença dependem dele).
  training_id         TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS academic_classes_status_idx
  ON dashboard.academic_classes (status);

CREATE TABLE IF NOT EXISTS dashboard.academic_class_schedule (
  id                  BIGSERIAL PRIMARY KEY,
  class_id            BIGINT NOT NULL REFERENCES dashboard.academic_classes(id) ON DELETE CASCADE,
  weekday             SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time          TIME NOT NULL,
  end_time            TIME NOT NULL,
  teacher_employee_id BIGINT REFERENCES dashboard.finance_employees(id),
  room_id             BIGINT REFERENCES dashboard.academic_rooms(id),
  CONSTRAINT academic_class_schedule_time_check CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS academic_class_schedule_class_idx
  ON dashboard.academic_class_schedule (class_id);

CREATE TABLE IF NOT EXISTS dashboard.academic_class_students (
  id                    BIGSERIAL PRIMARY KEY,
  class_id              BIGINT NOT NULL REFERENCES dashboard.academic_classes(id),
  student_id            BIGINT NOT NULL REFERENCES dashboard.academic_students(id),
  status                TEXT NOT NULL DEFAULT 'ativa'
                        CHECK (status IN ('ativa','trancada','cancelada','concluida')),
  start_date            DATE,
  end_date              DATE,
  finance_enrollment_id BIGINT REFERENCES dashboard.finance_enrollments(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (class_id, student_id)
);

CREATE INDEX IF NOT EXISTS academic_class_students_student_idx
  ON dashboard.academic_class_students (student_id);

CREATE TABLE IF NOT EXISTS dashboard.academic_calendar_days (
  day    DATE PRIMARY KEY,
  kind   TEXT NOT NULL CHECK (kind IN ('feriado','recesso','letivo_extra')),
  label  TEXT,
  scope  TEXT NOT NULL DEFAULT 'ambos' CHECK (scope IN ('didatico','financeiro','ambos'))
);

CREATE TABLE IF NOT EXISTS dashboard.academic_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A coluna student (texto) CONTINUA existindo e sendo preenchida: é dela que a
-- conciliação por nome de lib/enrollmentOrigin.ts depende.
ALTER TABLE dashboard.finance_enrollments
  ADD COLUMN IF NOT EXISTS student_id BIGINT REFERENCES dashboard.academic_students(id),
  ADD COLUMN IF NOT EXISTS class_id   BIGINT REFERENCES dashboard.academic_classes(id);

CREATE INDEX IF NOT EXISTS finance_enrollments_student_idx
  ON dashboard.finance_enrollments (student_id) WHERE student_id IS NOT NULL;

-- Modo de cobrança da parcela. Nasce 'manual' porque boleto recorrente no Mercado
-- Pago exige redirecionar o pagador ao init_point do /preapproval_plan — enquanto
-- isso não existir (Fase 9), toda mensalidade é baixada à mão. 'recorrente' fica
-- reservado para ligar a automação sem migração nova.
ALTER TABLE dashboard.finance_revenues
  ADD COLUMN IF NOT EXISTS charge_mode TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS charge_provider TEXT,
  ADD COLUMN IF NOT EXISTS charge_ref TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'finance_revenues_charge_mode_check'
      AND conrelid = 'dashboard.finance_revenues'::regclass
  ) THEN
    ALTER TABLE dashboard.finance_revenues
      ADD CONSTRAINT finance_revenues_charge_mode_check
      CHECK (charge_mode IN ('manual','link','recorrente'));
  END IF;
END
$$;
