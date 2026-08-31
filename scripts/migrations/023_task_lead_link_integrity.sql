-- 023 — Integridade e desempenho do vínculo tarefa → lead
--
-- Contexto: a tarefa de lead já era a MESMA tarefa do módulo /tarefas
-- (`dashboard.tasks.inscricao_id`), mas o vínculo não tinha chave estrangeira:
-- nada impedia uma tarefa apontar para um lead inexistente, e a agenda do
-- Kanban depende dele para abrir a ficha certa.
--
-- ON DELETE SET NULL, e não CASCADE: se um lead for removido de verdade, a
-- tarefa continua no quadro (o histórico do time não pode sumir junto), só
-- perde o vínculo. Na prática o CRM só faz soft delete
-- (payload.dashboard_excluido = "true"), então isto é rede de segurança.
--
-- O mesmo conteúdo roda de forma idempotente em `ensureTasksSchema()`
-- (lib/tasks.ts) no primeiro uso do módulo — este arquivo existe para o
-- histórico do schema, seguindo a convenção do repo.

-- Pré-checagem: a FK só pode ser criada se não houver tarefa órfã.
-- (Em 11/08/2026 a produção tinha 0.)
DO $$
DECLARE orfas INTEGER;
BEGIN
  SELECT COUNT(*) INTO orfas
    FROM dashboard.tasks t
   WHERE t.inscricao_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM inscricoes.inscricoes i WHERE i.id = t.inscricao_id);

  IF orfas > 0 THEN
    RAISE EXCEPTION 'Existem % tarefa(s) apontando para lead inexistente. Resolva antes de criar a FK.', orfas;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_inscricao_id_fkey') THEN
    ALTER TABLE dashboard.tasks
      ADD CONSTRAINT tasks_inscricao_id_fkey
      FOREIGN KEY (inscricao_id) REFERENCES inscricoes.inscricoes(id) ON DELETE SET NULL;
  END IF;
END $$;

-- A agenda entra pelo responsável, mas a PK de task_assignees é
-- (task_id, member_id): com member_id na segunda posição, "as tarefas do
-- fulano" varre o índice inteiro.
CREATE INDEX IF NOT EXISTS idx_task_assignees_member
  ON dashboard.task_assignees(member_id);
