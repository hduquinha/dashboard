-- Pagamentos de matrícula deixam de ser distribuídos em cascata pelo contrato.
-- Cada pagamento fica ligado à parcela escolhida ou, para dados antigos sem
-- vínculo, à parcela prevista no mesmo mês da data do pagamento.
-- Revise manualmente apenas os registros sem parcela no mesmo mês, que seguem
-- sem vínculo para não inventar uma destinação financeira.

BEGIN;

WITH candidates AS (
  SELECT ep.id,
         (
           SELECT r.id
           FROM dashboard.finance_revenues r
           WHERE r.enrollment_id = ep.enrollment_id
             AND r.date = date_trunc('month', ep.payment_date)::date
             AND r.status <> 'cancelado'
           ORDER BY r.installment_number, r.id
           LIMIT 1
         ) AS revenue_id
  FROM dashboard.finance_enrollment_payments ep
  WHERE ep.revenue_id IS NULL
)
UPDATE dashboard.finance_enrollment_payments ep
SET revenue_id = candidates.revenue_id
FROM candidates
WHERE ep.id = candidates.id
  AND candidates.revenue_id IS NOT NULL;

WITH calc AS (
  SELECT r.id,
         CASE
           WHEN COALESCE(p.paid, 0) >= r.amount THEN 'recebido'
           WHEN COALESCE(p.paid, 0) > 0 THEN 'parcial'
           WHEN COALESCE(r.due_date, r.date) < CURRENT_DATE THEN 'atrasado'
           ELSE 'previsto'
         END AS status
  FROM dashboard.finance_revenues r
  LEFT JOIN LATERAL (
    SELECT SUM(ep.amount) AS paid
    FROM dashboard.finance_enrollment_payments ep
    WHERE ep.revenue_id = r.id
  ) p ON TRUE
  WHERE r.enrollment_id IS NOT NULL
    AND r.status <> 'cancelado'
)
UPDATE dashboard.finance_revenues r
SET status = calc.status, updated_at = NOW()
FROM calc
WHERE r.id = calc.id
  AND r.status IS DISTINCT FROM calc.status;

COMMIT;
