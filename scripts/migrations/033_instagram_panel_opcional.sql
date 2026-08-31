-- 033 — "Leads Instagram" vira opção por card, gerenciada pelo master
--
-- Nem todo vendedor trabalha o direct. Em vez de o bloco aparecer para todos, o
-- card passa a ter uma chave; quem liga e desliga é usuário master, e é assim
-- que se define quem registra a prospecção do Instagram.
--
-- Desligar NÃO apaga lançamento: o bloco some da tela e do PDF e volta inteiro
-- se o card for religado. Trabalho feito não desaparece por troca de
-- configuração.
--
-- Idempotente e não destrutiva.

ALTER TABLE dashboard.tasks
  ADD COLUMN IF NOT EXISTS panel_instagram BOOLEAN NOT NULL DEFAULT false;

-- Estado inicial pedido: só Andrea e Thiago Cardoso. Casado por e-mail, não por
-- nome — o nome do usuário muda e já aparece gravado de formas diferentes no
-- histórico ("Thiago" × "Thiago Cardoso").
UPDATE dashboard.tasks t
   SET panel_instagram = true,
       updated_at = NOW()
  FROM dashboard.team_members tm
 WHERE t.kind = 'painel_leads'
   AND t.panel_member_id = tm.id
   AND LOWER(tm.email) IN ('andrea@escolavozup.com', 'thiago@escolavozup.com')
   AND NOT t.panel_instagram;
