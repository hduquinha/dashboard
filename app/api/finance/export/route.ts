import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import {
  currentMonth,
  getCommissionPanel,
  getFinanceCatalog,
  getFinanceDashboardSummary,
  listBranchItems,
  listCommissions,
  listEnrollments,
  listFixedExpenses,
  listRevenues,
  listVariableExpenses,
} from "@/lib/finance";
import { parseFinanceFilters, requireFinanceAccess } from "../utils";
import type { FinanceCatalog, FinanceDashboardSummary } from "@/types/finance";

type ExportRow = Record<string, string | number | null>;

const SECTION_LABELS: Record<string, string> = {
  dashboard: "Dashboard Financeiro",
  fluxo: "Fluxo de Caixa",
  receitas: "Receitas",
  "gastos-fixos": "Despesas Fixas",
  "gastos-variaveis": "Despesas Variaveis",
  funcionarios: "Funcionarios",
  folha: "Folha de Pagamento",
  comissoes: "Comissoes",
  matriculas: "Matriculas",
  filiais: "Unidade Tatuape",
  trimestral: "Consolidacao Trimestral",
  configuracoes: "Configuracoes Financeiras",
};

const COMPLETE_SECTIONS = [
  "dashboard",
  "fluxo",
  "receitas",
  "gastos-fixos",
  "gastos-variaveis",
  "funcionarios",
  "folha",
  "comissoes",
  "matriculas",
  "filiais",
  "trimestral",
  "configuracoes",
];

function filename(format: string, section: string) {
  const stamp = new Date().toISOString().slice(0, 10);
  return `vozup-financeiro-${section}-${stamp}.${format}`;
}

function csvEscape(value: string | number | null): string {
  if (value === null) return "";
  const raw = String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function rowsToCsv(rows: ExportRow[]) {
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  if (headers.length === 0) headers.push("vazio");
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((key) => csvEscape(row[key] ?? "")).join(",")),
  ].join("\r\n");
}

type ExportContext = {
  catalog: FinanceCatalog;
  summaries: Map<string, FinanceDashboardSummary>;
};

function scopedSearchParams(searchParams: URLSearchParams, month: string): URLSearchParams {
  const scoped = new URLSearchParams(searchParams.toString());
  scoped.delete("months");
  scoped.delete("sections");
  scoped.set("month", month);
  // A seleção explícita de meses deve prevalecer sobre o período atualmente
  // aberto na tela da dashboard.
  scoped.set("from", month);
  scoped.set("to", month);
  return scoped;
}

function withExportContext(rows: ExportRow[], section: string, month: string): ExportRow[] {
  return rows.map((row) => ({
    "Mês exportado": month,
    "Seção exportada": SECTION_LABELS[section] ?? section,
    ...row,
  }));
}

function addWorksheet(workbook: ExcelJS.Workbook, title: string, rows: ExportRow[]) {
  const sheet = workbook.addWorksheet(title.slice(0, 31));
  const headers = Object.keys(rows[0] ?? { Status: "Sem dados" });
  sheet.columns = headers.map((key) => ({
    header: key,
    key,
    width: Math.max(14, Math.min(34, key.length + 8)),
  }));

  rows.forEach((row) => sheet.addRow(row));
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rows.length + 1), column: headers.length },
  };
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF041A30" } };
    cell.alignment = { vertical: "middle" };
  });
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
    });
  });

  const numericKeys = headers.filter((key) =>
    rows.some((row) => typeof row[key] === "number")
  );
  if (rows.length > 0 && numericKeys.length > 0) {
    const totalRow = sheet.addRow(
      Object.fromEntries(headers.map((key, index) => [
        key,
        index === 0 ? "Total" : numericKeys.includes(key) ? { formula: `SUM(${sheet.getColumn(key).letter}2:${sheet.getColumn(key).letter}${rows.length + 1})` } : "",
      ]))
    );
    totalRow.font = { bold: true };
    totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5F8FF" } };
  }
}

async function buildRows(section: string, month: string, searchParams: URLSearchParams, context?: ExportContext): Promise<ExportRow[]> {
  const filters = parseFinanceFilters(searchParams);
  const catalog = context?.catalog ?? await getFinanceCatalog();
  const summary = context?.summaries.get(month) ?? await getFinanceDashboardSummary(month, filters);
  context?.summaries.set(month, summary);

  if (section === "dashboard") {
    return summary.kpis.map((kpi) => ({
      Indicador: kpi.label,
      Valor: kpi.value,
      "Mes anterior": kpi.previous,
      "Variacao %": kpi.deltaPct,
    }));
  }

  if (section === "fluxo") {
    return summary.monthly.map((item) => ({
      Mes: item.month,
      Receitas: item.revenue,
      "Receita prevista": item.revenueForecast,
      "Despesas fixas": item.fixedExpenses + item.commissions,
      "Despesas variaveis": item.variableExpenses,
      "Total de despesas": item.totalExpenses,
      "Lucro liquido": item.profit,
      "Margem %": item.margin,
      "Saldo em caixa": summary.cashBalance,
    }));
  }

  if (section === "receitas") {
    return (await listRevenues(filters)).map((item) => ({
      Data: item.date,
      Descricao: item.description,
      Categoria: item.categoryName,
      Origem: item.origin,
      Aluno: item.student,
      Curso: item.courseName,
      Unidade: item.branchName,
      "Forma de pagamento": item.paymentMethodName,
      Vendedor: item.sellerName,
      Valor: item.amount,
      Taxas: item.feeAmount,
      Status: item.status,
    }));
  }

  if (section === "gastos-fixos" || section === "folha") {
    return (await listFixedExpenses(month))
      .filter((item) => section === "folha" ? item.kind === "folha" : true)
      .map((item) => ({
        Mes: item.month,
        Descricao: item.description,
        Categoria: item.categoryName,
        Vencimento: item.dueDate,
        Salario: item.kind === "folha" ? item.amount : null,
        Beneficios: item.kind === "folha" ? item.benefitsAmount : null,
        Valor: item.kind === "folha" ? item.amount + (item.benefitsAmount ?? 0) : item.amount,
        Status: item.status,
        Travado: item.recurringLocked ? "Sim" : "Nao",
        "Dia travado": item.recurringDueDay,
        "Pago em": item.paidAt,
        "Link nota fiscal": item.invoiceUrl,
        "Arquivo nota fiscal": item.invoiceFilename,
        Observacoes: item.notes,
      }));
  }

  if (section === "gastos-variaveis") {
    return (await listVariableExpenses(filters)).map((item) => ({
      Data: item.date,
      Descricao: item.description,
      Categoria: item.categoryName,
      Unidade: item.branchName,
      Valor: item.amount,
      "Link nota fiscal": item.invoiceUrl,
      "Arquivo nota fiscal": item.invoiceFilename,
      Observacao: item.notes,
    }));
  }

  if (section === "matriculas") {
    return (await listEnrollments(filters)).map((item) => ({
      Aluno: item.student,
      Curso: item.courseName,
      "Valor do curso": item.totalAmount,
      Parcelas: item.installments,
      "Forma de pagamento": item.paymentMethodName,
      "Mes inicial": item.firstMonth,
      Data: item.saleDate,
      Vendedor: item.sellerName,
      Unidade: item.branchName,
      "Taxa %": item.ratePct,
      "Taxas": item.feeTotal,
      "Receita liquida": item.netTotal,
    }));
  }

  if (section === "comissoes") {
    const panel = await getCommissionPanel(month);
    const commissions = await listCommissions(filters);
    return [
      ...panel.sellers.map((seller) => ({
        Tipo: "Resumo vendedor",
        Vendedor: seller.sellerName,
        Aluno: null,
        Curso: null,
        "Valor venda": null,
        Percentual: null,
        Parcelas: null,
        "Comissao total": seller.yearTotal,
        "Comissao mes": seller.monthTotal,
        Pago: seller.paidTotal,
        Pendente: seller.pendingTotal,
      })),
      ...commissions.map((item) => ({
        Tipo: "Venda",
        Vendedor: item.sellerName,
        Aluno: item.student,
        Curso: item.courseName,
        "Valor venda": item.saleAmount,
        Percentual: item.percent,
        Parcelas: item.installments,
        "Comissao total": item.totalCommission,
        "Comissao mes": item.installmentsDetail
          .filter((installment) => installment.month === month)
          .reduce((sum, installment) => sum + installment.amount, 0),
        Pago: item.installmentsDetail
          .filter((installment) => installment.status === "pago")
          .reduce((sum, installment) => sum + installment.amount, 0),
        Pendente: item.installmentsDetail
          .filter((installment) => installment.status === "pendente")
          .reduce((sum, installment) => sum + installment.amount, 0),
      })),
    ];
  }

  if (section === "filiais") {
    return (await listBranchItems()).map((item) => ({
      Unidade: item.branchName,
      Item: item.item,
      Categoria: item.category,
      Fornecedor: item.supplier,
      Valor: item.amount,
      Data: item.date,
      Status: item.status,
      "Tipo de custo": item.costKind,
      "Link nota fiscal": item.invoiceUrl,
      "Arquivo nota fiscal": item.invoiceFilename,
      Observacoes: item.notes,
    }));
  }

  if (section === "trimestral") {
    return summary.quarterly.map((item) => ({
      Trimestre: item.label,
      Receita: item.revenue,
      "Despesas fixas": item.fixedExpenses,
      "Despesas variaveis": item.variableExpenses,
      "Total de despesas": item.totalExpenses,
      Lucro: item.profit,
      "Margem %": item.margin,
    }));
  }

  if (section === "funcionarios") {
    return catalog.employees.map((item) => ({
      Nome: item.name,
      Cargo: item.role,
      Salario: item.salary,
      Beneficios: item.benefits,
      Total: item.salary + item.benefits,
      Ativo: item.active ? "Sim" : "Nao",
    }));
  }

  return [
    ...catalog.categories.map((item) => ({
      Tipo: "Categoria",
      Grupo: item.kind,
      Nome: item.name,
      Valor: null,
      Ativo: item.active ? "Sim" : "Nao",
    })),
    ...catalog.paymentMethods.map((item) => ({
      Tipo: "Forma de pagamento",
      Grupo: item.kind,
      Nome: item.name,
      Valor: null,
      Ativo: item.active ? "Sim" : "Nao",
    })),
    ...catalog.installmentRates.map((item) => ({
      Tipo: "Taxa de parcela",
      Grupo: `${item.installments}x`,
      Nome: "Taxa",
      Valor: item.ratePct,
      Ativo: "Sim",
    })),
  ];
}

type PdfColumn = {
  key: string;
  label: string;
  width: number;
  align?: "left" | "right" | "center";
  format?: "currency" | "percent" | "date";
};

const PDF_COLUMNS: Record<string, PdfColumn[]> = {
  dashboard: [
    { key: "Indicador", label: "Indicador", width: 260 },
    { key: "Valor", label: "Valor", width: 150, align: "right", format: "currency" },
    { key: "Mes anterior", label: "Mês anterior", width: 150, align: "right", format: "currency" },
    { key: "Variacao %", label: "Variação", width: 130, align: "right", format: "percent" },
  ],
  fluxo: [
    { key: "Mes", label: "Mês", width: 95 },
    { key: "Receitas", label: "Recebido", width: 115, align: "right", format: "currency" },
    { key: "Receita prevista", label: "Previsto", width: 115, align: "right", format: "currency" },
    { key: "Despesas fixas", label: "Fixas", width: 110, align: "right", format: "currency" },
    { key: "Despesas variaveis", label: "Variáveis", width: 110, align: "right", format: "currency" },
    { key: "Lucro liquido", label: "Resultado", width: 115, align: "right", format: "currency" },
  ],
  receitas: [
    { key: "Data", label: "Data", width: 75, format: "date" },
    { key: "Descricao", label: "Descrição", width: 235 },
    { key: "Aluno", label: "Aluno", width: 145 },
    { key: "Vendedor", label: "Vendedor", width: 100 },
    { key: "Valor", label: "Previsto", width: 95, align: "right", format: "currency" },
    { key: "Status", label: "Status", width: 85, align: "center" },
  ],
  "gastos-fixos": [
    { key: "Mes", label: "Mês", width: 75 },
    { key: "Descricao", label: "Descrição", width: 230 },
    { key: "Categoria", label: "Categoria", width: 160 },
    { key: "Vencimento", label: "Vencimento", width: 95, format: "date" },
    { key: "Valor", label: "Valor", width: 105, align: "right", format: "currency" },
    { key: "Status", label: "Status", width: 85, align: "center" },
  ],
  folha: [
    { key: "Descricao", label: "Colaborador", width: 220 },
    { key: "Categoria", label: "Categoria", width: 150 },
    { key: "Salario", label: "Salário", width: 120, align: "right", format: "currency" },
    { key: "Beneficios", label: "Benefícios", width: 120, align: "right", format: "currency" },
    { key: "Valor", label: "Total", width: 120, align: "right", format: "currency" },
    { key: "Status", label: "Status", width: 90, align: "center" },
  ],
  "gastos-variaveis": [
    { key: "Data", label: "Data", width: 80, format: "date" },
    { key: "Descricao", label: "Descrição", width: 260 },
    { key: "Categoria", label: "Categoria", width: 165 },
    { key: "Unidade", label: "Unidade", width: 130 },
    { key: "Valor", label: "Valor", width: 120, align: "right", format: "currency" },
  ],
  matriculas: [
    { key: "Aluno", label: "Aluno", width: 220 },
    { key: "Curso", label: "Curso", width: 170 },
    { key: "Valor do curso", label: "Contrato", width: 115, align: "right", format: "currency" },
    { key: "Parcelas", label: "Parcelas", width: 75, align: "center" },
    { key: "Mes inicial", label: "Início", width: 95 },
    { key: "Vendedor", label: "Vendedor", width: 120 },
  ],
  comissoes: [
    { key: "Tipo", label: "Tipo", width: 105 },
    { key: "Vendedor", label: "Vendedor", width: 155 },
    { key: "Aluno", label: "Aluno", width: 185 },
    { key: "Comissao total", label: "Comissão", width: 115, align: "right", format: "currency" },
    { key: "Pago", label: "Pago", width: 105, align: "right", format: "currency" },
    { key: "Pendente", label: "Pendente", width: 105, align: "right", format: "currency" },
  ],
  trimestral: [
    { key: "Trimestre", label: "Trimestre", width: 125 },
    { key: "Receita", label: "Receita recebida", width: 145, align: "right", format: "currency" },
    { key: "Despesas fixas", label: "Fixas", width: 120, align: "right", format: "currency" },
    { key: "Despesas variaveis", label: "Variáveis", width: 120, align: "right", format: "currency" },
    { key: "Total de despesas", label: "Despesas", width: 120, align: "right", format: "currency" },
    { key: "Lucro", label: "Resultado", width: 120, align: "right", format: "currency" },
  ],
};

function pdfValue(value: string | number | null | undefined, column: PdfColumn): string {
  if (value === null || value === undefined || value === "") return "—";
  if (column.format === "currency" && typeof value === "number") {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
  }
  if (column.format === "percent" && typeof value === "number") return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value)}%`;
  if (column.format === "date" && typeof value === "string" && /^\d{4}-\d{2}(-\d{2})?$/.test(value)) {
    const [year, month, day = "01"] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  return String(value);
}

function pdfTruncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(1, max - 1))}…` : value;
}

function pdfColumns(section: string, rows: ExportRow[]): PdfColumn[] {
  if (PDF_COLUMNS[section]) return PDF_COLUMNS[section];
  return Object.keys(rows[0] ?? {}).slice(0, 6).map((key) => ({ key, label: key, width: 125 }));
}

function drawPdfHeader(doc: PDFKit.PDFDocument, section: string, month: string, page: number) {
  doc.rect(0, 0, doc.page.width, 82).fill("#071a33");
  doc.rect(0, 78, doc.page.width, 4).fill("#17b6d4");
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(18).text("VozUP", 36, 24);
  doc.fillColor("#b9d9ea").font("Helvetica").fontSize(9).text("GESTÃO FINANCEIRA · RELATÓRIO EXECUTIVO", 36, 49);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(12).text(SECTION_LABELS[section] ?? "Exportação", 520, 27, { width: 285, align: "right" });
  doc.fillColor("#b9d9ea").font("Helvetica").fontSize(9).text(`Competência: ${month}  ·  Página ${page}`, 520, 49, { width: 285, align: "right" });
}

function drawPdfFooter(doc: PDFKit.PDFDocument) {
  doc.moveTo(36, 558).lineTo(806, 558).strokeColor("#dbe5ed").lineWidth(0.6).stroke();
  doc.fillColor("#64748b").font("Helvetica").fontSize(7.5).text(`Gerado em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date())}`, 36, 566);
  doc.text("Dados financeiros internos · VozUP", 520, 566, { width: 285, align: "right" });
}

function drawPdfTable(doc: PDFKit.PDFDocument, section: string, month: string, rows: ExportRow[], startPage: number): number {
  const columns = pdfColumns(section, rows);
  const left = 36;
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
  const rowHeight = 23;
  let page = startPage;
  let y = 145;

  const drawTableHeader = () => {
    doc.roundedRect(left, y, tableWidth, 24, 3).fill("#e9f5f9");
    let x = left;
    for (const column of columns) {
      doc.fillColor("#315267").font("Helvetica-Bold").fontSize(7.5).text(column.label.toUpperCase(), x + 6, y + 8, { width: column.width - 12, align: column.align ?? "left" });
      x += column.width;
    }
    y += 24;
  };

  drawTableHeader();
  for (const [index, row] of rows.entries()) {
    if (y + rowHeight > 552) {
      drawPdfFooter(doc);
      doc.addPage();
      page += 1;
      drawPdfHeader(doc, section, month, page);
      y = 116;
      drawTableHeader();
    }
    if (index % 2 === 0) doc.rect(left, y, tableWidth, rowHeight).fill("#f8fbfc");
    doc.moveTo(left, y + rowHeight).lineTo(left + tableWidth, y + rowHeight).strokeColor("#e4edf2").lineWidth(0.4).stroke();
    let x = left;
    for (const column of columns) {
      const raw = pdfValue(row[column.key], column);
      const maxChars = Math.max(8, Math.floor(column.width / 5.4));
      doc.fillColor("#163147").font(column.align === "right" ? "Helvetica-Bold" : "Helvetica").fontSize(8.2).text(pdfTruncate(raw, maxChars), x + 6, y + 8, { width: column.width - 12, align: column.align ?? "left", lineBreak: false });
      x += column.width;
    }
    y += rowHeight;
  }
  drawPdfFooter(doc);
  return page;
}

async function buildPdf(sections: string[], months: string[], searchParams: URLSearchParams, context: ExportContext) {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0, info: { Title: "VozUP · Gestão Financeira", Author: "VozUP" } });
  const chunks: Buffer[] = [];

  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  let firstPage = true;
  let page = 1;
  for (const month of months) {
    for (const section of sections) {
      if (!firstPage) {
        doc.addPage();
        page += 1;
      }
      firstPage = false;
      const rows = await buildRows(section, month, scopedSearchParams(searchParams, month), context);
      drawPdfHeader(doc, section, month, page);
      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(14).text(SECTION_LABELS[section] ?? "Exportação", 36, 104);
      doc.fillColor("#64748b").font("Helvetica").fontSize(8.5).text(`${rows.length} registro${rows.length === 1 ? "" : "s"} no recorte selecionado`, 36, 123);
      if (rows.length === 0) {
        doc.roundedRect(36, 155, 770, 64, 5).fill("#f1f5f9");
        doc.fillColor("#64748b").font("Helvetica-Bold").fontSize(10).text("Sem dados para os filtros selecionados.", 54, 180);
        drawPdfFooter(doc);
      } else {
        page = drawPdfTable(doc, section, month, rows, page);
      }
    }
  }

  doc.end();
  return done;
}

export async function GET(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") || "xlsx";
  const requestedSections = (searchParams.get("sections") || searchParams.get("section") || "complete")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value === "complete" || COMPLETE_SECTIONS.includes(value));
  const sections = Array.from(new Set(requestedSections.flatMap((value) => value === "complete" ? COMPLETE_SECTIONS : [value])));
  const fallbackMonth = searchParams.get("month") || currentMonth();
  const selectedMonths = Array.from(new Set((searchParams.get("months") || fallbackMonth)
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^\d{4}-\d{2}$/.test(value))));
  if (sections.length === 0 || selectedMonths.length === 0) {
    return NextResponse.json({ error: "Selecione ao menos uma seção e um mês." }, { status: 400 });
  }
  const context: ExportContext = { catalog: await getFinanceCatalog(), summaries: new Map() };

  if (format === "csv") {
    const rows: ExportRow[] = [];
    for (const month of selectedMonths) {
      for (const section of sections) {
        rows.push(...withExportContext(await buildRows(section, month, scopedSearchParams(searchParams, month), context), section, month));
      }
    }
    return new NextResponse(rowsToCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename("csv", "selecao")}"`,
      },
    });
  }

  if (format === "pdf") {
    const pdf = await buildPdf(sections, selectedMonths, searchParams, context);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename("pdf", "selecao")}"`,
      },
    });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Dashboard VozUP";
  workbook.created = new Date();
  workbook.properties.date1904 = false;

  const usedSheetTitles = new Set<string>();
  for (const month of selectedMonths) {
    for (const item of sections) {
      const rows = await buildRows(item, month, scopedSearchParams(searchParams, month), context);
      const baseTitle = `${month} - ${SECTION_LABELS[item] ?? item}`;
      let sheetTitle = baseTitle.slice(0, 31);
      let suffix = 2;
      while (usedSheetTitles.has(sheetTitle)) {
        const suffixText = `-${suffix}`;
        sheetTitle = `${baseTitle.slice(0, 31 - suffixText.length)}${suffixText}`;
        suffix += 1;
      }
      usedSheetTitles.add(sheetTitle);
      addWorksheet(workbook, sheetTitle, rows);
    }
  }

  const raw = await workbook.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(Buffer.from(raw)), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename("xlsx", "selecao")}"`,
    },
  });
}
