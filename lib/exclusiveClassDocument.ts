import { readFileSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { CONSULTING_PERIODS } from "@/lib/exclusiveClassDocumentConfig";

const PAGE_MARGIN = 34;
const NAVY = "#061d33";
const CYAN = "#08a9d8";
const CYAN_LIGHT = "#e7f8fd";
const TEXT = "#172033";
const MUTED = "#5f6f82";
const BORDER = "#cbd7e3";
const SURFACE = "#f7fafc";
const VOZUP_LOGO = readFileSync(join(process.cwd(), "public", "vozup-logo-dark.png"));

export interface ExclusiveClassDocumentOptions {
  copies?: number;
  eventDate?: string;
  location?: string;
}

function pdfBuffer(document: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
}

function normalizeCopies(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(50, Math.max(1, Math.trunc(value ?? 1)));
}

function normalizeShortText(value: string | undefined, maxLength: number): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function formatEventDate(value: string | undefined): string {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return "____/____/________";
  }

  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

function drawCheckbox(
  document: PDFKit.PDFDocument,
  x: number,
  y: number,
  label: string,
  options: { size?: number; fontSize?: number } = {}
): number {
  const size = options.size ?? 10;
  const fontSize = options.fontSize ?? 8.5;

  document.save().rect(x, y, size, size).lineWidth(0.8).stroke(BORDER).restore();
  document
    .fillColor(TEXT)
    .font("Helvetica")
    .fontSize(fontSize)
    .text(label, x + size + 4, y + 1, { lineBreak: false });

  return x + size + 4 + document.widthOfString(label) + 14;
}

function drawWritingLine(
  document: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  label: string
): void {
  document
    .fillColor(MUTED)
    .font("Helvetica-Bold")
    .fontSize(7)
    .text(label.toUpperCase(), x, y);
  document
    .save()
    .moveTo(x, y + 20)
    .lineTo(x + width, y + 20)
    .lineWidth(0.8)
    .stroke(BORDER)
    .restore();
}

/** Campo de data em três lacunas (__ / __ / ____) em vez de uma linha corrida:
 * na linha longa cada participante escreve num formato — "11/8", "11 de
 * agosto", "amanhã" — e quem digita depois no CRM tem que adivinhar. */
function drawDateField(
  document: PDFKit.PDFDocument,
  x: number,
  y: number,
  label: string
): void {
  document
    .fillColor(MUTED)
    .font("Helvetica-Bold")
    .fontSize(7)
    .text(label.toUpperCase(), x, y);

  const lineY = y + 20;
  const parts = [
    { width: 30, hint: "DIA" },
    { width: 30, hint: "MÊS" },
    { width: 46, hint: "ANO" },
  ];
  let cursor = x;

  parts.forEach((part, index) => {
    document
      .save()
      .moveTo(cursor, lineY)
      .lineTo(cursor + part.width, lineY)
      .lineWidth(0.8)
      .stroke(BORDER)
      .restore();

    // Cada legenda centrada sob a SUA lacuna: escritas numa string só, com
    // espaços, elas nunca caem debaixo da linha certa.
    document
      .fillColor(BORDER)
      .font("Helvetica")
      .fontSize(5.5)
      .text(part.hint, cursor, lineY + 3, { width: part.width, align: "center" });

    cursor += part.width;

    if (index < parts.length - 1) {
      document
        .fillColor(MUTED)
        .font("Helvetica")
        .fontSize(9)
        .text("/", cursor + 4, lineY - 9, { lineBreak: false });
      cursor += 13;
    }
  });
}

function drawSectionTitle(
  document: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  step: string,
  title: string
): void {
  document.save().roundedRect(x, y, width, 22, 4).fill(CYAN_LIGHT).restore();
  document.save().roundedRect(x + 6, y + 4, 14, 14, 3).fill(CYAN).restore();
  document
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .text(step, x + 6, y + 8, { align: "center", width: 14 });
  document
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(title.toUpperCase(), x + 27, y + 7, { width: width - 34 });
}

function drawHeader(
  document: PDFKit.PDFDocument,
  eventDate: string,
  location: string
): void {
  const x = PAGE_MARGIN;
  const y = 30;
  const width = document.page.width - PAGE_MARGIN * 2;
  const height = 84;

  document.save().roundedRect(x, y, width, height, 8).fill(NAVY).restore();
  document.save().roundedRect(x, y, 7, height, 4).fill(CYAN).restore();
  document.image(VOZUP_LOGO, x + 22, y + 20, { width: 105 });
  document
    .fillColor("#bceffc")
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .text("AULA EXCLUSIVA", x + 149, y + 18);
  document
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(14)
    .text("Presença, consultoria\ne indicações", x + 149, y + 33, {
      width: width - 324,
      lineGap: 1,
    });

  document
    .fillColor("#9fb2c5")
    .font("Helvetica-Bold")
    .fontSize(6.5)
    .text("DATA DA AULA", x + width - 166, y + 17, { width: 142, align: "right" });
  document
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(eventDate, x + width - 166, y + 29, { width: 142, align: "right" });
  document
    .fillColor("#9fb2c5")
    .font("Helvetica-Bold")
    .fontSize(6.5)
    .text("UNIDADE / LOCAL", x + width - 166, y + 49, { width: 142, align: "right" });
  document
    .fillColor("#ffffff")
    .font("Helvetica")
    .fontSize(8.5)
    .text(location || "________________________", x + width - 166, y + 61, {
      width: 142,
      align: "right",
    });
}

function drawPresenceSection(document: PDFKit.PDFDocument): void {
  const x = PAGE_MARGIN;
  const width = document.page.width - PAGE_MARGIN * 2;
  const y = 151;

  drawSectionTitle(document, x, y, width, "1", "Identificação e presença");
  document
    .save()
    .roundedRect(x, y + 28, width, 67, 5)
    .lineWidth(0.8)
    .stroke(BORDER)
    .restore();

  drawWritingLine(document, x + 14, y + 43, width - 28, "Nome completo");
}

function drawConsultingSection(document: PDFKit.PDFDocument): void {
  const x = PAGE_MARGIN;
  const width = document.page.width - PAGE_MARGIN * 2;
  const y = 259;
  const contentX = x + 14;
  const contentWidth = width - 28;
  // Data à esquerda, período à direita, na mesma faixa: são só três opções, e
  // ocupar meia página com elas roubava o espaço das indicações, que é onde a
  // pessoa realmente escreve.
  const periodsX = contentX + 208;
  const periodsWidth = contentWidth - 208;
  const columnGap = 10;
  const slotHeight = 30;
  const columnCount = CONSULTING_PERIODS.length;
  const slotWidth = (periodsWidth - columnGap * (columnCount - 1)) / columnCount;
  const gridY = y + 56;
  const boxSize = 12;

  drawSectionTitle(document, x, y, width, "2", "Agendamento da consultoria");
  document
    .save()
    .roundedRect(x, y + 28, width, 86, 5)
    .lineWidth(0.8)
    .stroke(BORDER)
    .restore();

  drawDateField(document, contentX, y + 42, "Data da consultoria");
  document
    .fillColor(MUTED)
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .text("MARQUE O PERÍODO DE PREFERÊNCIA", periodsX, y + 43, { width: periodsWidth });

  CONSULTING_PERIODS.forEach((period, index) => {
    const slotX = periodsX + index * (slotWidth + columnGap);

    document
      .save()
      .roundedRect(slotX, gridY, slotWidth, slotHeight, 5)
      .fillAndStroke(SURFACE, BORDER)
      .restore();

    document.font("Helvetica-Bold").fontSize(10);
    const labelWidth = document.widthOfString(period);
    const groupWidth = boxSize + 7 + labelWidth;
    const groupX = slotX + (slotWidth - groupWidth) / 2;
    const groupY = gridY + (slotHeight - boxSize) / 2;

    document
      .save()
      .roundedRect(groupX, groupY, boxSize, boxSize, 2.5)
      .lineWidth(1)
      .fillAndStroke("#ffffff", BORDER)
      .restore();
    document
      .fillColor(NAVY)
      .font("Helvetica-Bold")
      .fontSize(10)
      .text(period, groupX + boxSize + 7, groupY + 2, { lineBreak: false });
  });

  document
    .fillColor(MUTED)
    .font("Helvetica-Oblique")
    .fontSize(7.2)
    .text("O horário dentro do período será combinado pela equipe VozUP no contato.", contentX, y + 96, {
      width: contentWidth,
    });
}

function drawReferralsSection(document: PDFKit.PDFDocument): void {
  const x = PAGE_MARGIN;
  const width = document.page.width - PAGE_MARGIN * 2;
  // Sobe junto com o encolhimento do agendamento, e a folga vai para a altura
  // das linhas: é aqui que se escreve nome e telefone à mão.
  const y = 386;
  const tableY = y + 47;
  const rowHeight = 48;
  const columns = [
    { label: "#", width: 24 },
    { label: "Nome", width: 184 },
    { label: "Telefone / WhatsApp", width: 132 },
    { label: "Vínculo", width: width - 340 },
  ];

  drawSectionTitle(document, x, y, width, "3", "Indicações para ganhar o presente da Aula Exclusiva");
  document
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(7.5)
    .text(
      "Indique pessoas que você gostaria de presentear. Preencha um contato por linha.",
      x,
      y + 29,
      { width }
    );

  let columnX = x;
  columns.forEach((column) => {
    document.save().rect(columnX, tableY, column.width, 20).fillAndStroke(NAVY, NAVY).restore();
    document
      .fillColor("#ffffff")
      .font("Helvetica-Bold")
      .fontSize(6.8)
      .text(column.label.toUpperCase(), columnX + 5, tableY + 7, {
        width: column.width - 10,
        align: column.label === "#" ? "center" : "left",
      });
    columnX += column.width;
  });

  for (let row = 0; row < 5; row += 1) {
    const rowY = tableY + 20 + row * rowHeight;
    columnX = x;

    columns.forEach((column, index) => {
      document
        .save()
        .rect(columnX, rowY, column.width, rowHeight)
        .fillAndStroke(row % 2 === 0 ? "#ffffff" : SURFACE, BORDER)
        .restore();

      if (index === 0) {
        document
          .fillColor(MUTED)
          .font("Helvetica-Bold")
          .fontSize(8)
          .text(String(row + 1), columnX, rowY + 20, {
            width: column.width,
            align: "center",
          });
      }
      columnX += column.width;
    });

    let optionX = x + columns[0].width + columns[1].width + columns[2].width + 5;
    optionX = drawCheckbox(document, optionX, rowY + 13, "Amigo", { size: 7, fontSize: 5.8 });
    optionX = drawCheckbox(document, optionX, rowY + 13, "Parente", { size: 7, fontSize: 5.8 });
    drawCheckbox(document, optionX, rowY + 13, "Colega", { size: 7, fontSize: 5.8 });
    drawCheckbox(
      document,
      x + columns[0].width + columns[1].width + columns[2].width + 5,
      rowY + 28,
      "Cliente",
      { size: 7, fontSize: 5.8 }
    );
    drawCheckbox(
      document,
      x + columns[0].width + columns[1].width + columns[2].width + 67,
      rowY + 28,
      "Outro",
      { size: 7, fontSize: 5.8 }
    );
  }
}

function drawPrivacyAndFooter(
  document: PDFKit.PDFDocument,
  copyIndex: number,
  totalCopies: number
): void {
  const x = PAGE_MARGIN;
  const width = document.page.width - PAGE_MARGIN * 2;
  const y = 722;

  document.save().roundedRect(x, y, width, 49, 5).fillAndStroke(SURFACE, BORDER).restore();
  drawCheckbox(document, x + 11, y + 10, "Confirmo que avisei ou tenho autorização para compartilhar os contatos indicados.", {
    size: 9,
    fontSize: 7.2,
  });
  document
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(6.7)
    .text(
      "Os dados serão usados pela VozUP somente para apresentar a Aula Exclusiva e o presente. Para corrigir ou excluir um contato, procure a equipe VozUP.",
      x + 11,
      y + 28,
      { width: width - 22 }
    );

  document
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(6.5)
    .text("VOZUP · Aula Exclusiva", x, 790, { width: width / 2, lineBreak: false });
  document.text(`Ficha ${copyIndex + 1} de ${totalCopies}`, x + width / 2, 790, {
    width: width / 2,
    align: "right",
    lineBreak: false,
  });
}

function drawParticipantPage(
  document: PDFKit.PDFDocument,
  eventDate: string,
  location: string,
  copyIndex: number,
  totalCopies: number
): void {
  drawHeader(document, eventDate, location);
  document
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(8)
    .text(
      "Preencha uma ficha por participante, escreva o nome com letra legível e marque o período.",
      PAGE_MARGIN,
      127,
      { width: document.page.width - PAGE_MARGIN * 2, align: "center" }
    );
  drawPresenceSection(document);
  drawConsultingSection(document);
  drawReferralsSection(document);
  drawPrivacyAndFooter(document, copyIndex, totalCopies);
}

export async function buildExclusiveClassDocumentPdf(
  options: ExclusiveClassDocumentOptions = {}
): Promise<Buffer> {
  const copies = normalizeCopies(options.copies);
  const eventDate = formatEventDate(options.eventDate);
  const location = normalizeShortText(options.location, 70);
  const document = new PDFDocument({
    autoFirstPage: false,
    bufferPages: true,
    margin: PAGE_MARGIN,
    size: "A4",
    info: {
      Title: "Lista de presença, consultoria e indicações — Aula Exclusiva",
      Author: "VozUP",
      Subject: "Ficha individual para participantes da Aula Exclusiva",
    },
  });
  const pendingBuffer = pdfBuffer(document);

  for (let copyIndex = 0; copyIndex < copies; copyIndex += 1) {
    document.addPage();
    drawParticipantPage(document, eventDate, location, copyIndex, copies);
  }

  document.end();
  return pendingBuffer;
}
