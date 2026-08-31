-- Matrículas: entrada separada, número de parcelas mensais e rateio de um
-- recebimento entre várias parcelas (ex.: agosto + setembro pagos em agosto).

BEGIN;

ALTER TABLE dashboard.finance_enrollments
  ADD COLUMN IF NOT EXISTS down_payment_amount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS regular_installments INTEGER;

UPDATE dashboard.finance_enrollments
   SET regular_installments = CASE
     WHEN COALESCE(down_payment_amount, 0) > 0 THEN GREATEST(1, installments - 1)
     ELSE GREATEST(1, installments)
   END
 WHERE regular_installments IS NULL;

ALTER TABLE dashboard.finance_enrollments
  ALTER COLUMN regular_installments SET DEFAULT 1,
  ALTER COLUMN regular_installments SET NOT NULL;

CREATE TABLE IF NOT EXISTS dashboard.finance_enrollment_payment_allocations (
  payment_id BIGINT NOT NULL REFERENCES dashboard.finance_enrollment_payments(id) ON DELETE CASCADE,
  revenue_id BIGINT NOT NULL REFERENCES dashboard.finance_revenues(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  PRIMARY KEY (payment_id, revenue_id)
);

CREATE INDEX IF NOT EXISTS idx_finance_enrollment_payment_allocations_revenue
  ON dashboard.finance_enrollment_payment_allocations(revenue_id);

-- Conversão sem perda dos pagamentos antigos: cada um já apontava para uma
-- única parcela, logo seu valor inteiro se torna o primeiro rateio.
INSERT INTO dashboard.finance_enrollment_payment_allocations (payment_id, revenue_id, amount)
SELECT ep.id, ep.revenue_id, ep.amount
  FROM dashboard.finance_enrollment_payments ep
 WHERE ep.revenue_id IS NOT NULL
ON CONFLICT (payment_id, revenue_id) DO NOTHING;

COMMIT;
