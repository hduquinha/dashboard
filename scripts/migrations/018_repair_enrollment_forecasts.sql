-- Corrige previsões antigas geradas com o valor total repetido na 1ª parcela.
-- Só ajusta contratos cujo somatório previsto difere do contrato e não reduz
-- uma parcela abaixo de um recebimento real já vinculado a ela.

BEGIN;

WITH schedule_totals AS (
  SELECT enrollment_id, COUNT(*) AS installments_created, SUM(amount) AS scheduled_total
  FROM dashboard.finance_revenues
  WHERE enrollment_id IS NOT NULL
  GROUP BY enrollment_id
), candidates AS (
  SELECT e.id AS enrollment_id, e.total_amount, e.installments, e.rate_pct
  FROM dashboard.finance_enrollments e
  JOIN schedule_totals st ON st.enrollment_id = e.id
  WHERE st.installments_created = e.installments
    AND st.scheduled_total <> e.total_amount
), expected_parts AS (
  SELECT
    r.id AS revenue_id,
    c.enrollment_id,
    CASE
      WHEN r.installment_number = c.installments
        THEN (ROUND(c.total_amount * 100)::bigint - FLOOR(ROUND(c.total_amount * 100)::numeric / c.installments)::bigint * (c.installments - 1)) / 100.0
      ELSE FLOOR(ROUND(c.total_amount * 100)::numeric / c.installments)::bigint / 100.0
    END AS amount,
    c.rate_pct
  FROM candidates c
  JOIN dashboard.finance_revenues r ON r.enrollment_id = c.enrollment_id
), safe_parts AS (
  SELECT ep.*
  FROM expected_parts ep
  WHERE NOT EXISTS (
    SELECT 1
    FROM dashboard.finance_enrollment_payments payment
    WHERE payment.revenue_id = ep.revenue_id
      AND payment.amount > ep.amount
  )
), safe_enrollments AS (
  SELECT enrollment_id
  FROM safe_parts
  GROUP BY enrollment_id
  HAVING COUNT(*) = (SELECT COUNT(*) FROM expected_parts all_parts WHERE all_parts.enrollment_id = safe_parts.enrollment_id)
)
UPDATE dashboard.finance_revenues r
SET amount = sp.amount,
    fee_amount = ROUND(sp.amount * COALESCE(sp.rate_pct, 0) / 100.0, 2),
    updated_at = NOW()
FROM safe_parts sp
JOIN safe_enrollments se ON se.enrollment_id = sp.enrollment_id
WHERE r.id = sp.revenue_id;

COMMIT;
