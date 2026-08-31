import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import {
  getProductionSummary,
  listProductionEntries,
  type ProductionEntry,
  type ProductionSummaryRow,
} from "@/lib/taskProduction";
import { buildFilters } from "../report/route";

export const dynamic = "force-dynamic";

/**
 * Exportação do relatório de produção, em Excel e PDF.
 *
 * Os MESMOS filtros do relatório na tela são aplicados aqui (`buildFilters` é
 * importado da rota do relatório, não reescrito): exportar tem que devolver
 * exatamente o que a pessoa está vendo, senão o arquivo vira outra verdade.
 */

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

function numero(value: number, unit: string): string {
  if (unit === "moeda") return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (unit === "duracao") return `${value.toLocaleString("pt-BR")} min`;
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function periodoLabel(from: string | null | undefined, to: string | null | undefined): string {
  if (from && to) return `${formatarData(from)} a ${formatarData(to)}`;
  if (from) return `a partir de ${formatarData(from)}`;
  if (to) return `até ${formatarData(to)}`;
  return "todo o período";
}

/** Linha por pessoa: soma de todos os indicadores que ela produziu. */
function porUsuario(summary: ProductionSummaryRow[]) {
  const mapa = new Map<string, { usuario: string; indicadores: number; total: number; dias: number }>();
  for (const row of summary) {
    const atual = mapa.get(row.memberName) ?? {
      usuario: row.memberName,
      indicadores: 0,
      total: 0,
      dias: 0,
    };
    atual.indicadores += 1;
    atual.total += row.total;
    atual.dias = Math.max(atual.dias, row.days);
    mapa.set(row.memberName, atual);
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total);
}

function planilha(summary: ProductionSummaryRow[], entries: ProductionEntry[], periodo: string) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Dashboard VozUP";
  workbook.created = new Date();

  const cabecalho = (sheet: ExcelJS.Worksheet, colunas: string[]) => {
    sheet.addRow(colunas);
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((column) => {
      column.width = 26;
    });
  };

  // Aba 1 — Resumo
  const resumo = workbook.addWorksheet("Resumo");
  resumo.addRow(["Relatório de produção — Kanban Comercial"]);
  resumo.getRow(1).font = { bold: true, size: 14 };
  resumo.addRow(["Período", periodo]);
  resumo.addRow(["Registros no período", entries.length]);
  resumo.addRow([]);
  resumo.addRow(["Usuário", "Tarefa", "Indicador", "Total", "Dias", "Média", "Maior", "Menor"]);
  resumo.getRow(5).font = { bold: true };
  for (const row of summary) {
    resumo.addRow([
      row.memberName,
      row.taskTitle,
      row.metricName,
      row.total,
      row.days,
      Number(row.average.toFixed(2)),
      row.max,
      row.min,
    ]);
  }
  resumo.columns.forEach((column) => {
    column.width = 24;
  });

  // Aba 2 — Registros detalhados
  const detalhe = workbook.addWorksheet("Registros");
  cabecalho(detalhe, ["Data", "Usuário", "Tarefa", "Indicador", "Valor", "Observação", "Registrado por"]);
  for (const entry of entries) {
    if (entry.values.length === 0) {
      detalhe.addRow([
        formatarData(entry.entryDate),
        entry.memberName ?? "—",
        entry.taskTitle,
        "—",
        "—",
        entry.note ?? "",
        entry.createdByName ?? "",
      ]);
      continue;
    }
    for (const value of entry.values) {
      detalhe.addRow([
        formatarData(entry.entryDate),
        entry.memberName ?? "—",
        entry.taskTitle,
        value.metricName,
        value.unit === "texto"
          ? value.text ?? ""
          : value.unit === "checagem"
            ? value.numeric
              ? "Sim"
              : "Não"
            : value.numeric ?? "",
        entry.note ?? "",
        entry.createdByName ?? "",
      ]);
    }
  }

  // Aba 3 — Por usuário
  const usuarios = workbook.addWorksheet("Por usuário");
  cabecalho(usuarios, ["Usuário", "Indicadores medidos", "Total somado", "Dias registrados"]);
  for (const row of porUsuario(summary)) {
    usuarios.addRow([row.usuario, row.indicadores, row.total, row.dias]);
  }

  // Aba 4 — Por tarefa
  const tarefas = workbook.addWorksheet("Por tarefa");
  cabecalho(tarefas, ["Tarefa", "Indicador", "Total", "Dias", "Média"]);
  for (const row of summary) {
    tarefas.addRow([row.taskTitle, row.metricName, row.total, row.days, Number(row.average.toFixed(2))]);
  }

  return workbook;
}

function pdf(summary: ProductionSummaryRow[], entries: ProductionEntry[], periodo: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text("Relatório de produção", { align: "left" });
    doc.fontSize(10).fillColor("#555").text("Kanban Comercial — VozUP");
    doc.moveDown(0.5);
    doc.fillColor("#000").fontSize(10).text(`Período: ${periodo}`);
    doc.text(`Registros: ${entries.length}`);
    doc.text(`Emitido em: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
    doc.moveDown();

    doc.fontSize(13).text("Resumo por indicador");
    doc.moveDown(0.3);
    doc.fontSize(9);
    for (const row of summary) {
      doc.text(
        `${row.memberName} · ${row.taskTitle} · ${row.metricName}: ` +
          `total ${numero(row.total, row.unit)} em ${row.days} dia(s) · ` +
          `média ${numero(row.average, row.unit)} · maior ${numero(row.max, row.unit)} · menor ${numero(row.min, row.unit)}`
      );
    }
    if (summary.length === 0) doc.text("Nenhum dado no período selecionado.");

    doc.moveDown();
    doc.fontSize(13).text("Totais por usuário");
    doc.moveDown(0.3);
    doc.fontSize(9);
    for (const row of porUsuario(summary)) {
      doc.text(`${row.usuario}: ${row.total.toLocaleString("pt-BR")} em ${row.dias} dia(s) registrados`);
    }

    doc.moveDown();
    doc.fontSize(13).text("Registros");
    doc.moveDown(0.3);
    doc.fontSize(8);
    // Limite explícito: um PDF com milhares de linhas não é um relatório
    // gerencial, é um despejo — o detalhe completo sai no Excel.
    for (const entry of entries.slice(0, 400)) {
      const valores = entry.values
        .map((value) =>
          value.unit === "texto"
            ? `${value.metricName}: ${value.text ?? "—"}`
            : value.unit === "checagem"
              ? `${value.metricName}: ${value.numeric ? "Sim" : "Não"}`
              : `${value.metricName}: ${numero(value.numeric ?? 0, value.unit)}`
        )
        .join(" · ");
      doc.text(
        `${formatarData(entry.entryDate)} — ${entry.memberName ?? "—"} — ${entry.taskTitle}` +
          (valores ? ` — ${valores}` : "") +
          (entry.note ? ` (${entry.note})` : "")
      );
    }
    if (entries.length > 400) {
      doc.moveDown(0.3);
      doc.fillColor("#777").text(`… e mais ${entries.length - 400} registro(s). Exporte em Excel para a lista completa.`);
    }

    doc.end();
  });
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  if (!hasPermission(session.user, "view.tasks")) {
    return NextResponse.json({ error: "Sem permissao para tarefas." }, { status: 403 });
  }

  const { filters } = await buildFilters(request, session.user);
  const formato = new URL(request.url).searchParams.get("format") === "pdf" ? "pdf" : "xlsx";
  const [summary, entries] = await Promise.all([
    getProductionSummary(filters),
    listProductionEntries(filters, { limit: 5000 }),
  ]);
  const periodo = periodoLabel(filters.from, filters.to);
  const nome = `producao-${new Date().toISOString().slice(0, 10)}`;

  if (formato === "pdf") {
    const buffer = await pdf(summary, entries, periodo);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${nome}.pdf"`,
      },
    });
  }

  const workbook = planilha(summary, entries, periodo);
  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nome}.xlsx"`,
    },
  });
}
