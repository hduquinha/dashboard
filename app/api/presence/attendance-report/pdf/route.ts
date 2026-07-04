import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { assertAuthenticatedRequest, UnauthorizedError } from "@/lib/auth";
import { formatTrainingTagLabel } from "@/lib/participantTags";
import {
  listPresenceRecords,
  type PendingPresenceRecord,
  type PresenceRecord,
} from "@/lib/presenceRecords";
import { humanizeName } from "@/lib/utils";

export const runtime = "nodejs";

const PAGE_MARGIN = 36;
const TEXT = "#172033";
const MUTED = "#64748b";
const BORDER = "#cbd5e1";
const SURFACE = "#f8fafc";
const TEAL = "#0f766e";
const TEAL_LIGHT = "#14b8a6";
const CYAN = "#0891b2";
const AMBER = "#f59e0b";
const AMBER_DARK = "#b45309";
const ROSE = "#e11d48";

interface IndicatorGroup {
  key: string;
  label: string;
  code: string | null;
  records: PresenceRecord[];
}

interface PdfCell {
  text: string;
  linkText?: string;
  linkUrl?: string;
}

interface PdfColumn {
  title: string;
  width: number;
  align?: "left" | "center" | "right";
}

function asLabel(value: string | null | undefined): string {
  return humanizeName(value) || value?.trim() || "-";
}

function formatMinutes(minutes: number | null | undefined): string {
  const safeMinutes = minutes ?? 0;
  if (safeMinutes < 60) {
    return `${safeMinutes}min`;
  }

  const hours = Math.floor(safeMinutes / 60);
  const rest = safeMinutes % 60;
  return rest > 0 ? `${hours}h ${rest}min` : `${hours}h`;
}

function percentage(value: number, total: number): number {
  if (total <= 0) {
    return 0;
  }

  return Math.round((value / total) * 100);
}

function whatsappUrl(phone: string | null | undefined): string | null {
  const digits = phone?.replace(/\D/g, "") ?? "";
  if (!digits) {
    return null;
  }

  const number = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${number}`;
}

function contactCell(phone: string | null | undefined): PdfCell {
  const linkUrl = whatsappUrl(phone);

  return {
    text: phone?.trim() || "-",
    linkText: linkUrl ? "WhatsApp" : undefined,
    linkUrl: linkUrl ?? undefined,
  };
}

function indicatorKey(record: PresenceRecord): string {
  const code = record.recrutadorCodigo?.trim();
  const name = record.recrutadorNome?.trim();

  if (code) {
    return `code:${code.toLowerCase()}`;
  }

  if (name) {
    return `name:${name.toLowerCase()}`;
  }

  return "none";
}

function indicatorLabel(record: PresenceRecord): string {
  const name = humanizeName(record.recrutadorNome);
  if (name) {
    return name;
  }

  return record.recrutadorCodigo?.trim() ? `Indicador ${record.recrutadorCodigo.trim()}` : "Sem indicador";
}

function buildIndicatorGroups(records: PresenceRecord[]): IndicatorGroup[] {
  const groups = new Map<string, IndicatorGroup>();

  records.forEach((record) => {
    const key = indicatorKey(record);
    const current = groups.get(key);
    if (current) {
      current.records.push(record);
      return;
    }

    groups.set(key, {
      key,
      label: indicatorLabel(record),
      code: record.recrutadorCodigo?.trim() || null,
      records: [record],
    });
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      records: group.records.sort((left, right) => left.nome.localeCompare(right.nome, "pt-BR")),
    }))
    .sort((left, right) => right.records.length - left.records.length || left.label.localeCompare(right.label, "pt-BR"));
}

function pdfBuffer(document: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    document.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    document.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    document.on("error", reject);
  });
}

function contentWidth(document: PDFKit.PDFDocument): number {
  return document.page.width - PAGE_MARGIN * 2;
}

function pageBottom(document: PDFKit.PDFDocument): number {
  return document.page.height - PAGE_MARGIN;
}

function ensureSpace(document: PDFKit.PDFDocument, height: number): void {
  if (document.y + height > pageBottom(document)) {
    document.addPage();
  }
}

function drawHero(document: PDFKit.PDFDocument, title: string, generatedAt: string): void {
  const x = PAGE_MARGIN;
  const y = document.y;
  const width = contentWidth(document);
  const height = 112;

  document.save().rect(x, y, width, height).fill("#0f172a").restore();
  document.save().rect(x, y, 8, height).fill(TEAL_LIGHT).restore();
  document
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text("Instituto UP", x + 24, y + 19);
  document
    .fillColor("#99f6e4")
    .font("Helvetica")
    .fontSize(8)
    .text("RELATORIO DO ENCONTRO", x + 24, y + 35);
  document
    .fillColor("#cbd5e1")
    .fontSize(8)
    .text(`Gerado em ${generatedAt}`, x + width - 168, y + 22, {
      width: 144,
      align: "right",
    });
  document
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(24)
    .text("Relatorio de presenca", x + 24, y + 57, { width: width - 48 });
  document
    .font("Helvetica")
    .fontSize(11)
    .fillColor("#e2e8f0")
    .text(title, x + 24, y + 90, { width: width - 48 });
  document.y = y + height + 14;
}

function drawMetric(
  document: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  label: string,
  value: number
): void {
  document.save().rect(x, y, width, 57).fillAndStroke("#ffffff", BORDER).restore();
  document
    .fillColor("#475569")
    .font("Helvetica-Bold")
    .fontSize(7)
    .text(label.toUpperCase(), x + 7, y + 9, { width: width - 14 });
  document
    .fillColor("#0f172a")
    .font("Helvetica-Bold")
    .fontSize(19)
    .text(String(value), x + 7, y + 25, { width: width - 14 });
}

function drawSummary(
  document: PDFKit.PDFDocument,
  metrics: Array<{ label: string; value: number }>
): void {
  ensureSpace(document, 65);
  const gap = 5;
  const width = (contentWidth(document) - gap * (metrics.length - 1)) / metrics.length;
  const y = document.y;

  metrics.forEach((metric, index) => {
    drawMetric(document, PAGE_MARGIN + index * (width + gap), y, width, metric.label, metric.value);
  });

  document.y = y + 70;
}

function drawPanel(
  document: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  eyebrow: string,
  title: string
): void {
  document.save().rect(x, y, width, height).fillAndStroke("#ffffff", BORDER).restore();
  document
    .fillColor(TEAL)
    .font("Helvetica-Bold")
    .fontSize(7)
    .text(eyebrow.toUpperCase(), x + 10, y + 10, { width: width - 20 });
  document
    .fillColor("#0f172a")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(title, x + 10, y + 22, { width: width - 20 });
}

function drawCharts(
  document: PDFKit.PDFDocument,
  groups: IndicatorGroup[],
  metrics: {
    associated: number;
    doubts: number;
    notFound: number;
    participantsTotal: number;
    approved: number;
    notApproved: number;
  }
): void {
  const gap = 9;
  const width = contentWidth(document);
  const leftWidth = width * 0.58;
  const rightWidth = width - leftWidth - gap;
  const panelHeight = 210;

  ensureSpace(document, panelHeight + 8);
  const y = document.y;
  drawPanel(document, PAGE_MARGIN, y, leftWidth, panelHeight, "Quem mais indicou", "Top 5 por presenca aprovada");
  drawPanel(document, PAGE_MARGIN + leftWidth + gap, y, rightWidth, panelHeight, "Distribuicao do encontro", "Associacao e aprovacao");

  const top = groups.slice(0, 5);
  if (top.length === 0) {
    document
      .fillColor(MUTED)
      .font("Helvetica-Oblique")
      .fontSize(8)
      .text("Sem presencas aprovadas para montar o ranking.", PAGE_MARGIN + 10, y + 53, {
        width: leftWidth - 20,
      });
  } else {
    const leaderTotal = top[0]?.records.length ?? 1;
    top.forEach((group, index) => {
      const rowY = y + 47 + index * 20;
      const numberX = PAGE_MARGIN + 10;
      const barX = PAGE_MARGIN + 34;
      const barWidth = leftWidth - 78;
      const barShare = Math.max(percentage(group.records.length, leaderTotal), 8);

      document.save().roundedRect(numberX, rowY, 15, 15, 2).fill(TEAL).restore();
      document
        .fillColor("#ffffff")
        .font("Helvetica-Bold")
        .fontSize(7)
        .text(String(index + 1), numberX, rowY + 4, { align: "center", width: 15 });
      document
        .fillColor(TEXT)
        .font("Helvetica-Bold")
        .fontSize(7.5)
        .text(`${group.label}${group.code ? ` #${group.code}` : ""}`, barX, rowY, {
          height: 10,
          width: barWidth,
          ellipsis: true,
        });
      document.save().rect(barX, rowY + 11, barWidth, 5).fill("#e2e8f0").restore();
      document.save().rect(barX, rowY + 11, (barWidth * barShare) / 100, 5).fill(CYAN).restore();
      document
        .fillColor("#0f172a")
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(String(group.records.length), PAGE_MARGIN + leftWidth - 31, rowY + 4, {
          align: "right",
          width: 20,
        });
    });
  }

  const rightX = PAGE_MARGIN + leftWidth + gap + 10;
  const rightInnerWidth = rightWidth - 20;

  // ── Associação ──
  document
    .fillColor(TEAL)
    .font("Helvetica-Bold")
    .fontSize(6.5)
    .text("ASSOCIACAO", rightX, y + 40);

  const railY = y + 52;
  const associatedShare = percentage(metrics.associated, metrics.participantsTotal);
  const doubtShare = percentage(metrics.doubts, metrics.participantsTotal);
  const notFoundShare =
    metrics.participantsTotal > 0 ? Math.max(100 - associatedShare - doubtShare, 0) : 0;

  document.save().rect(rightX, railY, rightInnerWidth, 12).fill("#e2e8f0").restore();
  document.save().rect(rightX, railY, (rightInnerWidth * associatedShare) / 100, 12).fill(TEAL_LIGHT).restore();
  document
    .save()
    .rect(rightX + (rightInnerWidth * associatedShare) / 100, railY, (rightInnerWidth * doubtShare) / 100, 12)
    .fill(AMBER)
    .restore();
  document
    .save()
    .rect(
      rightX + (rightInnerWidth * (associatedShare + doubtShare)) / 100,
      railY,
      (rightInnerWidth * notFoundShare) / 100,
      12
    )
    .fill(ROSE)
    .restore();

  [
    { label: "Com inscricao", value: metrics.associated, color: TEAL_LIGHT },
    { label: "Em duvida", value: metrics.doubts, color: AMBER },
    { label: "Nao encontradas", value: metrics.notFound, color: ROSE },
  ].forEach((item, index) => {
    const legendY = y + 72 + index * 13;
    document.save().rect(rightX, legendY + 2, 7, 7).fill(item.color).restore();
    document
      .fillColor(TEXT)
      .font("Helvetica")
      .fontSize(7.5)
      .text(item.label, rightX + 12, legendY, { width: rightInnerWidth - 42 });
    document
      .font("Helvetica-Bold")
      .text(String(item.value), rightX + rightInnerWidth - 25, legendY, {
        align: "right",
        width: 25,
      });
  });

  // ── Divisor ──
  const dividerY = y + 115;
  document
    .save()
    .moveTo(rightX, dividerY)
    .lineTo(rightX + rightInnerWidth, dividerY)
    .strokeColor(BORDER)
    .lineWidth(0.5)
    .stroke()
    .restore();

  // ── Aprovação ──
  document
    .fillColor(TEAL)
    .font("Helvetica-Bold")
    .fontSize(6.5)
    .text("APROVACAO", rightX, dividerY + 6);

  const approvalTotal = metrics.approved + metrics.notApproved;
  const approvedShare = percentage(metrics.approved, approvalTotal);
  const notApprovedShare = approvalTotal > 0 ? Math.max(100 - approvedShare, 0) : 0;

  const approvalRailY = dividerY + 18;
  document.save().rect(rightX, approvalRailY, rightInnerWidth, 12).fill("#e2e8f0").restore();
  document
    .save()
    .rect(rightX, approvalRailY, (rightInnerWidth * approvedShare) / 100, 12)
    .fill(TEAL_LIGHT)
    .restore();
  document
    .save()
    .rect(
      rightX + (rightInnerWidth * approvedShare) / 100,
      approvalRailY,
      (rightInnerWidth * notApprovedShare) / 100,
      12
    )
    .fill(AMBER)
    .restore();

  [
    { label: "Presenca aprovada", value: metrics.approved, color: TEAL_LIGHT },
    { label: "Presenca nao aprovada", value: metrics.notApproved, color: AMBER },
  ].forEach((item, index) => {
    const legendY = dividerY + 38 + index * 13;
    document.save().rect(rightX, legendY + 2, 7, 7).fill(item.color).restore();
    document
      .fillColor(TEXT)
      .font("Helvetica")
      .fontSize(7.5)
      .text(item.label, rightX + 12, legendY, { width: rightInnerWidth - 42 });
    document
      .font("Helvetica-Bold")
      .text(String(item.value), rightX + rightInnerWidth - 25, legendY, {
        align: "right",
        width: 25,
      });
  });

  document.y = y + panelHeight + 15;
}

function drawSectionHeading(document: PDFKit.PDFDocument, title: string): void {
  ensureSpace(document, 34);
  document
    .fillColor("#0f172a")
    .font("Helvetica-Bold")
    .fontSize(13)
    .text(title, PAGE_MARGIN, document.y, { width: contentWidth(document) });
  document
    .save()
    .moveTo(PAGE_MARGIN, document.y + 4)
    .lineTo(PAGE_MARGIN + contentWidth(document), document.y + 4)
    .strokeColor(BORDER)
    .lineWidth(0.7)
    .stroke()
    .restore();
  document.moveDown(0.7);
}

function drawIndicatorHeading(document: PDFKit.PDFDocument, group: IndicatorGroup): void {
  ensureSpace(document, 34);
  const y = document.y;
  const count = `${group.records.length} aprovado${group.records.length === 1 ? "" : "s"}`;

  document.save().rect(PAGE_MARGIN, y, 4, 25).fill(TEAL).restore();
  document
    .fillColor(TEAL)
    .font("Helvetica-Bold")
    .fontSize(6.5)
    .text("INDICADOR", PAGE_MARGIN + 10, y + 1);
  document
    .fillColor("#0f172a")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(`${group.label}${group.code ? ` #${group.code}` : ""}`, PAGE_MARGIN + 10, y + 10, {
      width: contentWidth(document) - 118,
    });
  document
    .fillColor(TEAL)
    .fontSize(9)
    .text(count, PAGE_MARGIN + contentWidth(document) - 102, y + 10, {
      align: "right",
      width: 102,
    });
  document.y = y + 31;
}

function cellHeight(document: PDFKit.PDFDocument, cell: PdfCell, width: number): number {
  const contentHeight = document.heightOfString(cell.text, { width: width - 8 });
  const linkHeight = cell.linkText ? document.heightOfString(cell.linkText, { width: width - 8 }) + 2 : 0;

  return contentHeight + linkHeight + 8;
}

function rowHeight(document: PDFKit.PDFDocument, cells: PdfCell[], columns: PdfColumn[]): number {
  document.font("Helvetica").fontSize(7.4);
  return Math.max(21, ...cells.map((cell, index) => cellHeight(document, cell, columns[index].width)));
}

function drawTableHeader(document: PDFKit.PDFDocument, columns: PdfColumn[]): void {
  const y = document.y;
  let x = PAGE_MARGIN;

  columns.forEach((column) => {
    document.save().rect(x, y, column.width, 17).fillAndStroke("#f1f5f9", BORDER).restore();
    document
      .fillColor("#475569")
      .font("Helvetica-Bold")
      .fontSize(6.2)
      .text(column.title.toUpperCase(), x + 4, y + 6, {
        align: column.align ?? "left",
        width: column.width - 8,
      });
    x += column.width;
  });

  document.y = y + 17;
}

function drawTableRow(
  document: PDFKit.PDFDocument,
  cells: PdfCell[],
  columns: PdfColumn[],
  rowIndex: number
): void {
  const height = rowHeight(document, cells, columns);
  if (document.y + height > pageBottom(document)) {
    document.addPage();
    drawTableHeader(document, columns);
  }

  const y = document.y;
  let x = PAGE_MARGIN;

  columns.forEach((column, index) => {
    const cell = cells[index];
    const fill = rowIndex % 2 === 0 ? "#ffffff" : SURFACE;
    document.save().rect(x, y, column.width, height).fillAndStroke(fill, BORDER).restore();
    document
      .fillColor(TEXT)
      .font("Helvetica")
      .fontSize(7.4)
      .text(cell.text, x + 4, y + 4, {
        align: column.align ?? "left",
        width: column.width - 8,
      });

    if (cell.linkText && cell.linkUrl) {
      const linkY = y + 4 + document.heightOfString(cell.text, { width: column.width - 8 }) + 1;
      document
        .fillColor(TEAL)
        .font("Helvetica-Bold")
        .fontSize(6.7)
        .text(cell.linkText, x + 4, linkY, {
          link: cell.linkUrl,
          underline: true,
          width: column.width - 8,
        });
    }

    x += column.width;
  });

  document.y = y + height;
}

function drawTable(document: PDFKit.PDFDocument, columns: PdfColumn[], rows: PdfCell[][]): void {
  ensureSpace(document, 40);
  drawTableHeader(document, columns);
  rows.forEach((row, index) => {
    drawTableRow(document, row, columns, index);
  });
  document.moveDown(1);
}

function proportionalColumns(document: PDFKit.PDFDocument, columns: Array<Omit<PdfColumn, "width"> & { share: number }>): PdfColumn[] {
  const width = contentWidth(document);
  return columns.map((column) => ({
    title: column.title,
    align: column.align,
    width: width * column.share,
  }));
}

function drawApprovalComparisonChart(
  document: PDFKit.PDFDocument,
  approvedGroups: IndicatorGroup[],
  notApprovedGroups: IndicatorGroup[]
): void {
  const allMap = new Map<string, { label: string; code: string | null; approved: number; notApproved: number }>();

  for (const g of approvedGroups) {
    allMap.set(g.key, { label: g.label, code: g.code, approved: g.records.length, notApproved: 0 });
  }
  for (const g of notApprovedGroups) {
    const existing = allMap.get(g.key);
    if (existing) {
      existing.notApproved = g.records.length;
    } else {
      allMap.set(g.key, { label: g.label, code: g.code, approved: 0, notApproved: g.records.length });
    }
  }

  const sorted = Array.from(allMap.values())
    .sort((a, b) => b.approved + b.notApproved - (a.approved + a.notApproved))
    .slice(0, 8);

  if (sorted.length === 0) return;

  const maxTotal = Math.max(...sorted.map((i) => i.approved + i.notApproved));
  const panelHeight = 36 + sorted.length * 20 + 14;

  ensureSpace(document, panelHeight + 10);
  const y = document.y;
  const width = contentWidth(document);

  drawPanel(document, PAGE_MARGIN, y, width, panelHeight, "Comparativo por indicador", "Aprovadas vs. Nao aprovadas");

  // legend header
  document.save().rect(PAGE_MARGIN + width - 80, y + 30, 8, 8).fill(TEAL_LIGHT).restore();
  document.fillColor(TEXT).font("Helvetica").fontSize(7).text("Aprovada", PAGE_MARGIN + width - 68, y + 31, { width: 32 });
  document.save().rect(PAGE_MARGIN + width - 30, y + 30, 8, 8).fill(AMBER).restore();
  document.fillColor(TEXT).font("Helvetica").fontSize(7).text("Nao aprov.", PAGE_MARGIN + width - 18, y + 31, { width: 40 });

  const labelWidth = 155;
  const countWidth = 40;
  const barX = PAGE_MARGIN + 10 + labelWidth + 6;
  const barWidth = width - 20 - labelWidth - 6 - countWidth;

  sorted.forEach((indicator, index) => {
    const rowY = y + 44 + index * 20;
    const approvedWidth = maxTotal > 0 ? (barWidth * indicator.approved) / maxTotal : 0;
    const notApprovedWidth = maxTotal > 0 ? (barWidth * indicator.notApproved) / maxTotal : 0;

    document
      .fillColor(TEXT)
      .font("Helvetica")
      .fontSize(7)
      .text(
        `${indicator.label}${indicator.code ? ` #${indicator.code}` : ""}`,
        PAGE_MARGIN + 10,
        rowY + 3,
        { width: labelWidth, ellipsis: true }
      );

    document.save().rect(barX, rowY + 4, barWidth, 10).fill("#e2e8f0").restore();
    if (approvedWidth > 0) {
      document.save().rect(barX, rowY + 4, approvedWidth, 10).fill(TEAL_LIGHT).restore();
    }
    if (notApprovedWidth > 0) {
      document.save().rect(barX + approvedWidth, rowY + 4, notApprovedWidth, 10).fill(AMBER).restore();
    }

    document
      .fillColor(TEAL)
      .font("Helvetica-Bold")
      .fontSize(7)
      .text(`${indicator.approved}✓`, barX + barWidth + 4, rowY + 3, { width: 18 });
    document
      .fillColor(AMBER_DARK)
      .font("Helvetica-Bold")
      .fontSize(7)
      .text(`${indicator.notApproved}✗`, barX + barWidth + 24, rowY + 3, { width: 18 });
  });

  document.y = y + panelHeight + 12;
}

function drawNotApprovedIndicatorHeading(document: PDFKit.PDFDocument, group: IndicatorGroup): void {
  ensureSpace(document, 34);
  const y = document.y;
  const count = `${group.records.length} nao aprovado${group.records.length === 1 ? "" : "s"}`;

  document.save().rect(PAGE_MARGIN, y, 4, 25).fill(AMBER).restore();
  document
    .fillColor(AMBER_DARK)
    .font("Helvetica-Bold")
    .fontSize(6.5)
    .text("INDICADOR", PAGE_MARGIN + 10, y + 1);
  document
    .fillColor("#0f172a")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(`${group.label}${group.code ? ` #${group.code}` : ""}`, PAGE_MARGIN + 10, y + 10, {
      width: contentWidth(document) - 118,
    });
  document
    .fillColor(AMBER_DARK)
    .fontSize(9)
    .text(count, PAGE_MARGIN + contentWidth(document) - 102, y + 10, {
      align: "right",
      width: 102,
    });
  document.y = y + 31;
}

function drawNotApprovedGroups(document: PDFKit.PDFDocument, groups: IndicatorGroup[]): void {
  drawSectionHeading(document, "2. Presencas nao aprovadas por indicador");

  if (groups.length === 0) {
    document.fillColor(MUTED).font("Helvetica-Oblique").fontSize(9).text("Nenhuma presenca nao aprovada registrada.");
    document.moveDown();
    return;
  }

  const columns = proportionalColumns(document, [
    { title: "#", share: 0.05, align: "center" },
    { title: "Inscrito", share: 0.26 },
    { title: "Contato", share: 0.20 },
    { title: "Nome no Zoom", share: 0.30 },
    { title: "Tempo", share: 0.11, align: "center" },
    { title: "% Dinamica", share: 0.08, align: "center" },
  ]);

  groups.forEach((group) => {
    drawNotApprovedIndicatorHeading(document, group);
    drawTable(
      document,
      columns,
      group.records.map((record, index) => [
        { text: String(index + 1) },
        { text: asLabel(record.nome) },
        contactCell(record.telefone),
        { text: asLabel(record.participanteNomeZoom) },
        { text: formatMinutes(record.tempoTotalMinutos) },
        { text: record.percentualDinamica ? `${record.percentualDinamica}%` : "-" },
      ])
    );
  });
}

function drawApprovedGroups(document: PDFKit.PDFDocument, groups: IndicatorGroup[]): void {
  drawSectionHeading(document, "1. Presencas aprovadas por indicador");

  if (groups.length === 0) {
    document.fillColor(MUTED).font("Helvetica-Oblique").fontSize(9).text("Nenhuma presenca aprovada associada.");
    document.moveDown();
    return;
  }

  const columns = proportionalColumns(document, [
    { title: "#", share: 0.05, align: "center" },
    { title: "Inscrito", share: 0.29 },
    { title: "Contato", share: 0.21 },
    { title: "Nome no Zoom", share: 0.34 },
    { title: "Tempo", share: 0.11, align: "center" },
  ]);

  groups.forEach((group) => {
    drawIndicatorHeading(document, group);
    drawTable(
      document,
      columns,
      group.records.map((record, index) => [
        { text: String(index + 1) },
        { text: asLabel(record.nome) },
        contactCell(record.telefone),
        { text: asLabel(record.participanteNomeZoom) },
        { text: formatMinutes(record.tempoTotalMinutos) },
      ])
    );
  });
}

function pendingCandidates(pending: PendingPresenceRecord): PdfCell[][] {
  const candidates = [
    {
      id: pending.inscricaoId1,
      name: pending.inscricaoNome1,
      phone: pending.inscricaoTelefone1,
    },
    {
      id: pending.inscricaoId2,
      name: pending.inscricaoNome2,
      phone: pending.inscricaoTelefone2,
    },
  ].filter((candidate) => candidate.id || candidate.name || candidate.phone);
  const visibleCandidates =
    candidates.length > 0 ? candidates : [{ id: null, name: "Sem candidata sugerida", phone: null }];

  return visibleCandidates.map((candidate, index) => [
    { text: asLabel(pending.participanteNome) },
    {
      text: `${formatMinutes(pending.tempoTotalMinutos)}\n${pending.aprovado ? "Aprovada" : "Insuficiente"}`,
    },
    {
      text: `Candidata ${index + 1}: ${asLabel(candidate.name)}${candidate.id ? ` #${candidate.id}` : ""}`,
    },
    contactCell(candidate.phone),
  ]);
}

function drawDoubts(document: PDFKit.PDFDocument, records: PendingPresenceRecord[]): void {
  drawSectionHeading(document, "3. Em duvida");

  const columns = proportionalColumns(document, [
    { title: "Nome no Zoom", share: 0.27 },
    { title: "Presenca", share: 0.16 },
    { title: "Possivel inscricao", share: 0.36 },
    { title: "Contato", share: 0.21 },
  ]);
  const rows =
    records.length > 0
      ? records.flatMap(pendingCandidates)
      : [[{ text: "Nenhuma presenca em duvida." }, { text: "" }, { text: "" }, { text: "" }]];

  drawTable(document, columns, rows);
}

function drawNotFound(document: PDFKit.PDFDocument, records: PendingPresenceRecord[]): void {
  drawSectionHeading(document, "4. Nao encontradas");

  const columns = proportionalColumns(document, [
    { title: "#", share: 0.06, align: "center" },
    { title: "Nome no Zoom", share: 0.58 },
    { title: "Tempo", share: 0.18, align: "center" },
    { title: "Presenca", share: 0.18, align: "center" },
  ]);
  const rows =
    records.length > 0
      ? records.map((record, index) => [
          { text: String(index + 1) },
          { text: asLabel(record.participanteNome) },
          { text: formatMinutes(record.tempoTotalMinutos) },
          { text: record.aprovado ? "Aprovada" : "Insuficiente" },
        ])
      : [[{ text: "-" }, { text: "Nenhum participante sem inscricao encontrada." }, { text: "" }, { text: "" }]];

  drawTable(document, columns, rows);
}

function drawFooters(document: PDFKit.PDFDocument): void {
  const pages = document.bufferedPageRange();
  for (let index = pages.start; index < pages.start + pages.count; index += 1) {
    document.switchToPage(index);
    document
      .fillColor(MUTED)
      .font("Helvetica")
      .fontSize(6.5)
      .text(`Relatorio de presenca | Pagina ${index + 1} de ${pages.count}`, PAGE_MARGIN, pageBottom(document) - 10, {
        align: "right",
        width: contentWidth(document),
      });
  }
}

function fileName(treinamentoId: string): string {
  const safeTraining = treinamentoId
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `relatorio-presenca-${safeTraining || "treinamento"}.pdf`;
}

export async function GET(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request, {
      requireSameOriginForSession: false,
    });

    const treinamentoId = request.nextUrl.searchParams.get("treinamento")?.trim();
    if (!treinamentoId) {
      return NextResponse.json({ error: "Treinamento nao informado." }, { status: 400 });
    }

    const data = await listPresenceRecords({ treinamentoId, apenasAprovados: false });
    const approved = data.presences
      .filter((record) => record.aprovado)
      .sort((left, right) => left.nome.localeCompare(right.nome, "pt-BR"));
    const notApproved = data.presences
      .filter((record) => !record.aprovado)
      .sort((left, right) => left.nome.localeCompare(right.nome, "pt-BR"));
    const indicatorGroups = buildIndicatorGroups(approved);
    const notApprovedIndicatorGroups = buildIndicatorGroups(notApproved);
    const doubts = data.pending.filter((record) => record.status === "doubt");
    const notFound = data.pending.filter((record) => record.status === "not-found");
    const participantsTotal = data.total + data.pending.length;
    const approvedPresenceTotal = approved.length + data.pending.filter((record) => record.aprovado).length;
    const generatedAt = new Date().toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const title = formatTrainingTagLabel(treinamentoId);
    const document = new PDFDocument({
      bufferPages: true,
      margin: PAGE_MARGIN,
      size: "A4",
      info: {
        Title: `Relatorio de presenca - ${title}`,
        Author: "Instituto UP",
      },
    });
    const pendingBuffer = pdfBuffer(document);

    drawHero(document, title, generatedAt);
    drawSummary(document, [
      { label: "Total no Zoom", value: participantsTotal },
      { label: "Presenca OK", value: approvedPresenceTotal },
      { label: "Nao aprovadas", value: notApproved.length },
      { label: "Em duvida", value: doubts.length },
      { label: "Nao encontradas", value: notFound.length },
    ]);
    drawCharts(document, indicatorGroups, {
      associated: data.total,
      doubts: doubts.length,
      notFound: notFound.length,
      participantsTotal,
      approved: approved.length,
      notApproved: notApproved.length,
    });
    drawApprovalComparisonChart(document, indicatorGroups, notApprovedIndicatorGroups);
    drawApprovedGroups(document, indicatorGroups);
    drawNotApprovedGroups(document, notApprovedIndicatorGroups);
    drawDoubts(document, doubts);
    drawNotFound(document, notFound);
    drawFooters(document);
    document.end();

    const pdf = await pendingBuffer;
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${fileName(treinamentoId)}"`,
        "Content-Type": "application/pdf",
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("Presence attendance PDF error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
