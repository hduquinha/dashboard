-- Teto de parcelas por forma de pagamento.
--
-- Antes desta coluna o limite era único (48, herdado do boleto longo) e valia
-- para toda forma de pagamento — não havia onde dizer "carnê vai até 48x, mas
-- cartão para em 12x". O comentário em `lib/enrollmentInstallments.ts` já
-- apontava esta tabela como o lugar certo; agora ela tem a coluna.
--
-- O DDL abaixo é o mesmo que `ensureFinanceSchema()` em `lib/finance.ts` aplica
-- sozinho no primeiro uso da tela. Este arquivo existe para histórico e para
-- quem preferir aplicar a mão antes do deploy.

ALTER TABLE dashboard.finance_payment_methods
  ADD COLUMN IF NOT EXISTS max_installments INTEGER;

-- NULL = sem teto próprio: vale o teto do sistema. As formas que já existiam
-- ficam assim de propósito — nada muda no comportamento delas.

-- Carnê em 48x (pedido do dia 27/08/2026). Também está em
-- DEFAULT_PAYMENT_METHODS, então uma instalação nova já nasce com ele.
INSERT INTO dashboard.finance_payment_methods (name, kind, max_installments)
VALUES ('Carnê', 'parcelado', 48)
ON CONFLICT (name) DO NOTHING;
