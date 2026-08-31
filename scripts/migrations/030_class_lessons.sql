-- Aulas com data e professores por turma.
--
-- Até aqui a turma só tinha grade semanal (dia da semana + hora). Sem aula com
-- data não havia plano de aulas, nem como pular feriado, nem chamada por aula.
-- Idempotente: as mesmas instruções rodam no boot (ensureAcademicSchema).

CREATE TABLE IF NOT EXISTS dashboard.academic_class_lessons (
  id                  BIGSERIAL PRIMARY KEY,
  class_id            BIGINT NOT NULL REFERENCES dashboard.academic_classes(id) ON DELETE CASCADE,
  sequence            INTEGER NOT NULL,
  lesson_date         DATE NOT NULL,
  start_time          TIME,
  end_time            TIME,
  teacher_employee_id BIGINT REFERENCES dashboard.finance_employees(id),
  room_id             BIGINT REFERENCES dashboard.academic_rooms(id),
  status              TEXT NOT NULL DEFAULT 'planejada'
                      CHECK (status IN ('planejada','realizada','cancelada','reposicao')),
  topic               TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (class_id, sequence)
);

CREATE INDEX IF NOT EXISTS academic_class_lessons_date_idx
  ON dashboard.academic_class_lessons (lesson_date);

CREATE TABLE IF NOT EXISTS dashboard.academic_class_teachers (
  class_id    BIGINT NOT NULL REFERENCES dashboard.academic_classes(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES dashboard.finance_employees(id),
  role        TEXT NOT NULL DEFAULT 'titular' CHECK (role IN ('titular','auxiliar')),
  PRIMARY KEY (class_id, employee_id)
);

-- Cursos: nº de aulas, carga horária e rateio do contrato.
ALTER TABLE dashboard.finance_courses ADD COLUMN IF NOT EXISTS lessons_count    INTEGER;
ALTER TABLE dashboard.finance_courses ADD COLUMN IF NOT EXISTS lesson_hours     NUMERIC;
ALTER TABLE dashboard.finance_courses ADD COLUMN IF NOT EXISTS lessons_per_week INTEGER NOT NULL DEFAULT 1;
ALTER TABLE dashboard.finance_courses ADD COLUMN IF NOT EXISTS enrollment_fee   NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE dashboard.finance_courses ADD COLUMN IF NOT EXISTS material_fee     NUMERIC NOT NULL DEFAULT 0;
