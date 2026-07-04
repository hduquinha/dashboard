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
    label: "Equipe",
    description: "Atividade e distribuição",
    icon: "📋",
    group: "primary",
    brand: "instituto-up",
  },
  {
    key: "distribuicao",
    href: "/distribuicao",
    label: "Distribuição",
    description: "Leads por filtro",
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
];

export const PRIMARY_NAV_LINKS = NAV_LINKS.filter(
  (link) => link.brand === "instituto-up" && link.group === "primary"
);
export const SECONDARY_NAV_LINKS = NAV_LINKS.filter(
  (link) => link.brand === "instituto-up" && link.group === "secondary"
);
export const VOZUP_NAV_LINKS = NAV_LINKS.filter((link) => link.brand === "vozup");
