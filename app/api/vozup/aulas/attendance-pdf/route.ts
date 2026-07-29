import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { assertAuthenticatedRequest, UnauthorizedError } from "@/lib/auth";
import { getVozupFolder, listAllVozupLeadsByBlock } from "@/lib/vozupFolders";
import { humanizeName } from "@/lib/utils";

export const runtime = "nodejs";

const PAGE_MARGIN = 36;
const TEXT = "#172033";
const MUTED = "#64748b";
const BORDER = "#cbd5e1";
const SURFACE = "#f8fafc";
const TEAL_LIGHT = "#14b8a6";
const PRESENT = "#047857";
const ABSENT = "#be123c";

/**
 * `assinatura` = lista em branco para assinar no dia da aula (padrão).
 * `presencas` = mesma lista já preenchida com o que foi marcado no CRM.
 */
type ListMode = "assinatura" | "presencas";

function contentWidth(document: PDFKit.PDFDocument): number {
  return document.page.width - PAGE_MARGIN * 2;
}

function pageBottom(document: PDFKit.PDFDocument): number {
  return document.page.height - PAGE_MARGIN;
}

function pdfBuffer(document: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
}

function drawHero(
  document: PDFKit.PDFDocument,
  title: string,
  total: number,
  generatedAt: string,
  mode: ListMode
): void {
  const x = PAGE_MARGIN;
  const y = document.y;
  const width = contentWidth(document);
  const height = 90;

  document.save().rect(x, y, width, height).fill("#0f172a").restore();
  document.save().rect(x, y, 8, height).fill(TEAL_LIGHT).restore();
  document
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text("Voz UP", x + 24, y + 18);
  document
    .fillColor("#99f6e4")
    .font("Helvetica")
    .fontSize(8)
    .text(
      mode === "presencas" ? "LISTA DE PRESENCA - PRESENCAS MARCADAS" : "LISTA DE PRESENCA",
      x + 24,
      y + 34
    );
  document
    .fillColor("#cbd5e1")
    .fontSize(8)
    .text(`Gerado em ${generatedAt}`, x + width - 168, y + 20, { width: 144, align: "right" });
  document
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(20)
    .text(title, x + 24, y + 52, { width: width - 190 });
  document
    .fillColor("#cbd5e1")
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(`${total} inscrito${total === 1 ? "" : "s"}`, x + width - 168, y + 55, { width: 144, align: "right" });

  document.y = y + height + 16;
}

/** Faixa de totais (presentes / ausentes / sem marcacao) do modo `presencas`. */
function drawSummary(
  document: PDFKit.PDFDocument,
  counts: { presentes: number; ausentes: number; semMarcacao: number }
): void {
  const cards: Array<{ label: string; value: number; color: string }> = [
    { label: "PRESENTES", value: counts.presentes, color: PRESENT },
    { label: "AUSENTES", value: counts.ausentes, color: ABSENT },
    { label: "SEM MARCACAO", value: counts.semMarcacao, color: MUTED },
  ];

  const gap = 10;
  const width = (contentWidth(document) - gap * (cards.length - 1)) / cards.length;
  const height = 42;
  const y = document.y;
  let x = PAGE_MARGIN;

  cards.forEach((card) => {
    document.save().roundedRect(x, y, width, height, 5).fillAndStroke(SURFACE, BORDER).restore();
    document.save().rect(x, y, 4, height).fill(card.color).restore();
    document
      .fillColor(MUTED)
      .font("Helvetica-Bold")
      .fontSize(7)
      .text(card.label, x + 14, y + 10, { width: width - 20 });
    document
      .fillColor(card.color)
      .font("Helvetica-Bold")
      .fontSize(15)
      .text(String(card.value), x + 14, y + 20, { width: width - 20 });
    x += width + gap;
  });

  document.y = y + height + 14;
}

function drawTableHeader(document: PDFKit.PDFDocument, columns: Array<{ title: string; width: number; align?: "left" | "center" }>): void {
  const y = document.y;
  let x = PAGE_MARGIN;

  columns.forEach((column) => {
    document.save().rect(x, y, column.width, 20).fillAndStroke("#f1f5f9", BORDER).restore();
    document
      .fillColor("#475569")
      .font("Helvetica-Bold")
      .fontSize(7.5)
      .text(column.title.toUpperCase(), x + 6, y + 7, { align: column.align ?? "left", width: column.width - 12 });
    x += column.width;
  });

  document.y = y + 20;
}

function fileName(title: string, mode: ListMode): string {
  const safe = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const suffix = mode === "presencas" ? "-com-presencas" : "";
  return `lista-presenca-${safe || "aula"}${suffix}.pdf`;
}

export async function GET(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request, { requireSameOriginForSession: false });

    const pastaKey = request.nextUrl.searchParams.get("pasta")?.trim();
    const bloco = request.nextUrl.searchParams.get("bloco")?.trim();
    if (!pastaKey || !bloco) {
      return NextResponse.json({ error: "Pasta ou bloco nao informado." }, { status: 400 });
    }

    const folder = getVozupFolder(pastaKey);
    if (!folder) {
      return NextResponse.json({ error: "Pasta invalida." }, { status: 400 });
    }

    const mode: ListMode =
      request.nextUrl.searchParams.get("modo")?.trim() === "presencas" ? "presencas" : "assinatura";

    const leads = await listAllVozupLeadsByBlock(pastaKey, bloco);
    const generatedAt = new Date().toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const document = new PDFDocument({
      bufferPages: true,
      margin: PAGE_MARGIN,
      size: "A4",
      info: {
        Title:
          mode === "presencas"
            ? `Lista de presenca (presencas marcadas) - ${bloco}`
            : `Lista de presenca - ${bloco}`,
        Author: "Voz UP",
      },
    });
    const pendingBuffer = pdfBuffer(document);

    drawHero(document, bloco, leads.length, generatedAt, mode);

    if (mode === "presencas") {
      drawSummary(document, {
        presentes: leads.filter((lead) => lead.aulaPresenca === "presente").length,
        ausentes: leads.filter((lead) => lead.aulaPresenca === "ausente").length,
        semMarcacao: leads.filter((lead) => lead.aulaPresenca === null).length,
      });
    }

    const width = contentWidth(document);
    const columns = [
      { title: "#", width: width * 0.06, align: "center" as const },
      { title: "Nome do inscrito", width: width * 0.42 },
      { title: "Telefone", width: width * 0.22 },
      mode === "presencas"
        ? { title: "Presenca", width: width * 0.3, align: "center" as const }
        : { title: "Assinatura", width: width * 0.3 },
    ];

    if (leads.length === 0) {
      drawTableHeader(document, columns);
      document
        .fillColor(MUTED)
        .font("Helvetica-Oblique")
        .fontSize(9)
        .text("Nenhum inscrito nesta aula.", PAGE_MARGIN, document.y + 8);
    } else {
      drawTableHeader(document, columns);
      const rowHeight = 26;
      leads.forEach((lead, index) => {
        if (document.y + rowHeight > pageBottom(document)) {
          document.addPage();
          drawTableHeader(document, columns);
        }

        const y = document.y;
        let x = PAGE_MARGIN;
        const fill = index % 2 === 0 ? "#ffffff" : SURFACE;

        columns.forEach((column) => {
          document.save().rect(x, y, column.width, rowHeight).fillAndStroke(fill, BORDER).restore();
          x += column.width;
        });

        x = PAGE_MARGIN;
        document
          .fillColor(TEXT)
          .font("Helvetica")
          .fontSize(8.5)
          .text(String(index + 1), x + 6, y + 9, { width: columns[0].width - 12, align: "center" });
        x += columns[0].width;
        document.text(humanizeName(lead.nome) || lead.nome || "Sem nome", x + 6, y + 9, { width: columns[1].width - 12 });
        x += columns[1].width;
        document.text(lead.telefone || "-", x + 6, y + 9, { width: columns[2].width - 12 });
        x += columns[2].width;

        if (mode === "presencas") {
          const status =
            lead.aulaPresenca === "presente"
              ? { label: "PRESENTE", color: PRESENT, background: "#ecfdf5" }
              : lead.aulaPresenca === "ausente"
              ? { label: "AUSENTE", color: ABSENT, background: "#fff1f2" }
              : { label: "NAO MARCADO", color: MUTED, background: "#f1f5f9" };

          const pillWidth = 96;
          const pillHeight = 16;
          const pillX = x + (columns[3].width - pillWidth) / 2;
          const pillY = y + (rowHeight - pillHeight) / 2;

          document
            .save()
            .roundedRect(pillX, pillY, pillWidth, pillHeight, 8)
            .fillAndStroke(status.background, status.color)
            .restore();
          document
            .fillColor(status.color)
            .font("Helvetica-Bold")
            .fontSize(7.5)
            .text(status.label, pillX, pillY + 5, { width: pillWidth, align: "center" });
        }

        document.y = y + rowHeight;
      });
    }

    const pages = document.bufferedPageRange();
    for (let index = pages.start; index < pages.start + pages.count; index += 1) {
      document.switchToPage(index);
      document
        .fillColor(MUTED)
        .font("Helvetica")
        .fontSize(6.5)
        .text(`Lista de presenca${mode === "presencas" ? " (presencas marcadas)" : ""} | Pagina ${index + 1} de ${pages.count}`, PAGE_MARGIN, pageBottom(document) - 10, {
          align: "right",
          width: contentWidth(document),
        });
    }

    document.end();

    const pdf = await pendingBuffer;
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${fileName(bloco, mode)}"`,
        "Content-Type": "application/pdf",
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("VozUP attendance PDF error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
