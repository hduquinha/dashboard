-- Permite criar turmas diretamente pela Agenda Financeira, sem catálogo de cursos.

BEGIN;

ALTER TABLE dashboard.finance_training_schedules
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS product TEXT CHECK (product IN ('online', 'up-day-plus')),
  ADD COLUMN IF NOT EXISTS days_per_meeting INTEGER NOT NULL DEFAULT 1
    CHECK (days_per_meeting BETWEEN 1 AND 7);

COMMIT;
