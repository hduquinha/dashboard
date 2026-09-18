import {
  INTERESSE_SEM_CONTATO,
  summarizeWorkshopReviews,
  type WorkshopReview,
} from "@/lib/workshopReviews";

function avaliacao(overrides: Partial<WorkshopReview> = {}): WorkshopReview {
  return {
    id: 1,
    respondidoEm: "2026-09-17T20:00:00.000Z",
    workshop: "Workshop 17/09/2026",
    nome: "Fulana de Tal",
    telefone: "(11) 98888-7777",
    nota: 10,
    momento: "Storytelling (a forma estratégica para gerar conexão)",
    interesse: "Gostei da experiência e quero que entrem em contato para me explicar as opções",
    inscricaoId: null,
    ...overrides,
  };
}

describe("summarizeWorkshopReviews", () => {
  it("nao inventa media quando ninguem respondeu", () => {
    const resumo = summarizeWorkshopReviews([]);

    expect(resumo.respostas).toBe(0);
    expect(resumo.notaMedia).toBeNull();
    expect(resumo.distribuicaoNotas).toHaveLength(11);
    expect(resumo.porMomento).toEqual([]);
  });

  it("conta a nota 0 como resposta, nao como campo vazio", () => {
    const resumo = summarizeWorkshopReviews([
      avaliacao({ id: 1, nota: 0 }),
      avaliacao({ id: 2, nota: 10 }),
    ]);

    // Se o 0 caisse fora, a media viraria 10 e a pior critica da pesquisa
    // desapareceria do relatorio.
    expect(resumo.notaMedia).toBe(5);
    expect(resumo.notasBaixas).toBe(1);
    expect(resumo.notasAltas).toBe(1);
    expect(resumo.distribuicaoNotas[0]).toEqual({ label: "0", total: 1 });
    expect(resumo.distribuicaoNotas[10]).toEqual({ label: "10", total: 1 });
  });

  it("ignora nota ausente na media, mas mantem a resposta na contagem", () => {
    const resumo = summarizeWorkshopReviews([
      avaliacao({ id: 1, nota: 8 }),
      avaliacao({ id: 2, nota: null }),
    ]);

    expect(resumo.respostas).toBe(2);
    expect(resumo.notaMedia).toBe(8);
  });

  it("separa quem quer proximos passos e quem ja tem ficha no CRM", () => {
    const resumo = summarizeWorkshopReviews([
      avaliacao({ id: 1, interesse: "Quero agendar minha consultoria individual para conhecer a grade de cursos", inscricaoId: 42 }),
      avaliacao({ id: 2, inscricaoId: null }),
      avaliacao({ id: 3, interesse: INTERESSE_SEM_CONTATO, inscricaoId: 7 }),
    ]);

    expect(resumo.querProximosPassos).toBe(2);
    expect(resumo.comLead).toBe(2);
  });

  it("ordena momentos do mais votado para o menos, com desempate estavel", () => {
    const resumo = summarizeWorkshopReviews([
      avaliacao({ id: 1, momento: "Visualização de futuro" }),
      avaliacao({ id: 2, momento: "Storytelling" }),
      avaliacao({ id: 3, momento: "Storytelling" }),
      avaliacao({ id: 4, momento: "O conjunto da experiência" }),
      avaliacao({ id: 5, momento: "" }),
    ]);

    expect(resumo.porMomento).toEqual([
      { label: "Storytelling", total: 2 },
      { label: "O conjunto da experiência", total: 1 },
      { label: "Visualização de futuro", total: 1 },
    ]);
  });
});
