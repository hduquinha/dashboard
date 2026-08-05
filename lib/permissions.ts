export const TEAM_ROLES = ["super_master", "admin", "member"] as const;

export type TeamRole = (typeof TEAM_ROLES)[number];

export interface PermissionDefinition {
  key: PermissionKey;
  label: string;
  description: string;
}

export interface PermissionGroup {
  key: string;
  label: string;
  description: string;
  permissions: readonly PermissionDefinition[];
}

export const PERMISSION_GROUPS = [
  {
    key: "visualizacao",
    label: "Visualizacao",
    description: "Abas e areas que o usuario pode abrir.",
    permissions: [
      { key: "view.dashboard", label: "Visao geral", description: "Resumo principal do dashboard." },
      { key: "view.crm", label: "Pipeline CRM", description: "Lista e kanban comercial." },
      { key: "view.vozup", label: "Leads VozUP", description: "Pastas e formularios da VozUP." },
      { key: "view.vozup_rotas", label: "Mapa de Rotas VozUP", description: "Apenas a tela de mapa de rotas de captacao (/vozup/rotas)." },
      { key: "view.finance", label: "Gestao Financeira", description: "ERP financeiro da VozUP." },
      { key: "view.campaigns", label: "Metricas de Campanha", description: "Gasto, leads e qualificacao real por anuncio do Meta Ads." },
      { key: "view.trainings", label: "Instituto UP", description: "Turmas, ofertas e treinamentos." },
      { key: "view.productivity", label: "Kanban", description: "Kanban da equipe, diario de bordo e fechamento." },
      { key: "view.distribution", label: "Chegada de Leads", description: "Leads novos (Meta/LP) e distribuicao manual." },
      { key: "view.recruiters", label: "Clusters", description: "Recrutadores e clusters." },
      { key: "view.network", label: "Rede", description: "Arvore de indicacoes." },
      { key: "view.anamnese", label: "Anamnese", description: "Respostas e vinculacoes." },
      { key: "view.reports", label: "Relatorios", description: "Rankings, graficos e exportacoes." },
      { key: "view.encontro", label: "Encontro Online", description: "Presenca da aula gravada." },
      { key: "view.tasks", label: "Tarefas", description: "Gerenciador de tarefas (setores, quadros kanban e cards)." },
    ],
  },
  {
    key: "crm_acoes",
    label: "CRM e pipeline",
    description: "Acoes que alteram leads e funil comercial.",
    permissions: [
      { key: "crm.view_all_leads", label: "Ver todos os vendedores", description: "Visao master do CRM." },
      { key: "crm.create_leads", label: "Criar leads", description: "Cadastro manual de leads." },
      { key: "distribution.add_lead", label: "Adicionar lead na Chegada", description: "Cadastrar lead direto na Chegada de Leads (pode deixar sem dono), sem acesso a distribuir." },
      { key: "crm.edit_leads", label: "Editar leads", description: "Alterar ficha e payload do lead." },
      { key: "crm.delete_leads", label: "Excluir leads", description: "Remover lead da pipeline." },
      { key: "crm.update_stage", label: "Mover etapas", description: "Alterar etapa do funil." },
      { key: "crm.assign_leads", label: "Atribuir vendedor", description: "Repassar leads para usuarios." },
      { key: "crm.merge_leads", label: "Mesclar duplicados", description: "Unificar cadastros." },
      { key: "crm.manage_links", label: "Gerenciar vinculos", description: "Adicionar, trocar e remover origens." },
      { key: "crm.manage_funnels", label: "Gerenciar funis", description: "Criar, editar funis e atribuir aos vendedores." },
      { key: "crm.manage_notes", label: "Observacoes", description: "Criar observacoes internas." },
      { key: "crm.manage_temperature", label: "Temperatura", description: "Alterar estrelas do lead." },
      { key: "crm.import", label: "Importar", description: "Importar planilhas e listas." },
      { key: "crm.export", label: "Exportar", description: "Exportar dados e relatorios." },
    ],
  },
  {
    key: "campos_visiveis",
    label: "Campos visiveis",
    description: "Informacoes que aparecem na ficha e listas do CRM.",
    permissions: [
      { key: "field.view.phone", label: "Telefone", description: "Telefone, WhatsApp e links de contato." },
      { key: "field.view.email", label: "E-mail", description: "E-mail do lead." },
      { key: "field.view.city", label: "Cidade", description: "Cidade, estado e endereco." },
      { key: "field.view.profession", label: "Profissao", description: "Profissao, cargo e empresa." },
      { key: "field.view.training", label: "Treinamento", description: "Treinamento, aula e historico de inscricoes." },
      { key: "field.view.source", label: "Origem", description: "Origem, campanha, formulario e criativo." },
      { key: "field.view.notes", label: "Observacoes", description: "Historico de anotacoes internas." },
      { key: "field.view.history", label: "Historico", description: "Historico de formularios e payload." },
      { key: "field.view.commercial", label: "Comercial", description: "Responsavel e etapa comercial." },
    ],
  },
  {
    key: "campos_editaveis",
    label: "Campos editaveis",
    description: "Campos que o usuario pode alterar na ficha do lead.",
    permissions: [
      { key: "field.edit.identity", label: "Nome", description: "Nome e identificacao principal." },
      { key: "field.edit.phone", label: "Telefone", description: "Telefone e WhatsApp." },
      { key: "field.edit.email", label: "E-mail", description: "E-mail principal." },
      { key: "field.edit.city", label: "Cidade", description: "Cidade, estado e bairro." },
      { key: "field.edit.profession", label: "Profissao", description: "Profissao, cargo e empresa." },
      { key: "field.edit.training", label: "Treinamento", description: "Treinamento e aula vinculada." },
      { key: "field.edit.source", label: "Origem", description: "Indicador, origem e campanha." },
      { key: "field.edit.extra", label: "Campos extras", description: "Campos dinamicos do payload." },
    ],
  },
  {
    key: "administracao",
    label: "Administracao",
    description: "Configuracoes sensiveis do sistema.",
    permissions: [
      { key: "admin.users", label: "Administrar usuarios", description: "Criar e editar usuarios." },
      { key: "admin.permissions", label: "Permissoes", description: "Alterar poderes, prioridade e perfis." },
      { key: "admin.audit", label: "Registro de auditoria", description: "Ver o historico completo de mudancas em qualquer lead." },
      { key: "tasks.admin", label: "Administrar tarefas", description: "Criar e editar setores, equipes e quadros do gerenciador de tarefas." },
      { key: "admin.distribution", label: "Distribuicao master", description: "Ordem e regras de distribuicao." },
      { key: "admin.productivity", label: "Produtividade master", description: "Validar e ver produtividade geral." },
      { key: "admin.reports", label: "Relatorios master", description: "Ver relatorios consolidados." },
      { key: "admin.system", label: "Sistema", description: "Configuracoes tecnicas e integracoes." },
    ],
  },
] as const satisfies readonly PermissionGroup[];

export type PermissionKey =
  | "view.dashboard"
  | "view.crm"
  | "view.vozup"
  | "view.vozup_rotas"
  | "view.finance"
  | "view.campaigns"
  | "view.trainings"
  | "view.productivity"
  | "view.distribution"
  | "view.recruiters"
  | "view.network"
  | "view.anamnese"
  | "view.reports"
  | "view.encontro"
  | "view.tasks"
  | "crm.view_all_leads"
  | "crm.create_leads"
  | "distribution.add_lead"
  | "crm.edit_leads"
  | "crm.delete_leads"
  | "crm.update_stage"
  | "crm.assign_leads"
  | "crm.merge_leads"
  | "crm.manage_links"
  | "crm.manage_funnels"
  | "crm.manage_notes"
  | "crm.manage_temperature"
  | "crm.import"
  | "crm.export"
  | "field.view.phone"
  | "field.view.email"
  | "field.view.city"
  | "field.view.profession"
  | "field.view.training"
  | "field.view.source"
  | "field.view.notes"
  | "field.view.history"
  | "field.view.commercial"
  | "field.edit.identity"
  | "field.edit.phone"
  | "field.edit.email"
  | "field.edit.city"
  | "field.edit.profession"
  | "field.edit.training"
  | "field.edit.source"
  | "field.edit.extra"
  | "admin.users"
  | "admin.permissions"
  | "admin.audit"
  | "tasks.admin"
  | "admin.distribution"
  | "admin.productivity"
  | "admin.reports"
  | "admin.system";

export const ALL_PERMISSION_KEYS = PERMISSION_GROUPS.flatMap((group) =>
  group.permissions.map((permission) => permission.key)
) as PermissionKey[];

const ALL_PERMISSION_KEY_SET = new Set<string>(ALL_PERMISSION_KEYS);

export const ROLE_LABELS: Record<TeamRole, string> = {
  super_master: "Super master",
  admin: "Administrador",
  member: "Usuario comum",
};

export const DEFAULT_PRIORITY_BY_ROLE: Record<TeamRole, number> = {
  super_master: 100,
  admin: 60,
  member: 10,
};

const ADMIN_EXCLUDED = new Set<PermissionKey>([
  "admin.users",
  "admin.permissions",
  "admin.system",
]);

const MEMBER_PERMISSIONS: PermissionKey[] = [
  "view.dashboard",
  "view.crm",
  "view.vozup",
  "view.tasks",
  "crm.create_leads",
  "crm.edit_leads",
  "crm.update_stage",
  "crm.manage_notes",
  "crm.manage_temperature",
  "field.view.phone",
  "field.view.email",
  "field.view.city",
  "field.view.profession",
  "field.view.training",
  "field.view.source",
  "field.view.notes",
  "field.view.history",
  "field.view.commercial",
  "field.edit.identity",
  "field.edit.phone",
  "field.edit.email",
  "field.edit.city",
  "field.edit.profession",
  "field.edit.training",
  "field.edit.source",
  "field.edit.extra",
];

export function normalizeTeamRole(value: unknown): TeamRole {
  return value === "super_master" || value === "admin" || value === "member" ? value : "member";
}

export function normalizePermissionList(input: unknown): PermissionKey[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const seen = new Set<PermissionKey>();
  for (const item of input) {
    if (typeof item !== "string" || !ALL_PERMISSION_KEY_SET.has(item)) {
      continue;
    }
    seen.add(item as PermissionKey);
  }

  return ALL_PERMISSION_KEYS.filter((key) => seen.has(key));
}

export function defaultPermissionsForRole(
  roleInput: TeamRole | string,
  options: { institutoUpOnly?: boolean } = {}
): PermissionKey[] {
  const role = normalizeTeamRole(roleInput);
  const base =
    role === "super_master"
      ? ALL_PERMISSION_KEYS
      : role === "admin"
        ? ALL_PERMISSION_KEYS.filter((key) => !ADMIN_EXCLUDED.has(key))
        : MEMBER_PERMISSIONS;

  return options.institutoUpOnly
    ? base.filter((key) => key !== "view.vozup" && key !== "view.finance" && key !== "view.campaigns")
    : [...base];
}

export function effectivePermissionsForRole(
  roleInput: TeamRole | string,
  storedPermissions: unknown,
  options: { institutoUpOnly?: boolean } = {}
): PermissionKey[] {
  const role = normalizeTeamRole(roleInput);
  if (role === "super_master") {
    return defaultPermissionsForRole(role, options);
  }

  if (Array.isArray(storedPermissions)) {
    const normalized = normalizePermissionList(storedPermissions);
    return options.institutoUpOnly
      ? normalized.filter((key) => key !== "view.vozup" && key !== "view.finance" && key !== "view.campaigns")
      : normalized;
  }

  return defaultPermissionsForRole(role, options);
}

export interface PermissionUser {
  email?: string | null;
  role?: string | null;
  permissions?: readonly string[] | null;
  institutoUpOnly?: boolean | null;
}

function configuredSuperMasterEmails(): string[] {
  const configured = process.env.DASHBOARD_SUPER_MASTER_EMAILS?.trim();
  const raw = configured && configured.length > 0 ? configured : "henrique@escolavozup.com";
  return raw
    .split(/[,\n;]/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function isSuperMaster(user: PermissionUser | null | undefined): boolean {
  if (normalizeTeamRole(user?.role) === "super_master") {
    return true;
  }
  const email = user?.email?.trim().toLowerCase();
  return Boolean(email && configuredSuperMasterEmails().includes(email));
}

export function hasPermission(
  user: PermissionUser | null | undefined,
  permission: PermissionKey
): boolean {
  if (!user) {
    return false;
  }

  if (isSuperMaster(user)) {
    return (
      (permission !== "view.vozup" && permission !== "view.finance" && permission !== "view.campaigns") ||
      !user.institutoUpOnly
    );
  }

  if (
    (permission === "view.vozup" || permission === "view.finance" || permission === "view.campaigns") &&
    user.institutoUpOnly
  ) {
    return false;
  }

  const permissions = Array.isArray(user.permissions)
    ? normalizePermissionList(user.permissions)
    : defaultPermissionsForRole(normalizeTeamRole(user.role), {
        institutoUpOnly: Boolean(user.institutoUpOnly),
      });

  return permissions.includes(permission);
}

export const NAV_PERMISSION_BY_KEY: Record<string, PermissionKey | undefined> = {
  home: "view.dashboard",
  crm: "view.crm",
  produtividade: "view.productivity",
  distribuicao: "view.distribution",
  treinamentos: "view.trainings",
  recrutadores: "view.recruiters",
  anamnese: "view.anamnese",
  relatorios: "view.reports",
  "encontro-online": "view.encontro",
  tarefas: "view.tasks",
  "tarefas-auditoria": "view.tasks",
  rede: "view.network",
  "vozup-leads": "view.vozup",
  "vozup-rotas": "view.vozup_rotas",
  "vozup-auditoria": "admin.audit",
  "vozup-financeiro": "view.finance",
  campanhas: "view.campaigns",
  documentos: "view.vozup",
  usuarios: "admin.users",
  funis: "crm.manage_funnels",
};

const PATH_PERMISSION_RULES: Array<{ prefix: string; permission: PermissionKey }> = [
  { prefix: "/crm", permission: "view.crm" },
  { prefix: "/vozup", permission: "view.vozup" },
  { prefix: "/financeiro", permission: "view.finance" },
  { prefix: "/campanhas", permission: "view.campaigns" },
  { prefix: "/documentos", permission: "view.vozup" },
  { prefix: "/treinamentos", permission: "view.trainings" },
  { prefix: "/produtividade", permission: "view.productivity" },
  { prefix: "/distribuicao", permission: "view.distribution" },
  { prefix: "/recrutadores", permission: "view.recruiters" },
  { prefix: "/rede", permission: "view.network" },
  { prefix: "/anamnese", permission: "view.anamnese" },
  { prefix: "/relatorios", permission: "view.reports" },
  { prefix: "/ranking", permission: "view.reports" },
  { prefix: "/encontro-online", permission: "view.encontro" },
  { prefix: "/tarefas", permission: "view.tasks" },
  { prefix: "/usuarios", permission: "admin.users" },
  { prefix: "/funis", permission: "crm.manage_funnels" },
];

export function canViewNavLink(
  user: PermissionUser | null | undefined,
  navKey: string
): boolean {
  if (!user) {
    return true;
  }

  const permission = NAV_PERMISSION_BY_KEY[navKey];
  return permission ? hasPermission(user, permission) : true;
}

export function canAccessDashboardPath(
  user: PermissionUser | null | undefined,
  pathname: string
): boolean {
  if (!user) {
    return true;
  }

  if (pathname === "/vozup/rotas" || pathname.startsWith("/vozup/rotas/")) {
    return hasPermission(user, "view.vozup_rotas") || hasPermission(user, "view.vozup");
  }

  // Registro de auditoria é ferramenta de master — gated em admin.audit, não no
  // view.vozup geral (senão qualquer vendedor com acesso à VozUP veria as ações
  // de todo mundo). Precede a regra genérica de prefixo /vozup abaixo.
  if (pathname === "/vozup/auditoria" || pathname.startsWith("/vozup/auditoria/")) {
    return hasPermission(user, "admin.audit");
  }

  const rule = PATH_PERMISSION_RULES.find((candidate) =>
    pathname === candidate.prefix || pathname.startsWith(`${candidate.prefix}/`)
  );

  return rule ? hasPermission(user, rule.permission) : true;
}
