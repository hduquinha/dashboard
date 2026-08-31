import ExcelJS from "exceljs";
import {
  buildImportLists,
  buildRevenueImportTemplate,
  parseRevenueImport,
  selectImportRows,
  type RevenueImportLists,
} from "@/lib/financeRevenueImport";
import { parseImportDate } from "@/lib/financeRevenueImportModel";
import type { FinanceCatalog } from "@/types/finance";

// A checagem de duplicidade é a única parte que conversa com o banco; o resto
// do módulo é leitura de planilha. Cada teste decide o que já "existe".
const existingRows: Array<{ date: string; description: string; amount: string }> = [];

jest.mock("@/lib/db", () => ({
  getPool: () => ({
    query: async () => ({ rows: existingRows }),
  }),
}));

const catalog = {
  categories: [
    { id: 1, kind: "receita", name: "Matrícula", active: true },
    { id: 2, kind: "receita", name: "Inscrição", active: true },
    { id: 3, kind: "receita", name: "Antiga", active: false },
    { id: 4, kind: "gasto_fixo", name: "Aluguel", active: true },
  ],
  courses: [{ id: 10, name: "Encontro Online", defaultPrice: null, active: true }],
  branches: [{ id: 20, name: "Matriz", city: null, active: true }],
  sellers: [{ id: 30, name: "Andrea", defaultPct: 10, active: true }],
  paymentMethods: [],
  employees: [],
  cardBrands: [],
  installmentRates: [],
  initialBalance: 0,
  boletoFee: 0,
} as unknown as FinanceCatalog;

const lists: RevenueImportLists = buildImportLists(catalog, ["Encontro Online"]);

type SheetRow = Array<string | number | Date | null>;

/** Planilha "de fora": cabeçalho livre, só as colunas que a pessoa tem. */
async function customSheet(headers: string[], rows: SheetRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Plan1");
  sheet.addRow(headers);
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Monta um arquivo com o cabeçalho oficial e as linhas informadas. */
async function sheetWith(rows: SheetRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Receitas");
  sheet.addRow([
    "Data da venda*",
    "Nome da receita*",
    "Valor*",
    "Categoria",
    "Origem",
    "Vencimento",
    "Curso",
    "Unidade",
    "Vendedor",
    "Comissão (%)",
    "Aluno",
    "Observações",
  ]);
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

beforeEach(() => {
  existingRows.length = 0;
});

describe("buildImportLists", () => {
  it("só oferece catálogo ativo e categorias de receita", () => {
    expect(lists.categories.map((item) => item.name)).toEqual(["Matrícula", "Inscrição"]);
    expect(lists.courses).toHaveLength(1);
    expect(lists.sellers[0]).toEqual({ id: 30, name: "Andrea" });
  });

  it("não repete a origem que já existe na base entre as sugestões padrão", () => {
    expect(lists.origins.filter((item) => item === "Encontro Online")).toHaveLength(1);
  });
});

describe("parseImportDate", () => {
  it("aceita dd/mm/aaaa, aaaa-mm-dd e célula de data", () => {
    expect(parseImportDate("05/08/2026")).toBe("2026-08-05");
    expect(parseImportDate("2026-08-05")).toBe("2026-08-05");
    expect(parseImportDate(new Date(Date.UTC(2026, 7, 5)))).toBe("2026-08-05");
  });

  it("recusa data que não existe no calendário", () => {
    expect(parseImportDate("31/02/2026")).toBeNull();
    expect(parseImportDate("amanhã")).toBeNull();
  });
});

describe("parseRevenueImport", () => {
  it("converte uma linha completa em receita do Instituto", async () => {
    const buffer = await sheetWith([
      ["10/08/2026", "Encontro Online 12/09", "R$ 1.250,50", "Inscrição", "Instagram", "20/08/2026", "Encontro Online", "Matriz", "Andrea", "12", "Maria", "pago no pix"],
    ]);

    const preview = await parseRevenueImport(buffer, "receitas.xlsx", lists);

    expect(preview.totals).toMatchObject({ rows: 1, ok: 1, errors: 0, duplicated: 0 });
    expect(preview.rows[0].input).toEqual({
      date: "2026-08-10",
      businessUnit: "instituto",
      description: "Encontro Online 12/09",
      categoryId: 2,
      origin: "Instagram",
      student: "Maria",
      courseId: 10,
      branchId: 20,
      sellerId: 30,
      amount: 1250.5,
      dueDate: "2026-08-20",
      notes: "pago no pix",
      commissionPct: 12,
    });
  });

  it("aponta o que está errado sem derrubar as outras linhas", async () => {
    const buffer = await sheetWith([
      ["10/08/2026", "", "100", "Inscrição", "", "", "", "", "", "", "", ""],
      ["30/02/2026", "Data impossível", "100", "", "", "", "", "", "", "", "", ""],
      ["10/08/2026", "Categoria inexistente", "100", "Consultoria", "", "", "", "", "", "", "", ""],
      ["10/08/2026", "Valor zerado", "0", "", "", "", "", "", "", "", "", ""],
      ["10/08/2026", "Linha boa", "100", "", "", "", "", "", "", "", "", ""],
    ]);

    const preview = await parseRevenueImport(buffer, null, lists);

    expect(preview.totals).toMatchObject({ rows: 5, ok: 1, errors: 4 });
    expect(preview.rows[0].errors[0]).toMatch(/Nome da receita/);
    expect(preview.rows[1].errors[0]).toMatch(/Data da venda/);
    expect(preview.rows[2].errors[0]).toMatch(/Consultoria/);
    expect(preview.rows[3].errors[0]).toMatch(/maior que zero/);
    // A linha da planilha (com o cabeçalho na 1) é o que a prévia mostra.
    expect(preview.rows[4]).toMatchObject({ line: 6, status: "ok" });
  });

  it("ignora linhas em branco no meio da planilha", async () => {
    const buffer = await sheetWith([
      ["10/08/2026", "Primeira", "100", "", "", "", "", "", "", "", "", ""],
      [null, null, null, null, null, null, null, null, null, null, null, null],
      ["11/08/2026", "Segunda", "200", "", "", "", "", "", "", "", "", ""],
    ]);

    const preview = await parseRevenueImport(buffer, null, lists);
    expect(preview.totals.rows).toBe(2);
  });

  it("marca como duplicada a linha que repete receita já gravada", async () => {
    existingRows.push({ date: "2026-08-10", description: "Encontro Online", amount: "100.00" });
    const buffer = await sheetWith([
      ["10/08/2026", "encontro online", "100", "", "", "", "", "", "", "", "", ""],
      ["11/08/2026", "Outra venda", "100", "", "", "", "", "", "", "", "", ""],
    ]);

    const preview = await parseRevenueImport(buffer, null, lists);

    expect(preview.rows[0].status).toBe("duplicado");
    expect(preview.rows[1].status).toBe("ok");
    expect(selectImportRows(preview)).toHaveLength(1);
    expect(selectImportRows(preview, { includeDuplicates: true })).toHaveLength(2);
  });

  it("marca como duplicada a linha repetida dentro do próprio arquivo", async () => {
    const buffer = await sheetWith([
      ["10/08/2026", "Encontro Online", "100", "", "", "", "", "", "", "", "", ""],
      ["10/08/2026", "Encontro Online", "100", "", "", "", "", "", "", "", "", ""],
    ]);

    const preview = await parseRevenueImport(buffer, null, lists);
    expect(preview.rows.map((row) => row.status)).toEqual(["ok", "duplicado"]);
  });

  it("aceita planilha de fora do modelo, com outros nomes de coluna", async () => {
    const buffer = await customSheet(
      ["Data", "Descrição", "Preço", "Tipo", "Canal", "Cliente", "Nada a ver"],
      [["12/08/2026", "Inscrição avulsa", "R$ 480,00", "Inscrição", "Indicação", "João", "ignorado"]]
    );

    const preview = await parseRevenueImport(buffer, "minha-planilha.xlsx", lists);

    expect(preview.totals).toMatchObject({ rows: 1, ok: 1, errors: 0 });
    expect(preview.rows[0].input).toMatchObject({
      date: "2026-08-12",
      description: "Inscrição avulsa",
      amount: 480,
      categoryId: 2,
      origin: "Indicação",
      student: "João",
    });
  });

  it("importa planilha só com nome e valor usando a data padrão da tela", async () => {
    const buffer = await customSheet(
      ["Nome", "Valor"],
      [["Encontro Online — Ana", 250], ["Encontro Online — Bruno", "300,50"]]
    );

    const preview = await parseRevenueImport(buffer, null, lists, { defaultDate: "2026-08-01" });

    expect(preview.totals).toMatchObject({ rows: 2, ok: 2, errors: 0 });
    expect(preview.rows[0].input).toMatchObject({ date: "2026-08-01", amount: 250 });
    expect(preview.rows[1].input).toMatchObject({ date: "2026-08-01", amount: 300.5 });
    // A data assumida aparece na prévia: ninguém importa competência sem saber.
    expect(preview.rows[0].warnings[0]).toMatch(/data padrão/);
  });

  it("recusa a linha sem data quando não há data padrão", async () => {
    const buffer = await customSheet(["Nome", "Valor"], [["Sem data nenhuma", 100]]);

    const preview = await parseRevenueImport(buffer, null, lists);

    expect(preview.rows[0].status).toBe("erro");
    expect(preview.rows[0].errors[0]).toMatch(/data padrão/);
  });

  it("usa a data padrão só onde a planilha não tem data", async () => {
    const buffer = await customSheet(
      ["Data", "Nome", "Valor"],
      [["12/08/2026", "Com data", 100], [null, "Sem data", 100]]
    );

    const preview = await parseRevenueImport(buffer, null, lists, { defaultDate: "2026-08-01" });

    expect(preview.rows[0].input).toMatchObject({ date: "2026-08-12" });
    expect(preview.rows[0].warnings).toHaveLength(0);
    expect(preview.rows[1].input).toMatchObject({ date: "2026-08-01" });
  });

  it("recusa arquivo sem coluna de descrição ou de valor", async () => {
    const buffer = await customSheet(["quando", "o que", "quanto"], [["10/08/2026", "Algo", "100"]]);

    await expect(parseRevenueImport(buffer, null, lists)).rejects.toThrow(/colunas obrigatórias/);
  });

  it("lê de volta a própria planilha modelo", async () => {
    const template = await buildRevenueImportTemplate(lists);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(template as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet("Receitas");
    expect(sheet).toBeDefined();

    // A lista suspensa da coluna Categoria aponta para a aba escondida.
    expect(sheet!.getCell("D2").dataValidation).toMatchObject({ type: "list" });
    expect(workbook.getWorksheet("Listas")?.state).toBe("hidden");

    const row = sheet!.getRow(2);
    row.getCell(1).value = new Date(Date.UTC(2026, 7, 10));
    row.getCell(2).value = "Vinda do modelo";
    row.getCell(3).value = 99.9;
    row.getCell(4).value = "Matrícula";
    const filled = Buffer.from(await workbook.xlsx.writeBuffer());

    const preview = await parseRevenueImport(filled, "modelo.xlsx", lists);
    expect(preview.totals).toMatchObject({ rows: 1, ok: 1 });
    expect(preview.rows[0].input).toMatchObject({
      date: "2026-08-10",
      description: "Vinda do modelo",
      amount: 99.9,
      categoryId: 1,
      businessUnit: "instituto",
    });
  });
});
