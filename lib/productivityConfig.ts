export const PRODUCTIVITY_CHANNELS = [
  { key: "m4_google", label: "M4 Google" },
  { key: "m4_meta_wpp", label: "M4 Meta Wpp" },
  { key: "m4_meta_nativos", label: "M4 Meta Nativos" },
  { key: "indicacao_aluno", label: "Indicacao Aluno" },
  { key: "equipe_vox", label: "Equipe Vox" },
  { key: "fachada", label: "Fachada" },
  { key: "instagram_direct_espontaneo", label: "Instagram Direct Espontaneo" },
  { key: "site", label: "Site" },
] as const;

export type ProductivityChannelKey = (typeof PRODUCTIVITY_CHANNELS)[number]["key"];

export interface MetricRowDefinition {
  key: string;
  label: string;
  group?: string;
  /**
   * Quando true, o valor da linha vem calculado ao vivo das movimentacoes do
   * Kanban (dashboard.commercial_events) e nao pode ser editado a mao — ver
   * lib/commercialReports.ts. Quando ausente/false, a linha nao tem nenhum
   * sinal automatico possivel (ex.: avaliacao Google) e continua manual.
   */
  automatic?: boolean;
}

export interface MetricSectionDefinition {
  key: string;
  label: string;
  rows: MetricRowDefinition[];
}

export type MetricMatrix = Record<string, Record<ProductivityChannelKey, number>>;

// Cada linha automatica mapeia 1:1 para uma chave de
// ProductivityKanbanConsultantMetric (lib/commercialReports.ts STAGE_TO_METRIC).
// As antigas subdivisoes por "meio de contato" (falado/whatsapp,
// presencial/meet) foram removidas: dashboard.commercial_events nunca
// registrou esse dado, entao a divisao manual era so uma aparencia de
// precisao que nao existia de verdade.
export const DAILY_PRODUCTIVITY_SECTIONS: MetricSectionDefinition[] = [
  {
    key: "tentativas",
    label: "Tentativas",
    rows: [{ key: "tentativas", label: "Tentativas", group: "Tentativas", automatic: true }],
  },
  {
    key: "conexoes",
    label: "Conexoes",
    rows: [{ key: "conexoes", label: "Conexoes", group: "Conexoes", automatic: true }],
  },
  {
    key: "agendamentos",
    label: "Agendamentos",
    rows: [{ key: "agendamentos", label: "Agendamentos", group: "Agendamentos", automatic: true }],
  },
  {
    key: "consultorias",
    label: "Consultorias",
    rows: [{ key: "consultorias", label: "Consultorias", group: "Consultorias", automatic: true }],
  },
];

export const CLOSING_NO_SHOW_ROWS: MetricRowDefinition[] = [
  { key: "nao_comparecimentos", label: "Nao Comparecimentos", group: "Nao Comparecimentos", automatic: true },
];

export const CLOSING_PRODUCTION_ROWS: MetricRowDefinition[] = [
  { key: "tentativas", label: "Tentativas", group: "Fechamento e Producao Diaria", automatic: true },
  { key: "conexoes", label: "Conexoes", group: "Fechamento e Producao Diaria", automatic: true },
  { key: "agendamentos", label: "Agendamentos", group: "Fechamento e Producao Diaria", automatic: true },
  { key: "consultorias", label: "Consultorias", group: "Fechamento e Producao Diaria", automatic: true },
  { key: "producao", label: "Producao (Ganho)", group: "Fechamento e Producao Diaria", automatic: true },
  { key: "indicacoes_aluno", label: "Indicacoes Aluno", group: "Fechamento e Producao Diaria" },
  { key: "avaliacao_google", label: "Avaliacao Google", group: "Fechamento e Producao Diaria" },
  { key: "pastas_di", label: "Pastas DI", group: "Fechamento e Producao Diaria" },
];

export const DAILY_PRODUCTIVITY_ROWS = DAILY_PRODUCTIVITY_SECTIONS.flatMap((section) => section.rows);

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
  }

  return 0;
}

export function createEmptyMetricMatrix(rows: MetricRowDefinition[]): MetricMatrix {
  return rows.reduce<MetricMatrix>((acc, row) => {
    acc[row.key] = PRODUCTIVITY_CHANNELS.reduce<Record<ProductivityChannelKey, number>>(
      (channelAcc, channel) => {
        channelAcc[channel.key] = 0;
        return channelAcc;
      },
      {} as Record<ProductivityChannelKey, number>
    );
    return acc;
  }, {});
}

export function normalizeMetricMatrix(
  value: unknown,
  rows: MetricRowDefinition[]
): MetricMatrix {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const matrix = createEmptyMetricMatrix(rows);

  for (const row of rows) {
    const rowSource =
      source[row.key] && typeof source[row.key] === "object"
        ? (source[row.key] as Record<string, unknown>)
        : {};

    for (const channel of PRODUCTIVITY_CHANNELS) {
      matrix[row.key][channel.key] = toNumber(rowSource[channel.key]);
    }
  }

  return matrix;
}

export function sumMetricMatrix(matrix: MetricMatrix): number {
  return Object.values(matrix).reduce((rowTotal, row) => {
    return rowTotal + Object.values(row).reduce((total, value) => total + value, 0);
  }, 0);
}

export function sumMetricRows(matrix: MetricMatrix, rowKeys: string[]): number {
  return rowKeys.reduce((total, rowKey) => {
    const row = matrix[rowKey];
    if (!row) {
      return total;
    }
    return total + Object.values(row).reduce((rowTotal, value) => rowTotal + value, 0);
  }, 0);
}

export function sumMetricChannels(matrix: MetricMatrix): Record<ProductivityChannelKey, number> {
  return PRODUCTIVITY_CHANNELS.reduce<Record<ProductivityChannelKey, number>>((acc, channel) => {
    acc[channel.key] = Object.values(matrix).reduce((total, row) => total + (row[channel.key] ?? 0), 0);
    return acc;
  }, {} as Record<ProductivityChannelKey, number>);
}
