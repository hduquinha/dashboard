import PDFDocument from "pdfkit";
import type {
  LeadMovementTransition,
  SellerMovementReport,
  TeamMovementReport,
} from "@/lib/leadMovementLog";
import { actionKindLabel } from "@/lib/leadMovementLog";
import type { InstagramOutreachReport } from "@/lib/instagramOutreach";

/** Totais do Instagram por vendedor, para a seção do PDF geral. */
export interface InstagramTeamRow {
  sellerName: string;
  reached: number;
  replied: number;
  confirmed: number;
}

/**
 * Desenho dos PDFs de movimentação de leads. Como em `contractDocument.ts`,
 * este arquivo SÓ desenha: quem busca o dado é a lib de consulta, quem decide
 * permissão é a rota. Assim dá para mudar o layout sem tocar em regra.
 *
 * Duas restrições que moldam tudo aqui:
 *
 * 1. **Só as fontes embutidas do PDFKit** (Helvetica/Courier). Registrar fonte
 *    externa quebra no container, e elas são WinAnsi: acento passa, mas seta
 *    "→" e outros símbolos saem como lixo. Por isso a seta é DESENHADA
 *    (vetor), não escrita.
 * 2. **Tabela é posicionamento manual.** O PDFKit não tem tabela; cada célula é
 *    um `text()` em x/y explícito com `lineBreak: false`, e a quebra de página é
 *    decidida por nós — senão o cabeçalho da tabela some da página 2 em diante.
 */

const MARGIN = 36;
/** Um PDF com milhares de linhas não é relatório gerencial, é despejo. */
const MAX_LINHAS = 400;

/** Emerald do painel na tela, para o relatório impresso ser reconhecível. */
const COR = {
  tinta: "#0F172A",
  suave: "#475569",
  fraca: "#94A3B8",
  linha: "#E2E8F0",
  zebra: "#F8FAFC",
  acento: "#047857",
  acentoClaro: "#D1FAE5",
  alerta: "#B45309",
  alertaClaro: "#FEF3C7",
  branco: "#FFFFFF",
} as const;

type Doc = InstanceType<typeof PDFDocument>;

interface Coluna {
  label: string;
  width: number;
  align?: "left" | "right";
}

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

function periodoLabel(from: string, to: string): string {
  return from === to ? formatarData(from) : `${formatarData(from)} a ${formatarData(to)}`;
}

function emitidoEm(): string {
  return new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function larguraUtil(doc: Doc): number {
  return doc.page.width - MARGIN * 2;
}

/** Onde o conteúdo tem que parar para não invadir o rodapé. */
function limiteInferior(doc: Doc): number {
  return doc.page.height - MARGIN - 26;
}

/**
 * Corta o texto na largura da célula em vez de deixar o PDFKit quebrar a linha
 * — numa tabela de posição fixa, uma linha que quebra escreve por cima da
 * linha de baixo.
 */
function cortar(doc: Doc, texto: string, largura: number): string {
  if (doc.widthOfString(texto) <= largura) return texto;
  let corte = texto;
  while (corte.length > 1 && doc.widthOfString(`${corte}...`) > largura) {
    corte = corte.slice(0, -1);
  }
  return `${corte}...`;
}

/** Seta em vetor: a Helvetica embutida não tem o caractere. */
function seta(doc: Doc, x: number, y: number, largura: number, cor: string): void {
  const meio = y + 3;
  doc
    .save()
    .strokeColor(cor)
    .lineWidth(0.8)
    .moveTo(x, meio)
    .lineTo(x + largura, meio)
    .stroke()
    .moveTo(x + largura - 2.5, meio - 2)
    .lineTo(x + largura, meio)
    .lineTo(x + largura - 2.5, meio + 2)
    .stroke()
    .restore();
}

/** Faixa colorida do topo — identidade do documento e o período em destaque. */
function faixa(doc: Doc, titulo: string, subtitulo: string, periodo: string): void {
  const largura = doc.page.width;
  doc.save().rect(0, 0, largura, 84).fill(COR.acento).restore();

  doc
    .fillColor(COR.branco)
    .font("Helvetica-Bold")
    .fontSize(17)
    .text(cortar(doc, titulo, largura - MARGIN * 2 - 150), MARGIN, 26, {
      width: largura - MARGIN * 2 - 150,
      lineBreak: false,
    });

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(COR.acentoClaro)
    .text(subtitulo, MARGIN, 48, { width: largura - MARGIN * 2 - 150, lineBreak: false });

  // Período à direita: é a primeira coisa que se procura ao abrir o relatório.
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(COR.acentoClaro)
    .text("PERÍODO", largura - MARGIN - 150, 28, { width: 150, align: "right", lineBreak: false });
  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor(COR.branco)
    .text(periodo, largura - MARGIN - 150, 40, { width: 150, align: "right", lineBreak: false });

  doc.fillColor(COR.tinta);
  doc.y = 100;
}

function rodape(doc: Doc, pagina: number, total: number): void {
  const y = doc.page.height - MARGIN - 14;
  doc
    .save()
    .strokeColor(COR.linha)
    .lineWidth(0.5)
    .moveTo(MARGIN, y - 6)
    .lineTo(doc.page.width - MARGIN, y - 6)
    .stroke()
    .restore();

  doc.font("Helvetica").fontSize(7).fillColor(COR.fraca);
  doc.text(
    `Emitido em ${emitidoEm()}  ·  Não inclui o funil de Triagem (lista fria)`,
    MARGIN,
    y,
    { width: larguraUtil(doc) - 60, lineBreak: false }
  );
  doc.text(`${pagina}/${total}`, doc.page.width - MARGIN - 60, y, {
    width: 60,
    align: "right",
    lineBreak: false,
  });
}

function titulo(doc: Doc, texto: string): void {
  if (doc.y + 40 > limiteInferior(doc)) doc.addPage();
  doc.font("Helvetica-Bold").fontSize(10.5).fillColor(COR.tinta);
  doc.text(texto.toUpperCase(), MARGIN, doc.y, { lineBreak: false, characterSpacing: 0.6 });
  const y = doc.y + 13;
  doc
    .save()
    .strokeColor(COR.acento)
    .lineWidth(1.5)
    .moveTo(MARGIN, y)
    .lineTo(MARGIN + 26, y)
    .stroke()
    .restore();
  doc.y = y + 10;
}

/** Os números do período em caixas — o resumo tem que ser lido de relance. */
function indicadores(
  doc: Doc,
  itens: Array<{ label: string; valor: number; destaque?: boolean }>
): void {
  const largura = larguraUtil(doc);
  const vao = 8;
  const cada = (largura - vao * (itens.length - 1)) / itens.length;
  const altura = 46;
  const y = doc.y;

  itens.forEach((item, indice) => {
    const x = MARGIN + indice * (cada + vao);
    doc
      .save()
      .roundedRect(x, y, cada, altura, 4)
      .fillAndStroke(item.destaque ? COR.acentoClaro : COR.zebra, COR.linha)
      .restore();

    doc
      .font("Helvetica-Bold")
      .fontSize(18)
      .fillColor(item.destaque ? COR.acento : COR.tinta)
      .text(String(item.valor), x + 10, y + 8, { width: cada - 20, lineBreak: false });

    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor(COR.suave)
      .text(item.label.toUpperCase(), x + 10, y + 30, {
        width: cada - 20,
        lineBreak: false,
        characterSpacing: 0.4,
      });
  });

  doc.fillColor(COR.tinta);
  doc.y = y + altura + 14;
}

/** Explicação impressa para não transformar um percentual contextual em uma meta absoluta. */
function comoLer(
  doc: Doc,
  report: Pick<SellerMovementReport, "moved" | "stalled" | "received" | "movements">
): void {
  const base = report.received;
  const percentualParados = base > 0 ? Math.round((report.stalled / base) * 100) : 0;
  const altura = 72;
  if (doc.y + altura > limiteInferior(doc)) doc.addPage();

  const y = doc.y;
  doc.save().roundedRect(MARGIN, y, larguraUtil(doc), altura, 4).fillAndStroke(COR.alertaClaro, COR.linha).restore();
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COR.tinta).text("COMO LER ESTE RELATÓRIO", MARGIN + 10, y + 9, {
    width: larguraUtil(doc) - 20,
    lineBreak: false,
  });
  doc.font("Helvetica").fontSize(7.5).fillColor(COR.suave).text(
    `Parados (${report.stalled}) = recebidos na janela sem evento depois da atribuição até o fim do período.`,
    MARGIN + 10,
    y + 24,
    { width: larguraUtil(doc) - 20, lineBreak: false }
  );
  doc.text(
    `Movimentados (${report.moved}) = leads diferentes movidos pelo vendedor. Movimentações (${report.movements}) = mudanças de etapa.`,
    MARGIN + 10,
    y + 36,
    { width: larguraUtil(doc) - 20, lineBreak: false }
  );
  doc.text(
    `${percentualParados}% parados = ${report.stalled} ÷ ${base} recebidos no período. Leads antigos não entram nesta base.`,
    MARGIN + 10,
    y + 48,
    { width: larguraUtil(doc) - 20, lineBreak: false }
  );
  doc.font("Helvetica-Oblique").fontSize(7).fillColor(COR.fraca).text(
    "A Triagem (lista fria) não entra nestes números.",
    MARGIN + 10,
    y + 60,
    { width: larguraUtil(doc) - 20, lineBreak: false }
  );
  doc.fillColor(COR.tinta);
  doc.y = y + altura + 12;
}

interface PizzaItem {
  label: string;
  value: number;
  color: string;
}

interface PizzaConfig {
  title: string;
  subtitle: string;
  items: PizzaItem[];
  note: string;
}

/**
 * Gráfico de pizza vetorial, sem imagem externa — assim continua nítido ao
 * imprimir e funciona no mesmo container que gera o restante do PDF.
 */
function desenharPizza(doc: Doc, x: number, largura: number, config: PizzaConfig, y: number): void {
  const total = config.items.reduce((soma, item) => soma + Math.max(0, item.value), 0);
  const centroX = x + 54;
  const centroY = y + 78;
  const raio = 43;
  const legendaX = x + 106;
  const legendaLargura = largura - 112;

  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(COR.tinta).text(config.title, x, y, {
    width: largura,
    lineBreak: false,
  });
  doc.font("Helvetica").fontSize(7.5).fillColor(COR.suave).text(config.subtitle, x, y + 14, {
    width: largura,
    lineBreak: false,
  });

  if (total === 0) {
    doc.save().circle(centroX, centroY, raio).fillAndStroke(COR.zebra, COR.linha).restore();
    doc.font("Helvetica-Oblique").fontSize(7).fillColor(COR.fraca).text("Sem dados", centroX - 25, centroY - 4, {
      width: 50,
      align: "center",
      lineBreak: false,
    });
  } else {
    let angulo = -Math.PI / 2;
    config.items.forEach((item) => {
      const valor = Math.max(0, item.value);
      if (valor === 0) return;

      const fim = angulo + (valor / total) * 2 * Math.PI;
      const desenho = doc
        .save()
        .moveTo(centroX, centroY)
        .lineTo(
          centroX + raio * Math.cos(angulo),
          centroY + raio * Math.sin(angulo)
        );
      // O método existe no PDFKit em runtime, mas ficou fora da tipagem
      // publicada por @types/pdfkit.
      (desenho as Doc & { arc: (x: number, y: number, raio: number, inicio: number, fim: number) => Doc }).arc(
        centroX,
        centroY,
        raio,
        angulo,
        fim
      );
      desenho.lineTo(centroX, centroY).fill(item.color).restore();
      angulo = fim;
    });
    doc.save().circle(centroX, centroY, raio).strokeColor(COR.branco).lineWidth(1).stroke().restore();
  }

  config.items.forEach((item, indice) => {
    const linhaY = y + 39 + indice * 21;
    const valor = Math.max(0, item.value);
    const percentual = total === 0 ? 0 : Math.round((valor / total) * 100);
    doc.save().rect(legendaX, linhaY + 2, 8, 8).fill(item.color).restore();
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(COR.tinta).text(`${item.label}: ${valor} (${percentual}%)`, legendaX + 13, linhaY, {
      width: legendaLargura - 13,
      lineBreak: false,
    });
  });

  doc.font("Helvetica-Oblique").fontSize(6.8).fillColor(COR.fraca).text(config.note, x, y + 133, {
    width: largura,
    lineBreak: false,
  });
}

/** Dois gráficos lado a lado para a leitura rápida do relatório. */
function graficosPizza(
  doc: Doc,
  normal: { received: number; stalled: number },
  instagram: { reached: number; replied: number; confirmed: number } | null
): void {
  const altura = 155;
  if (doc.y + altura > limiteInferior(doc)) doc.addPage();

  const gap = 14;
  const largura = instagram ? (larguraUtil(doc) - gap) / 2 : larguraUtil(doc);
  const y = doc.y;
  const normalConfig: PizzaConfig = {
    title: "Leads normais",
    subtitle: "Recebidos no período: com atividade x sem atividade",
    items: [
      { label: "Com atividade", value: Math.max(0, normal.received - normal.stalled), color: COR.acento },
      { label: "Sem atividade", value: normal.stalled, color: COR.alerta },
    ],
    note: "Base: leads recebidos no período. Movimentados e mudanças de etapa são indicadores separados.",
  };
  desenharPizza(doc, MARGIN, largura, normalConfig, y);

  if (instagram) {
    const instagramConfig: PizzaConfig = {
      title: "Instagram",
      subtitle: "Indicadores lançados no período",
      items: [
        { label: "Abordados", value: instagram.reached, color: "#C026D3" },
        { label: "Responderam", value: instagram.replied, color: "#2563EB" },
        { label: "Confirmados", value: instagram.confirmed, color: "#059669" },
      ],
      note: "Proporção visual; os três indicadores são independentes, não um funil obrigatório.",
    };
    desenharPizza(doc, MARGIN + largura + gap, largura, instagramConfig, y);
  }

  doc.y = y + altura;
  doc.fillColor(COR.tinta);
}

/**
 * Distribuição por transição com barra proporcional. O número sozinho não diz
 * onde o funil trava; a barra mostra isso sem o leitor precisar comparar.
 */
function barras(doc: Doc, itens: LeadMovementTransition[], vazio = "Nenhuma movimentação no período."): void {
  if (itens.length === 0) {
    doc.font("Helvetica-Oblique").fontSize(9).fillColor(COR.fraca);
    doc.text(vazio, MARGIN, doc.y, { lineBreak: false });
    doc.y += 16;
    doc.fillColor(COR.tinta);
    return;
  }

  const largura = larguraUtil(doc);
  const rotulo = 210;
  const numero = 34;
  const barraMax = largura - rotulo - numero - 12;
  const maior = Math.max(...itens.map((item) => item.count));
  const alturaLinha = 15;

  for (const item of itens) {
    if (doc.y + alturaLinha > limiteInferior(doc)) doc.addPage();
    const y = doc.y;

    // "De" alinhado à DIREITA e "Para" à esquerda, com a seta no meio: assim a
    // seta encosta nos dois rótulos em vez de flutuar no vão.
    const metade = (rotulo - 16) / 2;
    doc.font("Helvetica").fontSize(8).fillColor(COR.suave);
    doc.text(cortar(doc, item.fromStage, metade), MARGIN, y + 2, {
      width: metade,
      align: "right",
      lineBreak: false,
    });
    seta(doc, MARGIN + metade + 3, y + 2, 9, COR.fraca);
    doc.fillColor(COR.tinta).font("Helvetica-Bold");
    doc.text(cortar(doc, item.toStage, metade), MARGIN + metade + 16, y + 2, {
      width: metade,
      lineBreak: false,
    });

    // Trilho de fundo: sem ele uma barra de valor 1 vira um ponto solto e o
    // leitor perde a referência do "1 em relação a quanto".
    doc.save().rect(MARGIN + rotulo, y + 3, barraMax, 6).fill(COR.linha).restore();
    const comprimento = Math.max(6, (item.count / maior) * barraMax);
    doc.save().rect(MARGIN + rotulo, y + 3, comprimento, 6).fill(COR.acento).restore();

    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COR.tinta);
    doc.text(String(item.count), MARGIN + rotulo + barraMax + 6, y + 1.5, {
      width: numero,
      align: "right",
      lineBreak: false,
    });

    doc.y = y + alturaLinha;
  }

  doc.fillColor(COR.tinta);
  doc.y += 4;
}

/** Cabeçalho da tabela — redesenhado a cada página, senão a 2ª fica órfã. */
function cabecalhoTabela(doc: Doc, colunas: Coluna[]): void {
  const y = doc.y;
  doc.save().rect(MARGIN, y, larguraUtil(doc), 16).fill(COR.tinta).restore();

  let x = MARGIN + 6;
  doc.font("Helvetica-Bold").fontSize(7).fillColor(COR.branco);
  for (const coluna of colunas) {
    doc.text(coluna.label.toUpperCase(), x, y + 5, {
      width: coluna.width - 8,
      align: coluna.align ?? "left",
      lineBreak: false,
      characterSpacing: 0.4,
    });
    x += coluna.width;
  }
  doc.fillColor(COR.tinta);
  doc.y = y + 16;
}

const ALTURA_LINHA = 14;

/**
 * Abre página nova quando a próxima linha não cabe, repetindo o cabeçalho e
 * dizendo de quem é a tabela — a página 2 solta, sem nome nem período, obriga
 * o leitor a voltar para a primeira para saber o que está vendo.
 */
function garantirEspaco(doc: Doc, colunas: Coluna[], contexto?: string): void {
  if (doc.y + ALTURA_LINHA <= limiteInferior(doc)) return;
  doc.addPage();
  if (contexto) {
    doc.font("Helvetica").fontSize(8).fillColor(COR.fraca);
    doc.text(contexto, MARGIN, doc.y, { lineBreak: false });
    doc.y += 14;
  }
  cabecalhoTabela(doc, colunas);
}

function zebra(doc: Doc, y: number, indice: number): void {
  if (indice % 2 === 1) {
    doc.save().rect(MARGIN, y, larguraUtil(doc), ALTURA_LINHA).fill(COR.zebra).restore();
  }
}

function colunasMovimento(mostrarData: boolean): Coluna[] {
  return mostrarData
    ? [
        { label: "Data e hora", width: 74 },
        { label: "Lead", width: 122 },
        { label: "Movimento", width: 152 },
        { label: "Responsável", width: 84 },
        { label: "Movido por", width: 91 },
      ]
    : [
        { label: "Hora", width: 40 },
        { label: "Lead", width: 145 },
        { label: "Movimento", width: 160 },
        { label: "Responsável", width: 85 },
        { label: "Movido por", width: 93 },
      ];
}

function tabelaMovimentos(doc: Doc, report: SellerMovementReport): void {
  if (report.rows.length === 0) {
    doc.font("Helvetica-Oblique").fontSize(9).fillColor(COR.fraca);
    doc.text(
      `Nenhuma movimentação registrada em ${periodoLabel(report.from, report.to)}.`,
      MARGIN,
      doc.y,
      { lineBreak: false }
    );
    doc.y += 16;
    doc.fillColor(COR.tinta);
    return;
  }

  const mostrarData = report.from !== report.to;
  const colunas = colunasMovimento(mostrarData);
  const contexto = `${report.sellerName ?? report.sellerEmail} · ${periodoLabel(report.from, report.to)} · movimentações (continuação)`;
  cabecalhoTabela(doc, colunas);

  const visiveis = report.rows.slice(0, MAX_LINHAS);
  let temMarcado = false;

  visiveis.forEach((row, indice) => {
    garantirEspaco(doc, colunas, contexto);
    const y = doc.y;
    zebra(doc, y, indice);

    let x = MARGIN + 6;
    const proxima = (coluna: Coluna) => {
      const inicio = x;
      x += coluna.width;
      return inicio;
    };

    // Quando
    doc.font("Helvetica").fontSize(7.5).fillColor(COR.suave);
    const quando = mostrarData ? `${formatarData(row.date)} ${row.time}` : row.time;
    doc.text(quando, proxima(colunas[0]), y + 4, { width: colunas[0].width - 8, lineBreak: false });

    // Lead
    doc.font("Helvetica-Bold").fontSize(8).fillColor(COR.tinta);
    const xLead = proxima(colunas[1]);
    doc.text(cortar(doc, row.leadName ?? `Lead #${row.leadId}`, colunas[1].width - 8), xLead, y + 3.5, {
      width: colunas[1].width - 8,
      lineBreak: false,
    });

    // Movimento: de -> para, com a seta desenhada
    const xMov = proxima(colunas[2]);
    const metade = (colunas[2].width - 8 - 14) / 2;
    doc.font("Helvetica").fontSize(7.5).fillColor(COR.suave);
    doc.text(cortar(doc, row.fromStage ?? "—", metade), xMov, y + 4, {
      width: metade,
      align: "right",
      lineBreak: false,
    });
    seta(doc, xMov + metade + 2, y + 4, 9, COR.fraca);
    doc.font("Helvetica-Bold").fillColor(COR.acento);
    doc.text(cortar(doc, row.toStage ?? "—", metade), xMov + metade + 14, y + 4, {
      width: metade,
      lineBreak: false,
    });

    // Responsável
    doc.font("Helvetica").fontSize(7.5).fillColor(COR.suave);
    const xResp = proxima(colunas[3]);
    doc.text(cortar(doc, row.ownerName ?? "sem responsável", colunas[3].width - 8), xResp, y + 4, {
      width: colunas[3].width - 8,
      lineBreak: false,
    });

    // Movido por — marcado quando NÃO é o responsável. Quando é a própria
    // pessoa, repetir o nome ao lado do de "Responsável" só produzia ruído (e
    // ficava confuso quando o nome foi gravado diferente no dia: "Mayara" numa
    // coluna, "Mayara Oliveira" na outra, sendo o mesmo e-mail).
    const xPor = proxima(colunas[4]);
    const mesmaPessoa =
      !row.byOther &&
      (row.actorEmail ?? "").trim().toLowerCase() ===
        (row.ownerEmail ?? "").trim().toLowerCase() &&
      (row.actorEmail ?? "") !== "";
    const nomeAutor = mesmaPessoa ? "o próprio" : row.actorName ?? "—";
    if (row.byOther) {
      temMarcado = true;
      const texto = cortar(doc, nomeAutor, colunas[4].width - 20);
      const largura = doc.widthOfString(texto) + 10;
      doc.save().roundedRect(xPor - 3, y + 2, largura, 10, 5).fill(COR.alertaClaro).restore();
      doc.fillColor(COR.alerta).font("Helvetica-Bold").fontSize(7.5);
      doc.text(texto, xPor + 2, y + 4, { width: colunas[4].width - 8, lineBreak: false });
    } else {
      doc.fillColor(mesmaPessoa ? COR.fraca : COR.suave)
        .font(mesmaPessoa ? "Helvetica-Oblique" : "Helvetica")
        .fontSize(7.5);
      doc.text(cortar(doc, nomeAutor, colunas[4].width - 8), xPor, y + 4, {
        width: colunas[4].width - 8,
        lineBreak: false,
      });
    }

    doc.y = y + ALTURA_LINHA;
  });

  // Linha de fechamento da tabela.
  doc
    .save()
    .strokeColor(COR.linha)
    .lineWidth(0.5)
    .moveTo(MARGIN, doc.y)
    .lineTo(doc.page.width - MARGIN, doc.y)
    .stroke()
    .restore();
  doc.y += 8;

  if (temMarcado) {
    doc.font("Helvetica").fontSize(7).fillColor(COR.alerta);
    doc.text(
      "Destacado = movido por outra pessoa enquanto o lead era deste vendedor.",
      MARGIN,
      doc.y,
      { lineBreak: false }
    );
    doc.y += 12;
  }

  if (report.rows.length > MAX_LINHAS) {
    doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(COR.fraca);
    doc.text(
      `Mais ${report.rows.length - MAX_LINHAS} movimentação(ões) no período não couberam neste PDF.`,
      MARGIN,
      doc.y,
      { lineBreak: false }
    );
    doc.y += 12;
  }

  doc.fillColor(COR.tinta);
}

/**
 * Prospecção no Instagram. Fica no relatório mesmo zerada: um dia sem lançamento
 * é informação — foi justamente o buraco que fez a rotina antiga não pegar.
 */
function instagramDoVendedor(doc: Doc, outreach: InstagramOutreachReport | null): void {
  // Nulo = o card deste vendedor NÃO tem a opção "Leads Instagram" ligada, e
  // aí a seção não existe. Um objeto com zero dias é outra coisa: ele registra
  // Instagram e não lançou nada no período — isso o relatório precisa dizer.
  if (!outreach) return;

  titulo(doc, "Leads Instagram");

  indicadores(doc, [
    { label: "Abordados", valor: outreach.reached },
    { label: "Responderam", valor: outreach.replied },
    { label: "Confirmados", valor: outreach.confirmed, destaque: true },
  ]);

  if (outreach.days.length === 0) {
    doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(COR.fraca);
    doc.text("Nenhum dia lançado no período.", MARGIN, doc.y, { lineBreak: false });
    doc.y += 14;
    doc.fillColor(COR.tinta);
    return;
  }

  // Num relatório de UM dia a tabela repetiria as caixas de cima, mas a
  // observação não está em lugar nenhum — sem esta linha ela só existia no
  // período de vários dias, e o que a pessoa escreveu sobre o dia sumia
  // justamente do relatório daquele dia.
  if (outreach.days.length === 1) {
    const nota = outreach.days[0].note;
    if (nota) {
      doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(COR.suave);
      doc.text(nota, MARGIN, doc.y, { width: larguraUtil(doc) });
      doc.y += 6;
      doc.fillColor(COR.tinta);
    }
    return;
  }

  if (outreach.days.length > 1) {
    const colunas: Coluna[] = [
      { label: "Dia", width: 70 },
      { label: "Abordados", width: 75, align: "right" },
      { label: "Responderam", width: 85, align: "right" },
      { label: "Confirmados", width: 85, align: "right" },
      { label: "Observação", width: 208 },
    ];
    cabecalhoTabela(doc, colunas);
    outreach.days.forEach((dia, indice) => {
      garantirEspaco(doc, colunas);
      const y = doc.y;
      zebra(doc, y, indice);
      let x = MARGIN + 6;
      doc.font("Helvetica").fontSize(7.5).fillColor(COR.suave);
      doc.text(formatarData(dia.date), x, y + 4, { width: colunas[0].width - 8, lineBreak: false });
      x += colunas[0].width;
      [dia.reached, dia.replied, dia.confirmed].forEach((valor, posicao) => {
        const coluna = colunas[posicao + 1];
        doc.text(String(valor), x, y + 4, {
          width: coluna.width - 8,
          align: "right",
          lineBreak: false,
        });
        x += coluna.width;
      });
      doc.fillColor(COR.fraca);
      doc.text(cortar(doc, dia.note ?? "", colunas[4].width - 8), x, y + 4, {
        width: colunas[4].width - 8,
        lineBreak: false,
      });
      doc.fillColor(COR.suave);
      doc.y = y + ALTURA_LINHA;
    });
    doc.y += 8;
    doc.fillColor(COR.tinta);
  }
}

const COLUNAS_ACAO: Coluna[] = [
  { label: "Tipo", width: 80 },
  { label: "Ação registrada", width: 300 },
  { label: "Quantidade", width: 143, align: "right" },
];

/**
 * Ações registradas na ficha do lead. Agrupadas pela DESCRIÇÃO gravada, porque
 * "Ligação feita" e "Ligação não atendida" são o mesmo `kind` e só a descrição
 * as separa — agrupar por tipo juntaria as duas num número que não responde
 * nada.
 */
function acoesDoVendedor(doc: Doc, report: SellerMovementReport): void {
  const acoes = report.actions;
  if (!acoes || acoes.total === 0) return;

  titulo(doc, "Ações no lead");
  cabecalhoTabela(doc, COLUNAS_ACAO);

  acoes.byAction.forEach((item, indice) => {
    garantirEspaco(doc, COLUNAS_ACAO);
    const y = doc.y;
    zebra(doc, y, indice);
    let x = MARGIN + 6;

    doc.font("Helvetica").fontSize(7.5).fillColor(COR.suave);
    doc.text(actionKindLabel(item.kind), x, y + 4, {
      width: COLUNAS_ACAO[0].width - 8,
      lineBreak: false,
    });
    x += COLUNAS_ACAO[0].width;

    doc.font("Helvetica-Bold").fontSize(8).fillColor(COR.tinta);
    doc.text(cortar(doc, item.action, COLUNAS_ACAO[1].width - 8), x, y + 3.5, {
      width: COLUNAS_ACAO[1].width - 8,
      lineBreak: false,
    });
    x += COLUNAS_ACAO[1].width;

    doc.fillColor(COR.acento);
    doc.text(String(item.count), x, y + 3.5, {
      width: COLUNAS_ACAO[2].width - 8,
      align: "right",
      lineBreak: false,
    });
    doc.y = y + ALTURA_LINHA;
  });

  garantirEspaco(doc, COLUNAS_ACAO);
  const y = doc.y;
  doc.save().rect(MARGIN, y, larguraUtil(doc), ALTURA_LINHA + 2).fill(COR.acentoClaro).restore();
  doc.font("Helvetica-Bold").fontSize(8).fillColor(COR.acento);
  doc.text("TOTAL DE AÇÕES", MARGIN + 6, y + 4.5, {
    width: COLUNAS_ACAO[0].width + COLUNAS_ACAO[1].width - 8,
    lineBreak: false,
  });
  doc.text(String(acoes.total), MARGIN + 6 + COLUNAS_ACAO[0].width + COLUNAS_ACAO[1].width, y + 4.5, {
    width: COLUNAS_ACAO[2].width - 8,
    align: "right",
    lineBreak: false,
  });
  doc.y = y + ALTURA_LINHA + 10;
  doc.fillColor(COR.tinta);
}

function corpoDoVendedor(
  doc: Doc,
  report: SellerMovementReport,
  outreach?: InstagramOutreachReport | null
): void {
  indicadores(doc, [
    { label: "Recebidos", valor: report.received },
    { label: "Movimentados", valor: report.moved, destaque: true },
    { label: "Parados", valor: report.stalled },
    { label: "Movimentações", valor: report.movements },
  ]);
  comoLer(doc, report);
  titulo(doc, "Visualização dos indicadores");
  graficosPizza(
    doc,
    { received: report.received, stalled: report.stalled },
    outreach
      ? { reached: outreach.reached, replied: outreach.replied, confirmed: outreach.confirmed }
      : null
  );
  titulo(doc, "Mudanças de etapa por transição");
  // A distribuição conta só o que ELE moveu. A tabela abaixo pode ter linhas
  // mesmo com esta seção vazia (lead dele movido por outra pessoa) — sem esta
  // frase os dois blocos parecem se contradizer.
  barras(doc, report.transitions, "Este vendedor não moveu nenhum lead no período.");
  titulo(doc, "Mudanças de etapa registradas");
  tabelaMovimentos(doc, report);
  acoesDoVendedor(doc, report);
  instagramDoVendedor(doc, outreach ?? null);
}

function render(desenhar: (doc: Doc) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // bufferPages: o rodapé precisa saber o total de páginas, que só se conhece
    // depois que tudo foi desenhado.
    const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    desenhar(doc);

    const paginas = doc.bufferedPageRange();
    for (let i = 0; i < paginas.count; i += 1) {
      doc.switchToPage(paginas.start + i);
      rodape(doc, i + 1, paginas.count);
    }
    doc.flushPages();
    doc.end();
  });
}

/** PDF de um vendedor. */
export function sellerMovementPdf(
  report: SellerMovementReport,
  outreach?: InstagramOutreachReport | null
): Promise<Buffer> {
  return render((doc) => {
    faixa(
      doc,
      report.sellerName ?? report.sellerEmail,
      "Movimentação de leads · Kanban Comercial VozUP",
      periodoLabel(report.from, report.to)
    );
    corpoDoVendedor(doc, report, outreach);
  });
}

const COLUNAS_EQUIPE: Coluna[] = [
  { label: "Vendedor", width: 175 },
  { label: "Recebidos", width: 85, align: "right" },
  { label: "Movimentados", width: 85, align: "right" },
  { label: "Parados", width: 85, align: "right" },
  { label: "Movimentações", width: 93, align: "right" },
];

function tabelaEquipe(doc: Doc, team: TeamMovementReport): void {
  if (team.sellers.length === 0) {
    doc.font("Helvetica-Oblique").fontSize(9).fillColor(COR.fraca);
    doc.text("Nenhuma atividade registrada no período.", MARGIN, doc.y, { lineBreak: false });
    doc.y += 16;
    doc.fillColor(COR.tinta);
    return;
  }

  cabecalhoTabela(doc, COLUNAS_EQUIPE);

  team.sellers.forEach((row, indice) => {
    garantirEspaco(doc, COLUNAS_EQUIPE);
    const y = doc.y;
    zebra(doc, y, indice);

    // Sem barra de fundo atrás da linha: sobreposta ao zebrado ela lia como
    // defeito de renderização, não como ranking. A tabela já vem ordenada e a
    // proporção aparece nas barras da seção seguinte.
    let x = MARGIN + 6;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(COR.tinta);
    doc.text(
      cortar(doc, row.sellerName ?? row.sellerEmail, COLUNAS_EQUIPE[0].width - 8),
      x,
      y + 3.5,
      { width: COLUNAS_EQUIPE[0].width - 8, lineBreak: false }
    );
    x += COLUNAS_EQUIPE[0].width;

    const valores = [row.received, row.moved, row.stalled, row.movements];
    valores.forEach((valor, posicao) => {
      const coluna = COLUNAS_EQUIPE[posicao + 1];
      doc
        .font(posicao === 3 ? "Helvetica-Bold" : "Helvetica")
        .fontSize(8)
        .fillColor(posicao === 3 ? COR.acento : COR.suave);
      doc.text(String(valor), x, y + 3.5, {
        width: coluna.width - 8,
        align: "right",
        lineBreak: false,
      });
      x += coluna.width;
    });

    doc.y = y + ALTURA_LINHA;
  });

  // Totais.
  garantirEspaco(doc, COLUNAS_EQUIPE);
  const y = doc.y;
  doc.save().rect(MARGIN, y, larguraUtil(doc), ALTURA_LINHA + 2).fill(COR.acentoClaro).restore();
  let x = MARGIN + 6;
  doc.font("Helvetica-Bold").fontSize(8).fillColor(COR.acento);
  doc.text("TOTAL DA EQUIPE", x, y + 4.5, { width: COLUNAS_EQUIPE[0].width - 8, lineBreak: false });
  x += COLUNAS_EQUIPE[0].width;
  [team.totals.received, team.totals.moved, team.totals.stalled, team.totals.movements].forEach(
    (valor, posicao) => {
      const coluna = COLUNAS_EQUIPE[posicao + 1];
      doc.text(String(valor), x, y + 4.5, {
        width: coluna.width - 8,
        align: "right",
        lineBreak: false,
      });
      x += coluna.width;
    }
  );
  doc.y = y + ALTURA_LINHA + 6;

  doc.y += 3;
  doc.font("Helvetica").fontSize(7.5).fillColor(COR.suave);
  doc.text(
    "O detalhamento individual nas páginas seguintes cobre quem teve movimentação ou recebeu lead no período.",
    MARGIN,
    doc.y,
    { lineBreak: false }
  );
  doc.y += 14;
  doc.fillColor(COR.tinta);
}

const COLUNAS_INSTAGRAM: Coluna[] = [
  { label: "Vendedor", width: 203 },
  { label: "Abordados", width: 105, align: "right" },
  { label: "Responderam", width: 107, align: "right" },
  { label: "Confirmados", width: 108, align: "right" },
];

/** Prospecção no Instagram por vendedor — número lançado à mão, não capturado. */
function tabelaInstagramEquipe(doc: Doc, linhas: InstagramTeamRow[]): void {
  titulo(doc, "Leads Instagram");

  if (linhas.length === 0) {
    doc.font("Helvetica-Oblique").fontSize(9).fillColor(COR.fraca);
    doc.text("Nenhum lançamento no período.", MARGIN, doc.y, { lineBreak: false });
    doc.y += 16;
    doc.fillColor(COR.tinta);
    return;
  }

  cabecalhoTabela(doc, COLUNAS_INSTAGRAM);
  const totais = { reached: 0, replied: 0, confirmed: 0 };

  linhas.forEach((linha, indice) => {
    garantirEspaco(doc, COLUNAS_INSTAGRAM);
    const y = doc.y;
    zebra(doc, y, indice);
    totais.reached += linha.reached;
    totais.replied += linha.replied;
    totais.confirmed += linha.confirmed;

    let x = MARGIN + 6;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(COR.tinta);
    doc.text(cortar(doc, linha.sellerName, COLUNAS_INSTAGRAM[0].width - 8), x, y + 3.5, {
      width: COLUNAS_INSTAGRAM[0].width - 8,
      lineBreak: false,
    });
    x += COLUNAS_INSTAGRAM[0].width;

    [linha.reached, linha.replied, linha.confirmed].forEach((valor, posicao) => {
      const coluna = COLUNAS_INSTAGRAM[posicao + 1];
      doc
        .font(posicao === 2 ? "Helvetica-Bold" : "Helvetica")
        .fontSize(8)
        .fillColor(posicao === 2 ? COR.acento : COR.suave);
      doc.text(String(valor), x, y + 3.5, {
        width: coluna.width - 8,
        align: "right",
        lineBreak: false,
      });
      x += coluna.width;
    });
    doc.y = y + ALTURA_LINHA;
  });

  garantirEspaco(doc, COLUNAS_INSTAGRAM);
  const y = doc.y;
  doc.save().rect(MARGIN, y, larguraUtil(doc), ALTURA_LINHA + 2).fill(COR.acentoClaro).restore();
  let x = MARGIN + 6;
  doc.font("Helvetica-Bold").fontSize(8).fillColor(COR.acento);
  doc.text("TOTAL DA EQUIPE", x, y + 4.5, {
    width: COLUNAS_INSTAGRAM[0].width - 8,
    lineBreak: false,
  });
  x += COLUNAS_INSTAGRAM[0].width;
  [totais.reached, totais.replied, totais.confirmed].forEach((valor, posicao) => {
    const coluna = COLUNAS_INSTAGRAM[posicao + 1];
    doc.text(String(valor), x, y + 4.5, {
      width: coluna.width - 8,
      align: "right",
      lineBreak: false,
    });
    x += coluna.width;
  });
  doc.y = y + ALTURA_LINHA + 10;
  doc.fillColor(COR.tinta);
}

/**
 * PDF geral: primeiro a comparação da equipe (é o que o gestor abre para
 * responder "quem está produzindo"), depois uma página por vendedor.
 */
export function teamMovementPdf(
  team: TeamMovementReport,
  detalhes: Array<{ report: SellerMovementReport; outreach: InstagramOutreachReport | null }>,
  instagram: InstagramTeamRow[] = []
): Promise<Buffer> {
  return render((doc) => {
    const periodo = periodoLabel(team.from, team.to);
    faixa(doc, "Movimentação de leads · Equipe", "Kanban Comercial VozUP", periodo);

    indicadores(doc, [
      { label: "Recebidos", valor: team.totals.received },
      { label: "Movimentados", valor: team.totals.moved, destaque: true },
      { label: "Parados", valor: team.totals.stalled },
      { label: "Movimentações", valor: team.totals.movements },
    ]);
    comoLer(doc, team.totals);

    const instagramTotais = instagram.reduce(
      (totais, linha) => ({
        reached: totais.reached + linha.reached,
        replied: totais.replied + linha.replied,
        confirmed: totais.confirmed + linha.confirmed,
      }),
      { reached: 0, replied: 0, confirmed: 0 }
    );
    titulo(doc, "Visualização dos indicadores");
    graficosPizza(
      doc,
      { received: team.totals.received, stalled: team.totals.stalled },
      instagramTotais
    );

    titulo(doc, "Comparativo por vendedor");
    tabelaEquipe(doc, team);

    titulo(doc, "Mudanças de etapa por transição — equipe");
    barras(doc, team.transitions);

    tabelaInstagramEquipe(doc, instagram);

    for (const item of detalhes) {
      doc.addPage();
      faixa(
        doc,
        item.report.sellerName ?? item.report.sellerEmail,
        "Detalhamento individual · Movimentação de leads",
        periodo
      );
      corpoDoVendedor(doc, item.report, item.outreach);
    }
  });
}
