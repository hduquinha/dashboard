-- Dados do CONTRATANTE (item 2 do contrato) e o rateio do item 4.
--
-- O contrato de matrícula da VozUP pede RG, profissão, empresa, telefone fixo e
-- endereço completo — nada disso existia no cadastro do aluno, então o PDF saía
-- com o quadro pela metade e alguém preenchia à mão. O plano financeiro do item
-- 4 separa MATRÍCULA / MATERIAL DIDÁTICO / CURSO; o Financeiro só conhece o
-- total, e essa divisão é decisão comercial feita na hora da venda.
--
-- Idempotente: as mesmas instruções rodam no boot (ensureAcademicSchema /
-- ensureFinanceSchema), este arquivo existe para aplicar sem esperar o deploy.

ALTER TABLE dashboard.academic_students ADD COLUMN IF NOT EXISTS rg           TEXT;
ALTER TABLE dashboard.academic_students ADD COLUMN IF NOT EXISTS profession   TEXT;
ALTER TABLE dashboard.academic_students ADD COLUMN IF NOT EXISTS company      TEXT;
ALTER TABLE dashboard.academic_students ADD COLUMN IF NOT EXISTS landline     TEXT;
ALTER TABLE dashboard.academic_students ADD COLUMN IF NOT EXISTS address      TEXT;
ALTER TABLE dashboard.academic_students ADD COLUMN IF NOT EXISTS neighborhood TEXT;
ALTER TABLE dashboard.academic_students ADD COLUMN IF NOT EXISTS state        TEXT;
ALTER TABLE dashboard.academic_students ADD COLUMN IF NOT EXISTS zip          TEXT;

-- [{key,amount,installments,paymentMethod,firstDueDate}] — ver lib/contractTemplate.
ALTER TABLE dashboard.finance_enrollments ADD COLUMN IF NOT EXISTS contract_plan JSONB;

ALTER TABLE dashboard.finance_enrollments ADD COLUMN IF NOT EXISTS contract_course_hours TEXT;
ALTER TABLE dashboard.finance_enrollments ADD COLUMN IF NOT EXISTS contract_class_name   TEXT;
