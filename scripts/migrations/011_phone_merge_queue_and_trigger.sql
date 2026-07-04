-- ============================================
-- MIGRACAO: Fila de verificacao de merge por telefone
-- ============================================
-- Garante que TODA insercao em inscricoes.inscricoes (nao importa qual dos
-- ~8 servicos/apps a fez: dashboard, aula-experimental, vozup-campanha-b,
-- vozup-workshop, instituto-up-formulario, landingpage-vozup, importacao
-- de CSV) seja enfileirada para uma verificacao de merge por telefone.
--
-- Um sweep periodico rodando dentro do processo Node da dashboard
-- (server.js -> POST /api/internal/merge-sweep -> lib/mergeSweep.ts)
-- consome essa fila chamando autoMergeNewLeadByPhone (lib/db.ts) -- a
-- MESMA funcao ja usada pelos merges sincronos de insertInscricao e
-- ingestVozupLead. Este trigger NAO substitui esses merges sincronos;
-- eles continuam e deixam uma entrada de fila redundante que o sweep
-- descarta (dashboard_merged_into ja setado -> status 'skipped').
--
-- AFTER INSERT: so dispara quando a linha foi de fato persistida. Se o
-- trigger BEFORE INSERT ja existente (merge_upday_duplicate_before_insert,
-- migracao 003) cancelar o INSERT (RETURN NULL) para tratar como update de
-- um cadastro Up Day Plus, este trigger nunca roda -- comportamento correto,
-- sem precisar de nenhuma coordenacao extra entre os dois triggers.
-- ============================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS dashboard;

CREATE TABLE IF NOT EXISTS dashboard.pending_merge_checks (
    id             BIGSERIAL PRIMARY KEY,
    inscricao_id   INTEGER NOT NULL REFERENCES inscricoes.inscricoes(id) ON DELETE CASCADE,
    phone_digits   TEXT,
    status         TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'done', 'skipped', 'error')),
    attempts       INTEGER NOT NULL DEFAULT 0,
    last_error     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at   TIMESTAMPTZ,
    CONSTRAINT pending_merge_checks_inscricao_id_key UNIQUE (inscricao_id)
);

CREATE INDEX IF NOT EXISTS idx_pending_merge_checks_pending
    ON dashboard.pending_merge_checks (created_at)
    WHERE status = 'pending';

CREATE OR REPLACE FUNCTION dashboard.enqueue_merge_check()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO dashboard.pending_merge_checks (inscricao_id, phone_digits)
    VALUES (
        NEW.id,
        NULLIF(
            REGEXP_REPLACE(
                COALESCE(
                    NEW.payload ->> 'telefone',
                    NEW.payload ->> 'phone',
                    NEW.payload ->> 'celular',
                    NEW.payload ->> 'whatsapp',
                    ''
                ),
                '\D', '', 'g'
            ),
            ''
        )
    )
    ON CONFLICT (inscricao_id) DO NOTHING;

    RETURN NULL; -- valor ignorado em trigger AFTER
END;
$$;

DROP TRIGGER IF EXISTS enqueue_merge_check_after_insert ON inscricoes.inscricoes;

CREATE TRIGGER enqueue_merge_check_after_insert
AFTER INSERT ON inscricoes.inscricoes
FOR EACH ROW
EXECUTE FUNCTION dashboard.enqueue_merge_check();

COMMIT;
