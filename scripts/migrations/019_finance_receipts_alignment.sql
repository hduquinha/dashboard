-- Alinha os dados financeiros às regras corrigidas da Gestão Financeira:
--   1. contrato sem cronograma (parcela apagada avulsa) volta a ter parcelas;
--   2. parcela ganha vencimento no dia da venda (antes vencia sempre no dia 1);
--   3. parcelas da comissão passam a acompanhar o mês das parcelas do contrato;
--   4. pagamento de matrícula guarda a comissão sobre o valor recebido;
--   5. status das parcelas é recalculado pela cascata dos recebimentos.
-- Idempotente: rodar de novo não duplica parcela nem desloca vencimento.

BEGIN;

-- Colunas de comissão do recebimento (o app também cria; aqui deixa o script
-- autossuficiente para poder rodar antes do deploy).
ALTER TABLE dashboard.finance_enrollment_payments
  ADD COLUMN IF NOT EXISTS commission_pct NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_amount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_status TEXT NOT NULL DEFAULT 'disponivel',
  ADD COLUMN IF NOT EXISTS commission_paid_at TIMESTAMPTZ;

ALTER TABLE dashboard.finance_enrollment_payments
  DROP CONSTRAINT IF EXISTS finance_enrollment_payments_commission_status_check;
ALTER TABLE dashboard.finance_enrollment_payments
  ADD CONSTRAINT finance_enrollment_payments_commission_status_check
  CHECK (commission_status IN ('disponivel', 'paga'));

-- 1. Recria o cronograma de contratos que ficaram sem nenhuma parcela. Divide
-- igual e joga a sobra de centavos na última parcela, igual ao splitInstallments
-- do app. Só age quando NÃO existe nenhuma parcela: contrato com cronograma
-- parcial fica de fora de propósito, para não sobrescrever ajuste manual.
WITH orphan AS (
  SELECT e.*
  FROM dashboard.finance_enrollments e
  WHERE NOT EXISTS (
    SELECT 1 FROM dashboard.finance_revenues r WHERE r.enrollment_id = e.id
  )
), parts AS (
  SELECT
    o.id AS enrollment_id,
    g.i,
    (date_trunc('month', o.first_month) + ((g.i - 1) * INTERVAL '1 month'))::date AS month_date,
    CASE
      WHEN g.i = o.installments
        THEN (ROUND(o.total_amount * 100)::bigint
              - FLOOR(ROUND(o.total_amount * 100)::numeric / o.installments)::bigint * (o.installments - 1)) / 100.0
      ELSE FLOOR(ROUND(o.total_amount * 100)::numeric / o.installments)::bigint / 100.0
    END AS amount,
    o.installments,
    o.student,
    o.course_id,
    o.branch_id,
    o.payment_method_id,
    o.seller_id,
    o.rate_pct,
    o.sale_date
  FROM orphan o
  CROSS JOIN LATERAL generate_series(1, o.installments) AS g(i)
)
INSERT INTO dashboard.finance_revenues
  (date, description, category_id, origin, student, course_id, branch_id, payment_method_id, seller_id,
   amount, fee_amount, status, enrollment_id, installment_number, due_date)
SELECT
  p.month_date,
  'Matrícula — ' || p.student
    || COALESCE(' (' || co.name || ')', '')
    || CASE WHEN p.installments = 1 THEN '' ELSE ' · parcela ' || p.i || '/' || p.installments END,
  (SELECT id FROM dashboard.finance_categories WHERE kind = 'receita' AND name = 'Matrícula' LIMIT 1),
  'Matrícula parcelada',
  p.student, p.course_id, p.branch_id, p.payment_method_id, p.seller_id,
  p.amount,
  ROUND(p.amount * COALESCE(p.rate_pct, 0) / 100.0, 2),
  'previsto',
  p.enrollment_id,
  p.i,
  (p.month_date + (
    LEAST(
      EXTRACT(DAY FROM p.sale_date)::int,
      EXTRACT(DAY FROM (p.month_date + INTERVAL '1 month - 1 day'))::int
    ) - 1
  ) * INTERVAL '1 day')::date
FROM parts p
LEFT JOIN dashboard.finance_courses co ON co.id = p.course_id;

-- 2. Vencimento no mesmo dia do mês da venda, respeitando meses curtos.
UPDATE dashboard.finance_revenues r
SET due_date = (date_trunc('month', r.date) + (
      LEAST(
        EXTRACT(DAY FROM e.sale_date)::int,
        EXTRACT(DAY FROM (date_trunc('month', r.date) + INTERVAL '1 month - 1 day'))::int
      ) - 1
    ) * INTERVAL '1 day')::date,
    updated_at = NOW()
FROM dashboard.finance_enrollments e
WHERE r.enrollment_id = e.id AND r.due_date IS NULL;

-- 3. Comissão passa a vencer junto com as parcelas do contrato (first_month),
-- e não a partir do mês da venda.
WITH ordered AS (
  SELECT ci.id,
         e.first_month,
         ROW_NUMBER() OVER (PARTITION BY ci.commission_id ORDER BY ci.month, ci.id) - 1 AS idx
  FROM dashboard.finance_commission_installments ci
  JOIN dashboard.finance_commissions cm ON cm.id = ci.commission_id
  JOIN dashboard.finance_enrollments e ON e.id = cm.enrollment_id
)
UPDATE dashboard.finance_commission_installments ci
SET month = (date_trunc('month', ordered.first_month) + (ordered.idx * INTERVAL '1 month'))::date
FROM ordered
WHERE ci.id = ordered.id
  AND ci.month IS DISTINCT FROM (date_trunc('month', ordered.first_month) + (ordered.idx * INTERVAL '1 month'))::date;

-- 4. Comissão do recebimento, no percentual acordado na matrícula.
UPDATE dashboard.finance_enrollment_payments ep
SET commission_pct = cm.percent,
    commission_amount = ROUND(ep.amount * cm.percent / 100.0, 2)
FROM dashboard.finance_commissions cm
WHERE cm.enrollment_id = ep.enrollment_id
  AND cm.percent > 0
  AND ep.commission_amount = 0;

-- 5. Status das parcelas pela cascata: o total recebido do contrato quita as
-- parcelas em ordem cronológica.
WITH ordered AS (
  SELECT r.id, r.enrollment_id, r.amount, r.date, r.due_date,
         COALESCE(SUM(r.amount) OVER (
           PARTITION BY r.enrollment_id
           ORDER BY r.date, COALESCE(r.installment_number, 0), r.id
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
         ), 0) AS amount_before
  FROM dashboard.finance_revenues r
  WHERE r.enrollment_id IS NOT NULL AND r.status <> 'cancelado'
), paid AS (
  SELECT enrollment_id, COALESCE(SUM(amount), 0) AS total
  FROM dashboard.finance_enrollment_payments
  GROUP BY enrollment_id
), calc AS (
  SELECT o.id,
         CASE
           WHEN LEAST(o.amount, GREATEST(COALESCE(p.total, 0) - o.amount_before, 0)) >= o.amount THEN 'recebido'
           WHEN LEAST(o.amount, GREATEST(COALESCE(p.total, 0) - o.amount_before, 0)) > 0 THEN 'parcial'
           WHEN COALESCE(o.due_date, o.date) < CURRENT_DATE THEN 'atrasado'
           ELSE 'previsto'
         END AS next_status
  FROM ordered o
  LEFT JOIN paid p ON p.enrollment_id = o.enrollment_id
)
UPDATE dashboard.finance_revenues t
SET status = calc.next_status, updated_at = NOW()
FROM calc
WHERE t.id = calc.id AND t.status IS DISTINCT FROM calc.next_status;

COMMIT;
