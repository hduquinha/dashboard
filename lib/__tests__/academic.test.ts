import {
  ALLOCATION_LABELS,
  ageOn,
  allocationState,
  formatCpf,
  isValidCpf,
  normalizeCpf,
  requiresGuardian,
  summarizeRoster,
  findScheduleConflict,
  seatsLeft,
  validateClassDates,
  DEFAULT_ACADEMIC_REGISTRATION_RULES,
  validateStudentRegistration,
  classWeeklyMinutes,
  describeClassPeriod,
  describeSchedule,
  expandClassSessions,
  formatMinutes,
  humanizeClassSearch,
  occupancyRate,
} from "@/lib/academicRules";

describe("CPF", () => {
  it("guarda só dígitos e trata vazio como não informado", () => {
    expect(normalizeCpf("529.982.247-25")).toBe("52998224725");
    expect(normalizeCpf("")).toBeNull();
    expect(normalizeCpf(null)).toBeNull();
  });

  it("valida pelos dígitos verificadores", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("529.982.247-26")).toBe(false);
  });

  it("CPF ausente não é inválido — a secretaria pode cadastrar antes de ter o documento", () => {
    expect(isValidCpf(null)).toBe(true);
    expect(isValidCpf("")).toBe(true);
  });

  it("formata para exibição", () => {
    expect(formatCpf("52998224725")).toBe("529.982.247-25");
  });
});

describe("idade e responsável legal", () => {
  const hoje = new Date("2026-08-12T12:00:00Z");

  it("calcula a idade considerando se o aniversário já passou no ano", () => {
    expect(ageOn("2008-08-11", hoje)).toBe(18);
    expect(ageOn("2008-08-13", hoje)).toBe(17);
  });

  it("menor de idade exige responsável", () => {
    expect(requiresGuardian("2010-01-01", hoje)).toBe(true);
    expect(requiresGuardian("2000-01-01", hoje)).toBe(false);
  });

  it("sem data de nascimento não exige responsável — o cadastro não trava por campo faltando", () => {
    expect(requiresGuardian(null, hoje)).toBe(false);
    expect(requiresGuardian("", hoje)).toBe(false);
  });
});

describe("regras configuráveis de cadastro", () => {
  const base = { fullName: "Aluno Teste", cpf: "52998224725", email: "aluno@example.com" };

  it("exige CPF e e-mail por padrão", () => {
    expect(validateStudentRegistration({ ...base, cpf: null }, DEFAULT_ACADEMIC_REGISTRATION_RULES)).toContain("CPF");
    expect(validateStudentRegistration({ ...base, email: null }, DEFAULT_ACADEMIC_REGISTRATION_RULES)).toContain("e-mail");
  });

  it("permite desligar uma obrigatoriedade sem aceitar CPF inválido", () => {
    expect(
      validateStudentRegistration(
        { ...base, cpf: null },
        { ...DEFAULT_ACADEMIC_REGISTRATION_RULES, studentCpfRequired: false }
      )
    ).toBeNull();
    expect(isValidCpf("123")).toBe(false);
  });

  it("menor exige responsável com CPF e e-mail nas regras padrão", () => {
    const minor = { ...base, birthDate: "2015-01-01" };
    expect(validateStudentRegistration(minor, DEFAULT_ACADEMIC_REGISTRATION_RULES)).toContain("responsável");
    expect(
      validateStudentRegistration(
        { ...minor, guardian: { fullName: "Responsável", cpf: "52998224725", email: null } },
        DEFAULT_ACADEMIC_REGISTRATION_RULES
      )
    ).toContain("e-mail");
  });
});

describe("estado de alocação", () => {
  it("contrato fechado e turma indefinida é 'aguardando alocação', não erro", () => {
    expect(allocationState({ activeClasses: 0, contractsCount: 1 })).toBe("aguardando_alocacao");
    expect(ALLOCATION_LABELS.aguardando_alocacao).toContain("aguardando");
  });

  it("com turma ativa está alocado, mesmo tendo vários contratos", () => {
    expect(allocationState({ activeClasses: 1, contractsCount: 2 })).toBe("alocado");
  });

  it("sem turma e sem contrato é um terceiro estado — não se confunde com o anterior", () => {
    expect(allocationState({ activeClasses: 0, contractsCount: 0 })).toBe("sem_contrato");
  });
});

describe("contagem de alunos por turma", () => {
  const alunos = [
    { contractsCount: 1, classes: [{ classId: 1, className: "Oratória Terça", status: "ativa" }] },
    { contractsCount: 1, classes: [{ classId: 1, className: "Oratória Terça", status: "ativa" }] },
    { contractsCount: 1, classes: [{ classId: 2, className: "Oratória Quinta", status: "ativa" }] },
    // Cancelado numa turma, mas ainda com contrato: aguarda nova alocação.
    { contractsCount: 1, classes: [{ classId: 2, className: "Oratória Quinta", status: "cancelada" }] },
    // Sem contrato não pode aparecer como "matriculado, aguardando alocação".
    { contractsCount: 0, classes: [] },
  ];

  it("não perde nem duplica o aluno sem turma", () => {
    const resumo = summarizeRoster(alunos);
    expect(resumo.classes).toEqual([
      { classId: 1, className: "Oratória Terça", students: 2 },
      { classId: 2, className: "Oratória Quinta", students: 1 },
    ]);
    expect(resumo.awaitingAllocation).toBe(1);
    expect(resumo.withoutContractOrClass).toBe(1);
    // O total fecha com a lista inteira — é essa soma que impede a contagem de mentir.
    expect(
      resumo.classes.reduce((sum, line) => sum + line.students, 0) +
        resumo.awaitingAllocation +
        resumo.withoutContractOrClass
    ).toBe(resumo.total);
  });
});

describe("turma", () => {
  it("vagas restantes é null sem capacidade definida (não é zero)", () => {
    expect(seatsLeft(null, 10)).toBeNull();
    expect(seatsLeft(12, 10)).toBe(2);
    expect(seatsLeft(10, 12)).toBe(0);
  });

  it("turma cíclica não pode ter data de término", () => {
    expect(validateClassDates({ modality: "ciclica", startDate: "2026-08-01", endDate: "2026-12-01" })).toContain(
      "cíclica"
    );
    expect(validateClassDates({ modality: "ciclica", startDate: "2026-08-01", endDate: null })).toBeNull();
  });

  it("turma modular precisa de data de término", () => {
    expect(validateClassDates({ modality: "modular", startDate: "2026-08-01", endDate: null })).toContain(
      "data de término"
    );
  });

  it("recusa término anterior ao início", () => {
    expect(validateClassDates({ modality: "modular", startDate: "2026-08-01", endDate: "2026-07-01" })).toContain(
      "anterior"
    );
  });

  it("acusa horários sobrepostos no mesmo dia", () => {
    expect(
      findScheduleConflict([
        { weekday: 2, startTime: "19:00", endTime: "20:30" },
        { weekday: 2, startTime: "20:00", endTime: "21:00" },
      ])
    ).toContain("sobrepõem");
  });

  it("aceita dois horários no mesmo dia quando não se cruzam", () => {
    expect(
      findScheduleConflict([
        { weekday: 2, startTime: "09:00", endTime: "10:30" },
        { weekday: 2, startTime: "19:00", endTime: "20:30" },
        { weekday: 4, startTime: "19:00", endTime: "20:30" },
      ])
    ).toBeNull();
  });

  it("recusa término antes do início no mesmo horário", () => {
    expect(findScheduleConflict([{ weekday: 1, startTime: "20:00", endTime: "19:00" }])).toContain("depois");
  });
});

describe("carga horária e ocupação da turma", () => {
  const grade = [
    { weekday: 2, startTime: "19:00", endTime: "20:30" },
    { weekday: 4, startTime: "19:00", endTime: "20:30" },
  ];

  it("soma os minutos de todos os horários da grade", () => {
    expect(classWeeklyMinutes(grade)).toBe(180);
    expect(classWeeklyMinutes([])).toBe(0);
  });

  it("ignora horário invertido em vez de subtrair carga", () => {
    expect(classWeeklyMinutes([{ startTime: "20:00", endTime: "19:00" }])).toBe(0);
  });

  it("formata a carga em horas e minutos", () => {
    expect(formatMinutes(180)).toBe("3h");
    expect(formatMinutes(90)).toBe("1h30");
    expect(formatMinutes(45)).toBe("45min");
    expect(formatMinutes(0)).toBe("—");
  });

  it("agrupa dias que dividem o mesmo horário", () => {
    expect(describeSchedule(grade)).toBe("Ter e Qui · 19:00–20:30");
    expect(describeSchedule([])).toBe("Sem grade de horário");
  });

  it("turma sem capacidade não tem ocupação (não é 0%)", () => {
    expect(occupancyRate(null, 10)).toBeNull();
    expect(occupancyRate(10, 5)).toBe(50);
    expect(occupancyRate(10, 10)).toBe(100);
  });

  it("busca ignora acento e caixa", () => {
    expect(humanizeClassSearch(" Oratória ")).toBe("oratoria");
  });
});

describe("projeção de aulas", () => {
  const schedule = [
    { weekday: 2, startTime: "19:00", endTime: "20:30", teacherName: "Marina", roomName: "Sala 1" },
    { weekday: 4, startTime: "19:00", endTime: "20:30", teacherName: null, roomName: null },
  ];

  it("projeta as próximas aulas a partir da grade", () => {
    const sessions = expandClassSessions({
      schedule,
      startDate: null,
      endDate: null,
      calendar: [],
      from: "2026-08-17", // segunda-feira
      limit: 3,
    });
    expect(sessions.map((session) => session.date)).toEqual(["2026-08-18", "2026-08-20", "2026-08-25"]);
    expect(sessions[0].teacherName).toBe("Marina");
    expect(sessions.every((session) => session.status === "aula")).toBe(true);
  });

  it("marca feriado em vez de sumir com a data — a turma precisa ser avisada", () => {
    const sessions = expandClassSessions({
      schedule,
      startDate: null,
      endDate: null,
      calendar: [{ day: "2026-08-20", kind: "feriado", label: "Feriado municipal", scope: "ambos" }],
      from: "2026-08-17",
      limit: 2,
    });
    expect(sessions[1]).toMatchObject({ date: "2026-08-20", status: "feriado", label: "Feriado municipal" });
  });

  it("feriado só financeiro não bloqueia aula", () => {
    const sessions = expandClassSessions({
      schedule,
      startDate: null,
      endDate: null,
      calendar: [{ day: "2026-08-20", kind: "feriado", label: "Vencimento", scope: "financeiro" }],
      from: "2026-08-17",
      limit: 2,
    });
    expect(sessions[1].status).toBe("aula");
  });

  it("não passa da data de término da turma modular", () => {
    const sessions = expandClassSessions({
      schedule,
      startDate: null,
      endDate: "2026-08-19",
      calendar: [],
      from: "2026-08-17",
      limit: 5,
    });
    expect(sessions.map((session) => session.date)).toEqual(["2026-08-18"]);
  });

  it("turma que ainda não começou projeta a partir do início", () => {
    const sessions = expandClassSessions({
      schedule,
      startDate: "2026-09-01",
      endDate: null,
      calendar: [],
      from: "2026-08-17",
      limit: 1,
    });
    expect(sessions[0].date).toBe("2026-09-01");
  });

  it("turma sem grade não projeta nada", () => {
    expect(
      expandClassSessions({ schedule: [], startDate: null, endDate: null, calendar: [], from: "2026-08-17" })
    ).toEqual([]);
  });
});

describe("describeClassPeriod", () => {
  it("mostra o período completo quando a turma tem começo e fim", () => {
    expect(describeClassPeriod("2026-08-26", "2027-02-24")).toBe("26/08/2026 a 24/02/2027");
  });

  it("aceita ISO completo, não só AAAA-MM-DD", () => {
    expect(describeClassPeriod("2026-08-26T00:00:00.000Z", "2027-02-24T00:00:00.000Z")).toBe(
      "26/08/2026 a 24/02/2027"
    );
  });

  it("com só uma das datas, diz qual é", () => {
    expect(describeClassPeriod("2026-08-26", null)).toBe("Início 26/08/2026");
    expect(describeClassPeriod(null, "2027-02-24")).toBe("Até 24/02/2027");
  });

  it("sem data nenhuma devolve null — a linha some do card em vez de virar travessão", () => {
    expect(describeClassPeriod(null, null)).toBeNull();
    expect(describeClassPeriod(undefined, undefined)).toBeNull();
    expect(describeClassPeriod("", "")).toBeNull();
  });
});
