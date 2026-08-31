import { normalizeOutreachCount } from "@/lib/instagramOutreach";

describe("normalizeOutreachCount", () => {
  it("aceita número inteiro digitado", () => {
    expect(normalizeOutreachCount(40)).toBe(40);
    expect(normalizeOutreachCount("40")).toBe(40);
  });

  it("campo vazio ou texto vira zero em vez de NaN no relatório", () => {
    expect(normalizeOutreachCount("")).toBe(0);
    expect(normalizeOutreachCount("abc")).toBe(0);
    expect(normalizeOutreachCount(null)).toBe(0);
    expect(normalizeOutreachCount(undefined)).toBe(0);
  });

  it("negativo vira zero — não existe abordar menos que ninguém", () => {
    expect(normalizeOutreachCount(-5)).toBe(0);
  });

  it("corta a parte decimal: pessoa não é meia", () => {
    expect(normalizeOutreachCount(12.9)).toBe(12);
  });

  it("limita o absurdo para um dedo preso no teclado não virar número do mês", () => {
    expect(normalizeOutreachCount(999999999)).toBe(100000);
  });
});
