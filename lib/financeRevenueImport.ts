import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { getPool } from "@/lib/db";
import type { FinanceCatalog } from "@/types/finance";
import {
  REVENUE_IMPORT_COLUMNS,
  REVENUE_IMPORT_MAX_ROWS,
  cellText,
  normalizeKey,
  normalizeHeader,
  parseAmount,
  parseImportDate,
  type RevenueImportInput,
  type RevenueImportLists,
  type RevenueImportListKey,
  type RevenueImportOptions,
  type RevenueImportPreview,
  type RevenueImportRow,
} from "@/lib/financeRevenueImportModel";

/**
 * Importação de receitas por planilha — SOMENTE Instituto UP.
 *
 * A Voz UP vende por matrícula: a receita dela nasce do contrato e é lá que ela
 * precisa ser lançada (ver `createEnrollment` em lib/finance.ts). O Instituto UP
 * não tem matrícula — cada entrada de Encontro Online ou UP Day Plus é uma
 * receita avulsa solta, e é isso que torna o lançamento em massa necessário aqui
 * e proibido do outro lado. Por isso toda linha criada por este módulo entra com
 * `business_unit = 'instituto'`, sem coluna na planilha para escolher outra
 * coisa: se a unidade fosse um campo da planilha, uma linha errada colocaria
 * receita do Instituto dentro do resultado da Voz UP.
 *
 * O fluxo é o mesmo da importação de leads (`lib/importSpreadsheet.ts`): sobe o
 * arquivo, confere a prévia linha a linha, e só então confirma. O arquivo é
 * enviado DE NOVO na confirmação e relido aqui — o servidor nunca grava a partir
 * de valores que o navegador poderia ter editado no meio do caminho.
 */

export * from "@/lib/financeRevenueImportModel";

const SCHEMA = "dashboard";

/** Linhas de dados já formatadas na planilha modelo (validação e formato prontos). */
const TEMPLATE_ROWS = 400;

/** Sugestões de origem quando a base ainda não tem histórico do Instituto. */
const DEFAULT_ORIGINS = [
  "Encontro Online",
  "UP Day Plus",
  "Indicação",
  "Instagram",
  "WhatsApp",
  "Meta Ads",
  "Google Ads",
];

// ── Listas do modelo ────────────────────────────────────────────────

export function buildImportLists(catalog: FinanceCatalog, origins: string[] = []): RevenueImportLists {
  const pick = (items: Array<{ id: number; name: string; active: boolean }>) =>
    items.filter((item) => item.active).map((item) => ({ id: item.id, name: item.name }));

  const seen = new Set<string>();
  const mergedOrigins: string[] = [];
  for (const origin of [...origins, ...DEFAULT_ORIGINS]) {
    const value = origin?.trim();
    if (!value) continue;
    const key = normalizeKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    mergedOrigins.push(value);
  }

  return {
    categories: pick(catalog.categories.filter((item) => item.kind === "receita")),
    courses: pick(catalog.courses),
    branches: pick(catalog.branches),
    sellers: pick(catalog.sellers),
    origins: mergedOrigins,
  };
}

/** Origens já usadas em receitas do Instituto — viram sugestão no modelo. */
export async function listInstitutoOrigins(): Promise<string[]> {
  const { rows } = await getPool().query<{ origin: string }>(
    `SELECT DISTINCT origin
       FROM ${SCHEMA}.finance_revenues
      WHERE business_unit = 'instituto' AND origin IS NOT NULL AND btrim(origin) <> ''
      ORDER BY origin
      LIMIT 100`
  );
  return rows.map((row) => row.origin);
}

// ── Planilha modelo ─────────────────────────────────────────────────

const HEADER_FILL = "FF041A30";
const LIST_SHEET = "Listas";

/** Coluna do `Listas` que alimenta cada lista suspensa, na ordem em que são escritas. */
const LIST_ORDER: RevenueImportListKey[] = ["categories", "origins", "courses", "branches", "sellers"];

const LIST_LABELS: Record<RevenueImportListKey, string> = {
  categories: "Categorias de receita",
  origins: "Origens",
  courses: "Cursos",
  branches: "Unidades",
  sellers: "Vendedores",
};

function columnLetter(index: number): string {
  let value = index;
  let letter = "";
  while (value > 0) {
    const rest = (value - 1) % 26;
    letter = String.fromCharCode(65 + rest) + letter;
    value = Math.floor((value - rest - 1) / 26);
  }
  return letter;
}

/**
 * `worksheet.dataValidations.add(faixa, regra)` existe no ExcelJS mas ficou de
 * fora dos tipos publicados (só `cell.dataValidation` é declarado).
 */
function addValidation(sheet: ExcelJS.Worksheet, range: string, validation: ExcelJS.DataValidation): void {
  (sheet as unknown as { dataValidations: { add(range: string, validation: ExcelJS.DataValidation): void } })
    .dataValidations.add(range, validation);
}

export async function buildRevenueImportTemplate(lists: RevenueImportLists): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Dashboard VozUP";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Receitas", { views: [{ state: "frozen", ySplit: 1 }] });
  const guide = workbook.addWorksheet("Instruções");
  const listSheet = workbook.addWorksheet(LIST_SHEET, { state: "hidden" });

  // Aba escondida com as opções: é ela que as listas suspensas referenciam.
  const listValues: Record<RevenueImportListKey, string[]> = {
    categories: lists.categories.map((item) => item.name),
    origins: lists.origins,
    courses: lists.courses.map((item) => item.name),
    branches: lists.branches.map((item) => item.name),
    sellers: lists.sellers.map((item) => item.name),
  };
  LIST_ORDER.forEach((key, index) => {
    const column = listSheet.getColumn(index + 1);
    column.width = 32;
    listSheet.getCell(1, index + 1).value = LIST_LABELS[key];
    listValues[key].forEach((value, rowIndex) => {
      listSheet.getCell(rowIndex + 2, index + 1).value = value;
    });
  });

  sheet.columns = REVENUE_IMPORT_COLUMNS.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width,
  }));

  const headerRow = sheet.getRow(1);
  headerRow.height = 24;
  headerRow.eachCell((cell, index) => {
    const column = REVENUE_IMPORT_COLUMNS[index - 1];
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle" };
    if (column) cell.note = column.help;
  });

  REVENUE_IMPORT_COLUMNS.forEach((column, index) => {
    const columnIndex = index + 1;
    const sheetColumn = sheet.getColumn(columnIndex);
    if (column.format === "date") sheetColumn.numFmt = "dd/mm/yyyy";
    if (column.format === "money") sheetColumn.numFmt = 'R$ #,##0.00';
    if (column.format === "percent") sheetColumn.numFmt = "0.00";

    // A validação é declarada por FAIXA, não célula a célula: o otimizador do
    // ExcelJS ordena endereços como texto ("C10" antes de "C2") e, com mais de
    // nove linhas, emite duas faixas sobrepostas para a mesma coluna — o que faz
    // o Excel abrir o arquivo reclamando de conteúdo a reparar.
    const range = `${columnLetter(columnIndex)}2:${columnLetter(columnIndex)}${TEMPLATE_ROWS + 1}`;
    const listKey = column.list;
    const options = listKey ? listValues[listKey] : null;
    const listColumn = listKey ? columnLetter(LIST_ORDER.indexOf(listKey) + 1) : null;

    if (listKey && listColumn && options && options.length > 0) {
      addValidation(sheet, range, {
        type: "list",
        allowBlank: true,
        // Sem `showErrorMessage`, o Excel apenas sugere: é o que a coluna
        // Origem precisa, porque no banco ela é texto livre.
        showErrorMessage: !column.freeText,
        errorStyle: "stop",
        errorTitle: "Valor fora da lista",
        error: `Escolha uma das opções cadastradas em ${LIST_LABELS[listKey]}.`,
        formulae: [`${LIST_SHEET}!$${listColumn}$2:$${listColumn}$${options.length + 1}`],
      });
    }

    if (column.format === "money" || column.format === "percent") {
      addValidation(sheet, range, {
        type: "decimal",
        operator: "greaterThanOrEqual",
        allowBlank: true,
        showErrorMessage: true,
        errorStyle: "stop",
        errorTitle: "Valor inválido",
        error: "Digite um número.",
        formulae: [0],
      });
    }
  });

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: REVENUE_IMPORT_COLUMNS.length } };

  // Aba de instruções: quem preenche a planilha quase nunca é quem abriu a tela.
  guide.columns = [{ width: 28 }, { width: 96 }];
  const guideRows: Array<[string, string]> = [
    ["Para que serve", "Lançar em massa as receitas do Instituto UP (Encontro Online, UP Day Plus e afins)."],
    ["Onde importar", "Gestão Financeira › Receitas, com a chave do topo em Instituto UP › botão Importar planilha."],
    ["Unidade", "Toda linha entra como Instituto UP. Receita da Voz UP nasce da matrícula e não pode ser importada aqui."],
    ["Status", "Toda receita importada entra como Previsto. O dinheiro só entra no caixa quando o recebimento é registrado em Receber."],
    ["Preencha a partir de", "Segunda linha da aba Receitas. A ordem das colunas não importa."],
    ["Colunas com *", "Nome e Valor são obrigatórios em toda linha. Sem data, a tela pede uma data padrão na hora de importar."],
    ["Planilha própria", "Não é obrigatório usar este modelo: a importação também lê a sua planilha, desde que tenha uma coluna de descrição (Nome, Descrição, Item, Produto...) e uma de valor (Valor, Preço, Total...). Colunas desconhecidas são ignoradas."],
    ["Listas suspensas", "Categoria, Curso, Unidade e Vendedor só aceitam itens já cadastrados no financeiro. Origem aceita texto novo."],
    ["Datas", "Formato dd/mm/aaaa (ou uma célula de data do Excel)."],
    ["Valores", "Use vírgula decimal: 1.234,56. O símbolo R$ é opcional."],
    ["Antes de gravar", "A tela mostra uma prévia linha a linha, com erros e possíveis duplicidades, e só grava depois da sua confirmação."],
  ];
  guide.getCell("A1").value = "Como usar esta planilha";
  guide.getCell("A1").font = { bold: true, size: 14 };
  guideRows.forEach(([label, text], index) => {
    const row = index + 3;
    guide.getCell(row, 1).value = label;
    guide.getCell(row, 1).font = { bold: true };
    guide.getCell(row, 1).alignment = { vertical: "top" };
    guide.getCell(row, 2).value = text;
    guide.getCell(row, 2).alignment = { vertical: "top", wrapText: true };
  });

  const columnsTitleRow = guideRows.length + 5;
  guide.getCell(columnsTitleRow, 1).value = "Colunas";
  guide.getCell(columnsTitleRow, 1).font = { bold: true, size: 12 };
  REVENUE_IMPORT_COLUMNS.forEach((column, index) => {
    const row = columnsTitleRow + 1 + index;
    guide.getCell(row, 1).value = column.header;
    guide.getCell(row, 1).font = { bold: true };
    const aliases = column.aliases?.length ? ` Também aceita: ${column.aliases.join(", ")}.` : "";
    guide.getCell(row, 2).value = `${column.help}${aliases}`;
    guide.getCell(row, 2).alignment = { wrapText: true };
  });

  const raw = await workbook.xlsx.writeBuffer();
  return Buffer.from(raw);
}

// ── Leitura e validação ─────────────────────────────────────────────

export class RevenueImportError extends Error {}

async function readWorkbook(buffer: Buffer, filename: string | null): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  const isCsv = (filename ?? "").toLowerCase().endsWith(".csv");
  try {
    if (isCsv) {
      await workbook.csv.read(Readable.from(buffer));
    } else {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    }
  } catch {
    throw new RevenueImportError(
      "Não foi possível ler o arquivo. Use o modelo em .xlsx (ou um .csv com as mesmas colunas)."
    );
  }

  const sheet =
    workbook.worksheets.find((item) => normalizeKey(item.name) === "receitas") ?? workbook.worksheets[0];
  if (!sheet) throw new RevenueImportError("A planilha está vazia.");
  return sheet;
}

interface HeaderMap {
  /** índice da coluna (1-based) por chave da coluna do modelo. */
  columns: Map<string, number>;
  headerRow: number;
}

/**
 * Cabeçalho aceito: o do modelo ou qualquer apelido declarado na coluna. O
 * rótulo do modelo tem precedência, então uma planilha que traga "Nome" e
 * "Aluno" lê o primeiro como descrição e o segundo como aluno.
 */
function headerIndex(): Map<string, string> {
  const byHeader = new Map<string, string>();
  for (const column of REVENUE_IMPORT_COLUMNS) {
    byHeader.set(normalizeHeader(column.header), column.key);
  }
  for (const column of REVENUE_IMPORT_COLUMNS) {
    for (const alias of column.aliases ?? []) {
      const key = normalizeHeader(alias);
      if (!byHeader.has(key)) byHeader.set(key, column.key);
    }
  }
  return byHeader;
}

/**
 * Só descrição e valor são exigidos do ARQUIVO: sem eles não há receita para
 * criar. A data pode faltar na planilha inteira — nesse caso quem importa
 * informa a competência na tela (`defaultDate`), que é melhor do que recusar a
 * lista que a pessoa já mantém ou, pior, assumir "hoje" em silêncio.
 */
function findHeader(sheet: ExcelJS.Worksheet): HeaderMap {
  const byHeader = headerIndex();

  const lastRow = Math.min(sheet.rowCount, 10);
  for (let rowIndex = 1; rowIndex <= lastRow; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    const columns = new Map<string, number>();
    row.eachCell({ includeEmpty: false }, (cell, columnIndex) => {
      const key = byHeader.get(normalizeHeader(cellText(cell.value)));
      if (key && !columns.has(key)) columns.set(key, columnIndex);
    });
    if (columns.has("description") && columns.has("amount")) {
      return { columns, headerRow: rowIndex };
    }
  }

  throw new RevenueImportError(
    "Não encontrei as colunas obrigatórias. A planilha precisa de uma coluna de descrição (Nome, Descrição, Item…) e uma de valor (Valor, Preço, Total…) na mesma linha de cabeçalho. Se preferir, baixe o modelo."
  );
}

function lookup(
  options: RevenueImportOptions[],
  value: unknown
): { id: number | null; error: string | null } {
  const raw = cellText(value);
  if (!raw) return { id: null, error: null };
  if (typeof value === "number" && Number.isInteger(value)) {
    const byId = options.find((item) => item.id === value);
    if (byId) return { id: byId.id, error: null };
  }
  const key = normalizeKey(raw);
  const match = options.find((item) => normalizeKey(item.name) === key);
  if (match) return { id: match.id, error: null };
  return { id: null, error: raw };
}

function duplicateKey(date: string, description: string, amount: number): string {
  return `${date}|${normalizeKey(description)}|${amount.toFixed(2)}`;
}

/** Receitas do Instituto já gravadas nas datas da planilha, para apontar repetição. */
async function loadExistingKeys(dates: string[]): Promise<Set<string>> {
  if (dates.length === 0) return new Set();
  const { rows } = await getPool().query<{ date: Date | string; description: string; amount: string }>(
    `SELECT date, description, amount
       FROM ${SCHEMA}.finance_revenues
      WHERE business_unit = 'instituto' AND date = ANY($1::date[])`,
    [dates]
  );
  const keys = new Set<string>();
  for (const row of rows) {
    const date = row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date).slice(0, 10);
    keys.add(duplicateKey(date, row.description ?? "", Number(row.amount)));
  }
  return keys;
}

export interface ParseRevenueImportOptions {
  /**
   * Competência usada quando a planilha não traz coluna de data, ou a célula
   * está vazia. Vem da tela: assumir "hoje" jogaria a receita no mês errado sem
   * ninguém perceber.
   */
  defaultDate?: string | null;
}

export async function parseRevenueImport(
  buffer: Buffer,
  filename: string | null,
  lists: RevenueImportLists,
  options: ParseRevenueImportOptions = {}
): Promise<RevenueImportPreview> {
  const sheet = await readWorkbook(buffer, filename);
  const { columns, headerRow } = findHeader(sheet);
  const defaultDate = options.defaultDate ? parseImportDate(options.defaultDate) : null;
  const hasDateColumn = columns.has("date");

  const rows: RevenueImportRow[] = [];
  const cellOf = (row: ExcelJS.Row, key: string): unknown => {
    const index = columns.get(key);
    return index ? row.getCell(index).value : null;
  };

  for (let rowIndex = headerRow + 1; rowIndex <= sheet.rowCount; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    const filled = REVENUE_IMPORT_COLUMNS.some((column) => cellText(cellOf(row, column.key)) !== "");
    if (!filled) continue;

    if (rows.length >= REVENUE_IMPORT_MAX_ROWS) {
      throw new RevenueImportError(
        `A planilha tem mais de ${REVENUE_IMPORT_MAX_ROWS} linhas preenchidas. Divida em arquivos menores.`
      );
    }

    const errors: string[] = [];
    const warnings: string[] = [];
    const values: Record<string, string> = {};

    const rawDate = cellOf(row, "date");
    const sheetDate = hasDateColumn ? parseImportDate(rawDate) : null;
    const date = sheetDate ?? defaultDate;
    if (!date) {
      errors.push(
        hasDateColumn && cellText(rawDate)
          ? "Data da venda inválida (use dd/mm/aaaa)."
          : "Sem data nesta linha: informe a data padrão na tela ou preencha a coluna de data."
      );
    } else if (!sheetDate) {
      warnings.push(`Sem data na planilha: usando a data padrão (${date.split("-").reverse().join("/")}).`);
    }

    const description = cellText(cellOf(row, "description"));
    if (!description) errors.push("Nome da receita é obrigatório.");

    const amount = parseAmount(cellOf(row, "amount"));
    if (amount === null) errors.push("Valor inválido ou em branco.");
    else if (amount <= 0) errors.push("Valor precisa ser maior que zero.");

    const dueDateRaw = cellOf(row, "dueDate");
    const dueDate = cellText(dueDateRaw) ? parseImportDate(dueDateRaw) : null;
    if (cellText(dueDateRaw) && !dueDate) errors.push("Vencimento inválido (use dd/mm/aaaa).");

    const category = lookup(lists.categories, cellOf(row, "categoryId"));
    if (category.error) errors.push(`Categoria "${category.error}" não existe no financeiro.`);

    const course = lookup(lists.courses, cellOf(row, "courseId"));
    if (course.error) errors.push(`Curso "${course.error}" não existe no financeiro.`);

    const branch = lookup(lists.branches, cellOf(row, "branchId"));
    if (branch.error) errors.push(`Unidade "${branch.error}" não existe no financeiro.`);

    const seller = lookup(lists.sellers, cellOf(row, "sellerId"));
    if (seller.error) errors.push(`Vendedor "${seller.error}" não existe no financeiro.`);

    const commissionRaw = cellText(cellOf(row, "commissionPct"));
    let commissionPct: number | null = null;
    if (commissionRaw) {
      commissionPct = parseAmount(cellOf(row, "commissionPct"));
      if (commissionPct === null || commissionPct < 0 || commissionPct > 100) {
        errors.push("Comissão precisa ser um número entre 0 e 100.");
        commissionPct = null;
      }
    }
    if (commissionPct !== null && commissionPct > 0 && seller.id === null) {
      warnings.push("Comissão informada sem vendedor: ela não gera comissão para ninguém.");
    }

    const origin = cellText(cellOf(row, "origin"));
    const student = cellText(cellOf(row, "student"));
    const notes = cellText(cellOf(row, "notes"));

    values.date = date ?? cellText(cellOf(row, "date"));
    values.description = description;
    values.amount = amount === null ? cellText(cellOf(row, "amount")) : amount.toFixed(2);
    values.categoryId = category.id
      ? lists.categories.find((item) => item.id === category.id)?.name ?? ""
      : category.error ?? "";
    values.origin = origin;
    values.dueDate = dueDate ?? cellText(dueDateRaw);
    values.courseId = course.id ? lists.courses.find((item) => item.id === course.id)?.name ?? "" : course.error ?? "";
    values.branchId = branch.id ? lists.branches.find((item) => item.id === branch.id)?.name ?? "" : branch.error ?? "";
    values.sellerId = seller.id ? lists.sellers.find((item) => item.id === seller.id)?.name ?? "" : seller.error ?? "";
    values.commissionPct = commissionPct === null ? commissionRaw : String(commissionPct);
    values.student = student;
    values.notes = notes;

    const input: RevenueImportInput | null =
      errors.length === 0 && date && amount !== null
        ? {
            date,
            businessUnit: "instituto",
            description,
            categoryId: category.id,
            origin: origin || null,
            student: student || null,
            courseId: course.id,
            branchId: branch.id,
            sellerId: seller.id,
            amount,
            dueDate,
            notes: notes || null,
            ...(commissionPct !== null ? { commissionPct } : {}),
          }
        : null;

    rows.push({
      line: rowIndex,
      status: errors.length > 0 ? "erro" : "ok",
      errors,
      warnings,
      values,
      input,
    });
  }

  if (rows.length === 0) {
    throw new RevenueImportError("Nenhuma linha preenchida na planilha.");
  }

  // Duplicidade: contra o que já está no banco e contra a própria planilha —
  // reimportar o mesmo arquivo é o erro mais fácil de cometer, e receita
  // duplicada infla faturamento sem ninguém notar.
  const dates = Array.from(new Set(rows.map((item) => item.input?.date).filter((value): value is string => Boolean(value))));
  const existing = await loadExistingKeys(dates);
  const seenInFile = new Set<string>();
  for (const row of rows) {
    if (!row.input) continue;
    const key = duplicateKey(row.input.date, row.input.description, row.input.amount);
    if (existing.has(key)) {
      row.status = "duplicado";
      row.warnings.push("Já existe uma receita do Instituto com esta data, descrição e valor.");
    } else if (seenInFile.has(key)) {
      row.status = "duplicado";
      row.warnings.push("Linha repetida dentro da própria planilha.");
    }
    seenInFile.add(key);
  }

  return {
    filename,
    rows,
    totals: {
      rows: rows.length,
      ok: rows.filter((row) => row.status === "ok").length,
      duplicated: rows.filter((row) => row.status === "duplicado").length,
      errors: rows.filter((row) => row.status === "erro").length,
      amount: rows
        .filter((row) => row.status === "ok")
        .reduce((sum, row) => sum + (row.input?.amount ?? 0), 0),
    },
  };
}

/** Linhas que serão realmente gravadas, dadas as escolhas da tela. */
export function selectImportRows(
  preview: RevenueImportPreview,
  options: { includeDuplicates?: boolean } = {}
): RevenueImportRow[] {
  return preview.rows.filter((row) => {
    if (!row.input) return false;
    if (row.status === "erro") return false;
    if (row.status === "duplicado" && !options.includeDuplicates) return false;
    return true;
  });
}
