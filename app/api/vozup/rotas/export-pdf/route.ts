import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { assertAuthenticatedRequest, UnauthorizedError } from "@/lib/auth";
import { VOZUP_ROUTES, type VozupRouteRow } from "@/lib/vozupRoutesMap";

export const runtime = "nodejs";

const PAGE_MARGIN = 30;
const TEXT = "#172033";
const MUTED = "#64748b";
const BORDER = "#cbd5e1";
const SURFACE = "#f8fafc";
const LINK = "#0f6fb8";
const ACCENT = "#00838F";
const VOZUP_DOMAIN = "https://www.escolavozup.com";

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

function drawHero(document: PDFKit.PDFDocument, total: number, generatedAt: string): void {
  const x = PAGE_MARGIN;
  const y = document.y;
  const width = contentWidth(document);
  const height = 74;

  document.save().rect(x, y, width, height).fill("#0f172a").restore();
  document.save().rect(x, y, 8, height).fill("#00AFC1").restore();
  document
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text("Voz UP", x + 22, y + 14);
  document
    .fillColor("#99e5ea")
    .font("Helvetica")
    .fontSize(8)
    .text("MAPA DE ROTAS DE CAPTACAO", x + 22, y + 30);
  document
    .fillColor("#cbd5e1")
    .fontSize(8)
    .text(`Gerado em ${generatedAt}`, x + width - 168, y + 16, { width: 144, align: "right" });
  document
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(`${total} rotas`, x + width - 168, y + 40, { width: 144, align: "right" });

  document.y = y + height + 14;
}

interface Column {
  title: string;
  width: number;
  key: keyof VozupRouteRow;
}

const ROUTE_COLUMNS: Column[] = [
  { title: "Rota", width: 0.4, key: "rota" },
  { title: "Tema", width: 0.35, key: "tema" },
  { title: "Formulario", width: 0.25, key: "variante" },
];

function drawTableHeader(document: PDFKit.PDFDocument, columns: Array<Column & { widthPt: number }>, accent: string): void {
  const y = document.y;
  let x = PAGE_MARGIN;

  columns.forEach((column) => {
    document.save().rect(x, y, column.widthPt, 18).fillAndStroke("#f1f5f9", BORDER).restore();
    document.save().rect(x, y, 3, 18).fill(accent).restore();
    document
      .fillColor("#475569")
      .font("Helvetica-Bold")
      .fontSize(6.5)
      .text(column.title.toUpperCase(), x + 8, y + 6, { width: column.widthPt - 12 });
    x += column.widthPt;
  });

  document.y = y + 18;
}

export async function GET(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request, { requireSameOriginForSession: false });

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
      layout: "landscape",
      info: {
        Title: "Mapa de rotas - VozUP",
        Author: "Voz UP",
      },
    });
    const pendingBuffer = pdfBuffer(document);

    drawHero(document, VOZUP_ROUTES.length, generatedAt);

    const width = contentWidth(document);
    const columns = ROUTE_COLUMNS.map((column) => ({ ...column, widthPt: column.width * width }));

    drawTableHeader(document, columns, ACCENT);

    const rowHeight = 24;
    VOZUP_ROUTES.forEach((row, index) => {
      if (document.y + rowHeight > pageBottom(document)) {
        document.addPage();
        drawTableHeader(document, columns, ACCENT);
      }

      const y = document.y;
      let x = PAGE_MARGIN;
      const fill = index % 2 === 0 ? "#ffffff" : SURFACE;

      columns.forEach((column) => {
        document.save().rect(x, y, column.widthPt, rowHeight).fillAndStroke(fill, BORDER).restore();
        x += column.widthPt;
      });

      x = PAGE_MARGIN;
      columns.forEach((column) => {
        const isRota = column.key === "rota";
        const text = String(row[column.key] ?? "");

        document
          .fillColor(isRota ? LINK : TEXT)
          .font(isRota ? "Helvetica-Bold" : "Helvetica")
          .fontSize(7)
          .text(text, x + 8, y + 8, {
            width: column.widthPt - 12,
            ellipsis: true,
            underline: isRota,
            link: isRota ? `${VOZUP_DOMAIN}${text}` : undefined,
          });
        x += column.widthPt;
      });

      document.y = y + rowHeight;
    });

    const pages = document.bufferedPageRange();
    for (let index = pages.start; index < pages.start + pages.count; index += 1) {
      document.switchToPage(index);
      document
        .fillColor(MUTED)
        .font("Helvetica")
        .fontSize(6.5)
        .text(`Mapa de rotas VozUP | Pagina ${index + 1} de ${pages.count}`, PAGE_MARGIN, pageBottom(document) - 10, {
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
        "Content-Disposition": `attachment; filename="mapa-de-rotas-vozup.pdf"`,
        "Content-Type": "application/pdf",
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("VozUP routes PDF error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
