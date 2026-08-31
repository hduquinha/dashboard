import { generateLessonDates, lessonPlanEndDate, yearsSpanned } from "@/lib/lessonPlan";
import { holidayDaysForYears } from "@/lib/holidays";

describe("generateLessonDates", () => {
  it("gera uma aula por semana no mesmo dia", () => {
    // 2026-03-03 é uma terça-feira.
    const aulas = generateLessonDates({ startDate: "2026-03-03", weekdays: [2], lessonsCount: 4 });
    expect(aulas.map((a) => a.date)).toEqual([
      "2026-03-03",
      "2026-03-10",
      "2026-03-17",
      "2026-03-24",
    ]);
    expect(aulas.map((a) => a.sequence)).toEqual([1, 2, 3, 4]);
  });

  it("começa no próximo dia de aula quando a data inicial não é dia de aula", () => {
    // 2026-03-01 é domingo; a turma é de terça.
    const [primeira] = generateLessonDates({
      startDate: "2026-03-01",
      weekdays: [2],
      lessonsCount: 1,
    });
    expect(primeira.date).toBe("2026-03-03");
  });

  it("pula feriado mantendo o dia da semana", () => {
    // Carnaval de 2026 cai em 17/02 (terça).
    const feriados = holidayDaysForYears([2026]);
    const aulas = generateLessonDates({
      startDate: "2026-02-10",
      weekdays: [2],
      lessonsCount: 3,
      blocked: feriados,
    });
    expect(aulas.map((a) => a.date)).toEqual(["2026-02-10", "2026-02-24", "2026-03-03"]);
    // A aula seguinte carrega o motivo do buraco, para a tela explicar.
    expect(aulas[1].skipped).toEqual(["2026-02-17"]);
  });

  it("duas aulas por semana ficam nos dois dias escolhidos", () => {
    // Segundas e quartas a partir de 02/03/2026 (segunda).
    const aulas = generateLessonDates({ startDate: "2026-03-02", weekdays: [1, 3], lessonsCount: 4 });
    expect(aulas.map((a) => a.date)).toEqual([
      "2026-03-02",
      "2026-03-04",
      "2026-03-09",
      "2026-03-11",
    ]);
  });

  it("atravessa a virada do ano sem perder aula", () => {
    const aulas = generateLessonDates({
      startDate: "2026-12-15",
      weekdays: [2],
      lessonsCount: 4,
      blocked: holidayDaysForYears([2026, 2027]),
    });
    // 22/12 e 29/12 são terças normais; 01/01 é feriado mas não é terça.
    expect(aulas.map((a) => a.date)).toEqual([
      "2026-12-15",
      "2026-12-22",
      "2026-12-29",
      "2027-01-05",
    ]);
  });

  it("devolve lista vazia sem dia da semana ou sem número de aulas", () => {
    expect(generateLessonDates({ startDate: "2026-03-03", weekdays: [], lessonsCount: 4 })).toEqual([]);
    expect(generateLessonDates({ startDate: "2026-03-03", weekdays: [2], lessonsCount: 0 })).toEqual([]);
  });

  it("nunca gera aula em dia bloqueado", () => {
    const feriados = holidayDaysForYears([2026, 2027]);
    const aulas = generateLessonDates({
      startDate: "2026-01-05",
      weekdays: [1],
      lessonsCount: 40,
      blocked: feriados,
    });
    expect(aulas).toHaveLength(40);
    expect(aulas.some((aula) => feriados.has(aula.date))).toBe(false);
  });
});

describe("lessonPlanEndDate", () => {
  it("é a data da última aula", () => {
    const aulas = generateLessonDates({ startDate: "2026-03-03", weekdays: [2], lessonsCount: 3 });
    expect(lessonPlanEndDate(aulas)).toBe("2026-03-17");
  });

  it("é null quando não há aula", () => {
    expect(lessonPlanEndDate([])).toBeNull();
  });
});

describe("yearsSpanned", () => {
  it("cobre a virada de ano do curso", () => {
    expect(yearsSpanned("2026-11-03", 24)).toEqual([2026, 2027]);
  });

  it("um curso curto no meio do ano fica só no ano dele", () => {
    expect(yearsSpanned("2026-03-03", 8)).toEqual([2026]);
  });
});
