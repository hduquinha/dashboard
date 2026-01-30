export interface NavLink {
  key: string;
  href: string;
  label: string;
  description: string;
  icon: string;
}

export const NAV_LINKS: NavLink[] = [
  { key: "home", href: "/", label: "Início", description: "Treinamento atual", icon: "🏠" },
  { key: "treinamentos", href: "/treinamentos", label: "Treinamentos", description: "Por data", icon: "📅" },
  { key: "crm", href: "/crm", label: "CRM", description: "Base completa", icon: "📋" },
  { key: "duplicados", href: "/duplicados", label: "Duplicados", description: "Higienização", icon: "⚠️" },
  { key: "recrutadores", href: "/recrutadores", label: "Clusters", description: "Gerencie clusters", icon: "🧭" },
  { key: "anamnese", href: "/anamnese", label: "Anamnese", description: "Vincular respostas", icon: "📝" },
  { key: "presenca", href: "/presenca", label: "Presença", description: "Validar encontros", icon: "✅" },
  { key: "rede", href: "/rede", label: "Rede", description: "Visualização da árvore", icon: "🌱" },
  { key: "importar", href: "/importar", label: "Importar", description: "Planilhas e lotes", icon: "📥" },
];
