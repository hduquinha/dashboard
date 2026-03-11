export interface NavLink {
  key: string;
  href: string;
  label: string;
  description: string;
  icon: string;
}

export const NAV_LINKS: NavLink[] = [
  { key: "home", href: "/", label: "Início", description: "Visão geral", icon: "🏠" },
  { key: "crm", href: "/crm", label: "CRM", description: "Gestão de leads", icon: "🎯" },
  { key: "treinamentos", href: "/treinamentos", label: "Treinamentos", description: "Por data", icon: "📅" },
  { key: "recrutadores", href: "/recrutadores", label: "Clusters", description: "Gerencie clusters", icon: "🧭" },
  { key: "anamnese", href: "/anamnese", label: "Anamnese", description: "Vincular respostas", icon: "📝" },
  { key: "relatorios", href: "/relatorios", label: "Relatórios", description: "Rankings e gráficos", icon: "📊" },
  { key: "encontro-online", href: "/encontro-online", label: "Encontro Online", description: "Presença aula gravada", icon: "🎥" },
  { key: "rede", href: "/rede", label: "Rede", description: "Visualização da árvore", icon: "🌱" },
];
