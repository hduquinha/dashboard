import type { MetricMatrix, ProductivityChannelKey } from "@/lib/productivityConfig";

export interface ProductivityActor {
  id: number | null;
  email: string;
  name: string;
}

export interface ProductivityConsultant {
  userId: number | null;
  email: string;
  name: string;
}

export interface ProductivityDailyBoard {
  id: number;
  consultantUserId: number | null;
  consultantEmail: string;
  consultantName: string;
  reportDate: string;
  metrics: MetricMatrix;
  createdByUserId: number | null;
  createdByEmail: string | null;
  createdByName: string | null;
  verifiedAt: string | null;
  verifiedByUserId: number | null;
  verifiedByEmail: string | null;
  verifiedByName: string | null;
  managerNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductivityClosingBoard {
  id: number;
  consultantUserId: number | null;
  consultantEmail: string;
  consultantName: string;
  reportDate: string;
  noShowMetrics: MetricMatrix;
  productionMetrics: MetricMatrix;
  deliveryDate: string | null;
  specialistSignature: string | null;
  createdByUserId: number | null;
  createdByEmail: string | null;
  createdByName: string | null;
  verifiedAt: string | null;
  verifiedByUserId: number | null;
  verifiedByEmail: string | null;
  verifiedByName: string | null;
  managerNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductivitySummary {
  totalAttempts: number;
  totalConnections: number;
  totalAppointments: number;
  totalConsultorias: number;
  totalNoShows: number;
  totalProduction: number;
  verifiedDailyBoards: number;
  verifiedClosingBoards: number;
  pendingVerification: number;
}

export interface ProductivityTrendPoint {
  date: string;
  label: string;
  tentativas: number;
  conexoes: number;
  agendamentos: number;
  consultorias: number;
  producao: number;
  bolos: number;
}

export interface ProductivityChannelPoint {
  channel: ProductivityChannelKey;
  label: string;
  value: number;
}

export interface ProductivityConsultantPoint {
  email: string;
  name: string;
  tentativas: number;
  agendamentos: number;
  producao: number;
}

export interface ProductivityChartsData {
  trend: ProductivityTrendPoint[];
  channels: ProductivityChannelPoint[];
  consultants: ProductivityConsultantPoint[];
}

export interface ProductivityLeadAgent {
  id: number | null;
  /** Id em dashboard.team_members (nome do campo mantido por compatibilidade historica). */
  chatwootUserId: number;
  name: string;
  email: string;
  role: "admin" | "member";
  inboxIds: number[];
  active: boolean;
  position: number;
  institutoUpOnly: boolean;
}

export interface LeadDistributionQueueItem {
  inscricaoId: number;
  name: string | null;
  phone: string | null;
  createdAt: string;
  trainingLabel: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
}

export interface LeadDistributionResultItem {
  inscricaoId: number;
  assigneeId: number;
  assigneeName: string;
  assigneeEmail: string;
}

export interface ProductivityDistributionState {
  configured: boolean;
  agents: ProductivityLeadAgent[];
  queue: LeadDistributionQueueItem[];
  lastAssignments: LeadDistributionResultItem[];
}

export interface ProductivityKanbanStageMetric {
  stage: string;
  stageName: string;
  total: number;
  assigned: number;
  unassigned: number;
}

export interface ProductivityKanbanConsultantMetric {
  teamMemberId: number | null;
  name: string;
  email: string | null;
  total: number;
  tentativas: number;
  conexoes: number;
  agendamentos: number;
  consultorias: number;
  noShow: number;
  producao: number;
  updatedInPeriod: number;
}

export interface ProductivityKanbanRecentCard {
  inscricaoId: number;
  contactName: string | null;
  assigneeName: string | null;
  stageName: string;
  updatedAt: string | null;
}

export interface ProductivityKanbanSnapshot {
  totalLeads: number;
  unassignedLeads: number;
  updatedInPeriod: number;
  distributedInPeriod: number;
  stageMetrics: ProductivityKanbanStageMetric[];
  consultantMetrics: ProductivityKanbanConsultantMetric[];
  recentCards: ProductivityKanbanRecentCard[];
}

export interface ProductivityWorkspace {
  currentUser: ProductivityActor;
  isManager: boolean;
  dateFrom: string;
  dateTo: string;
  consultants: ProductivityConsultant[];
  dailyBoards: ProductivityDailyBoard[];
  closingBoards: ProductivityClosingBoard[];
  summary: ProductivitySummary;
  charts: ProductivityChartsData;
  distribution: ProductivityDistributionState;
  kanban: ProductivityKanbanSnapshot;
}

export interface SaveProductivityBoardsInput {
  reportDate: string;
  consultantUserId?: number | null;
  consultantEmail?: string | null;
  consultantName?: string | null;
  dailyMetrics: MetricMatrix;
  noShowMetrics: MetricMatrix;
  productionMetrics: MetricMatrix;
  deliveryDate?: string | null;
  specialistSignature?: string | null;
}
