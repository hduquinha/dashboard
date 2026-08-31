/**
 * Estrutura do menu lateral.
 *
 * O menu tinha 24 itens soltos em três blocos ("Instituto UP", "Mais
 * ferramentas" e "VozUP"), e a divisão por marca não ajudava a achar nada:
 * Financeiro, Alunos, Turmas e Campanhas viviam sob "VozUP" mesmo sendo usados
 * pela operação inteira, enquanto o que a equipe abre todo dia ficava misturado
 * com o que se usa uma vez por mês.
 *
 * Hoje:
 *  - `FIXED_NAV_LINKS`: o que se abre todo dia, sempre visível, sem pasta;
 *  - `NAV_SECTIONS`: pastas dobráveis para o resto, agrupadas por área de
 *    trabalho — Instituto UP (produto e comunidade), Pedagógico (o aluno
 *    depois de matriculado), Mídia e Tráfego (o que traz lead), Financeiro e
 *    Administração.
 *
 * `/documentos` (modelos para imprimir) existe e continua protegida por
 * `view.vozup`, mas saiu do menu por decisão do usuário em 2026-08-18: só é
 * alcançável por URL direta. Repor o item aqui basta para trazê-la de volta.
 *
 * Ver lib/permissions.ts para o gate de cada chave — pasta sem nenhum item
 * permitido não é nem desenhada (ver components/ModernSidebar).
 */
export interface NavLink {
  key: string;
  href: string;
  label: string;
  description: string;
}

export interface NavSection {
  key: string;
  label: string;
  /** Chave do ícone da pasta, resolvida em components/ModernSidebar. */
  icon: string;
  links: NavLink[];
}

/** Rotina diária: fica sempre à vista, sem pasta. */
export const FIXED_NAV_LINKS: NavLink[] = [
  {
    key: "home",
    href: "/",
    label: "Visão geral",
    description: "Resumo comercial",
  },
  {
    key: "distribuicao",
    href: "/distribuicao",
    label: "Chegada de Leads",
    description: "Novos leads Meta e landing pages",
  },
  {
    key: "crm",
    href: "/crm",
    label: "Pipeline CRM",
    description: "Leads e etapas comerciais",
  },
  {
    key: "produtividade",
    href: "/produtividade",
    label: "Kanban",
    description: "Kanban e produtividade da equipe",
  },
  {
    key: "tarefas",
    href: "/tarefas",
    label: "Tarefas",
    description: "Setores, quadros kanban e tarefas da equipe",
  },
];

export const NAV_SECTIONS: NavSection[] = [
  {
    key: "instituto-up",
    label: "Instituto UP",
    icon: "secao-instituto-up",
    links: [
      {
        key: "treinamentos",
        href: "/treinamentos",
        label: "Instituto UP",
        description: "Ofertas e turmas",
      },
      {
        key: "encontro-online",
        href: "/encontro-online",
        label: "Encontro Online",
        description: "Presença aula gravada",
      },
      {
        key: "anamnese",
        href: "/anamnese",
        label: "Anamnese",
        description: "Vincular respostas",
      },
      {
        key: "cupons",
        href: "/cupons",
        label: "Cupons",
        description: "Cortesias do Encontro Online e quem já usou",
      },
      {
        key: "relatorios",
        href: "/relatorios",
        label: "Relatórios",
        description: "Rankings e gráficos",
      },
      {
        key: "recrutadores",
        href: "/recrutadores",
        label: "Clusters",
        description: "Gerencie clusters",
      },
      {
        key: "rede",
        href: "/rede",
        label: "Rede",
        description: "Visualização da árvore",
      },
    ],
  },
  {
    key: "pedagogico",
    label: "Pedagógico",
    icon: "secao-pedagogico",
    links: [
      {
        key: "alunos",
        href: "/alunos",
        label: "Alunos",
        description: "Alunos matriculados, responsável legal e alocação em turma",
      },
      {
        key: "turmas",
        href: "/turmas",
        label: "Turmas",
        description: "Turmas, grade de horário, sala e alunos alocados",
      },
      {
        key: "chamada",
        href: "/chamada",
        label: "Chamada",
        description: "Aulas do dia, presença e reposição",
      },
      {
        key: "matriculas",
        href: "/matriculas",
        label: "Matrículas",
        description: "Contratos, parcelas e recebimentos",
      },
    ],
  },
  {
    key: "midia",
    label: "Mídia e Tráfego",
    icon: "secao-midia",
    links: [
      {
        key: "campanhas",
        href: "/campanhas",
        label: "Métricas de Campanha",
        description: "Gasto, leads e qualificação real por anúncio",
      },
      {
        key: "vozup-rotas",
        href: "/vozup/rotas",
        label: "Mapa de Rotas",
        description: "Rotas de captação por pasta e tema",
      },
      {
        key: "vozup-leads",
        href: "/vozup",
        label: "Leads VozUP",
        description: "Leads captados pelas páginas VozUP",
      },
    ],
  },
  {
    key: "financeiro",
    label: "Financeiro",
    icon: "secao-financeiro",
    links: [
      {
        key: "vozup-financeiro",
        href: "/financeiro",
        label: "Gestão Financeira",
        description: "ERP financeiro VozUP",
      },
      {
        key: "contratos",
        href: "/contratos",
        label: "Contratos",
        description: "Contrato digital de matrícula e assinatura eletrônica",
      },
      {
        key: "catalogo",
        href: "/catalogo",
        label: "Cursos",
        description: "Tabela de preços e faturamento por treinamento",
      },
    ],
  },
  {
    key: "admin",
    label: "Administração",
    icon: "secao-admin",
    links: [
      {
        key: "usuarios",
        href: "/usuarios",
        label: "Usuários",
        description: "Permissões e acessos",
      },
      {
        key: "funis",
        href: "/funis",
        label: "Funis",
        description: "Funis de vendas e etapas do Kanban",
      },
      {
        key: "vozup-auditoria",
        href: "/vozup/auditoria",
        label: "Registro de Auditoria",
        description: "Histórico completo de mudanças em qualquer lead",
      },
      {
        key: "tarefas-auditoria",
        href: "/tarefas/auditoria",
        label: "Auditoria de Tarefas",
        description: "Histórico de mudanças nos cards e quadros",
      },
    ],
  },
];

/** Todos os itens, em qualquer lugar do menu. */
export const ALL_NAV_LINKS: NavLink[] = [
  ...FIXED_NAV_LINKS,
  ...NAV_SECTIONS.flatMap((section) => section.links),
];
