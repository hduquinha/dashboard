-- Taxa percentual própria de cada forma de pagamento.
-- O valor fica no cadastro da forma para que a configuração possa ser editada
-- individualmente (PIX, débito, boleto, cartão etc.).

ALTER TABLE dashboard.finance_payment_methods
  ADD COLUMN IF NOT EXISTS fee_pct NUMERIC NOT NULL DEFAULT 0;
