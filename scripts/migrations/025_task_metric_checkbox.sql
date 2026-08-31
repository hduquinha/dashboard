-- 025 — Indicador do tipo "checagem" (sim/não) + indicadores iniciais das rotinas
--
-- Nem toda rotina produz número. "Abrir a escola" e "Preparar o café" só
-- precisam responder "foi feito hoje?"; forçar um campo numérico ali produziria
-- o hábito de digitar 1 todo dia, que é ruído.
--
-- O valor vai em value_numeric como 1/0 de propósito, e não numa coluna
-- booleana nova: assim a checagem entra na MESMA agregação dos outros
-- indicadores, e "quantos dias a escola foi aberta em agosto" é a soma comum,
-- sem caso especial no relatório.

ALTER TABLE dashboard.task_metrics DROP CONSTRAINT IF EXISTS task_metrics_unit_check;
ALTER TABLE dashboard.task_metrics
  ADD CONSTRAINT task_metrics_unit_check
  CHECK (unit IN ('inteiro', 'decimal', 'texto', 'duracao', 'moeda', 'checagem'));

-- ---------------------------------------------------------------------------
-- Indicadores iniciais das 5 rotinas que já existiam no quadro Comercial.
-- São um ponto de partida editável pela própria tela (renomear, trocar tipo,
-- acrescentar) — não uma regra fixa.
-- ---------------------------------------------------------------------------
INSERT INTO dashboard.task_metrics (task_id, name, unit, position)
SELECT dados.task_id, dados.name, dados.unit, dados.position
  FROM (VALUES
    -- Rotinas de presença: só confirmam que foi feito, e por quem.
    (166, 'Escola aberta',          'checagem', 0),
    (167, 'Correntes enroladas',    'checagem', 0),
    (168, 'Café preparado',         'checagem', 0),
    -- Rotinas com volume real de trabalho.
    (169, 'Pessoas respondidas',    'inteiro',  0),
    (169, 'Leads qualificados',     'inteiro',  1),
    (170, 'Leads contatados',       'inteiro',  0),
    (170, 'Retornos recebidos',     'inteiro',  1)
  ) AS dados(task_id, name, unit, position)
 WHERE EXISTS (SELECT 1 FROM dashboard.tasks t WHERE t.id = dados.task_id AND t.kind = 'recorrente')
   AND NOT EXISTS (
     SELECT 1 FROM dashboard.task_metrics m
      WHERE m.task_id = dados.task_id AND m.name = dados.name
   );
