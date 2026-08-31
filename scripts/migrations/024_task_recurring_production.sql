-- 024 — Tarefa recorrente e registro de produção
--
-- Problema que motivou: a rotina do comercial estava sendo lançada como UMA
-- TAREFA NOVA POR DIA. Em 11/08/2026 os relatórios diários da equipe viraram
-- 20 cards concluídos numa tacada; repetir isso todo dia enche o quadro e não
-- produz número nenhum — não dá para somar "quantas pessoas a Andrea respondeu
-- no Instagram em agosto" a partir de títulos de card.
--
-- Modelo escolhido: 1 TAREFA RECORRENTE + N REGISTROS DE PRODUÇÃO.
-- A tarefa "Responder o Instagram" existe uma vez só e nunca é concluída; cada
-- dia vira uma linha em task_production_entries com os valores dos indicadores.
--
-- Por que tabela própria e não a descrição da tarefa: a descrição cresceria
-- para sempre e não é somável nem filtrável. Por que não uma tabela larga com
-- coluna "quantidade": cada rotina mede coisas diferentes (respostas, ligações
-- atendidas, reuniões), então os indicadores são configuráveis por tarefa.

-- ---------------------------------------------------------------------------
-- 1. Tipo da tarefa
-- ---------------------------------------------------------------------------
-- 'pontual' (o que sempre existiu: tem prazo, é concluída) e 'recorrente'
-- (rotina que não se conclui, só acumula produção). O DEFAULT garante que toda
-- tarefa já existente continue funcionando exatamente como antes.
ALTER TABLE dashboard.tasks
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'pontual';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_kind_check') THEN
    ALTER TABLE dashboard.tasks
      ADD CONSTRAINT tasks_kind_check CHECK (kind IN ('pontual', 'recorrente'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_kind
  ON dashboard.tasks(kind) WHERE kind = 'recorrente';

-- ---------------------------------------------------------------------------
-- 2. Indicadores configuráveis de cada tarefa recorrente
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dashboard.task_metrics (
  id           SERIAL PRIMARY KEY,
  task_id      INTEGER NOT NULL REFERENCES dashboard.tasks(id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,
  -- Tipo do dado. 'inteiro' e 'decimal' são os que entram em soma/média nos
  -- relatórios; 'texto' fica fora dos cálculos de propósito.
  unit         TEXT    NOT NULL DEFAULT 'inteiro'
               CHECK (unit IN ('inteiro', 'decimal', 'texto', 'duracao', 'moeda')),
  position     INTEGER NOT NULL DEFAULT 0,
  -- Meta diária. A coluna já nasce aqui para o sistema de metas ser ligado
  -- depois sem migrar dado nenhum; hoje ninguém lê este campo.
  daily_target NUMERIC,
  archived     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_metrics_task
  ON dashboard.task_metrics(task_id) WHERE NOT archived;

-- ---------------------------------------------------------------------------
-- 3. Registro de produção — uma linha por tarefa + pessoa + dia
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dashboard.task_production_entries (
  id         SERIAL PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES dashboard.tasks(id) ON DELETE CASCADE,
  -- Quem produziu. SET NULL em vez de CASCADE: se a pessoa sair da equipe, a
  -- produção dela continua contando no histórico do setor.
  member_id  INTEGER REFERENCES dashboard.team_members(id) ON DELETE SET NULL,
  entry_date DATE    NOT NULL,
  note       TEXT,
  -- Auditoria: quem digitou pode não ser quem produziu (supervisor lançando
  -- pela equipe), por isso created_by é separado de member_id.
  created_by INTEGER REFERENCES dashboard.team_members(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Um registro por pessoa por dia na mesma rotina: registrar de novo edita o que
-- existe em vez de criar outro. É o que impede a duplicidade acidental de
-- quem clica duas vezes ou reabre a tela no fim do dia.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_task_production_day
  ON dashboard.task_production_entries(task_id, member_id, entry_date);

-- Caminhos de entrada dos relatórios: por período, por pessoa e por tarefa.
CREATE INDEX IF NOT EXISTS idx_task_production_date
  ON dashboard.task_production_entries(entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_task_production_member
  ON dashboard.task_production_entries(member_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_task_production_task
  ON dashboard.task_production_entries(task_id, entry_date DESC);

-- ---------------------------------------------------------------------------
-- 4. Valor de cada indicador dentro de um registro
-- ---------------------------------------------------------------------------
-- Numérico e texto em colunas separadas para o relatório somar sem CAST e sem
-- risco de quebrar num valor que não é número.
CREATE TABLE IF NOT EXISTS dashboard.task_production_values (
  entry_id      INTEGER NOT NULL REFERENCES dashboard.task_production_entries(id) ON DELETE CASCADE,
  metric_id     INTEGER NOT NULL REFERENCES dashboard.task_metrics(id) ON DELETE CASCADE,
  value_numeric NUMERIC,
  value_text    TEXT,
  PRIMARY KEY (entry_id, metric_id)
);

CREATE INDEX IF NOT EXISTS idx_task_production_values_metric
  ON dashboard.task_production_values(metric_id);

-- ---------------------------------------------------------------------------
-- 5. Migração dos dados existentes
-- ---------------------------------------------------------------------------
-- Os cards que já viviam na coluna "Rotina diária" do quadro Comercial são,
-- por definição, rotinas — viram recorrentes. Todo o resto continua 'pontual'
-- pelo DEFAULT, sem nenhuma mudança de comportamento.
UPDATE dashboard.tasks t
   SET kind = 'recorrente'
  FROM dashboard.task_columns c
 WHERE c.id = t.column_id
   AND c.board_id = 3
   AND c.name ILIKE '%rotina%'
   AND t.kind <> 'recorrente';

-- ---------------------------------------------------------------------------
-- 6. Simplificação das colunas do quadro Comercial
-- ---------------------------------------------------------------------------
-- Arquivar, não apagar: DELETE levaria junto as referências em task_activity e
-- tiraria do histórico a informação de por onde os cards passaram. As três
-- estavam vazias em 12/08/2026 (0 cards ativos e 0 arquivados), então nenhum
-- card precisa ser realocado. Só o quadro Comercial (board 3) — TI/Marketing
-- tem colunas de nome parecido e não entra nesta mudança.
UPDATE dashboard.task_columns
   SET archived = TRUE
 WHERE board_id = 3
   AND name IN ('🎯 Prioridade da semana', '🔄 Em execução', '⏳ Travado / Aguardando')
   AND NOT archived;
