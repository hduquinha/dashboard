import { sellerMovementPdf, teamMovementPdf } from "@/lib/leadMovementPdf";
import type { SellerMovementReport, TeamMovementReport } from "@/lib/leadMovementLog";
import { inflateSync } from "node:zlib";

const report: SellerMovementReport = {
  sellerEmail: "andrea@example.com",
  sellerName: "Andrea",
  from: "2026-08-24",
  to: "2026-08-24",
  received: 2,
  moved: 1,
  movements: 1,
  stalled: 1,
  transitions: [],
  rows: [],
  actions: { total: 0, byAction: [], byKind: [], rows: [] },
};

const outreach = {
  reached: 12,
  replied: 5,
  confirmed: 3,
  days: [
    {
      date: "2026-08-24",
      reached: 12,
      replied: 5,
      confirmed: 3,
      note: "Retornos do direct",
      updatedAt: null,
      createdByName: "Andrea",
    },
  ],
};

function pdfText(pdf: Buffer): string {
  const source = pdf.toString("latin1");
  return [...source.matchAll(/\/Filter \/FlateDecode[\s\S]*?stream\n([\s\S]*?)\nendstream/g)]
    .map((match) => inflateSync(Buffer.from(match[1], "latin1")).toString("latin1"))
    .map((stream) =>
      [...stream.matchAll(/<([0-9a-fA-F]+)>/g)]
        .map((match) => Buffer.from(match[1], "hex").toString("latin1"))
        .join("")
    )
    .join("\n");
}

describe("PDF do histórico de movimentação", () => {
  it("inclui os indicadores do Instagram no PDF individual", async () => {
    const pdf = await sellerMovementPdf(report, outreach);
    const text = pdfText(pdf);

    expect(text).toContain("Leads normais");
    expect(text).toContain("Recebidos no período: com atividade x sem atividade");
    expect(text).toContain("COMO LER ESTE RELATÓRIO");
    expect(text).toContain("LEADS INSTAGRAM");
    expect(text).toContain("ABORDADOS");
    expect(text).toContain("RESPONDERAM");
    expect(text).toContain("CONFIRMADOS");
    expect(text).toContain("12");
    expect(text).toContain("5");
    expect(text).toContain("3");
  });

  it("não cria uma seção de Instagram quando o card não tem essa opção", async () => {
    const pdf = await sellerMovementPdf(report, null);

    expect(pdfText(pdf)).not.toContain("LEADS INSTAGRAM");
  });

  it("mantém os indicadores do Instagram no PDF geral da equipe", async () => {
    const team: TeamMovementReport = {
      from: report.from,
      to: report.to,
      sellers: [report],
      totals: {
        received: report.received,
        moved: report.moved,
        movements: report.movements,
        stalled: report.stalled,
      },
      transitions: [],
    };

    const pdf = await teamMovementPdf(
      team,
      [{ report, outreach }],
      [{ sellerName: "Andrea", reached: 12, replied: 5, confirmed: 3 }]
    );

    expect(pdfText(pdf)).toContain("Leads normais");
    expect(pdfText(pdf)).toContain("LEADS INSTAGRAM");
    expect(pdfText(pdf)).toContain("Andrea");
  });
});
