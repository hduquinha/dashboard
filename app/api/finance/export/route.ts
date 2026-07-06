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
  matriculas: "Matriculas Parceladas",
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
  const headers = Object.keys(rows[0] ?? { vazio: "" });
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((key) => csvEscape(row[key] ?? "")).join(",")),
  ].join("\r\n");
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

async function buildRows(section: string, month: string, searchParams: URLSearchParams): Promise<ExportRow[]> {
  const filters = parseFinanceFilters(searchParams);
  const catalog = await getFinanceCatalog();
  const summary = await getFinanceDashboardSummary(month, filters);

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

async function buildPdf(section: string, month: string, searchParams: URLSearchParams) {
  const rows = await buildRows(section === "complete" ? "trimestral" : section, month, searchParams);
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 });
  const chunks: Buffer[] = [];

  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  doc.fontSize(18).text("VozUP - Gestao Financeira", { continued: false });
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor("#475569").text(`${SECTION_LABELS[section] ?? "Exportacao"} · ${month}`);
  doc.moveDown();

  rows.slice(0, 40).forEach((row) => {
    doc.fillColor("#0f172a").fontSize(9).text(
      Object.entries(row)
        .map(([key, value]) => `${key}: ${value ?? ""}`)
        .join("   |   "),
      { width: 760 }
    );
    doc.moveDown(0.25);
  });

  doc.end();
  return done;
}

export async function GET(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") || "xlsx";
  const section = searchParams.get("section") || "complete";
  const month = searchParams.get("month") || currentMonth();
  const sections = section === "complete" ? COMPLETE_SECTIONS : [section];

  if (format === "csv") {
    const rows = await buildRows(sections[0], month, searchParams);
    return new NextResponse(rowsToCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename("csv", sections[0])}"`,
      },
    });
  }

  if (format === "pdf") {
    const pdf = await buildPdf(section, month, searchParams);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename("pdf", section)}"`,
      },
    });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Dashboard VozUP";
  workbook.created = new Date();
  workbook.properties.date1904 = false;

  for (const item of sections) {
    addWorksheet(workbook, SECTION_LABELS[item] ?? item, await buildRows(item, month, searchParams));
  }

  const raw = await workbook.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(Buffer.from(raw)), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename("xlsx", section)}"`,
    },
  });
}
