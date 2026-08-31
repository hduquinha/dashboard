import { easterSunday, holidayDaysForYears, holidaysForYear } from "@/lib/holidays";

/**
 * As datas conferidas abaixo saíram do calendário oficial — se alguém mexer no
 * cálculo da Páscoa, é aqui que quebra antes de virar aula marcada em feriado.
 */
describe("easterSunday", () => {
  it.each([
    [2024, "2024-03-31"],
    [2025, "2025-04-20"],
    [2026, "2026-04-05"],
    [2027, "2027-03-28"],
  ])("Páscoa de %s", (year, esperado) => {
    expect(easterSunday(year).toISOString().slice(0, 10)).toBe(esperado);
  });
});

describe("holidaysForYear", () => {
  const dias = (year: number) => new Map(holidaysForYear(year).map((h) => [h.day, h.label]));

  it("traz os móveis de 2026 ancorados na Páscoa", () => {
    const mapa = dias(2026);
    expect(mapa.get("2026-02-16")).toMatch(/Carnaval/);
    expect(mapa.get("2026-02-17")).toMatch(/Carnaval/);
    expect(mapa.get("2026-04-03")).toBe("Sexta-feira Santa");
    expect(mapa.get("2026-06-04")).toBe("Corpus Christi");
  });

  it("traz os fixos nacionais e o aniversário de São Paulo", () => {
    const mapa = dias(2026);
    expect(mapa.get("2026-01-01")).toBe("Confraternização Universal");
    expect(mapa.get("2026-09-07")).toBe("Independência do Brasil");
    expect(mapa.get("2026-11-20")).toBe("Consciência Negra");
    expect(mapa.get("2026-01-25")).toBe("Aniversário de São Paulo");
  });

  it("vem ordenado por data", () => {
    const lista = holidaysForYear(2027).map((h) => h.day);
    expect([...lista].sort()).toEqual(lista);
  });

  it("não repete data no mesmo ano", () => {
    const lista = holidaysForYear(2026).map((h) => h.day);
    expect(new Set(lista).size).toBe(lista.length);
  });
});

describe("holidayDaysForYears", () => {
  it("junta anos num conjunto só", () => {
    const dias = holidayDaysForYears([2026, 2027]);
    expect(dias.has("2026-12-25")).toBe(true);
    expect(dias.has("2027-12-25")).toBe(true);
    expect(dias.has("2026-03-15")).toBe(false);
  });
});
