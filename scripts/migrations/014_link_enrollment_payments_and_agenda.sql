-- Vincula cada pagamento real à parcela/mês previsto da matrícula e
-- adiciona a capacidade configurável das turmas para a Agenda Financeira.

BEGIN;

ALTER TABLE dashboard.finance_enrollment_payments
  ADD COLUMN IF NOT EXISTS revenue_id BIGINT
    REFERENCES dashboard.finance_revenues(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS asaas_payment_url TEXT;

CREATE INDEX IF NOT EXISTS idx_finance_enrollment_payments_revenue
  ON dashboard.finance_enrollment_payments(revenue_id);

CREATE TABLE IF NOT EXISTS dashboard.finance_training_capacities (
  id BIGSERIAL PRIMARY KEY,
  training_id TEXT NOT NULL UNIQUE,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_training_capacities_training
  ON dashboard.finance_training_capacities(training_id);

COMMIT;
