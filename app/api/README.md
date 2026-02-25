# API Routes

Route Handlers REST que alimentam o painel. Todas as rotas protegidas exigem `Authorization: Bearer <DASHBOARD_TOKEN>` ou cookie de sessão.

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/inscricoes` | Lista inscrições com paginação e filtros |
| `POST` | `/api/inscricoes` | Cria nova inscrição |
| `GET` | `/api/inscricoes/search` | Busca por nome, telefone ou indicador |
| `GET` | `/api/inscricoes/[id]` | Detalhes de uma inscrição |
| `PATCH` | `/api/inscricoes/[id]/status` | Atualiza status |
| `POST` | `/api/inscricoes/[id]/notes` | Adiciona nota |
| `GET` | `/api/trainings` | Lista treinamentos |
| `GET` | `/api/trainings/[id]` | Detalhes e ranking do treinamento |
| `GET` | `/api/recruiters` | Lista recrutadores |
| `POST` | `/api/presence/parse` | Faz parsing do CSV do Zoom |
| `POST` | `/api/presence/confirm` | Confirma presença |
| `GET` | `/api/presence/list` | Lista presenças confirmadas |
| `DELETE` | `/api/presence/remove` | Remove presença |
| `GET` | `/api/presence/report` | Relatório de presença |
| `GET` | `/api/anamnese/[code]` | Consulta anamnese por código |
| `POST` | `/api/anamnese/link` | Vincula anamnese a recrutador |
| `GET` | `/api/export` | Exporta base filtrada (CSV) |
| `GET` | `/api/print` | Gera PDF para impressão |
