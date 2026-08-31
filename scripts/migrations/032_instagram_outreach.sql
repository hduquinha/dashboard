-- 032 — Prospecção no Instagram lançada dentro do card do Histórico
--
-- Por que existe: não há caminho automático para DM frio no Instagram. A API da
-- Meta só permite responder quem escreveu primeiro, e quando o vendedor chama
-- pelo perfil pessoal nenhuma integração enxerga nada. O número digitado é a
-- única fonte possível.
--
-- Por que não reusa `task_production_entries`: lá os indicadores são
-- CONFIGURÁVEIS por tarefa; aqui as três perguntas são fixas e de negócio, e o
-- registro é chaveado por vendedor + dia — o mesmo eixo do painel de
-- movimentação. Reusar obrigaria a duplicar a definição dos indicadores em cada
-- card de painel, ou a manter uma tarefa fantasma só para abrigá-los.
--
-- Idempotente e não destrutiva.

CREATE TABLE IF NOT EXISTS dashboard.instagram_outreach (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES dashboard.team_members(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  reached INTEGER NOT NULL DEFAULT 0,
  replied INTEGER NOT NULL DEFAULT 0,
  confirmed INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_by INTEGER REFERENCES dashboard.team_members(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Mesma idempotência da produção de rotina: relançar é editar o dia, não
  -- criar um segundo registro.
  CONSTRAINT uniq_instagram_outreach_day UNIQUE (member_id, entry_date),
  -- Negativo é erro de digitação. Não há teto entre os três de propósito: quem
  -- responde hoje pode ter sido chamado ontem.
  CONSTRAINT instagram_outreach_nao_negativo
    CHECK (reached >= 0 AND replied >= 0 AND confirmed >= 0)
);

CREATE INDEX IF NOT EXISTS idx_instagram_outreach_dia
  ON dashboard.instagram_outreach (entry_date DESC);

-- ---------------------------------------------------------------------------
-- Sai da rotina diária.
--
-- A contagem do Instagram passa a ser lançada no card do Histórico, ao lado dos
-- números do CRM. A rotina "Verificar e responder o Instagram" é ARQUIVADA, não
-- apagada: DELETE levaria junto, por CASCADE, os lançamentos já feitos, e
-- arquivar é reversível (basta despublicar o arquivo em /tarefas/arquivo).
-- ---------------------------------------------------------------------------

UPDATE dashboard.tasks
   SET archived = true,
       archived_at = COALESCE(archived_at, NOW()),
       updated_at = NOW()
 WHERE kind = 'recorrente'
   AND NOT archived
   AND title = 'Verificar e responder o Instagram';
