/**
 * O PDF do contrato, no layout do contrato em papel da VozUP.
 *
 * Duas vias saem daqui, e a diferença entre elas é só o fim do documento:
 * - `digital`: assinada pelo link, termina com o bloco de assinatura
 *   eletrônica e ganha uma página de **termo de evidências**;
 * - `impressao`: sai com as linhas de assinatura da CONTRATADA, do
 *   CONTRATANTE e das duas testemunhas, para assinar à caneta.
 *
 * O texto não é escrito aqui — vem de `renderContractClauses()`, que é puro e
 * testado. Este arquivo só desenha.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import {
  contractClosing,
  fieldValue,
  formatPhoneBR,
  formatZip,
  formatCpf,
  formatDatePtBr,
  formatMoneyBRL,
  normalizePlan,
  planTotal,
  renderContractClauses,
  type ContractCompany,
  type ContractCourse,
  type ContractPlanRow,
  type ContractSnapshot,
  type ContractStudent,
} from "@/lib/contractTemplate";

const PAGE_MARGIN = 46;
/** 7 linhas de 21pt — o quadro do item 2 de um aluno. */
const STUDENT_BOX_HEIGHT = 147;
/** 2 linhas de 21pt — o quadro do item 3 de um aluno. */
const COURSE_BOX_HEIGHT = 42;
const NAVY = "#0f2b3d";
const TEAL = "#1a8ca0";
const TEAL_BAR = "#1b7f94";
const TEXT = "#1b2733";
const MUTED = "#66788a";
const BORDER = "#c9d6e0";
const SURFACE = "#f4f8fa";

export type ContractPdfVariant = "digital" | "impressao";

let cachedLogo: Buffer | null = null;
/**
 * Logotipo do cabeçalho.
 *
 * Usa uma cópia **sem canal alfa**, achatada sobre branco
 * (`vozup-logo-contrato.png`): o PNG RGBA do site sai com um halo claro em
 * volta do "UP" quando vira SMask no PDF, e era isso que aparecia no contrato
 * impresso. O arquivo com transparência continua servindo o site.
 */
function logo(): Buffer | null {
  if (cachedLogo) return cachedLogo;
  for (const file of ["vozup-logo-contrato.png", "vozup-logo-dark.png"]) {
    try {
      cachedLogo = readFileSync(join(process.cwd(), "public", file));
      return cachedLogo;
    } catch {
      // Tenta o próximo; logo ausente não pode impedir a emissão do contrato.
    }
  }
  return null;
}

export interface ContractEvidence {
  contractId: number;
  version: number;
  signedAt: string;
  signerName: string;
  signerCpf: string;
  cpfVerified: boolean;
  ip: string | null;
  userAgent: string | null;
  openedAt: string | null;
  linkReference: string;
  /** SHA-256 do CONTEÚDO contratado — o do arquivo só existe depois de fechado. */
  contentHash: string;
  acceptanceText: string;
  /** Segundos entre a primeira abertura do link e o aceite (medido no servidor). */
  readingSeconds: number;
  /** Piso exigido, para o termo dizer contra o que o tempo foi conferido. */
  minReadingSeconds: number;
  /** O signatário declarou ter chegado ao fim do texto. */
  reachedEnd: boolean;
  /** Consumiu o código de 6 dígitos enviado ao e-mail do cadastro. */
  otpVerified: boolean;
  /** Endereço para onde o código foi; entra MASCARADO no termo. */
  otpSentTo: string | null;
}

function pdfBuffer(document: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
}

function contentWidth(document: PDFKit.PDFDocument): number {
  return document.page.width - PAGE_MARGIN * 2;
}

function formatDateTimeBr(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  const formatted = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "America/Sao_Paulo",
  }).format(date);
  return `${formatted} (horário de Brasília)`;
}

/** O e-mail entra mascarado: o termo circula em processo e anexo, e o endereço
 *  inteiro do aluno não precisa viajar junto para provar o que precisa provar. */
function maskEvidenceEmail(value: string): string {
  const [user, domain] = value.split("@");
  if (!user || !domain) return "•••";
  const visible = user.slice(0, Math.min(3, user.length));
  return `${visible}${"•".repeat(Math.max(3, user.length - visible.length))}@${domain}`;
}

/** "3 min 12 s" em vez de "192 s": o termo é lido por gente, não por máquina. */
function formatReadingTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/** Faixa teal + bloco navy chanfrado do topo — a marca visual do documento. */
function drawTopBanner(document: PDFKit.PDFDocument): void {
  const width = document.page.width;
  document.save().rect(0, 0, width, 12).fill(TEAL).restore();
  document
    .save()
    .moveTo(0, 12)
    .lineTo(200, 12)
    .lineTo(168, 44)
    .lineTo(0, 44)
    .closePath()
    .fill(NAVY)
    .restore();
}

function drawFooter(document: PDFKit.PDFDocument, snapshot: ContractSnapshot, page: number, total: number): void {
  const { company } = snapshot;
  const parts = [company.website, company.instagram, company.phone].map((part) => part.trim()).filter(Boolean);
  const y = document.page.height - 40;

  const originalBottom = document.page.margins.bottom;
  // Sem zerar a margem, o pdfkit entende que o rodapé "não coube", cria uma
  // página nova para ele — e essa página dispara o cabeçalho e pede outro
  // rodapé. Um contrato de 3 páginas saía com 9, metade em branco.
  document.page.margins.bottom = 0;

  document.save().moveTo(PAGE_MARGIN, y - 8).lineTo(document.page.width - PAGE_MARGIN, y - 8).lineWidth(0.5).stroke(BORDER).restore();
  document
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(7.5)
    .text(parts.join("   •   "), PAGE_MARGIN, y, { width: contentWidth(document), align: "center", lineBreak: false })
    .fontSize(7)
    .text(`${page}/${total}`, PAGE_MARGIN, y, {
      width: contentWidth(document),
      align: "right",
      lineBreak: false,
    });

  document.page.margins.bottom = originalBottom;
}

// ── Quadro de resumo (página 1) ──────────────────────────────────

interface FieldCell {
  label: string;
  value: string;
  /** Fração da largura útil. */
  flex: number;
}

function drawSectionTitle(document: PDFKit.PDFDocument, index: number, title: string): void {
  const width = contentWidth(document);
  const height = 20;
  const y = document.y;
  document.save().rect(PAGE_MARGIN, y, width, height).fill(TEAL_BAR).restore();
  document
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(9.5)
    .text(`${index}.   ${title}`, PAGE_MARGIN + 10, y + 5.5, { width: width - 20, lineBreak: false });
  document.y = y + height;
  document.x = PAGE_MARGIN;
}

/**
 * Garante espaço para o próximo bloco do quadro de resumo.
 *
 * Com dois alunos o quadro passa de uma página, e o PDFKit, ao escrever fora
 * da área útil, cria uma página por chamada de texto — o contrato de casal saía
 * com dezenas de páginas quase vazias e a tabela do item 4 picotada. Quebrar
 * antes do bloco mantém cada quadro inteiro na mesma página.
 */
function ensureSpace(document: PDFKit.PDFDocument, needed: number): void {
  const limit = document.page.height - PAGE_MARGIN - 34;
  if (document.y + needed > limit) document.addPage();
}

/**
 * Faixa de subtítulo, sem número: separa o quadro do segundo aluno sem criar
 * um item novo. Renumerar quebraria as cláusulas, que citam "ITEM 3" e
 * "ITEM 4" pelo número.
 */
function drawSubsectionTitle(document: PDFKit.PDFDocument, title: string): void {
  const width = contentWidth(document);
  const height = 17;
  const y = document.y;
  document.save().rect(PAGE_MARGIN, y, width, height).fill(SURFACE).restore();
  document
    .fillColor(TEAL_BAR)
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .text(title, PAGE_MARGIN + 10, y + 4.5, { width: width - 20, lineBreak: false });
  document.y = y + height;
  document.x = PAGE_MARGIN;
}

/** O quadro do item 2 — igual para quem paga e para quem entra junto. */
function drawStudentBox(document: PDFKit.PDFDocument, student: ContractStudent): void {
  drawFieldRow(document, [{ label: "ALUNO", value: fieldValue(student.name), flex: 1 }]);
  drawFieldRow(document, [
    { label: "RG", value: fieldValue(student.rg), flex: 0.33 },
    { label: "CPF", value: formatCpf(student.cpf), flex: 0.34 },
    { label: "DATA NASC", value: formatDatePtBr(student.birthDate), flex: 0.33 },
  ]);
  drawFieldRow(document, [
    { label: "PROFISSÃO", value: fieldValue(student.profession), flex: 0.5 },
    { label: "EMPRESA", value: fieldValue(student.company), flex: 0.5 },
  ]);
  drawFieldRow(document, [
    { label: "TELEFONE", value: formatPhoneBR(student.phone), flex: 0.5 },
    { label: "CELULAR", value: formatPhoneBR(student.mobile), flex: 0.5 },
  ]);
  drawFieldRow(document, [{ label: "E-MAIL", value: fieldValue(student.email), flex: 1 }]);
  drawFieldRow(document, [{ label: "ENDEREÇO", value: fieldValue(student.address), flex: 1 }]);
  drawFieldRow(document, [
    { label: "BAIRRO", value: fieldValue(student.neighborhood), flex: 0.3 },
    { label: "CIDADE", value: fieldValue(student.city), flex: 0.3 },
    { label: "UF", value: fieldValue(student.state), flex: 0.16 },
    { label: "CEP", value: formatZip(student.zip), flex: 0.24 },
  ]);
}

/**
 * Item 3 de um aluno. Com um aluno só o quadro é o de sempre; com dois, cada
 * um leva o nome de quem faz aquele treinamento — senão não dá para saber quem
 * cursa o quê.
 */
function drawCourseBox(
  document: PDFKit.PDFDocument,
  course: ContractCourse,
  studentName: string | null
): void {
  drawFieldRow(document, [
    studentName
      ? { label: "ALUNO", value: fieldValue(studentName), flex: 0.42 }
      : null,
    { label: "NOME DO CURSO", value: fieldValue(course.name), flex: studentName ? 0.58 : 1 },
  ].filter((cell): cell is FieldCell => cell !== null));
  drawFieldRow(document, [
    { label: "CARGA HORÁRIA TOTAL", value: fieldValue(course.hours), flex: 0.55 },
    { label: "TURMA", value: fieldValue(course.className), flex: 0.45 },
  ]);
}

function drawFieldRow(document: PDFKit.PDFDocument, cells: FieldCell[], options: { height?: number } = {}): void {
  const width = contentWidth(document);
  const height = options.height ?? 21;
  const y = document.y;
  let x = PAGE_MARGIN;

  for (const cell of cells) {
    const cellWidth = width * cell.flex;
    document.save().rect(x, y, cellWidth, height).lineWidth(0.6).stroke(BORDER).restore();

    const labelText = `${cell.label}:`;
    document.font("Helvetica-Bold").fontSize(8);
    const labelWidth = document.widthOfString(labelText);
    document.fillColor(TEXT).text(labelText, x + 8, y + 6.5, { lineBreak: false });
    document
      .font("Helvetica")
      .fontSize(8.5)
      .fillColor(TEXT)
      .text(cell.value, x + 8 + labelWidth + 6, y + 6, {
        width: Math.max(10, cellWidth - labelWidth - 22),
        lineBreak: false,
        ellipsis: true,
      });

    x += cellWidth;
  }

  document.y = y + height;
  document.x = PAGE_MARGIN;
}

/**
 * Linhas do item 4.
 *
 * Com um aluno só, é o plano como está gravado. Com dois, a linha CURSO se
 * abre em uma por pessoa ("CURSO — Fulano"), porque é isso que o contrato de
 * casal precisa dizer: quanto é de cada um. O dinheiro não muda — a soma
 * continua sendo o total, e matrícula e material seguem em linha única, que é
 * como são cobrados. O que sobra depois dos alunos adicionais é do pagador.
 */
function expandPlanByStudent(snapshot: ContractSnapshot): ContractPlanRow[] {
  const rows = normalizePlan(snapshot.plan);
  const coStudents = snapshot.coStudents ?? [];
  if (coStudents.length === 0) return rows;

  const courseRow = rows.find((row) => row.key === "curso");
  if (!courseRow || courseRow.amount <= 0) return rows;

  const others = coStudents.reduce((sum, item) => sum + item.amount, 0);
  const payerAmount = Math.round((courseRow.amount - others) * 100) / 100;
  const installments = courseRow.installments > 0 ? courseRow.installments : 1;
  const share = (amount: number, name: string): ContractPlanRow => ({
    ...courseRow,
    label: `CURSO — ${shortName(name)}`,
    amount,
    installmentAmount: Math.round((amount / installments) * 100) / 100,
  });

  return [
    ...rows.filter((row) => row.key !== "curso"),
    ...(payerAmount > 0 ? [share(payerAmount, snapshot.student.name)] : []),
    ...coStudents.map((co) => share(co.amount, co.student.name)),
  ];
}

/** "Renata Cristina de Souza Lima" → "Renata Lima": a coluna ITEM é estreita. */
function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return parts.join(" ");
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

/**
 * Encurta o texto até caber na largura da célula, com reticências.
 *
 * `lineBreak: false` do PDFKit não impediu a quebra nas colunas estreitas do
 * contrato de duas pessoas: "Boleto Parcelado" virava duas linhas e a segunda
 * atravessava a borda da tabela. Medir e cortar resolve em qualquer largura,
 * sem depender do comportamento de wrap da biblioteca.
 */
function fitText(document: PDFKit.PDFDocument, text: string, maxWidth: number): string {
  if (!text) return "";
  if (document.widthOfString(text) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && document.widthOfString(`${cut}…`) > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}…`;
}

function drawPlanTable(document: PDFKit.PDFDocument, snapshot: ContractSnapshot): void {
  const width = contentWidth(document);
  const rowHeight = 22;
  // "CURSO — Renata Souza" não cabe na coluna estreita do contrato de um aluno
  // só: com alunos adicionais, a coluna ITEM cresce e as demais encolhem, com
  // os rótulos abreviados para o cabeçalho caber em UMA linha.
  const wide = (snapshot.coStudents?.length ?? 0) > 0;
  const itemFlex = wide ? 0.26 : 0.19;
  const columns = wide
    ? [
        { label: "ITEM", flex: itemFlex, align: "left" as const },
        { label: "VALOR", flex: 0.13, align: "right" as const },
        { label: "PARC.", flex: 0.11, align: "center" as const },
        { label: "VL. PARCELA", flex: 0.14, align: "right" as const },
        { label: "FORMA DE PAG.", flex: 0.2, align: "left" as const },
        { label: "1º VENC.", flex: 0.16, align: "center" as const },
      ]
    : [
        { label: "ITEM", flex: itemFlex, align: "left" as const },
        { label: "VALOR", flex: 0.14, align: "right" as const },
        { label: "Nº DE PARCELAS", flex: 0.15, align: "center" as const },
        { label: "VALOR PARCELA", flex: 0.15, align: "right" as const },
        { label: "FORMA DE PAGAMENTO", flex: 0.21, align: "left" as const },
        { label: "1º VENCIMENTO", flex: 0.16, align: "center" as const },
      ];

  const top = document.y;
  document.save().rect(PAGE_MARGIN, top, width, rowHeight).fill(SURFACE).restore();
  let x = PAGE_MARGIN;
  for (const column of columns) {
    const columnWidth = width * column.flex;
    document
      .fillColor(TEAL_BAR)
      .font("Helvetica-Bold")
      .fontSize(7)
      .text(fitText(document, column.label, columnWidth - 12), x + 6, top + 8, {
        width: columnWidth - 12,
        align: column.align,
        lineBreak: false,
      });
    x += columnWidth;
  }

  const rows = expandPlanByStudent(snapshot);
  let y = top + rowHeight;

  for (const row of rows) {
    const cells = [
      row.label,
      row.amount > 0 ? formatMoneyBRL(row.amount) : "",
      row.installments > 0 ? String(row.installments) : "",
      row.installmentAmount > 0 ? formatMoneyBRL(row.installmentAmount) : "",
      row.paymentMethod ?? "",
      formatDatePtBr(row.firstDueDate),
    ];
    let cellX = PAGE_MARGIN;
    columns.forEach((column, index) => {
      const columnWidth = width * column.flex;
      document.save().rect(cellX, y, columnWidth, rowHeight).lineWidth(0.6).stroke(BORDER).restore();
      document
        .fillColor(TEXT)
        .font(index === 0 ? "Helvetica-Bold" : "Helvetica")
        .fontSize(index === 0 ? 7.5 : 8)
        .text(fitText(document, cells[index], columnWidth - 12), cellX + 6, y + 7.5, {
          width: columnWidth - 12,
          align: column.align,
          lineBreak: false,
        });
      cellX += columnWidth;
    });
    y += rowHeight;
  }

  // Linha do TOTAL: valor somado E o parcelamento de fato.
  //
  // Com o valor dividido por aluno, cada linha mostra a fração daquele aluno
  // (R$ 395,80) e o boleto que chega é a soma (R$ 791,59) — sem esta linha, o
  // contrato não diz em lugar nenhum quanto a pessoa paga por mês. Matrícula e
  // material ficam de fora da conta porque são cobrados de uma vez, junto com a
  // primeira parcela: o que se parcela é o curso.
  const parceladas = rows.filter((row) => row.key === "curso" && row.amount > 0);
  const parcelas = parceladas[0]?.installments ?? 0;
  const totalParcelado = parceladas.reduce((sum, row) => sum + row.amount, 0);
  const valorParcela = parcelas > 0 ? Math.round((totalParcelado / parcelas) * 100) / 100 : 0;

  document.save().rect(PAGE_MARGIN, y, width, rowHeight).fill(SURFACE).restore();
  document.save().rect(PAGE_MARGIN, y, width, rowHeight).lineWidth(0.6).stroke(BORDER).restore();

  const totalCells = [
    "TOTAL:",
    formatMoneyBRL(planTotal(snapshot.plan)),
    parcelas > 0 ? String(parcelas) : "",
    valorParcela > 0 ? formatMoneyBRL(valorParcela) : "",
    "",
    "",
  ];
  let totalX = PAGE_MARGIN;
  columns.forEach((column, index) => {
    const columnWidth = width * column.flex;
    document
      .fillColor(TEXT)
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(fitText(document, totalCells[index], columnWidth - 12), totalX + 6, y + 7.5, {
        width: columnWidth - 12,
        align: column.align,
        lineBreak: false,
      });
    totalX += columnWidth;
  });

  document.y = y + rowHeight;
  document.x = PAGE_MARGIN;
}

function drawSummaryPage(document: PDFKit.PDFDocument, snapshot: ContractSnapshot): void {
  const { company, student, signer, course } = snapshot;
  const width = contentWidth(document);

  const brand = logo();
  if (brand) {
    document.image(brand, document.page.width / 2 - 60, 62, { width: 120 });
  } else {
    document
      .fillColor(NAVY)
      .font("Helvetica-Bold")
      .fontSize(24)
      .text("VozUP", PAGE_MARGIN, 70, { width, align: "center" });
  }

  document
    .fillColor(TEAL)
    .font("Helvetica-Bold")
    .fontSize(17)
    .text("CONTRATO DE PRESTAÇÃO DE SERVIÇOS", PAGE_MARGIN, 132, { width, align: "center" });

  document.y = 176;
  document.x = PAGE_MARGIN;

  drawSectionTitle(document, 1, "CONTRATADA");
  drawFieldRow(document, [{ label: "ESCOLA", value: fieldValue(company.name), flex: 1 }]);
  drawFieldRow(document, [{ label: "ENDEREÇO", value: fieldValue(company.address), flex: 1 }]);
  drawFieldRow(document, [
    { label: "BAIRRO", value: fieldValue(company.neighborhood), flex: 0.3 },
    { label: "CIDADE", value: fieldValue(company.city), flex: 0.3 },
    { label: "UF", value: fieldValue(company.state), flex: 0.16 },
    { label: "CEP", value: fieldValue(company.zip), flex: 0.24 },
  ]);

  document.y += 14;
  const coStudents = snapshot.coStudents ?? [];
  // Título fixo, com ou sem alunos adicionais: quem separa os quadros é o
  // subtítulo "ALUNO ADICIONAL" logo abaixo.
  drawSectionTitle(document, 2, "CONTRATANTE");
  drawStudentBox(document, student);
  for (const [index, co] of coStudents.entries()) {
    document.y += 10;
    ensureSpace(document, STUDENT_BOX_HEIGHT + 17);
    drawSubsectionTitle(
      document,
      coStudents.length > 1 ? `ALUNO ADICIONAL ${index + 2}` : "ALUNO ADICIONAL"
    );
    drawStudentBox(document, co.student);
  }

  // Menor de idade: quem assina é o responsável legal, e o contrato precisa
  // dizer quem é — o formulário em papel não tinha essa linha porque o campo
  // era preenchido à mão na hora.
  if (signer.role === "responsavel") {
    drawFieldRow(document, [
      { label: "RESPONSÁVEL LEGAL", value: fieldValue(signer.name), flex: 0.62 },
      { label: "CPF", value: formatCpf(signer.cpf), flex: 0.38 },
    ]);
  }

  document.y += 14;
  ensureSpace(document, 20 + COURSE_BOX_HEIGHT * (1 + coStudents.length));
  drawSectionTitle(document, 3, "CURSO / TREINAMENTO");
  drawCourseBox(document, course, coStudents.length > 0 ? student.name : null);
  for (const co of coStudents) {
    // Sem o respiro, os quadros de curso dos dois alunos se encostam e o item 3
    // parece uma tabela só de quatro linhas.
    document.y += 6;
    ensureSpace(document, COURSE_BOX_HEIGHT);
    drawCourseBox(document, co.course, co.student.name);
  }

  document.y += 14;
  // Título + cabeçalho + linhas do plano + total, na mesma página.
  ensureSpace(document, 20 + 22 * (3 + coStudents.length + 1));
  drawSectionTitle(document, 4, "PLANO FINANCEIRO");
  drawPlanTable(document, snapshot);

  document.y += 14;
  ensureSpace(document, 20 + 56);
  drawSectionTitle(document, 5, "OBSERVAÇÕES / ADITIVO");
  const notesHeight = 56;
  const notesTop = document.y;
  document.save().rect(PAGE_MARGIN, notesTop, width, notesHeight).lineWidth(0.6).stroke(BORDER).restore();
  if (snapshot.notes) {
    document
      .fillColor(TEXT)
      .font("Helvetica")
      .fontSize(8.5)
      .text(snapshot.notes, PAGE_MARGIN + 8, notesTop + 8, { width: width - 16, height: notesHeight - 16 });
  }
  document.y = notesTop + notesHeight;
}

// ── Cláusulas ────────────────────────────────────────────────────

function drawClauses(document: PDFKit.PDFDocument, snapshot: ContractSnapshot, variant: ContractPdfVariant): void {
  const width = contentWidth(document);

  document.addPage();
  document
    .fillColor(TEXT)
    .font("Helvetica-Bold")
    .fontSize(13)
    .text("CONTRATO DE PRESTAÇÃO DE SERVIÇOS EDUCACIONAIS", PAGE_MARGIN, document.y, { width });
  document.moveDown(0.6);
  document
    .font("Helvetica")
    .fontSize(9)
    .fillColor(TEXT)
    .text(
      "Pelo presente instrumento particular, CONTRATADA e CONTRATANTE têm, entre si, justas e contratadas, as cláusulas a seguir:",
      PAGE_MARGIN,
      document.y,
      { width, align: "justify" }
    );
  document.moveDown(0.8);

  for (const block of renderContractClauses(snapshot, { digitalSignature: variant === "digital" })) {
    if (document.y > document.page.height - 140) document.addPage();

    document.moveDown(0.5);
    document
      .fillColor(TEXT)
      .font("Helvetica-Bold")
      .fontSize(10)
      .text(block.title, PAGE_MARGIN, document.y, { width });
    document.moveDown(0.3);

    for (const item of block.items) {
      if (document.y > document.page.height - 110) document.addPage();
      const numberText = `${item.number} `;
      document.font("Helvetica-Bold").fontSize(9);
      const numberWidth = document.widthOfString(numberText);
      const top = document.y;
      document.fillColor(TEXT).text(numberText, PAGE_MARGIN, top, { lineBreak: false });
      document
        .font("Helvetica")
        .fontSize(9)
        .fillColor(TEXT)
        .text(item.text, PAGE_MARGIN + numberWidth, top, {
          width: width - numberWidth,
          align: "justify",
          lineGap: 1.5,
        });
      document.moveDown(0.45);
      document.x = PAGE_MARGIN;
    }
  }
}

function signatureLine(
  document: PDFKit.PDFDocument,
  x: number,
  y: number,
  lineWidth: number,
  title: string,
  lines: string[]
): void {
  document.save().moveTo(x, y).lineTo(x + lineWidth, y).lineWidth(0.8).stroke(TEXT).restore();
  document
    .fillColor(TEXT)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(title, x, y + 6, { width: lineWidth, lineBreak: false });
  let offset = y + 19;
  for (const line of lines) {
    document.font("Helvetica").fontSize(8).fillColor(MUTED).text(line, x, offset, { width: lineWidth, lineBreak: false });
    offset += 11;
  }
}

/**
 * Assinatura da escola a partir do data URI guardado nos dados da escola.
 *
 * Falha aqui nunca pode impedir a emissão: imagem corrompida vira `null` e a
 * linha da CONTRATADA sai em branco, exatamente como saía antes de existir
 * assinatura fixa.
 */
function companySignature(company: ContractCompany): Buffer | null {
  const uri = company.signatureImage?.trim();
  if (!uri) return null;
  const base64 = uri.slice(uri.indexOf(",") + 1);
  try {
    const buffer = Buffer.from(base64, "base64");
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
}

function drawSignatureArea(
  document: PDFKit.PDFDocument,
  snapshot: ContractSnapshot,
  variant: ContractPdfVariant,
  evidence: ContractEvidence | null
): void {
  const width = contentWidth(document);
  // Folga maior desde que a CONTRATADA passou a ter 4 linhas (razão social,
  // CNPJ, nome e cargo de quem assina) e uma assinatura desenhada acima.
  const needed = 190;
  if (document.y + needed > document.page.height - 70) document.addPage();

  document.moveDown(1);
  document
    .fillColor(TEXT)
    .font("Helvetica-Bold")
    .fontSize(9.5)
    .text("E, por estarem justos e acordados, assinam o presente.", PAGE_MARGIN, document.y, { width });
  document.moveDown(0.8);
  document
    .font("Helvetica-Bold")
    .fontSize(9.5)
    .text(contractClosing(snapshot), PAGE_MARGIN, document.y, { width });

  const half = width / 2;
  const lineWidth = half - 24;
  let y = document.y + (variant === "impressao" ? 74 : 66);

  if (variant === "digital" && evidence) {
    document
      .fillColor(TEAL)
      .font("Helvetica-Bold")
      .fontSize(8)
      .text("ASSINADO ELETRONICAMENTE", PAGE_MARGIN + half, y - 30, { width: lineWidth, lineBreak: false })
      .fillColor(MUTED)
      .font("Helvetica")
      .fontSize(7.5)
      .text(evidence.signerName, PAGE_MARGIN + half, y - 19, { width: lineWidth, lineBreak: false })
      .text(formatDateTimeBr(evidence.signedAt), PAGE_MARGIN + half, y - 10, { width: lineWidth, lineBreak: false });
  }

  // Assinatura da escola: vai nas DUAS vias. Na impressa o aluno recebe o papel
  // já assinado pela CONTRATADA e só assina o lado dele.
  const companyMark = companySignature(snapshot.company);
  if (companyMark) {
    try {
      // Ancorada na linha e centralizada na metade esquerda; `fit` respeita a
      // proporção, então assinatura larga ou alta cabe do mesmo jeito.
      document.image(companyMark, PAGE_MARGIN + lineWidth / 2 - 70, y - 50, {
        fit: [140, 44],
        align: "center",
        valign: "bottom",
      });
    } catch {
      // Imagem ilegível para o pdfkit: segue sem ela.
    }
  }

  const contratadaLines = [
    snapshot.company.legalName || snapshot.company.name,
    snapshot.company.cnpj ? `CNPJ ${snapshot.company.cnpj}` : "",
    snapshot.company.representativeName,
    snapshot.company.representativeRole,
  ].filter(Boolean);

  // CPF em linha própria, abaixo do nome — nas duas vias. Na impressa ele nem
  // aparecia, e um contrato em papel sem o documento de quem assina identifica
  // a parte pela metade.
  const signerCpf = variant === "digital" && evidence ? evidence.signerCpf : snapshot.signer.cpf;
  const contratanteLines = [
    variant === "digital" && evidence ? evidence.signerName : snapshot.signer.name,
    signerCpf ? `CPF ${formatCpf(signerCpf)}` : "",
    snapshot.signer.role === "responsavel" ? "Responsável legal pelo(a) aluno(a)" : "",
  ].filter(Boolean);

  signatureLine(document, PAGE_MARGIN, y, lineWidth, "CONTRATADA", contratadaLines);
  signatureLine(document, PAGE_MARGIN + half, y, lineWidth, "CONTRATANTE", contratanteLines);

  // O avanço acompanha o bloco mais alto: a CONTRATADA tem 4 linhas (razão
  // social, CNPJ, nome e cargo) e o CONTRATANTE pode ter 3 (nome, CPF e
  // "responsável legal"), então altura fixa cortaria uma das duas.
  const tallest = Math.max(contratadaLines.length, contratanteLines.length);
  y += Math.max(62, 19 + tallest * 11 + 14);

  // Sem testemunhas, por decisão da escola em 21/08/2026 — nem na via digital
  // nem na impressa. Ver docs/contrato-revisao-juridica.md para a consequência
  // (o contrato deixa de ser título executivo do CPC art. 784, III).

  document.y = y;
}

// ── Termo de evidências ──────────────────────────────────────────

function drawEvidencePage(
  document: PDFKit.PDFDocument,
  snapshot: ContractSnapshot,
  evidence: ContractEvidence
): void {
  document.addPage();
  const width = contentWidth(document);

  document
    .fillColor(TEXT)
    .font("Helvetica-Bold")
    .fontSize(13)
    .text("TERMO DE EVIDÊNCIAS DA ASSINATURA ELETRÔNICA", PAGE_MARGIN, document.y, { width });
  document.moveDown(0.4);
  document
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(8.5)
    .text(
      "Documento gerado automaticamente pelo sistema da escola no momento do aceite. Registra quem assinou, quando, de onde e o que foi assinado, nos termos do art. 10, §2º, da MP nº 2.200-2/2001.",
      PAGE_MARGIN,
      document.y,
      { width, align: "justify", lineGap: 1.5 }
    );
  document.moveDown(0.8);

  const rows: Array<[string, string]> = [
    ["Contrato", `nº ${evidence.contractId}/${evidence.version} — ${snapshot.course.name || "—"}`],
    ["Aluno(a)", snapshot.student.name],
    [
      "Signatário",
      `${evidence.signerName} (${snapshot.signer.role === "responsavel" ? "responsável legal" : "próprio aluno"})`,
    ],
    [
      "CPF do signatário",
      `${formatCpf(evidence.signerCpf)} — ${evidence.cpfVerified ? "conferido com o cadastro da escola" : "declarado no ato da assinatura"}`,
    ],
    ["E-mail do cadastro", snapshot.signer.email ?? "—"],
    ["Telefone do cadastro", snapshot.signer.phone ?? snapshot.student.mobile ?? "—"],
    ["Link aberto em", formatDateTimeBr(evidence.openedAt)],
    ["Assinatura registrada em", formatDateTimeBr(evidence.signedAt)],
    [
      "Tempo de leitura antes do aceite",
      `${formatReadingTime(evidence.readingSeconds)} — mínimo exigido pelo sistema: ${formatReadingTime(evidence.minReadingSeconds)}`,
    ],
    [
      "Código de verificação (2º fator)",
      evidence.otpVerified && evidence.otpSentTo
        ? `conferido — código de 6 dígitos enviado para ${maskEvidenceEmail(evidence.otpSentTo)} e digitado no ato da assinatura`
        : "não utilizado",
    ],
    [
      "Texto exibido integralmente",
      evidence.reachedEnd
        ? "sim — o signatário percorreu o contrato até a última cláusula antes de aceitar"
        : "não declarado",
    ],
    ["Endereço IP de origem", evidence.ip ?? "não registrado"],
    ["Dispositivo/navegador", evidence.userAgent ?? "não registrado"],
    ["Referência do link", evidence.linkReference],
    ["Valor contratado", formatMoneyBRL(planTotal(snapshot.plan))],
    ["Verificação do conteúdo (SHA-256)", evidence.contentHash],
  ];

  let y = document.y;
  const labelWidth = width * 0.34;
  for (const [label, value] of rows) {
    const height = Math.max(
      18,
      document.font("Helvetica").fontSize(8).heightOfString(value, { width: width - labelWidth - 18 }) + 10
    );
    document.save().rect(PAGE_MARGIN, y, width, height).lineWidth(0.5).stroke(BORDER).restore();
    document.save().rect(PAGE_MARGIN, y, labelWidth, height).fill(SURFACE).restore();
    document
      .fillColor(MUTED)
      .font("Helvetica-Bold")
      .fontSize(7.5)
      .text(label.toUpperCase(), PAGE_MARGIN + 8, y + 5, { width: labelWidth - 16 });
    document
      .fillColor(TEXT)
      .font("Helvetica")
      .fontSize(8)
      .text(value, PAGE_MARGIN + labelWidth + 9, y + 5, { width: width - labelWidth - 18 });
    y += height;
  }

  document.y = y + 14;
  document.fillColor(TEXT).font("Helvetica-Bold").fontSize(8.5).text("Declaração de aceite registrada", PAGE_MARGIN, document.y, { width });
  document.moveDown(0.2);
  document
    .fillColor(TEXT)
    .font("Helvetica")
    .fontSize(8)
    .text(`“${evidence.acceptanceText}”`, PAGE_MARGIN, document.y, { width, align: "justify", lineGap: 1.4 });

  document.moveDown(0.8);
  document
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(7.5)
    .text(
      "Como conferir: o código SHA-256 acima é calculado sobre o conteúdo contratado — partes, cláusulas, valores e plano financeiro. Qualquer alteração, ainda que de uma vírgula, produz um código diferente, o que permite verificar a qualquer tempo que este é o mesmo contrato aceito pelo signatário.",
      PAGE_MARGIN,
      document.y,
      { width, align: "justify", lineGap: 1.4 }
    );
}

export interface BuildContractPdfInput {
  snapshot: ContractSnapshot;
  contractId: number;
  version: number;
  variant: ContractPdfVariant;
  evidence: ContractEvidence | null;
}

export async function buildContractPdf(input: BuildContractPdfInput): Promise<Buffer> {
  const { snapshot, variant, evidence } = input;

  const document = new PDFDocument({
    autoFirstPage: false,
    bufferPages: true,
    margin: PAGE_MARGIN,
    size: "A4",
    info: {
      Title: `Contrato de matrícula nº ${input.contractId}`,
      Author: snapshot.company.legalName || snapshot.company.name || "VozUP",
      Subject: `Contrato de prestação de serviços educacionais — ${snapshot.course.name}`,
    },
  });

  document.on("pageAdded", () => {
    drawTopBanner(document);
    document.x = PAGE_MARGIN;
    document.y = 68;
  });

  const pending = pdfBuffer(document);

  document.addPage();
  drawSummaryPage(document, snapshot);
  drawClauses(document, snapshot, variant);
  drawSignatureArea(document, snapshot, variant, evidence);

  if (variant === "digital" && evidence) {
    drawEvidencePage(document, snapshot, evidence);
  }

  const range = document.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    document.switchToPage(range.start + index);
    drawFooter(document, snapshot, index + 1, range.count);
  }

  document.end();
  return pending;
}
