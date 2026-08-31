-- 031 — Painel de movimentação de leads por vendedor (coluna "Histórico" em /tarefas)
--
-- Nada aqui cria histórico: ele já existe em dashboard.commercial_events desde
-- 01/07/2026 e continua sendo a única fonte. Esta migração só prepara o card
-- que exibe esse histórico e o índice do recorte por período.
--
-- Idempotente e não destrutiva: nenhum DROP, nenhum UPDATE em dado existente.

-- De qual vendedor o card de painel mostra a movimentação. Fica no card e não
-- em task_assignees porque "de quem é o relatório" não é a mesma pergunta que
-- "quem responde por esta tarefa".
ALTER TABLE dashboard.tasks ADD COLUMN IF NOT EXISTS panel_member_id INTEGER;

-- `kind` ganha 'painel_leads'. A constraint veio da migração 024 com dois
-- valores; recriar é o padrão do repo para lista fechada que cresce.
ALTER TABLE dashboard.tasks DROP CONSTRAINT IF EXISTS tasks_kind_check;
ALTER TABLE dashboard.tasks
  ADD CONSTRAINT tasks_kind_check CHECK (kind IN ('pontual', 'recorrente', 'painel_leads'));

-- O painel filtra por tipo de evento dentro de uma janela de datas. Com o
-- volume atual (~7,4 mil eventos) o planner ainda prefere seq scan; o índice é
-- para quando a tabela crescer, não para hoje.
CREATE INDEX IF NOT EXISTS idx_commercial_events_type_created
  ON dashboard.commercial_events (event_type, created_at DESC);

-- ---------------------------------------------------------------------------
-- Coluna "Histórico" no quadro Comercial, com um card por vendedor.
--
-- A coluna "Leads" que já existe NÃO é tocada: ela guarda tarefas de retorno
-- ("ligar para X no dia Y") e continua recebendo os cards do ciclo de
-- agendamento. Os painéis vão para uma coluna própria.
--
-- Idempotente: rodar de novo não duplica coluna nem card.
-- ---------------------------------------------------------------------------

INSERT INTO dashboard.task_columns (board_id, name, color, position)
SELECT b.id, 'Histórico', '#059669',
       COALESCE((SELECT MAX(c.position) + 1 FROM dashboard.task_columns c WHERE c.board_id = b.id), 0)
  FROM dashboard.task_boards b
 WHERE b.name = 'Comercial'
   AND NOT EXISTS (
     SELECT 1 FROM dashboard.task_columns c
      WHERE c.board_id = b.id AND c.name = 'Histórico'
   );

-- Um card por vendedor ativo que já aparece no histórico comercial. `is_seller`
-- é o mesmo filtro da distribuição (migração 025): sem ele entrariam admins que
-- só repassaram lead.
--
-- SEMEADURA DE PRIMEIRA EXECUÇÃO. A cláusula "a coluna ainda não tem nenhum
-- painel" existe porque quem administra o quadro APAGA os cards que não quer
-- (aconteceu com três admins logo no primeiro dia). Sem ela, rodar a migração de
-- novo ressuscitaria esses cards e desfaria a curadoria. Card de vendedor novo
-- se cria pela tela, escolhendo o tipo "Histórico de leads".
INSERT INTO dashboard.tasks (board_id, column_id, title, kind, panel_member_id, priority, position)
SELECT c.board_id,
       c.id,
       'Leads ' || tm.name,
       'painel_leads',
       tm.id,
       'media',
       ROW_NUMBER() OVER (ORDER BY tm.name) - 1
  FROM dashboard.task_columns c
  JOIN dashboard.task_boards b ON b.id = c.board_id AND b.name = 'Comercial'
  JOIN dashboard.team_members tm ON tm.active AND tm.is_seller
 WHERE c.name = 'Histórico'
   AND NOT EXISTS (
     SELECT 1 FROM dashboard.tasks seed
      WHERE seed.board_id = c.board_id AND seed.kind = 'painel_leads'
   )
   AND EXISTS (
     SELECT 1 FROM dashboard.commercial_events e
      WHERE LOWER(e.actor_email) = LOWER(tm.email)
         OR LOWER(e.payload->>'sellerEmail') = LOWER(tm.email)
   )
   AND NOT EXISTS (
     SELECT 1 FROM dashboard.tasks t
      WHERE t.board_id = c.board_id AND t.kind = 'painel_leads' AND t.panel_member_id = tm.id
   );
