import {
  VOZUP_CONTRACT_COMPANY,
  companyAddressLine,
  contractClosing,
  contractForum,
  formatCpf,
  formatDatePtBr,
  formatLongDatePtBr,
  formatMoneyBRL,
  forumStateLabel,
  hashContractSnapshot,
  buildPlanRows,
  planToChargeTerms,
  normalizePlan,
  planTotal,
  renderContractClauses,
  type ContractSnapshot,
} from "@/lib/contractTemplate";
import {
  CONTRACT_STATUS_LABELS,
  contractWhatsAppMessage,
  MAX_OTP_ATTEMPTS,
  MIN_READING_SECONDS,
  evaluateSignAttempt,
  generateOtp,
  hashOtp,
  isCompleteName,
  missingCompanyFields,
  missingContractFields,
  SCANNED_UPLOAD_MAX_BYTES,
  validatePhysicalContractUpload,
} from "@/lib/contractRules";

function snapshot(overrides: Partial<ContractSnapshot> = {}): ContractSnapshot {
  return {
    company: VOZUP_CONTRACT_COMPANY,
    student: {
      name: "Maria Aparecida da Silva Souza",
      rg: "12.345.678-9",
      cpf: "52998224725",
      birthDate: "1990-04-15",
      profession: "Administradora",
      company: "Empresa Exemplo Ltda.",
      phone: "1133334444",
      mobile: "11988887777",
      email: "maria@exemplo.com",
      address: "Rua Exemplo, 123, apto 45",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
      zip: "01000-000",
    },
    signer: {
      name: "Maria Aparecida da Silva Souza",
      cpf: "52998224725",
      email: "maria@exemplo.com",
      phone: "11988887777",
      role: "aluno",
    },
    course: { name: "Oratória e Liderança Emocional", hours: "48 horas", className: "Turma Agosto/2026" },
    plan: normalizePlan([
      {
        key: "matricula",
        label: "MATRÍCULA",
        amount: 400,
        installments: 1,
        installmentAmount: 400,
        paymentMethod: "Pix",
        firstDueDate: "2026-09-05",
      },
      {
        key: "curso",
        label: "CURSO",
        amount: 3600,
        installments: 6,
        installmentAmount: 600,
        paymentMethod: "Cartão de crédito",
        firstDueDate: "2026-09-10",
      },
    ]),
    notes: null,
    saleDate: "2026-08-18",
    generatedAt: "2026-08-18T12:00:00.000Z",
    ...overrides,
  };
}

describe("formatação", () => {
  it("escreve dinheiro no formato brasileiro", () => {
    expect(formatMoneyBRL(3600)).toBe("R$ 3.600,00");
    expect(formatMoneyBRL(1234567.5)).toBe("R$ 1.234.567,50");
    expect(formatMoneyBRL(0)).toBe("R$ 0,00");
  });

  it("data inválida vira vazio no quadro e lacuna no fecho", () => {
    expect(formatDatePtBr("2026-08-18")).toBe("18/08/2026");
    expect(formatDatePtBr(null)).toBe("");
    expect(formatLongDatePtBr("2026-08-18")).toBe("18 de agosto de 2026");
    expect(formatLongDatePtBr("qualquer coisa")).toContain("___");
  });

  it("CPF só é mascarado quando tem 11 dígitos", () => {
    expect(formatCpf("52998224725")).toBe("529.982.247-25");
    expect(formatCpf("123")).toBe("123");
    expect(formatCpf(null)).toBe("");
  });

  it("endereço da escola sai numa linha, pulando o que falta", () => {
    expect(companyAddressLine(VOZUP_CONTRACT_COMPANY)).toBe("Rua Azevedo Soares, 1334, Tatuapé, São Paulo - SP");
    expect(companyAddressLine({ ...VOZUP_CONTRACT_COMPANY, neighborhood: "" })).toBe(
      "Rua Azevedo Soares, 1334, São Paulo - SP"
    );
  });

  it("foro cai para a cidade quando a comarca não é informada", () => {
    expect(contractForum({ ...VOZUP_CONTRACT_COMPANY, forum: "" })).toBe("São Paulo");
    expect(contractForum({ ...VOZUP_CONTRACT_COMPANY, forum: "Tatuapé" })).toBe("Tatuapé");
  });

  it("fecho do contrato leva cidade e data por extenso", () => {
    expect(contractClosing(snapshot())).toBe("São Paulo, 18 de agosto de 2026");
  });
});

describe("plano financeiro", () => {
  it("sempre tem as quatro linhas do contrato em papel, na ordem", () => {
    const plan = normalizePlan([
      {
        key: "curso",
        label: "CURSO",
        amount: 100,
        installments: 1,
        installmentAmount: 100,
        paymentMethod: null,
        firstDueDate: null,
      },
    ]);
    expect(plan.map((row) => row.key)).toEqual(["matricula", "material", "entrada", "curso"]);
    expect(plan[0].amount).toBe(0);
    // A entrada zerada também fica: o quadro responde "não tem entrada" em vez
    // de omitir a linha.
    expect(plan[2].amount).toBe(0);
  });

  it("não imprime linha de entrada quando a venda não tem entrada", () => {
    const rows = buildPlanRows({
      rateio: { matricula: 500, material: 300, curso: 7700 },
      downPayment: 0,
      installments: 11,
      paymentMethod: "Boleto",
      entryMethod: "Boleto",
      firstDueDate: "2026-08-24",
      atDate: "2026-08-24",
    });
    expect(rows.map((row) => row.key)).toEqual(["matricula", "material", "curso"]);
    const curso = rows[2];
    expect(curso.installments).toBe(11);
    expect(curso.installmentAmount).toBe(700);
  });

  it("entrada vira linha própria e abate do curso — o valor da parcela é o do boleto", () => {
    const rows = buildPlanRows({
      rateio: { matricula: 500, material: 300, curso: 7700 },
      downPayment: 1500,
      installments: 10,
      paymentMethod: "Boleto",
      entryMethod: "Pix",
      firstDueDate: "2026-09-05",
      atDate: "2026-08-24",
    });
    expect(rows.map((row) => row.key)).toEqual(["matricula", "material", "entrada", "curso"]);
    // A entrada de 1.500 já paga matrícula (500) e material (300); sobram 700.
    expect(rows[2].amount).toBe(700);
    expect(rows[2].paymentMethod).toBe("Pix");
    expect(rows[2].firstDueDate).toBe("2026-08-24");
    expect(rows[3].amount).toBe(7000);
    expect(rows[3].installments).toBe(10);
    expect(rows[3].installmentAmount).toBe(700);
    expect(rows[3].firstDueDate).toBe("2026-09-05");
    // Nada de dinheiro se perde nem se duplica no caminho.
    expect(planTotal(rows)).toBe(8500);
  });

  it("entrada menor que matrícula + material não vira linha nem abate do curso", () => {
    const rows = buildPlanRows({
      rateio: { matricula: 500, material: 300, curso: 7700 },
      downPayment: 600,
      installments: 10,
      paymentMethod: "Boleto",
      entryMethod: "Pix",
      firstDueDate: "2026-09-05",
      atDate: "2026-08-24",
    });
    expect(rows.map((row) => row.key)).toEqual(["matricula", "material", "curso"]);
    expect(planTotal(rows)).toBe(8500);
  });

  it("venda sem rateio: tudo em curso, com a entrada separada", () => {
    const rows = buildPlanRows({
      rateio: { matricula: 0, material: 0, curso: 8500 },
      downPayment: 1500,
      installments: 10,
      paymentMethod: "Boleto",
      entryMethod: "Pix",
      firstDueDate: "2026-09-05",
      atDate: "2026-08-24",
    });
    expect(rows.map((row) => row.key)).toEqual(["entrada", "curso"]);
    expect(rows[0].amount).toBe(1500);
    expect(rows[1].amount).toBe(7000);
    expect(rows[1].installmentAmount).toBe(700);
    expect(planTotal(rows)).toBe(8500);
  });

  it("linha de entrada sobrevive à ordem do quadro em papel", () => {
    const plan = normalizePlan(
      buildPlanRows({
        rateio: { matricula: 0, material: 0, curso: 8500 },
        downPayment: 1500,
        installments: 10,
        paymentMethod: "Boleto",
        entryMethod: "Pix",
        firstDueDate: "2026-09-05",
        atDate: "2026-08-24",
      })
    );
    expect(plan.map((row) => row.key)).toEqual(["matricula", "material", "entrada", "curso"]);
    expect(planTotal(plan)).toBe(8500);
  });

  it("total é a soma das linhas", () => {
    expect(planTotal(snapshot().plan)).toBe(4000);
    expect(planTotal([])).toBe(0);
  });
});

describe("texto do contrato (modelo V4 da escola)", () => {
  it("tem as oito cláusulas do papel, na ordem", () => {
    const titles = renderContractClauses(snapshot()).map((block) => block.title);
    expect(titles).toEqual([
      "1. OBJETO DO CONTRATO",
      "2. AULAS",
      "3. PAGAMENTO",
      "4. MATERIAL DIDÁTICO",
      "5. VIGÊNCIA, RESCISÃO E MULTA",
      "6. CONDIÇÕES GERAIS",
      "7. USO DE IMAGEM",
      "8. FORO",
    ]);
  });

  it("a cláusula de assinatura eletrônica só existe na via digital", () => {
    expect(renderContractClauses(snapshot(), { digitalSignature: true }).map((b) => b.title)).toContain(
      "9. ASSINATURA ELETRÔNICA"
    );
    expect(renderContractClauses(snapshot(), { digitalSignature: false }).map((b) => b.title)).not.toContain(
      "9. ASSINATURA ELETRÔNICA"
    );
  });

  it("mantém as condições que valem dinheiro exatamente como no contrato de hoje", () => {
    const text = JSON.stringify(renderContractClauses(snapshot()));
    expect(text).toContain("90 (noventa) dias");
    expect(text).toContain("2% (dois por cento) de multa contratual, 1% (um por cento) ao mês");
    expect(text).toContain("INPC");
    expect(text).toContain("12 (doze) meses");
    expect(text).toContain("72 (setenta e duas) horas");
    expect(text).toContain("20% (vinte por cento)");
    expect(text).toContain("100% (cem por cento) da carga horária");
  });

  it("a cláusula de foro escreve o nome do estado, não a sigla", () => {
    expect(forumStateLabel("SP")).toBe("Estado de São Paulo");
    expect(forumStateLabel("mg")).toBe("Estado de Minas Gerais");
    expect(forumStateLabel("DF")).toBe("Distrito Federal");
    expect(JSON.stringify(renderContractClauses(snapshot()))).toContain("foro de São Paulo, Estado de São Paulo");
  });

  it("endereço da prestação e foro vêm do cadastro da escola, não estão fixos no texto", () => {
    const custom = snapshot({
      company: { ...VOZUP_CONTRACT_COMPANY, address: "Av. Nova, 900", neighborhood: "Moema", forum: "Santo Amaro" },
    });
    const text = JSON.stringify(renderContractClauses(custom));
    expect(text).toContain("Av. Nova, 900, Moema, São Paulo - SP");
    expect(text).toContain("foro de Santo Amaro");
  });
});

describe("hash do conteúdo", () => {
  it("é estável para o mesmo contrato e muda quando o valor muda", () => {
    expect(hashContractSnapshot(snapshot())).toBe(hashContractSnapshot(snapshot()));
    const other = snapshot();
    other.plan[2].amount = 3601;
    expect(hashContractSnapshot(other)).not.toBe(hashContractSnapshot(snapshot()));
  });

  it("muda quando muda o aluno, mesmo com os mesmos valores", () => {
    const other = snapshot();
    other.student = { ...other.student, name: "Outra Pessoa Qualquer" };
    expect(hashContractSnapshot(other)).not.toBe(hashContractSnapshot(snapshot()));
  });
});

describe("o que falta preencher", () => {
  it("contrato completo não tem pendência", () => {
    expect(missingContractFields(snapshot())).toEqual([]);
  });

  it("cobra CPF, curso e plano — e nomeia o responsável quando é ele quem assina", () => {
    const semCpf = snapshot();
    semCpf.signer = { ...semCpf.signer, cpf: null };
    expect(missingContractFields(semCpf)).toContain("CPF do aluno");

    const menor = snapshot();
    menor.signer = { name: "João Souza", cpf: null, email: null, phone: null, role: "responsavel" };
    expect(missingContractFields(menor)).toContain("CPF do responsável");

    const semCurso = snapshot({ course: { name: "", hours: null, className: null } });
    expect(missingContractFields(semCurso)).toContain("curso");

    const semPlano = snapshot({ plan: normalizePlan([]) });
    expect(missingContractFields(semPlano)).toContain("plano financeiro");
  });

  it("recusa contrato de menor de idade que assinaria sozinho", () => {
    // Data de nascimento relativa: um ano fixo faria o teste passar a valer o
    // contrário sozinho quando o aluno "fizesse 18" com a passagem do tempo.
    const dezesseisAnos = new Date();
    dezesseisAnos.setFullYear(dezesseisAnos.getFullYear() - 16);
    const nascimento = dezesseisAnos.toISOString().slice(0, 10);

    const menorSozinho = snapshot();
    menorSozinho.student = { ...menorSozinho.student, birthDate: nascimento };
    expect(missingContractFields(menorSozinho).join(" ")).toContain("responsável legal");

    // Com o responsável no lugar do signatário, o contrato volta a fechar.
    const comResponsavel = snapshot();
    comResponsavel.student = { ...comResponsavel.student, birthDate: nascimento };
    comResponsavel.signer = {
      name: "Maria Alves da Silva",
      cpf: "06359104890",
      email: "maria@exemplo.com",
      phone: "11988887777",
      role: "responsavel",
    };
    expect(missingContractFields(comResponsavel)).toEqual([]);
  });

  it("maior de idade não passa a exigir responsável", () => {
    expect(missingContractFields(snapshot()).join(" ")).not.toContain("responsável legal");
  });

  it("dado que falta na escola aparece como pendência do contrato", () => {
    const semCnpj = snapshot({ company: { ...VOZUP_CONTRACT_COMPANY, cnpj: "" } });
    expect(missingContractFields(semCnpj)).toContain("CNPJ da escola");
  });

  it("os padrões da VozUP já vêm completos — ninguém precisa redigitar CNPJ", () => {
    expect(missingCompanyFields(VOZUP_CONTRACT_COMPANY)).toEqual([]);
  });
});

describe("regras de assinatura eletrônica", () => {
  // Agora: 10 minutos depois da abertura do link, então o tempo mínimo de
  // leitura já passou em tudo que não sobrescrever `openedAt`.
  const AGORA = new Date("2026-08-21T14:10:00.000Z");
  const pendente = {
    status: "pendente" as const,
    expiresAt: "2999-01-01T00:00:00.000Z",
    signerCpf: "52998224725",
    documentReady: true,
    openedAt: "2026-08-21T14:00:00.000Z",
    // Código pedido às 14:00, válido até 14:15.
    otp: {
      hash: hashOtp("123456"),
      expiresAt: "2026-08-21T14:15:00.000Z",
      attempts: 0,
      verifiedAt: null,
    },
  };
  const input = {
    name: "Maria Aparecida da Silva Souza",
    cpf: "529.982.247-25",
    accepted: true,
    reachedEnd: true,
    otpCode: "123456",
  };

  it("aceita quando tudo confere e marca o CPF como conferido", () => {
    expect(evaluateSignAttempt(pendente, input, AGORA)).toEqual({
      ok: true,
      name: "Maria Aparecida da Silva Souza",
      cpf: "52998224725",
      cpfVerified: true,
      readingSeconds: 600,
      otpVerified: true,
    });
  });

  it("sem CPF no cadastro, assina com o CPF declarado — e a evidência diz isso", () => {
    expect(evaluateSignAttempt({ ...pendente, signerCpf: null }, input, AGORA)).toMatchObject({
      ok: true,
      cpfVerified: false,
    });
  });

  it("recusa CPF de outra pessoa e CPF inválido", () => {
    expect(evaluateSignAttempt(pendente, { ...input, cpf: "111.444.777-35" }, AGORA)).toMatchObject({
      reason: "cpf_divergente",
    });
    expect(evaluateSignAttempt(pendente, { ...input, cpf: "111.111.111-11" }, AGORA)).toMatchObject({
      reason: "cpf_invalido",
    });
  });

  it("exige nome completo e aceite explícito", () => {
    expect(evaluateSignAttempt(pendente, { ...input, name: "Maria" }, AGORA)).toMatchObject({ reason: "nome_incompleto" });
    expect(evaluateSignAttempt(pendente, { ...input, accepted: false }, AGORA)).toMatchObject({ reason: "aceite_ausente" });
  });

  it("assinado, cancelado, vencido ou incompleto não assina", () => {
    expect(evaluateSignAttempt({ ...pendente, status: "assinado" }, input, AGORA)).toMatchObject({ reason: "ja_assinado" });
    expect(evaluateSignAttempt({ ...pendente, status: "cancelado" }, input, AGORA)).toMatchObject({ reason: "cancelado" });
    expect(evaluateSignAttempt({ ...pendente, expiresAt: "2020-01-01T00:00:00.000Z" }, input, AGORA)).toMatchObject({
      reason: "expirado",
    });
    expect(evaluateSignAttempt({ ...pendente, documentReady: false }, input, AGORA)).toMatchObject({
      reason: "documento_incompleto",
    });
  });

  it("não assina sem ter chegado ao fim do texto", () => {
    expect(evaluateSignAttempt(pendente, { ...input, reachedEnd: false }, AGORA)).toMatchObject({
      reason: "leitura_incompleta",
    });
  });

  it("não assina antes do tempo mínimo de leitura", () => {
    // O caso da vida real: link aberto às 14:44:28, assinado às 14:44:48.
    const vinteSegundosDepois = new Date("2026-08-21T14:00:20.000Z");
    expect(evaluateSignAttempt(pendente, input, vinteSegundosDepois)).toMatchObject({
      reason: "leitura_rapida",
    });
  });

  it("libera exatamente no piso de leitura, não um segundo antes", () => {
    const umSegundoAntes = new Date("2026-08-21T14:01:29.000Z");
    const noPiso = new Date("2026-08-21T14:01:30.000Z");
    expect(evaluateSignAttempt(pendente, input, umSegundoAntes)).toMatchObject({
      reason: "leitura_rapida",
    });
    expect(evaluateSignAttempt(pendente, input, noPiso)).toMatchObject({
      ok: true,
      readingSeconds: MIN_READING_SECONDS,
    });
  });

  it("sem registro de abertura, não há tempo comprovado — e não assina", () => {
    expect(evaluateSignAttempt({ ...pendente, openedAt: null }, input, AGORA)).toMatchObject({
      reason: "leitura_rapida",
    });
  });

  it("quem abriu ontem e voltou hoje não espera de novo", () => {
    expect(
      evaluateSignAttempt({ ...pendente, openedAt: "2026-08-20T09:00:00.000Z" }, input, AGORA)
    ).toMatchObject({ ok: true });
  });

  it("aceite ausente é recusado antes da leitura — o motivo tem que ser o certo", () => {
    // Ordem importa para a mensagem que a pessoa lê: quem não marcou o aceite
    // precisa ouvir isso, não "role até o fim".
    expect(
      evaluateSignAttempt(pendente, { ...input, accepted: false, reachedEnd: false }, AGORA)
    ).toMatchObject({ reason: "aceite_ausente" });
  });

  it("sem ter pedido código, não assina", () => {
    const semCodigo = { ...pendente, otp: { hash: null, expiresAt: null, attempts: 0, verifiedAt: null } };
    expect(evaluateSignAttempt(semCodigo, input, AGORA)).toMatchObject({ reason: "otp_ausente" });
  });

  it("código errado, curto ou vazio não passa", () => {
    expect(evaluateSignAttempt(pendente, { ...input, otpCode: "654321" }, AGORA)).toMatchObject({
      reason: "otp_invalido",
    });
    expect(evaluateSignAttempt(pendente, { ...input, otpCode: "123" }, AGORA)).toMatchObject({
      reason: "otp_ausente",
    });
    expect(evaluateSignAttempt(pendente, { ...input, otpCode: "" }, AGORA)).toMatchObject({
      reason: "otp_ausente",
    });
  });

  it("código vencido não serve, mesmo sendo o certo", () => {
    const vencido = { ...pendente, otp: { ...pendente.otp, expiresAt: "2026-08-21T14:05:00.000Z" } };
    expect(evaluateSignAttempt(vencido, input, AGORA)).toMatchObject({ reason: "otp_expirado" });
  });

  it("depois de 5 erros o código morre e tem que pedir outro", () => {
    const esgotado = { ...pendente, otp: { ...pendente.otp, attempts: MAX_OTP_ATTEMPTS } };
    // Nem com o código CERTO — senão bastaria continuar tentando.
    expect(evaluateSignAttempt(esgotado, input, AGORA)).toMatchObject({ reason: "otp_esgotado" });
  });

  it("código já conferido não é pedido de novo se o CPF estava errado", () => {
    // O caso real: acerta o código, erra o CPF, corrige o CPF. Fazer pedir
    // outro e-mail aqui seria castigar quem digitou errado uma vez.
    const conferido = {
      ...pendente,
      otp: { ...pendente.otp, verifiedAt: "2026-08-21T14:02:00.000Z", expiresAt: "2026-08-21T14:05:00.000Z" },
    };
    expect(evaluateSignAttempt(conferido, { ...input, otpCode: "" }, AGORA)).toMatchObject({
      ok: true,
      otpVerified: true,
    });
  });

  it("o código não é guardado em claro", () => {
    const hash = hashOtp("123456");
    expect(hash).not.toContain("123456");
    expect(hash).toHaveLength(64);
    expect(hashOtp("123456")).toBe(hash);
    expect(hashOtp("123457")).not.toBe(hash);
  });

  it("gera código de 6 dígitos, com zeros à esquerda quando cair neles", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateOtp()).toMatch(/^\d{6}$/);
    }
  });

  it("nome completo é duas palavras de verdade", () => {
    expect(isCompleteName("Maria Silva")).toBe(true);
    expect(isCompleteName("Maria")).toBe(false);
    expect(isCompleteName("M S")).toBe(false);
  });
});

describe("via assinada em papel", () => {
  const pdf = { name: "contrato.pdf", type: "application/pdf", size: 120000, header: "%PDF-1.7" };

  it("aceita PDF de verdade e foto do celular", () => {
    expect(validatePhysicalContractUpload(pdf)).toBeNull();
    expect(
      validatePhysicalContractUpload({ name: "foto.jpg", type: "image/jpeg", size: 900000, header: "JFIF" })
    ).toBeNull();
  });

  it("recusa arquivo que só finge ser PDF", () => {
    expect(validatePhysicalContractUpload({ ...pdf, header: "MZ" })).toContain("não é um PDF de verdade");
  });

  it("recusa vazio, gigante e tipo não suportado", () => {
    expect(validatePhysicalContractUpload({ ...pdf, size: 0 })).toContain("vazio");
    // Preso à constante: o teto já subiu uma vez (20 → 40 MB) e um número
    // solto aqui teria transformado a mudança de regra em teste vermelho.
    expect(
      validatePhysicalContractUpload({ ...pdf, size: SCANNED_UPLOAD_MAX_BYTES + 1 })
    ).toContain("máximo");
    expect(validatePhysicalContractUpload({ ...pdf, size: SCANNED_UPLOAD_MAX_BYTES })).toBeNull();
    expect(validatePhysicalContractUpload({ ...pdf, type: "application/zip" })).toContain("PDF, JPG, PNG ou WEBP");
  });
});

describe("apoio da tela", () => {
  it("mensagem de WhatsApp leva o link e trata pelo primeiro nome", () => {
    const message = contractWhatsAppMessage({
      signerName: "Maria Aparecida da Silva Souza",
      courseName: "Oratória e Liderança Emocional",
      link: "https://dashboard.escolavozup.com/contrato/abc",
      companyName: "Escola VozUP",
    });
    expect(message).toContain("Oi, Maria!");
    expect(message).toContain("https://dashboard.escolavozup.com/contrato/abc");
  });

  it("rótulos de status cobrem os três estados", () => {
    expect(Object.keys(CONTRACT_STATUS_LABELS)).toEqual(["pendente", "assinado", "cancelado"]);
  });
});

/**
 * O quadro do contrato voltando para a cobrança. Os casos são os mesmos de
 * `buildPlanRows` de propósito: ida e volta têm que fechar, senão corrigir o
 * quadro na tela reescreveria a matrícula com um valor que ninguém combinou.
 */
describe("planToChargeTerms", () => {
  it("ida e volta fecham: o que virou quadro volta como a mesma cobrança", () => {
    const rows = buildPlanRows({
      rateio: { matricula: 500, material: 300, curso: 7700 },
      downPayment: 1500,
      installments: 10,
      paymentMethod: "Boleto Parcelado",
      entryMethod: "PIX",
      firstDueDate: "2026-09-05",
      atDate: "2026-08-24",
    });
    expect(planToChargeTerms(rows)).toEqual({
      totalAmount: 8500,
      downPayment: 1500,
      installments: 10,
      paymentMethod: "Boleto Parcelado",
      entryMethod: "PIX",
      firstDueDate: "2026-09-05",
      atDate: "2026-08-24",
    });
  });

  it("a linha ENTRADA não conta dinheiro duas vezes", () => {
    const rows = buildPlanRows({
      rateio: { matricula: 0, material: 0, curso: 8500 },
      downPayment: 1500,
      installments: 10,
      paymentMethod: "Boleto Parcelado",
      entryMethod: "PIX",
      firstDueDate: "2026-09-05",
      atDate: "2026-08-24",
    });
    const terms = planToChargeTerms(rows);
    expect(terms.totalAmount).toBe(8500);
    expect(terms.downPayment).toBe(1500);
  });

  it("sem entrada, o que é cobrado no ato é matrícula + material", () => {
    const rows = buildPlanRows({
      rateio: { matricula: 500, material: 300, curso: 7700 },
      downPayment: 0,
      installments: 11,
      paymentMethod: "Boleto Parcelado",
      entryMethod: "Boleto Parcelado",
      firstDueDate: "2026-08-24",
      atDate: "2026-08-24",
    });
    const terms = planToChargeTerms(rows);
    expect(terms.totalAmount).toBe(8500);
    expect(terms.downPayment).toBe(800);
    expect(terms.installments).toBe(11);
    expect(terms.atDate).toBe("2026-08-24");
  });

  it("quadro com tudo em curso — o caso da correção de 24x para 48x", () => {
    const terms = planToChargeTerms(
      normalizePlan([
        {
          key: "curso",
          label: "CURSO",
          amount: 9500,
          installments: 48,
          installmentAmount: 197.92,
          paymentMethod: "Carnê",
          firstDueDate: "2026-08-24",
        },
      ])
    );
    expect(terms).toEqual({
      totalAmount: 9500,
      downPayment: 0,
      installments: 48,
      paymentMethod: "Carnê",
      entryMethod: null,
      firstDueDate: "2026-08-24",
      atDate: null,
    });
  });

  it("quadro vazio não vira cobrança: total zero e nunca zero parcelas", () => {
    const terms = planToChargeTerms([]);
    expect(terms.totalAmount).toBe(0);
    expect(terms.installments).toBe(1);
    expect(terms.paymentMethod).toBeNull();
  });
});
