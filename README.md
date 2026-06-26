<div align="center">

# Instituto UP — Painel Administrativo

**Plataforma interna para gestão de inscrições, treinamentos e rede de recrutadores do Instituto UP.**

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06b6d4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169e1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Vercel](https://img.shields.io/badge/Deploy-Vercel-000?logo=vercel)](https://dashboard-instituto-up.vercel.app)

[**Acessar Painel →**](https://dashboard-instituto-up.vercel.app)

</div>

---

## Visão Geral

Dashboard full-stack construído com **Next.js 16 (App Router)** e **PostgreSQL** para centralizar a operação do Instituto UP. Controle de inscrições recebidas por formulários e planilhas, organização de treinamentos, acompanhamento da árvore de indicações e geração de relatórios em tempo real.

Dados persistidos em **PostgreSQL** (compatível com Aiven / Vercel Postgres) e autenticação por token compartilhado.

---

## Funcionalidades

### 📊 Dashboard (Home)

- Cards de métricas em tempo real: total de leads, novos leads (24 h), taxa de conversão e graduados.
- Gráficos interativos (Recharts): crescimento da rede (LineChart), distribuição leads/recrutadores (PieChart donut) e ranking dos top clusters (BarChart horizontal).
- Seletor de treinamento para filtrar métricas por evento específico.
- Notificação de duplicados pendentes com contagem e motivos.

### 📋 CRM

- Tabela paginada (até 1 000 registros por página) com ordenação por coluna.
- Filtros avançados: nome, telefone, indicador, treinamento e status de presença.
- Modal lateral de detalhes de cada inscrição com notas e alteração de status.
- Exportação completa da base filtrada via `/api/export`.

### 📅 Treinamentos

- Listagem de todos os treinamentos com cards resumidos: total de inscritos, presentes, recrutadores e novos leads nas últimas 24 h.
- Página de detalhes por treinamento (`/treinamentos/[id]`) com ranking de recrutadores, presença e aprovação.

### ⚠️ Duplicados (Higienização)

- Detecção automática de inscrições suspeitas por telefone, e-mail, nome+dia ou payload idêntico.
- Interface de revisão com opção de selecionar qual inscrição manter e excluir ou dispensar a duplicidade.
- Badge no sidebar indicando pendências.

### 🧭 Clusters (Recrutadores)

- Diretório centralizado de todos os indicadores oficiais com código, nome, telefone e cidade.
- Geração automática do próximo código disponível e link de indicação.
- Vinculação de inscrição existente a código de recrutador.
- Vinculação de respostas de anamnese pendentes diretamente pela ficha do recrutador.

### 📝 Anamnese

- Listagem de respostas de anamnese ainda não vinculadas a recrutadores.
- Interface para associar cada resposta ao recrutador correto, com busca filtrada.

### ✅ Presença

- Upload e parsing de CSV exportado do Zoom.
- Pipeline em 4 etapas: **Upload → Revisão → Associação → Confirmação**.
- Análise automática de tempo de participação com intervalos configuráveis.
- Associação inteligente de participantes do Zoom a inscrições cadastradas (match por nome/telefone com score).
- Resolução de dúvidas com seleção manual de candidato.
- Merge de participantes com nomes fragmentados.
- Página de confirmados (`/presenca/confirmados`) com listagem das presenças já validadas.

### 🌱 Rede (Network Visualization)

- Grafo interativo da árvore de recrutamento construído com **React Flow** e layout automático via **dagre**.
- Nós personalizados diferenciando recrutadores (verde) e leads (azul) com contadores de diretos/descendentes.
- Expansão/colapso de sub-árvores, agrupamento de leads e paginação embutida no grafo.
- Filtros por treinamento e recrutador; foco em um nó específico via query param `?focus=`.
- Painel lateral com detalhes completos da inscrição selecionada.

### 📊 Relatórios

- Filtro por treinamento com visualização de ranking de recrutadores e presença.
- Gráficos de barras comparativos (inscritos × presentes × recrutadores) por treinamento.
- Gráfico de pizza com distribuição geral.
- Exportação para PDF via impressão nativa do navegador (layout otimizado para `@media print`).

### 📥 Importar

- Upload de planilha (`.xlsx` / `.xls`) com pré-visualização do lote antes da importação.
- Validação automática com separação em: importáveis, duplicados e com erros.
- Confirmação explícita após revisão, com feedback de resultado.

---

## Tech Stack

| Camada       | Tecnologia                                                                        |
| ------------ | --------------------------------------------------------------------------------- |
| Framework    | [Next.js 16](https://nextjs.org/) (App Router, Server Components, Server Actions) |
| UI           | [React 19](https://react.dev/), [Tailwind CSS 4](https://tailwindcss.com/)        |
| Gráficos     | [Recharts 3](https://recharts.org/) (Line, Bar, Pie)                             |
| Grafos       | [React Flow 11](https://reactflow.dev/) + [dagre](https://github.com/dagrejs/dagre) |
| Ícones       | [Lucide React](https://lucide.dev/)                                              |
| Banco        | [PostgreSQL](https://www.postgresql.org/) via [`pg`](https://node-postgres.com/) |
| Planilhas    | [SheetJS (xlsx)](https://sheetjs.com/)                                            |
| PDF          | [PDFKit](https://pdfkit.org/)                                                     |
| Testes       | [Jest](https://jestjs.io/) + [Supertest](https://github.com/ladjs/supertest)     |
| Lint         | [ESLint 9](https://eslint.org/) + eslint-config-next                              |
| Tipagem      | [TypeScript 5](https://www.typescriptlang.org/)                                  |

---

## Estrutura do Projeto

```
app/
├── layout.tsx                   # Root layout (Geist font, metadata)
├── login/                       # Autenticação por token
├── (dashboard)/                 # Route group protegido
│   ├── layout.tsx               # Sidebar + auth guard
│   ├── page.tsx                 # Dashboard principal (métricas + gráficos)
│   ├── crm/                     # CRM — tabela completa com filtros
│   ├── treinamentos/            # Treinamentos e detalhes por evento
│   ├── duplicados/              # Detecção e resolução de duplicados
│   ├── recrutadores/            # Diretório de indicadores (clusters)
│   ├── anamnese/                # Vinculação de respostas de anamnese
│   ├── presenca/                # Validação de presença (Zoom CSV)
│   ├── rede/                    # Grafo interativo da rede
│   ├── relatorios/              # Rankings e gráficos exportáveis
│   └── importar/                # Upload de planilhas
├── api/                         # Route Handlers (REST)
│   ├── inscricoes/              # CRUD inscrições + search + notes + status
│   ├── presence/                # Parse, confirm, list, resolve, report
│   ├── trainings/               # Listagem e ranking por treinamento
│   ├── recruiters/              # Listagem de recrutadores
│   ├── anamnese/                # Link e consulta de anamnese
│   ├── export/                  # Exportação CSV/Excel
│   └── print/                   # Geração de PDF
components/                      # Componentes client e server reutilizáveis
lib/                             # Lógica de negócio, DB, auth, parsers
types/                           # Tipos TypeScript (inscricao, presence, training)
scripts/migrations/              # Migrations SQL (schema normalizado)
```

---

## Pré-requisitos

- **Node.js** ≥ 18
- **PostgreSQL** acessível via connection string

---

## Configuração Local

1. **Instale as dependências:**
   ```bash
   npm install
   ```

2. **Configure as variáveis de ambiente** — copie `.env.example` para `.env.local`:
   ```bash
   cp .env.example .env.local
   ```

3. **Execute lint e testes:**
   ```bash
   npm run lint
   npm test
   ```

4. **Inicie o servidor de desenvolvimento:**
   ```bash
   npm run dev
   ```
   Acesse em **http://localhost:3000**.

---

## Variáveis de Ambiente

| Variável          | Descrição                                                                      |
| ----------------- | ------------------------------------------------------------------------------ |
| `DATABASE_URL`    | Connection string do PostgreSQL (`postgres://user:pass@host:5432/db`).         |
| `PG_SSL`          | `true` quando o banco exigir SSL (Aiven, Vercel Postgres, etc.).               |
| `DASHBOARD_SESSION_SECRET` | Segredo longo usado para criptografar o cookie de sessão da dashboard. |
| `DASHBOARD_TOKEN` | Token legado opcional para automações via `Authorization: Bearer`. O login web usa o Chatwoot. |
| `CHATWOOT_INTERNAL_URL` | URL interna usada pela dashboard para autenticar em `/auth/sign_in` do Chatwoot. |
| `CHATWOOT_DATABASE_URL` | Connection string do banco do Chatwoot para mensagens e sincronização de contatos. |
| `CHATWOOT_ACCOUNT_ID` | ID da conta do Chatwoot sincronizada pelo CRM. |
| `CHATWOOT_FRONTEND_URL` | URL usada para abrir o Chatwoot e conversas a partir do CRM. |
| `CHATWOOT_DEFAULT_INBOX_ID` | Opcional. Inbox usado ao criar conversa pelo botão de WhatsApp do CRM. Se vazio, usa o inbox WhatsApp/API mais usado. |
| `TRAINING_CONFIG` | JSON com as opções de treinamento (`id`, `label`, `startsAt`) exibidas no app. |

Em produção (Vercel), configure também `VERCEL_ENV` conforme o ambiente.

---

## Scripts Disponíveis

| Comando                  | Descrição                                |
| ------------------------ | ---------------------------------------- |
| `npm run dev`            | Servidor Next.js em modo desenvolvimento |
| `npm run dev -- --turbo` | Modo Turbopack (opcional, mais rápido)   |
| `npm run build`          | Build de produção                        |
| `npm run start`          | Servidor de produção                     |
| `npm run lint`           | ESLint com zero warnings permitidos      |
| `npm test`               | Suíte de testes (Jest + Supertest)       |

---

## Testes

| Arquivo                              | Cobertura                                      |
| ------------------------------------ | ---------------------------------------------- |
| `lib/__tests__/parsePayload.test.ts` | Normalização e parsing do payload de inscrições |
| `app/api/inscricoes/route.test.ts`   | Rota de API com autenticação e respostas        |

```bash
npm test
```

---

## Deploy

O projeto roda na **Vercel** com deploy automático a cada push na branch `main`.

**Produção:** [dashboard-instituto-up.vercel.app](https://dashboard-instituto-up.vercel.app)

1. Conecte o repositório na Vercel.
2. Configure as variáveis de ambiente (`DATABASE_URL`, `PG_SSL`, `DASHBOARD_SESSION_SECRET`, `CHATWOOT_INTERNAL_URL`, `CHATWOOT_DATABASE_URL`, `TRAINING_CONFIG`).
3. Push na `main` → deploy automático.

---

## Licença

Projeto interno — **Instituto UP · Desenvolvimento Humano**. Todos os direitos reservados.
