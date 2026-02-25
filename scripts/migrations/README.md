# Migrações SQL

Scripts de migração para o schema normalizado do banco PostgreSQL.

## Ordem de execução

1. **[001_create_normalized_schema.sql](001_create_normalized_schema.sql)** — Cria o schema `dashboard` com as tabelas normalizadas: `pessoas`, `treinamentos`, `inscricoes`, `presencas`, `anamneses` e `recrutadores`.

2. **[002_migrate_data.sql](002_migrate_data.sql)** — Migra os dados do schema legado (`inscricoes.inscricoes`) para a nova estrutura normalizada.

## Como executar

```bash
# Conecte ao banco e execute em ordem
psql $DATABASE_URL -f 001_create_normalized_schema.sql
psql $DATABASE_URL -f 002_migrate_data.sql
```

> **Atenção:** Faça backup do banco antes de executar as migrações em produção.
