-- Agenda recorrente das turmas. Ex.: curso de três meses, toda quarta-feira.
-- A tabela só armazena o calendário; inscrições continuam na origem operacional.

BEGIN;

CREATE TABLE IF NOT EXISTS dashboard.finance_training_schedules (
  id BIGSERIAL PRIMARY KEY,
  training_id TEXT NOT NULL UNIQUE,
  starts_at DATE NOT NULL,
  recurrence TEXT NOT NULL DEFAULT 'once' CHECK (recurrence IN ('once', 'weekly')),
  duration_months INTEGER NOT NULL DEFAULT 1 CHECK (duration_months BETWEEN 1 AND 24),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_training_schedules_training
  ON dashboard.finance_training_schedules(training_id);

COMMIT;
