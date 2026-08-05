-- Pagamentos reais e flexíveis de matrícula.
-- As parcelas já existentes em finance_revenues seguem como previsão; esta
-- tabela registra cada recebimento efetivo, com sua própria data e forma.

BEGIN;

CREATE TABLE IF NOT EXISTS dashboard.finance_enrollment_payments (
  id BIGSERIAL PRIMARY KEY,
  enrollment_id BIGINT NOT NULL REFERENCES dashboard.finance_enrollments(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  payment_date DATE NOT NULL,
  payment_method TEXT NOT NULL
    CHECK (payment_method IN ('pix', 'dinheiro', 'transferencia', 'debito', 'credito', 'boleto', 'outros')),
  installments INTEGER CHECK (installments IS NULL OR installments BETWEEN 1 AND 24),
  card_brand_id BIGINT REFERENCES dashboard.finance_card_brands(id),
  fee_pct NUMERIC,
  fee_amount NUMERIC NOT NULL DEFAULT 0,
  net_amount NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  invoice_file BYTEA,
  invoice_filename TEXT,
  invoice_mime TEXT,
  created_by_user_id BIGINT,
  created_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_enrollment_payments_enrollment
  ON dashboard.finance_enrollment_payments(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_finance_enrollment_payments_date
  ON dashboard.finance_enrollment_payments(payment_date);

COMMIT;
