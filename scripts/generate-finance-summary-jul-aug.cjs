const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const ExcelJS = require("exceljs");

const PERIODS = [
  { key: "2026-07", label: "Julho/2026", start: "2026-07-01", end: "2026-08-01" },
  { key: "2026-08", label: "Agosto/2026", start: "2026-08-01", end: "2026-09-01" },
];
const OUTPUT = path.resolve(__dirname, "../../reports/resumo-financeiro-julho-agosto-2026.xlsx");
const CURRENCY_FORMAT = 'R$ #,##0.00';
const INTEGER_FORMAT = '#,##0';

function databaseUrl() {
  const envPath = path.resolve(__dirname, "../.env.local");
  const env = fs.readFileSync(envPath, "utf8");
  const line = env.split(/\r?\n/).find((item) => item.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL não encontrado em dashboard/.env.local");
  return line.slice("DATABASE_URL=".length).trim().replace(/^['"]|['"]$/g, "");
}

function number(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value) {
  return Math.round(number(value) * 100) / 100;
}

function sum(rows, field) {
  return round2(rows.reduce((total, row) => total + number(row[field]), 0));
}

function periodFor(value) {
  const key = String(value).slice(0, 7);
  return PERIODS.find((period) => period.key === key);
}

function companyLabel(value) {
  return value === "instituto" ? "Instituto UP" : "Voz UP";
}

function methodLabel(value) {
  return {
    pix: "PIX",
    credito: "Crédito",
    debito: "Débito",
    boleto: "Boleto",
    dinheiro: "Dinheiro",
    transferencia: "Transferência",
    outros: "Outros / não informado",
  }[value] ?? "Outros / não informado";
}

function styleTitle(row) {
  row.font = { name: "Aptos Display", size: 16, bold: true, color: { argb: "FF0F172A" } };
  row.height = 26;
}

function styleSubtitle(row) {
  row.font = { name: "Aptos", size: 10, italic: true, color: { argb: "FF475569" } };
}

function styleHeader(row) {
  row.font = { name: "Aptos", size: 10, bold: true, color: { argb: "FF1E293B" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
  row.alignment = { vertical: "middle", wrapText: true };
  row.height = 24;
  row.eachCell((cell) => {
    cell.border = { bottom: { style: "thin", color: { argb: "FFCBD5E1" } } };
  });
}

function styleSection(row) {
  row.font = { name: "Aptos", size: 11, bold: true, color: { argb: "FF334155" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
  row.border = { bottom: { style: "thin", color: { argb: "FFCBD5E1" } } };
}

function styleTotal(row) {
  row.font = { name: "Aptos", size: 10, bold: true, color: { argb: "FF0F172A" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCCFBF1" } };
  row.eachCell((cell) => {
    cell.border = { top: { style: "thin", color: { argb: "FF99F6E4" } } };
  });
}

function applyCurrency(row, columns) {
  for (const column of columns) row.getCell(column).numFmt = CURRENCY_FORMAT;
}

function applyInteger(row, columns) {
  for (const column of columns) row.getCell(column).numFmt = INTEGER_FORMAT;
}

function setupSheet(sheet, widths) {
  sheet.views = [{ state: "frozen", ySplit: 4 }];
  sheet.properties.defaultRowHeight = 18;
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
}

function addSection(sheet, label, width) {
  const row = sheet.addRow([label]);
  sheet.mergeCells(row.number, 1, row.number, width);
  styleSection(row);
  return row;
}

function addSummarySheet(workbook, data) {
  const sheet = workbook.addWorksheet("Resumo");
  setupSheet(sheet, [42, 18, 18, 18]);
  styleTitle(sheet.addRow(["Resumo financeiro — julho e agosto de 2026"]));
  styleSubtitle(sheet.addRow(["Valores em R$ | Receitas recebidas no mês | Despesas fixas e variáveis separadas por situação"]));
  sheet.addRow([]);

  addSection(sheet, "1. RECEITAS POR FORMA DE PAGAMENTO", 4);
  const methodHeader = sheet.addRow(["Forma de pagamento", ...PERIODS.map((period) => period.label), "Total"]);
  styleHeader(methodHeader);
  for (const method of data.methodOrder) {
    const values = PERIODS.map((period) => data.methods[method][period.key].gross);
    const row = sheet.addRow([method, ...values, round2(values.reduce((a, b) => a + b, 0))]);
    applyCurrency(row, [2, 3, 4]);
  }
  const methodTotal = sheet.addRow(["Total de receitas", ...PERIODS.map((period) => data.months[period.key].gross), data.total.gross]);
  applyCurrency(methodTotal, [2, 3, 4]);
  styleTotal(methodTotal);

  sheet.addRow([]);
  addSection(sheet, "2. RESUMO DE DESPESAS E RESULTADO", 4);
  const header = sheet.addRow(["Item", ...PERIODS.map((period) => period.label), "Total"]);
  styleHeader(header);
  const rows = [
    ["Receita bruta", "gross"],
    ["(-) Taxas", "fees"],
    ["Receita líquida", "net"],
    ["Despesas variáveis", "variable"],
    ["Despesas fixas pagas", "fixedPaid"],
    ["Comissões pagas", "commissionPaid"],
    ["Total pago/lançado", "cashExpenses"],
    ["Resultado após despesas pagas", "result"],
    ["Despesas fixas em aberto", "fixedOpen"],
    ["Comissões em aberto", "commissionOpen"],
    ["Total comprometido", "committedExpenses"],
  ];
  for (const [label, field] of rows) {
    const values = PERIODS.map((period) => data.months[period.key][field]);
    const row = sheet.addRow([label, ...values, round2(values.reduce((a, b) => a + b, 0))]);
    applyCurrency(row, [2, 3, 4]);
    if (["Receita líquida", "Total pago/lançado", "Resultado após despesas pagas", "Total comprometido"].includes(label)) styleTotal(row);
  }
}

function addMethodsSheet(workbook, data) {
  const sheet = workbook.addWorksheet("Receitas por método");
  setupSheet(sheet, [30, 18, 18, 18, 18, 18]);
  styleTitle(sheet.addRow(["Receitas por método de pagamento — julho e agosto de 2026"]));
  styleSubtitle(sheet.addRow(["Bruto por mês; taxas e líquido no total do período. Para conferir cada recebimento, use a aba detalhada."]));
  sheet.addRow([]);
  const header = sheet.addRow(["Forma de pagamento", "Julho — bruto", "Agosto — bruto", "Total bruto", "Total taxas", "Total líquido"]);
  styleHeader(header);
  for (const method of data.methodOrder) {
    const july = data.methods[method]["2026-07"];
    const august = data.methods[method]["2026-08"];
    const row = sheet.addRow([method, july.gross, august.gross, round2(july.gross + august.gross), round2(july.fees + august.fees), round2(july.net + august.net)]);
    applyCurrency(row, [2, 3, 4, 5, 6]);
  }
  const row = sheet.addRow(["TOTAL", data.months["2026-07"].gross, data.months["2026-08"].gross, data.total.gross, data.total.fees, data.total.net]);
  applyCurrency(row, [2, 3, 4, 5, 6]);
  styleTotal(row);
  sheet.autoFilter = { from: "A4", to: "F4" };
}

function addExpenseCategorySheet(workbook, data) {
  const sheet = workbook.addWorksheet("Despesas por categoria");
  setupSheet(sheet, [16, 30, 18, 17, 17, 17, 12]);
  styleTitle(sheet.addRow(["Despesas por categoria — julho e agosto de 2026"]));
  styleSubtitle(sheet.addRow(["Despesas fixas aparecem separadas por status; despesas variáveis entram como lançadas no mês."]));
  sheet.addRow([]);
  const header = sheet.addRow(["Tipo", "Categoria", "Status", "Julho/2026", "Agosto/2026", "Total", "Lançamentos"]);
  styleHeader(header);
  for (const item of data.expenseCategories) {
    const row = sheet.addRow([item.kind, item.category, item.status, item.months["2026-07"].total, item.months["2026-08"].total, round2(item.months["2026-07"].total + item.months["2026-08"].total), item.months["2026-07"].entries + item.months["2026-08"].entries]);
    applyCurrency(row, [4, 5, 6]);
    applyInteger(row, [7]);
  }
  const total = sheet.addRow(["TOTAL", "", "", data.months["2026-07"].committedExpenses, data.months["2026-08"].committedExpenses, data.total.committedExpenses, data.expenseCount]);
  applyCurrency(total, [4, 5, 6]);
  applyInteger(total, [7]);
  styleTotal(total);
  sheet.autoFilter = { from: "A4", to: "G4" };
}

function addRevenueDetailsSheet(workbook, revenues) {
  const sheet = workbook.addWorksheet("Receitas detalhadas");
  setupSheet(sheet, [14, 18, 25, 32, 28, 18, 18, 14, 16, 14, 16]);
  styleTitle(sheet.addRow(["Receitas detalhadas — julho e agosto de 2026"]));
  styleSubtitle(sheet.addRow(["Fonte: recebimentos de receitas avulsas e pagamentos de matrículas registrados no banco financeiro."]));
  sheet.addRow([]);
  const header = sheet.addRow(["Data", "Empresa", "Origem", "Aluno/participante", "Descrição/curso", "Método", "Valor bruto", "Taxas", "Valor líquido", "Parcelas", "Mês"]);
  styleHeader(header);
  for (const item of revenues) {
    const row = sheet.addRow([new Date(`${item.payment_date}T00:00:00Z`), companyLabel(item.business_unit), item.source, item.student ?? "", item.description ?? item.course_name ?? "", methodLabel(item.payment_method), number(item.amount), number(item.fee_amount), number(item.net_amount), item.installments ?? "", periodFor(item.payment_date)?.label ?? ""]);
    row.getCell(1).numFmt = "dd/mm/yyyy";
    applyCurrency(row, [7, 8, 9]);
  }
  sheet.autoFilter = { from: "A4", to: "K4" };
}

function addExpenseDetailsSheet(workbook, fixed, variable) {
  const sheet = workbook.addWorksheet("Despesas detalhadas");
  setupSheet(sheet, [14, 16, 18, 30, 28, 18, 18, 18, 16]);
  styleTitle(sheet.addRow(["Despesas detalhadas — julho e agosto de 2026"]));
  styleSubtitle(sheet.addRow(["Despesas fixas usam o mês de competência; despesas variáveis usam a data do lançamento."]));
  sheet.addRow([]);
  const header = sheet.addRow(["Data/mês", "Empresa", "Tipo", "Descrição", "Categoria", "Status", "Valor", "Mês", "Observação"]);
  styleHeader(header);
  for (const item of [...fixed, ...variable]) {
    const monthBasedRow = item.kind === "Fixa" || item.kind === "Comissão";
    const date = monthBasedRow ? new Date(`${item.month}T00:00:00Z`) : new Date(`${item.date}T00:00:00Z`);
    const row = sheet.addRow([date, companyLabel(item.business_unit), item.kind, item.description, item.category ?? "Sem categoria", item.status, number(item.amount), periodFor(monthBasedRow ? item.month : item.date)?.label ?? "", item.notes ?? ""]);
    row.getCell(1).numFmt = "dd/mm/yyyy";
    row.getCell(7).numFmt = CURRENCY_FORMAT;
  }
  sheet.autoFilter = { from: "A4", to: "I4" };
}

async function loadData(pool) {
  const [revenues, fixed, variable, commissions] = await Promise.all([
    pool.query(`
      SELECT rp.payment_date::date::text AS payment_date, COALESCE(r.business_unit, 'vozup') AS business_unit,
             'Receita avulsa' AS source, r.student, r.description, co.name AS course_name,
             rp.payment_method, rp.amount, rp.fee_amount, rp.net_amount, rp.installments
      FROM dashboard.finance_revenue_payments rp
      LEFT JOIN dashboard.finance_revenues r ON r.id = rp.revenue_id
      LEFT JOIN dashboard.finance_courses co ON co.id = r.course_id
      WHERE rp.payment_date >= DATE '2026-07-01' AND rp.payment_date < DATE '2026-09-01'
      UNION ALL
      SELECT ep.payment_date::date::text, COALESCE(e.business_unit, 'vozup'),
             'Matrícula', e.student, NULL, co.name,
             ep.payment_method, ep.amount, ep.fee_amount, ep.net_amount, ep.installments
      FROM dashboard.finance_enrollment_payments ep
      LEFT JOIN dashboard.finance_enrollments e ON e.id = ep.enrollment_id
      LEFT JOIN dashboard.finance_courses co ON co.id = e.course_id
      WHERE ep.payment_date >= DATE '2026-07-01' AND ep.payment_date < DATE '2026-09-01'
      ORDER BY 1`),
    pool.query(`
      SELECT month::date::text AS month, COALESCE(business_unit, 'vozup') AS business_unit,
             'Fixa' AS kind, description, c.name AS category, status,
             (amount + COALESCE(benefits_amount, 0))::numeric AS amount, notes
      FROM dashboard.finance_fixed_expenses f
      LEFT JOIN dashboard.finance_categories c ON c.id = f.category_id
      WHERE month >= DATE '2026-07-01' AND month < DATE '2026-09-01'
      ORDER BY 1, 4`),
    pool.query(`
      SELECT date::date::text AS date, COALESCE(business_unit, 'vozup') AS business_unit,
             'Variável' AS kind, description, c.name AS category, 'Lançada' AS status,
             amount::numeric, notes
      FROM dashboard.finance_variable_expenses v
      LEFT JOIN dashboard.finance_categories c ON c.id = v.category_id
      WHERE date >= DATE '2026-07-01' AND date < DATE '2026-09-01'
      ORDER BY 1, 4`),
    pool.query(`
      SELECT ci.month::date::text AS month, COALESCE(e.business_unit, 'vozup') AS business_unit,
             'Comissão' AS kind, CONCAT('Comissão — ', COALESCE(cm.student, 'Vendedor')) AS description,
             'Comissões' AS category, ci.status, ci.amount::numeric, NULL AS notes
      FROM dashboard.finance_commission_installments ci
      JOIN dashboard.finance_commissions cm ON cm.id = ci.commission_id
      LEFT JOIN dashboard.finance_enrollments e ON e.id = cm.enrollment_id
      WHERE ci.month >= DATE '2026-07-01' AND ci.month < DATE '2026-09-01'
      ORDER BY 1, 4`),
  ]);
  return { revenues: revenues.rows, fixed: fixed.rows, variable: variable.rows, commissions: commissions.rows };
}

function aggregate(data) {
  const methodOrder = ["PIX", "Crédito", "Débito", "Boleto", "Dinheiro", "Transferência", "Outros / não informado"];
  const methods = Object.fromEntries(methodOrder.map((method) => [method, Object.fromEntries(PERIODS.map((period) => [period.key, { entries: 0, gross: 0, fees: 0, net: 0 }]))]));
  const months = Object.fromEntries(PERIODS.map((period) => [period.key, { entries: 0, gross: 0, fees: 0, net: 0, variable: 0, fixedPaid: 0, fixedOpen: 0, commissionPaid: 0, commissionOpen: 0, cashExpenses: 0, result: 0, committedExpenses: 0 }]));
  const companies = Object.fromEntries(["Voz UP", "Instituto UP"].map((company) => [company, { months: Object.fromEntries(PERIODS.map((period) => [period.key, { net: 0, expenses: 0 }])), total: { net: 0, expenses: 0 } }]));

  for (const item of data.revenues) {
    const period = periodFor(item.payment_date); if (!period) continue;
    const method = methodLabel(item.payment_method); const target = methods[method][period.key];
    target.entries += 1; target.gross += number(item.amount); target.fees += number(item.fee_amount); target.net += number(item.net_amount);
    const month = months[period.key]; month.entries += 1; month.gross += number(item.amount); month.fees += number(item.fee_amount); month.net += number(item.net_amount);
    const company = companies[companyLabel(item.business_unit)]; company.months[period.key].net += number(item.net_amount); company.total.net += number(item.net_amount);
  }
  const expenseCategories = new Map();
  for (const item of [...data.fixed, ...data.variable, ...data.commissions]) {
    const period = periodFor(item.month ?? item.date); if (!period) continue;
    const amount = number(item.amount); const month = months[period.key];
    const key = `${item.kind}|${item.category ?? "Sem categoria"}|${item.status}`;
    if (!expenseCategories.has(key)) expenseCategories.set(key, { kind: item.kind, category: item.category ?? "Sem categoria", status: item.status, months: Object.fromEntries(PERIODS.map((p) => [p.key, { entries: 0, total: 0 }])) });
    const category = expenseCategories.get(key); category.months[period.key].entries += 1; category.months[period.key].total += amount;
    if (item.kind === "Fixa") {
      if (item.status === "pago") month.fixedPaid += amount; else month.fixedOpen += amount;
    } else if (item.kind === "Comissão") {
      if (item.status === "pago") month.commissionPaid += amount; else month.commissionOpen += amount;
    } else month.variable += amount;
    const company = companies[companyLabel(item.business_unit)];
    const countsAsCashExpense = item.kind === "Variável" || item.status === "pago";
    if (countsAsCashExpense) { company.months[period.key].expenses += amount; company.total.expenses += amount; }
  }
  for (const period of PERIODS) {
    const month = months[period.key]; month.cashExpenses = round2(month.variable + month.fixedPaid + month.commissionPaid); month.result = round2(month.net - month.cashExpenses); month.committedExpenses = round2(month.cashExpenses + month.fixedOpen + month.commissionOpen);
  }
  for (const method of methodOrder) for (const period of PERIODS) for (const field of ["gross", "fees", "net"]) methods[method][period.key][field] = round2(methods[method][period.key][field]);
  const total = { entries: 0, gross: 0, fees: 0, net: 0, committedExpenses: 0 };
  for (const period of PERIODS) { total.entries += months[period.key].entries; total.gross += months[period.key].gross; total.fees += months[period.key].fees; total.net += months[period.key].net; total.committedExpenses += months[period.key].committedExpenses; }
  for (const field of ["gross", "fees", "net", "committedExpenses"]) total[field] = round2(total[field]);
  for (const company of Object.values(companies)) for (const period of PERIODS) { company.months[period.key].net = round2(company.months[period.key].net); company.months[period.key].expenses = round2(company.months[period.key].expenses); }
  for (const company of Object.values(companies)) { company.total.net = round2(company.total.net); company.total.expenses = round2(company.total.expenses); }
  return { methodOrder, methods, months, total, companies, expenseCategories: [...expenseCategories.values()].sort((a, b) => `${a.kind}${a.category}${a.status}`.localeCompare(`${b.kind}${b.category}${b.status}`)), expenseCount: data.fixed.length + data.variable.length + data.commissions.length };
}

async function main() {
  const pool = new Pool({ connectionString: databaseUrl(), ssl: /sslmode=require/i.test(databaseUrl()) ? { rejectUnauthorized: false } : undefined });
  try {
    const data = await loadData(pool);
    const summary = aggregate(data);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Gestão Financeira";
    workbook.created = new Date();
    addSummarySheet(workbook, summary);
    addMethodsSheet(workbook, summary);
    addExpenseCategorySheet(workbook, summary);
    addRevenueDetailsSheet(workbook, data.revenues);
    addExpenseDetailsSheet(workbook, data.fixed, [...data.variable, ...data.commissions]);
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    await workbook.xlsx.writeFile(OUTPUT);
    console.log(JSON.stringify({ output: OUTPUT, revenueRows: data.revenues.length, fixedRows: data.fixed.length, variableRows: data.variable.length, totals: summary.total }));
  } finally { await pool.end(); }
}

main().catch((error) => { console.error(error); process.exit(1); });
