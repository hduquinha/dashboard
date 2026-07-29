export interface NavLink {
  key: string;
  href: string;
  label: string;
  description: string;
  icon: string;
  group: "primary" | "secondary";
  brand: "instituto-up" | "vozup";
}

export const NAV_LINKS: NavLink[] = [
  // ── Instituto UP ───────────────────────────────────────────────
  {
    key: "home",
    href: "/",
    label: "Visão geral",
    description: "Resumo comercial",
    icon: "🏠",
    group: "primary",
    brand: "instituto-up",
  },
  {
    key: "crm",
    href: "/crm",
    label: "Pipeline CRM",
    description: "Leads e etapas comerciais",
    icon: "🎯",
    group: "primary",
    brand: "instituto-up",
  },
  {
    key: "produtividade",
    href: "/produtividade",
    label: "Kanban",
    description: "Kanban e produtividade da equipe",
    icon: "📋",
    group: "primary",
    brand: "instituto-up",
  },
  {
    key: "distribuicao",
    href: "/distribuicao",
    label: "Chegada de Leads",
    description: "Novos leads Meta e landing pages",
    icon: "↗",
    group: "primary",
    brand: "instituto-up",
  },
  {
    key: "treinamentos",
    href: "/treinamentos",
    label: "Instituto UP",
    description: "Ofertas e turmas",
    icon: "📅",
    group: "primary",
    brand: "instituto-up",
  },
  {
    key: "tarefas",
    href: "/tarefas",
    label: "Tarefas",
    description: "Setores, quadros kanban e tarefas da equipe",
    icon: "✅",
    group: "primary",
    brand: "instituto-up",
  },
  {
    key: "recrutadores",
    href: "/recrutadores",
    label: "Clusters",
    description: "Gerencie clusters",
    icon: "🧭",
    group: "secondary",
    brand: "instituto-up",
  },
  {
    key: "anamnese",
    href: "/anamnese",
    label: "Anamnese",
    description: "Vincular respostas",
    icon: "📝",
    group: "secondary",
    brand: "instituto-up",
  },
  {
    key: "relatorios",
    href: "/relatorios",
    label: "Relatórios",
    description: "Rankings e gráficos",
    icon: "📊",
    group: "secondary",
    brand: "instituto-up",
  },
  {
    key: "encontro-online",
    href: "/encontro-online",
    label: "Encontro Online",
    description: "Presença aula gravada",
    icon: "🎥",
    group: "secondary",
    brand: "instituto-up",
  },
  {
    key: "rede",
    href: "/rede",
    label: "Rede",
    description: "Visualização da árvore",
    icon: "🌱",
    group: "secondary",
    brand: "instituto-up",
  },
  {
    key: "usuarios",
    href: "/usuarios",
    label: "Usuarios",
    description: "Permissoes e acessos",
    icon: "🔐",
    group: "secondary",
    brand: "instituto-up",
  },
  {
    key: "funis",
    href: "/funis",
    label: "Funis",
    description: "Funis de vendas e etapas do Kanban",
    icon: "🧩",
    group: "secondary",
    brand: "instituto-up",
  },

  // ── VozUP ──────────────────────────────────────────────────────
  {
    key: "vozup-leads",
    href: "/vozup",
    label: "Leads VozUP",
    description: "Leads captados pelas páginas VozUP",
    icon: "👥",
    group: "primary",
    brand: "vozup",
  },
  {
    key: "vozup-rotas",
    href: "/vozup/rotas",
    label: "Mapa de Rotas",
    description: "Rotas de captação por pasta e tema",
    icon: "🗺️",
    group: "primary",
    brand: "vozup",
  },
  {
    key: "vozup-auditoria",
    href: "/vozup/auditoria",
    label: "Registro de Auditoria",
    description: "Histórico completo de mudanças em qualquer lead",
    icon: "🕵️",
    group: "primary",
    brand: "vozup",
  },
  {
    key: "vozup-financeiro",
    href: "/financeiro",
    label: "Gestão Financeira",
    description: "ERP financeiro VozUP",
    icon: "💳",
    group: "primary",
    brand: "vozup",
  },
  {
    key: "campanhas",
    href: "/campanhas",
    label: "Métricas de Campanha",
    description: "Gasto, leads e qualificação real por anúncio",
    icon: "📈",
    group: "primary",
    brand: "vozup",
  },
];

export const PRIMARY_NAV_LINKS = NAV_LINKS.filter(
  (link) => link.brand === "instituto-up" && link.group === "primary"
);
export const SECONDARY_NAV_LINKS = NAV_LINKS.filter(
  (link) => link.brand === "instituto-up" && link.group === "secondary"
);
export const VOZUP_NAV_LINKS = NAV_LINKS.filter((link) => link.brand === "vozup");
