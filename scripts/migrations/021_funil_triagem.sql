-- 021_funil_triagem.sql
--
-- Funil de Triagem: lista fria/importada que os vendedores conferem ANTES de o
-- lead entrar no CRM geral. Enquanto o lead estiver num funil marcado como
-- triagem ele não aparece em /crm, /inscricoes, /vozup nem no CSV — some da
-- base geral, mas continua trabalhável no Kanban do próprio funil de triagem.
-- Quando o vendedor confirma que o contato presta, é só usar "Mover para outro
-- funil" (que já existe) e o lead passa a aparecer no geral.

ALTER TABLE dashboard.funnels
  ADD COLUMN IF NOT EXISTS is_triage BOOLEAN NOT NULL DEFAULT false;

INSERT INTO dashboard.funnels (name, is_triage, is_default)
SELECT 'Triagem', true, false
WHERE NOT EXISTS (SELECT 1 FROM dashboard.funnels WHERE is_triage = true);

INSERT INTO dashboard.funnel_stages (funnel_id, key, label, kind, color, position)
SELECT f.id, s.key, s.label, s.kind, s.color, s.position
FROM dashboard.funnels f
CROSS JOIN (VALUES
  ('a_conferir',  'A conferir',  'entry',  'slate',   0),
  ('em_contato',  'Em contato',  'normal', 'cyan',    1),
  ('qualificado', 'Qualificado', 'won',    'emerald', 2),
  ('descartado',  'Descartado',  'lost',   'rose',    3)
) AS s(key, label, kind, color, position)
WHERE f.is_triage = true
  AND NOT EXISTS (
    SELECT 1 FROM dashboard.funnel_stages fs WHERE fs.funnel_id = f.id AND fs.key = s.key
  );
