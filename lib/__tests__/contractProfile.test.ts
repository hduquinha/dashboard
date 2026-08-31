import {
  EMPTY_CONTRACT_PROFILE,
  validateCourseInfo,
  normalizeContractProfile,
  planSplitTotal,
  validateContractProfile,
  describePlanSplitDivergence,
  validatePlanSplit,
} from "@/lib/contractProfile";

/** Quadro completo — desde 08/2026 o contrato não aceita lacuna nenhuma. */
const base = {
  ...EMPTY_CONTRACT_PROFILE,
  fullName: "Maria de Souza",
  // CPF válido de teste (dígitos verificadores conferem).
  cpf: "111.444.777-35",
  rg: "12.345.678-9",
  birthDate: "1990-05-10",
  profession: "Professora",
  company: "Escola Municipal",
  landline: "1133334444",
  phone: "11987654321",
  email: "maria@exemplo.com",
  address: "Rua Azevedo Soares, 1334",
  neighborhood: "Tatuapé",
  city: "São Paulo",
  state: "SP",
  zip: "03322-001",
};

/** Nascimento relativo: ano fixo faria o teste mudar de sentido sozinho. */
function anosAtras(anos: number): string {
  const data = new Date();
  data.setFullYear(data.getFullYear() - anos);
  return data.toISOString().slice(0, 10);
}

describe("aluno menor de idade", () => {
  const menor = { ...base, birthDate: anosAtras(16) };
  const responsavel = {
    fullName: "Maria Alves da Silva",
    cpf: "063.591.048-90",
    email: "maria.responsavel@exemplo.com",
    phone: "11988887777",
    relationship: "Mãe",
    birthDate: null,
  };

  it("exige responsável legal", () => {
    expect(validateContractProfile(menor)).toMatch(/responsável legal/i);
  });

  it("aceita com o responsável completo", () => {
    expect(validateContractProfile({ ...menor, guardian: responsavel })).toBeNull();
  });

  it("cobra CPF e e-mail do responsável — são eles que sustentam a assinatura", () => {
    expect(validateContractProfile({ ...menor, guardian: { ...responsavel, cpf: null } })).toMatch(
      /CPF do responsável/i
    );
    expect(
      validateContractProfile({ ...menor, guardian: { ...responsavel, cpf: "111.111.111-11" } })
    ).toMatch(/inválido/i);
    expect(validateContractProfile({ ...menor, guardian: { ...responsavel, email: null } })).toMatch(
      /e-mail do responsável/i
    );
  });

  it("dispensa contato próprio do menor quando o do responsável está completo", () => {
    // Aluna de 16 anos sem e-mail nem celular próprios é o caso comum, e o link
    // da assinatura vai para o responsável de qualquer forma.
    const semContato = { ...menor, email: null, phone: null, guardian: responsavel };
    expect(validateContractProfile(semContato)).toBeNull();
    // Endereço continua obrigatório: ele é impresso no quadro do contrato.
    expect(validateContractProfile({ ...semContato, zip: null })).toMatch(/CEP/i);
  });

  it("não pede responsável para maior de idade", () => {
    expect(validateContractProfile({ ...base, birthDate: anosAtras(30) })).toBeNull();
  });
});

describe("validateContractProfile", () => {
  it("aceita o quadro mínimo do contrato", () => {
    expect(validateContractProfile(base)).toBeNull();
  });

  it("recusa nome sem sobrenome — contrato não se assina com apelido", () => {
    expect(validateContractProfile({ ...base, fullName: "Maria" })).toMatch(/completo/i);
  });

  it("recusa CPF com dígito errado", () => {
    expect(validateContractProfile({ ...base, cpf: "111.444.777-00" })).toMatch(/CPF/i);
  });

  // A data deixou de ser obrigatória em 22/08/2026: venda fecha sem ela e o
  // contrato sai com o campo vazio. O que continua valendo é o formato.
  it("aceita venda sem data de nascimento", () => {
    expect(validateContractProfile({ ...base, birthDate: null })).toBeNull();
  });

  it("recusa data de nascimento em formato inválido", () => {
    expect(validateContractProfile({ ...base, birthDate: "12/04/1985" })).toMatch(/nascimento/i);
  });

  it("cobra celular com DDD", () => {
    expect(validateContractProfile({ ...base, phone: "98765" })).toMatch(/celular/i);
  });

  it("cobra e-mail válido — é para onde vai o contrato", () => {
    expect(validateContractProfile({ ...base, email: "maria@" })).toMatch(/e-mail/i);
  });

  // Endereço é o domicílio do contratante: sustenta notificação de cobrança e
  // a eleição de foro, então continua cobrado inteiro.
  it.each([
    ["address", /endereço/i],
    ["neighborhood", /bairro/i],
    ["city", /cidade/i],
  ])("cobra %s — o contrato não sai com lacuna", (field, mensagem) => {
    expect(validateContractProfile({ ...base, [field]: null })).toMatch(mensagem);
  });

  // Revisão de 22/08/2026: o que não muda a obrigação deixou de travar a venda.
  it.each([["rg"], ["profession"], ["company"], ["landline"]])(
    "aceita venda sem %s",
    (field) => {
      expect(validateContractProfile({ ...base, [field]: null })).toBeNull();
    }
  );

  it("cobra UF com duas letras e CEP com 8 dígitos", () => {
    expect(validateContractProfile({ ...base, state: "São Paulo" })).toMatch(/UF/i);
    expect(validateContractProfile({ ...base, zip: "033" })).toMatch(/CEP/i);
  });
});

describe("normalizeContractProfile", () => {
  it("limpa o CPF e sobe a UF", () => {
    const profile = normalizeContractProfile({ ...base, state: "sp" });
    expect(profile.cpf).toBe("11144477735");
    expect(profile.state).toBe("SP");
  });

  it("campo em branco vira null, não string vazia", () => {
    expect(normalizeContractProfile({ ...base, company: "   " }).company).toBeNull();
  });
});

describe("validatePlanSplit", () => {
  it("aceita quando a soma bate com o valor fechado", () => {
    expect(validatePlanSplit({ matricula: 500, material: 800, curso: 7200 }, 8500)).toBeNull();
  });

  // Até 25/08/2026 isto era erro. Passou a ser permitido por decisão do
  // usuário: o contrato pode ter total próprio, e a divergência vira aviso
  // (describePlanSplitDivergence), não bloqueio.
  it("aceita soma diferente do valor fechado — o contrato pode ter total próprio", () => {
    expect(validatePlanSplit({ matricula: 500, material: 800, curso: 100 }, 8500)).toBeNull();
  });

  it("tolera um centavo de arredondamento", () => {
    const split = { matricula: 33.33, material: 33.33, curso: 33.33 };
    expect(planSplitTotal(split)).toBe(99.99);
    expect(validatePlanSplit(split, 100)).toBeNull();
  });

  it("recusa valor negativo", () => {
    expect(validatePlanSplit({ matricula: -1, material: 0, curso: 8501 }, 8500)).toMatch(/negativ/i);
  });
});


describe("validateCourseInfo", () => {
  it("aceita carga horária e turma preenchidas", () => {
    expect(validateCourseInfo({ hours: "72 horas", className: "Terças 19h" })).toBeNull();
  });

  it("cobra a carga horária (item 3 do contrato)", () => {
    expect(validateCourseInfo({ hours: "", className: "Terças 19h" })).toMatch(/carga/i);
  });

  it("cobra a turma", () => {
    expect(validateCourseInfo({ hours: "72 horas", className: "  " })).toMatch(/turma/i);
  });
});

describe("describePlanSplitDivergence", () => {
  it("cala quando o contrato bate com a matrícula", () => {
    expect(describePlanSplitDivergence({ matricula: 500, material: 800, curso: 7200 }, 8500)).toBeNull();
  });

  it("tolera um centavo de arredondamento", () => {
    expect(describePlanSplitDivergence({ matricula: 33.33, material: 33.33, curso: 33.33 }, 100)).toBeNull();
  });

  it("avisa com os dois valores quando o contrato vale menos que a matrícula", () => {
    const aviso = describePlanSplitDivergence({ matricula: 500, material: 0, curso: 900 }, 8500);
    expect(aviso).toContain("1.400,00");
    expect(aviso).toContain("8.500,00");
  });

  it("avisa também quando o contrato vale mais", () => {
    expect(describePlanSplitDivergence({ matricula: 0, material: 0, curso: 9000 }, 8500)).toContain("9.000,00");
  });
});
