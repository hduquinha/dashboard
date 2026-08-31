/**
 * Modelo da importação de receitas do Instituto UP: colunas da planilha, tipos
 * da prévia e as conversões de texto para data e dinheiro.
 *
 * Vive separado de `financeRevenueImport.ts` porque o modal da tela precisa dos
 * mesmos rótulos e tipos, e aquele módulo carrega `exceljs` e o pool do
 * Postgres — importá-lo de um componente "use client" arrastaria o servidor
 * inteiro para dentro do bundle do navegador.
 */

/** Teto de linhas por importação: cada linha é um INSERT + um evento de auditoria. */
export const REVENUE_IMPORT_MAX_ROWS = 1000;

export type RevenueImportListKey = "categories" | "origins" | "courses" | "branches" | "sellers";

export interface RevenueImportColumn {
  key: string;
  header: string;
  width: number;
  required?: boolean;
  /** Lista suspensa aplicada à coluna na planilha modelo. */
  list?: RevenueImportListKey;
  /** `true` aceita valor fora da lista (a lista vira sugestão, não trava). */
  freeText?: boolean;
  /**
   * Outros cabeçalhos aceitos para esta coluna. Existem porque quase ninguém
   * chega com o modelo em mãos: a planilha que a pessoa já mantém chama a
   * coluna de "Descrição", "Preço" ou "Cliente", e recusar o arquivo por causa
   * do rótulo transformaria a importação em retrabalho de digitação.
   */
  aliases?: string[];
  format?: "date" | "money" | "percent";
  help: string;
}

/**
 * Colunas da planilha. O conjunto espelha o formulário "Nova receita" (receita
 * avulsa) — de propósito não existe coluna de forma de pagamento nem de status:
 * ambos nascem do recebimento, registrado depois em "Receber". Uma coluna de
 * status aqui deixaria a planilha declarar dinheiro em caixa que ninguém
 * conferiu.
 */
export const REVENUE_IMPORT_COLUMNS: RevenueImportColumn[] = [
  {
    key: "date",
    header: "Data da venda*",
    aliases: ["Data", "Data de venda", "Data do lançamento", "Competência", "Dia"],
    width: 16,
    required: true,
    format: "date",
    help: "Obrigatório. Competência da receita (dd/mm/aaaa).",
  },
  {
    key: "description",
    header: "Nome da receita*",
    aliases: ["Nome", "Descrição", "Histórico", "Item", "Produto", "Serviço", "Lançamento", "Referente a"],
    width: 42,
    required: true,
    help: "Obrigatório. Ex.: Encontro Online 12/09 — inscrição.",
  },
  {
    key: "amount",
    header: "Valor*",
    aliases: ["Valor total", "Valor da venda", "Valor bruto", "Preço", "Total", "Montante"],
    width: 16,
    required: true,
    format: "money",
    help: "Obrigatório. Valor fechado da venda, maior que zero.",
  },
  {
    key: "categoryId",
    header: "Categoria",
    aliases: ["Tipo", "Tipo de receita", "Classificação"],
    width: 22,
    list: "categories",
    help: "Escolha na lista. Só aceita categorias de receita já cadastradas.",
  },
  {
    key: "origin",
    header: "Origem",
    aliases: ["Fonte", "Canal", "Procedência"],
    width: 24,
    list: "origins",
    freeText: true,
    help: "Lista de sugestões — pode digitar um valor novo.",
  },
  {
    key: "dueDate",
    header: "Vencimento",
    aliases: ["Data de vencimento", "Data do vencimento", "Vence em", "Prazo"],
    width: 16,
    format: "date",
    help: "Opcional. Em branco, a receita fica sem data de cobrança.",
  },
  {
    key: "courseId",
    header: "Curso",
    aliases: ["Treinamento"],
    width: 26,
    list: "courses",
    help: "Opcional. Escolha na lista.",
  },
  {
    key: "branchId",
    header: "Unidade",
    aliases: ["Filial", "Local"],
    width: 18,
    list: "branches",
    help: "Opcional. Escolha na lista.",
  },
  {
    key: "sellerId",
    header: "Vendedor",
    aliases: ["Responsável", "Consultor", "Atendente"],
    width: 22,
    list: "sellers",
    help: "Opcional. Escolha na lista.",
  },
  {
    key: "commissionPct",
    header: "Comissão (%)",
    aliases: ["Comissão", "Comissão %", "% comissão", "Percentual de comissão"],
    width: 14,
    format: "percent",
    help: "Opcional, de 0 a 100. Em branco usa o percentual padrão do vendedor.",
  },
  {
    key: "student",
    header: "Aluno",
    aliases: ["Cliente", "Nome do aluno", "Participante", "Comprador", "Pagante"],
    width: 30,
    help: "Opcional. Nome de quem comprou.",
  },
  {
    key: "notes",
    header: "Observações",
    aliases: ["Observação", "Obs", "Notas", "Comentários", "Detalhes"],
    width: 40,
    help: "Opcional.",
  },
];

export interface RevenueImportOptions {
  id: number;
  name: string;
}

export interface RevenueImportLists {
  categories: RevenueImportOptions[];
  courses: RevenueImportOptions[];
  branches: RevenueImportOptions[];
  sellers: RevenueImportOptions[];
  /** Origem é texto livre no banco: a lista existe só como sugestão. */
  origins: string[];
}

/**
 * Payload de uma linha válida. Espelha os campos de `RevenueInput`
 * (lib/finance.ts) que a planilha preenche — declarado aqui para o modelo não
 * depender do módulo financeiro inteiro.
 */
export interface RevenueImportInput {
  date: string;
  businessUnit: "instituto";
  description: string;
  categoryId: number | null;
  origin: string | null;
  student: string | null;
  courseId: number | null;
  branchId: number | null;
  sellerId: number | null;
  amount: number;
  dueDate: string | null;
  notes: string | null;
  commissionPct?: number;
}

export type RevenueImportRowStatus = "ok" | "duplicado" | "erro";

export interface RevenueImportRow {
  /** Número da linha na planilha, como o usuário vê no Excel. */
  line: number;
  status: RevenueImportRowStatus;
  errors: string[];
  warnings: string[];
  /** Valores já formatados para a prévia na tela. */
  values: Record<string, string>;
  input: RevenueImportInput | null;
}

export interface RevenueImportPreview {
  filename: string | null;
  rows: RevenueImportRow[];
  totals: {
    rows: number;
    ok: number;
    duplicated: number;
    errors: number;
    /** Soma das linhas prontas para importar (sem erro e sem duplicidade). */
    amount: number;
  };
}

// ── Normalização ────────────────────────────────────────────────────

/** Chave de comparação: sem acento, sem caixa, sem espaço duplicado. */
export function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Cabeçalho: além da chave, ignora o `*` de obrigatório e o que vem em parênteses. */
export function normalizeHeader(value: string): string {
  return normalizeKey(value).replace(/\*/g, "").replace(/\(.*?\)/g, "").replace(/[:.]/g, "").trim();
}

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const rich = value as { text?: unknown; result?: unknown; richText?: Array<{ text?: string }>; hyperlink?: string };
    if (Array.isArray(rich.richText)) return rich.richText.map((part) => part.text ?? "").join("").trim();
    if (rich.result !== undefined) return cellText(rich.result);
    if (typeof rich.text === "string") return rich.text.trim();
  }
  return String(value).trim();
}

/**
 * Valor monetário digitado por gente: "R$ 1.234,56", "1234.56", "1.234".
 * Mesma regra do formulário (o último separador manda), replicada aqui porque
 * a versão do cliente vive dentro de um componente "use client".
 */
export function parseAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = cellText(value).replace(/r\$/gi, "").replace(/\s/g, "");
  if (!raw) return null;
  if (!/^-?[\d.,]+$/.test(raw)) return null;
  const decimalSeparator = raw.lastIndexOf(",") > raw.lastIndexOf(".") ? "," : ".";
  const normalized =
    decimalSeparator === ","
      ? raw.replace(/\./g, "").replace(",", ".")
      : raw.replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function ymd(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Data em qualquer forma que a planilha entregue: célula de data (Date em UTC),
 * serial do Excel, ou texto dd/mm/aaaa e aaaa-mm-dd. Ano de dois dígitos vira
 * 20xx — planilha financeira não tem lançamento do século passado.
 */
export function parseImportDate(value: unknown): string | null {
  if (value instanceof Date) {
    return ymd(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // Serial do Excel: dia 1 = 1900-01-01, com o bug do 1900 bissexto embutido.
    const serialEpoch = Date.UTC(1899, 11, 30);
    const date = new Date(serialEpoch + Math.round(value) * 86400000);
    return ymd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  const raw = cellText(value);
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) {
    const [, year, month, day] = iso.map(Number) as unknown as [never, number, number, number];
    return isValidYmd(year, month, day) ? ymd(year, month, day) : null;
  }

  const br = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]);
    const year = Number(br[3]) < 100 ? 2000 + Number(br[3]) : Number(br[3]);
    return isValidYmd(year, month, day) ? ymd(year, month, day) : null;
  }

  return null;
}

