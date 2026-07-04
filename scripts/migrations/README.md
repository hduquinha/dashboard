# Migrações SQL

Scripts de migração para o schema normalizado do banco PostgreSQL.

## Ordem de execução

1. **[001_create_normalized_schema.sql](001_create_normalized_schema.sql)** — Cria o schema `dashboard` com as tabelas normalizadas: `pessoas`, `treinamentos`, `inscricoes`, `presencas`, `anamneses` e `recrutadores`.

2. **[002_migrate_data.sql](002_migrate_data.sql)** — Migra os dados do schema legado (`inscricoes.inscricoes`) para a nova estrutura normalizada.

3. **[003_prevent_upday_plus_duplicates.sql](003_prevent_upday_plus_duplicates.sql)** — Mescla duplicados do Up Day Plus, guarda backup dos registros removidos e instala um trigger para transformar novas etapas repetidas em atualização do cadastro existente.

4. **[004_create_productivity_tables.sql](004_create_productivity_tables.sql)** — Cria os modelos de produtividade diaria, fechamento/producao diaria, ordem de usuarios para distribuicao e historico de atribuicoes no Chatwoot.

5. **[005_fix_online_training_stale_dashboard_tags.sql](005_fix_online_training_stale_dashboard_tags.sql)** — Corrige cadastros de Encontro Online que herdaram tags antigas de Up Day Plus.

6. **[006_fix_online_training_date_and_duplicates.sql](006_fix_online_training_date_and_duplicates.sql)** — Corrige data de Encontro Online e deduplica registros por pessoa + data.

7. **[007_dedupe_online_by_phone_date.sql](007_dedupe_online_by_phone_date.sql)** — Deduplica Encontro Online por telefone + data.

8. **[008_fix_august_upday_and_fake_training_date.sql](008_fix_august_upday_and_fake_training_date.sql)** — Canonicaliza o Up Day Plus de agosto e remove a data fantasma 01/01/2026 dos campos de treinamento.

9. **[009_team_members_and_cleanup.sql](009_team_members_and_cleanup.sql)** — Cria `dashboard.team_members` (login e equipe próprios, substituindo o Chatwoot) e prepara a limpeza das colunas de fechamento via Chatwoot em `commercial_leads`.

10. **[010_team_members_instituto_up_only.sql](010_team_members_instituto_up_only.sql)** — Adiciona a flag `instituto_up_only` em `team_members`, que restringe o acesso de um usuário à seção Leads VozUP.

11. **[011_phone_merge_queue_and_trigger.sql](011_phone_merge_queue_and_trigger.sql)** — Cria `dashboard.pending_merge_checks` e um trigger `AFTER INSERT` em `inscricoes.inscricoes` que enfileira toda linha nova para verificação de merge por telefone, consumida por um sweep periódico (`lib/mergeSweep.ts`) dentro do processo do dashboard.

> **Nota sobre `dashboard.commercial_leads.position`** (ordem manual do Kanban, coluna adicionada via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` em `ensureCommercialSchema`/`ensureCommercialSchemaForReads`): não precisou de migração de backfill. Leads sem `position` explícito (nunca arrastados) usam o fallback `COALESCE(cl.position, -i.id)` — único por lead e já preserva "mais recente primeiro" sem precisar tocar dado nenhum.

## Como executar

```bash
# Conecte ao banco e execute em ordem
psql $DATABASE_URL -f 001_create_normalized_schema.sql
psql $DATABASE_URL -f 002_migrate_data.sql
psql $DATABASE_URL -f 003_prevent_upday_plus_duplicates.sql
psql $DATABASE_URL -f 004_create_productivity_tables.sql
psql $DATABASE_URL -f 005_fix_online_training_stale_dashboard_tags.sql
psql $DATABASE_URL -f 006_fix_online_training_date_and_duplicates.sql
psql $DATABASE_URL -f 007_dedupe_online_by_phone_date.sql
psql $DATABASE_URL -f 008_fix_august_upday_and_fake_training_date.sql
psql $DATABASE_URL -f 009_team_members_and_cleanup.sql
psql $DATABASE_URL -f 010_team_members_instituto_up_only.sql
psql $DATABASE_URL -f 011_phone_merge_queue_and_trigger.sql
```

> **Atenção:** Faça backup do banco antes de executar as migrações em produção.
