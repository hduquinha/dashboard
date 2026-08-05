import {
  bestSchedulingBlock,
  blockForHour,
  buildBlockArrival,
  buildHourlyArrival,
  buildWeekdayArrival,
  buildWeekdayBlockMatrix,
  formatHourLabel,
  groupLeadsByDestination,
  peakHour,
  summarizeArrival,
} from "@/lib/leadArrivalAnalysis";
import type { AdLeadDetail } from "@/types/metaAds";

function lead(overrides: Partial<AdLeadDetail> & { id: number }): AdLeadDetail {
  return {
    nome: `Lead ${overrides.id}`,
    telefone: "11999999999",
    email: null,
    criadoEm: "2026-07-20T23:30:00.000Z",
    hora: 20,
    diaSemana: 1,
    dia: "2026-07-20",
    adId: "ad-1",
    adName: "VOZUP_AD01",
    adsetName: "Conjunto 1",
    campaignName: "Campanha 1",
    landingUrl: "https://escolavozup.com/forms/vendas/6-perguntas",
    thumbnailUrl: null,
    imageUrl: null,
    videoId: null,
    stageKey: "novo",
    stageLabel: "Novo",
    stageKind: "entry",
    sellerName: "Mayara",
    bucket: "novo",
    isReturning: false,
    etapasAlcancadas: ["novo"],
    ...overrides,
  };
}

describe("summarizeArrival", () => {
  it("conta agendamento pelo histórico, não pela etapa atual", () => {
    const leads = [
      // Agendou e depois foi perdido: continua contando como agendamento.
      lead({ id: 1, stageKey: "perdido", stageKind: "lost", etapasAlcancadas: ["novo", "agendado", "perdido"] }),
      lead({ id: 2, stageKey: "ganho", stageKind: "won", etapasAlcancadas: ["novo", "agendado", "ganho"] }),
      lead({ id: 3 }),
      lead({ id: 4, sellerName: null }),
    ];

    const totals = summarizeArrival(leads);

    expect(totals.cadastros).toBe(4);
    expect(totals.agendaram).toBe(2);
    expect(totals.ganhos).toBe(1);
    expect(totals.perdidos).toBe(1);
    expect(totals.semDono).toBe(1);
    expect(totals.taxaAgendamento).toBe(50);
  });

  it("separa contatos novos de retornos mesclados e não divide por zero", () => {
    expect(summarizeArrival([]).taxaAgendamento).toBeNull();
    expect(summarizeArrival([lead({ id: 1, bucket: "recontato", isReturning: true }), lead({ id: 2 })]).contatosNovos).toBe(1);
  });
});

describe("buildHourlyArrival", () => {
  it("devolve as 24 horas, inclusive as vazias", () => {
    const hours = buildHourlyArrival([lead({ id: 1, hora: 9 })]);

    expect(hours).toHaveLength(24);
    expect(hours[9].cadastros).toBe(1);
    expect(hours[9].label).toBe("09h");
    expect(hours[5].cadastros).toBe(0);
    expect(hours[5].leads).toEqual([]);
  });

  it("mantém os leads de cada hora para a lista da tela", () => {
    const hours = buildHourlyArrival([lead({ id: 7, hora: 21 }), lead({ id: 8, hora: 21 })]);
    expect(hours[21].leads.map((l) => l.id)).toEqual([7, 8]);
  });
});

describe("faixas do dia", () => {
  it("classifica a hora na faixa certa", () => {
    expect(blockForHour(0).key).toBe("madrugada");
    expect(blockForHour(6).key).toBe("manha");
    expect(blockForHour(12).key).toBe("tarde");
    expect(blockForHour(23).key).toBe("noite");
  });

  it("soma participação de cada faixa sobre o total", () => {
    const blocks = buildBlockArrival([
      lead({ id: 1, hora: 2 }),
      lead({ id: 2, hora: 20 }),
      lead({ id: 3, hora: 21 }),
      lead({ id: 4, hora: 22 }),
    ]);

    const noite = blocks.find((block) => block.key === "noite");
    expect(noite?.cadastros).toBe(3);
    expect(noite?.participacao).toBe(75);
    expect(blocks.find((block) => block.key === "tarde")?.cadastros).toBe(0);
  });
});

describe("peakHour e bestSchedulingBlock", () => {
  it("aponta a hora com mais chegadas e null quando não há lead", () => {
    expect(peakHour(buildHourlyArrival([]))).toBeNull();
    const peak = peakHour(buildHourlyArrival([lead({ id: 1, hora: 3 }), lead({ id: 2, hora: 3 }), lead({ id: 3, hora: 8 })]));
    expect(peak?.hora).toBe(3);
  });

  it("ignora faixa com amostra pequena para não eleger 100% de 1 lead", () => {
    const leads = [
      // Madrugada: 1 lead, 1 agendamento (100%, mas amostra de 1).
      lead({ id: 1, hora: 2, etapasAlcancadas: ["novo", "agendado"] }),
      // Noite: 6 leads, 2 agendamentos (33%).
      ...Array.from({ length: 2 }, (_, index) =>
        lead({ id: 10 + index, hora: 20, etapasAlcancadas: ["novo", "agendado"] })
      ),
      ...Array.from({ length: 4 }, (_, index) => lead({ id: 20 + index, hora: 21 })),
    ];

    const best = bestSchedulingBlock(buildBlockArrival(leads));
    expect(best?.key).toBe("noite");
  });

  it("devolve null quando nenhuma faixa alcança a amostra mínima", () => {
    expect(bestSchedulingBlock(buildBlockArrival([lead({ id: 1, hora: 2 })]))).toBeNull();
  });
});

describe("buildWeekdayArrival e buildWeekdayBlockMatrix", () => {
  it("cobre os 7 dias e as 28 células da matriz", () => {
    const leads = [lead({ id: 1, diaSemana: 0, hora: 20 }), lead({ id: 2, diaSemana: 3, hora: 9 })];

    const weekdays = buildWeekdayArrival(leads);
    expect(weekdays).toHaveLength(7);
    expect(weekdays[0].cadastros).toBe(1);
    expect(weekdays[0].shortLabel).toBe("Dom");

    const matrix = buildWeekdayBlockMatrix(leads);
    expect(matrix).toHaveLength(28);
    expect(matrix.find((cell) => cell.diaSemana === 0 && cell.blockKey === "noite")?.cadastros).toBe(1);
    expect(matrix.find((cell) => cell.diaSemana === 3 && cell.blockKey === "manha")?.cadastros).toBe(1);
  });
});

describe("groupLeadsByDestination", () => {
  it("separa formulário nativo das landing pages, com os desfechos de cada um", () => {
    const groups = groupLeadsByDestination([
      lead({ id: 1, landingUrl: "https://fb.me/abc", etapasAlcancadas: ["novo", "agendado"] }),
      lead({ id: 2, landingUrl: "https://fb.me/abc" }),
      lead({ id: 3, landingUrl: "https://escolavozup.com/forms/vendas/6-perguntas" }),
    ]);

    expect(groups.get("native_form")?.cadastros).toBe(2);
    expect(groups.get("native_form")?.agendaram).toBe(1);
    expect(groups.get("native_form")?.taxaAgendamento).toBe(50);
    expect(groups.get("lp:vendas/6-perguntas")?.cadastros).toBe(1);
    expect(groups.get("lp:vendas/6-perguntas")?.destination.label).toBe("LP Vendas");
  });

  it("ordena os leads do grupo do mais recente pro mais antigo", () => {
    const groups = groupLeadsByDestination([
      lead({ id: 1, criadoEm: "2026-07-20T10:00:00.000Z", landingUrl: "https://fb.me/abc" }),
      lead({ id: 2, criadoEm: "2026-07-22T10:00:00.000Z", landingUrl: "https://fb.me/abc" }),
    ]);

    expect(groups.get("native_form")?.leads.map((l) => l.id)).toEqual([2, 1]);
  });
});

describe("formatHourLabel", () => {
  it("usa dois dígitos", () => {
    expect(formatHourLabel(0)).toBe("00h");
    expect(formatHourLabel(21)).toBe("21h");
  });
});
