-- Contrato digital de matrícula + assinatura eletrônica (Fase 8 do plano de
-- substituição do Sponte, decisão #2 resolvida como "nativa no CRM").
--
-- O DDL abaixo é o mesmo de `ensureContractsSchema()` em `lib/contracts.ts`,
-- que roda sozinho no primeiro uso da tela. Este arquivo existe para histórico
-- e para quem preferir aplicar a mão antes do deploy.
--
-- Depende de dashboard.finance_enrollments (a matrícula é o contrato
-- financeiro; o contrato digital é o documento que a pessoa assina).

CREATE TABLE IF NOT EXISTS dashboard.contracts (
  id                BIGSERIAL PRIMARY KEY,
  enrollment_id     BIGINT NOT NULL REFERENCES dashboard.finance_enrollments(id) ON DELETE CASCADE,
  version           INTEGER NOT NULL DEFAULT 1,
  status            TEXT NOT NULL DEFAULT 'pendente'
                    CHECK (status IN ('pendente','assinado','cancelado')),
  token             TEXT NOT NULL UNIQUE,
  lead_inscricao_id BIGINT,
  student_id        BIGINT,
  signer_name       TEXT NOT NULL,
  signer_cpf        TEXT,
  signer_email      TEXT,
  signer_phone      TEXT,
  signer_role       TEXT NOT NULL DEFAULT 'aluno'
                    CHECK (signer_role IN ('aluno','responsavel')),
  student_name      TEXT,
  course_name       TEXT,
  amount            NUMERIC NOT NULL DEFAULT 0,
  -- Conteúdo congelado do contrato: é o que a pessoa leu, e não muda quando a
  -- matrícula é corrigida depois.
  snapshot          JSONB NOT NULL,
  snapshot_hash     TEXT NOT NULL,
  expires_at        TIMESTAMPTZ,
  first_opened_at   TIMESTAMPTZ,
  signed_at         TIMESTAMPTZ,
  signed_name       TEXT,
  signed_cpf        TEXT,
  signed_ip         TEXT,
  signed_user_agent TEXT,
  cpf_verified      BOOLEAN NOT NULL DEFAULT FALSE,
  signature_method  TEXT CHECK (signature_method IN ('eletronica','fisica')),
  signed_file       BYTEA,
  signed_file_hash  TEXT,
  canceled_at       TIMESTAMPTZ,
  canceled_reason   TEXT,
  created_by_id     BIGINT,
  created_by_name   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Instalações que já tinham a primeira versão da tabela recebem o método sem
-- perder os contratos existentes.
ALTER TABLE dashboard.contracts
  ADD COLUMN IF NOT EXISTS signature_method TEXT
  CHECK (signature_method IN ('eletronica','fisica'));

-- No máximo UM contrato aguardando assinatura por matrícula. Assinados e
-- cancelados acumulam de propósito (versões).
CREATE UNIQUE INDEX IF NOT EXISTS contracts_pending_per_enrollment
  ON dashboard.contracts (enrollment_id) WHERE status = 'pendente';
CREATE INDEX IF NOT EXISTS contracts_enrollment_idx ON dashboard.contracts (enrollment_id);
CREATE INDEX IF NOT EXISTS contracts_status_idx ON dashboard.contracts (status);
CREATE INDEX IF NOT EXISTS contracts_lead_idx
  ON dashboard.contracts (lead_inscricao_id) WHERE lead_inscricao_id IS NOT NULL;

-- Trilha de evidências: append-only. É ela que sustenta a assinatura eletrônica
-- simples (MP 2.200-2/2001, art. 10, §2º) em caso de contestação.
CREATE TABLE IF NOT EXISTS dashboard.contract_events (
  id           BIGSERIAL PRIMARY KEY,
  contract_id  BIGINT NOT NULL REFERENCES dashboard.contracts(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id     BIGINT,
  actor_name   TEXT,
  ip           TEXT,
  user_agent   TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS contract_events_contract_idx
  ON dashboard.contract_events (contract_id, at DESC);
