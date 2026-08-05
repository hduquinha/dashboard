-- Novo tipo de aula e suporte à exclusão de turmas manuais na Agenda.

BEGIN;

ALTER TABLE dashboard.finance_training_schedules
  DROP CONSTRAINT IF EXISTS finance_training_schedules_product_check;

ALTER TABLE dashboard.finance_training_schedules
  ADD CONSTRAINT finance_training_schedules_product_check
  CHECK (product IN ('online', 'up-day-plus', 'curso-oratoria'));

COMMIT;
