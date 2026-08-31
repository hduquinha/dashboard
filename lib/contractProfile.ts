/**
 * Quadro do CONTRATANTE (item 2 do contrato) preenchido na hora da venda.
 *
 * O contrato da VozUP (`Contrato_Alunos_VozUP_DIGITAL_PREENCHIVEL.pdf`) pede
 * bem mais do que o cadastro do aluno guardava — RG, profissão, empresa,
 * telefone fixo e endereço completo. Enquanto esses dados só apareciam depois,
 * na secretaria, o PDF saía com metade do quadro em branco e o contrato era
 * completado à mão.
 *
 * As regras de obrigatoriedade vivem aqui, sem banco, porque o formulário do
 * vendedor e a rota que grava precisam usar exatamente as mesmas: validação que
 * só existe na tela não existe.
 */
import { isValidCpf, normalizeCpf, requiresGuardian } from "@/lib/academicRules";

/**
 * Responsável legal, para o aluno menor de idade.
 *
 * O contrato de menor não é assinado por ele: até os 16 é absolutamente
 * incapaz e dos 16 aos 18 precisa ser assistido (CC arts. 3º e 4º). Quem se
 * obriga é o responsável, e é o CPF e o e-mail DELE que sustentam a assinatura
 * eletrônica — o código de verificação vai para a caixa dele, não a do aluno.
 */
export interface ContractGuardian {
  fullName: string;
  cpf: string | null;
  email: string | null;
  phone: string | null;
  /** "Mãe", "Pai", "Avó"… vai no texto do contrato. */
  relationship: string | null;
  birthDate: string | null;
}

export const EMPTY_CONTRACT_GUARDIAN: ContractGuardian = {
  fullName: "",
  cpf: null,
  email: null,
  phone: null,
  relationship: null,
  birthDate: null,
};

export interface ContractStudentProfile {
  fullName: string;
  cpf: string | null;
  rg: string | null;
  birthDate: string | null;
  profession: string | null;
  company: string | null;
  /** Telefone fixo — o contrato tem os dois campos. */
  landline: string | null;
  /** Celular; é o que o CRM já tem do lead. */
  phone: string | null;
  email: string | null;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  /**
   * Preenchido só quando o aluno é menor. Nulo em maior de idade — e é o que
   * `resolvePeople` lê para decidir que o signatário é o responsável.
   */
  guardian: ContractGuardian | null;
}

/**
 * O aluno deste quadro é menor de idade?
 *
 * Deriva da data de nascimento, e não de uma marcação à parte: marcação
 * separada envelhece sozinha (o aluno faz 18 anos e ninguém desmarca) e
 * permite contrato de menor sem responsável só porque a caixa ficou vazia.
 */
export function profileRequiresGuardian(
  profile: Pick<ContractStudentProfile, "birthDate">,
  reference = new Date()
): boolean {
  return requiresGuardian(profile.birthDate, reference);
}

export const EMPTY_CONTRACT_PROFILE: ContractStudentProfile = {
  fullName: "",
  cpf: null,
  rg: null,
  birthDate: null,
  profession: null,
  company: null,
  landline: null,
  phone: null,
  email: null,
  address: null,
  neighborhood: null,
  city: null,
  state: null,
  zip: null,
  guardian: null,
};

/**
 * O quadro do CONTRATANTE inteiro é obrigatório.
 *
 * A primeira versão pedia só o que identifica quem assina (nome, CPF,
 * nascimento, celular, e-mail) e deixava o resto para a secretaria. O contrato
 * gerado saiu com metade do item 2 em branco, e a operação decidiu (2026-08-19)
 * que **todo campo que existe no PDF tem que ser preenchido na venda** — é o
 * único momento em que o cliente ainda está do outro lado para responder.
 *
 * Revisto em 2026-08-22: obrigatório passou a ser só o que o contrato precisa
 * para valer, e o resto entrou como opcional para não travar a venda.
 *
 * **Continua obrigatório** — nome completo e CPF (identificam quem se obriga),
 * e-mail (é para onde vai o link e o código da assinatura eletrônica; sem ele
 * não há como assinar nem como provar quem assinou), celular (o outro canal de
 * contato e de prova) e o endereço completo com CEP, cidade e UF (domicílio do
 * contratante, que é o que sustenta notificação de cobrança e a eleição de foro).
 *
 * **Deixou de ser obrigatório** — RG (o CPF já identifica de forma única e é o
 * documento usado na assinatura), profissão e empresa (dado cadastral, sem
 * efeito na obrigação), telefone fixo (redundante com o celular) e data de
 * nascimento. Todos continuam no formulário e no PDF quando preenchidos.
 *
 * Consequência a conhecer da data de nascimento: é dela que sai a regra de
 * menor de idade (`requiresGuardian`), e sem data o sistema trata o aluno como
 * maior — quem vende para menor precisa preencher.
 */
export const REQUIRED_CONTRACT_FIELDS = [
  "fullName",
  "cpf",
  "phone",
  "email",
  "address",
  "neighborhood",
  "city",
  "state",
  "zip",
] as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Devolve a primeira pendência do quadro, ou null quando está pronto para
 * virar contrato. Mensagem em texto porque é ela que o vendedor lê.
 */
const FIELD_LABELS: Record<(typeof REQUIRED_CONTRACT_FIELDS)[number], string> = {
  fullName: "o nome completo do aluno",
  cpf: "o CPF",
  phone: "o celular",
  email: "o e-mail",
  address: "o endereço",
  neighborhood: "o bairro",
  city: "a cidade",
  state: "a UF",
  zip: "o CEP",
};

export function validateContractProfile(profile: ContractStudentProfile): string | null {
  const name = profile.fullName?.trim() ?? "";
  if (name.length < 3) return "Escreva o nome completo do aluno.";
  // Nome de contrato é nome civil inteiro: só o primeiro nome não identifica
  // ninguém num documento assinado.
  if (!name.includes(" ")) return "O nome do aluno precisa ser completo (nome e sobrenome).";

  if (!normalizeCpf(profile.cpf)) return "Informe o CPF do aluno.";
  if (!isValidCpf(profile.cpf)) return "CPF inválido — confira os números.";

  // Data de nascimento deixou de ser obrigatória (22/08/2026, decisão da
  // operação): muita venda fecha sem o cliente ter a data à mão, e travar o
  // contrato por ela custava mais do que o campo em branco. Quando preenchida,
  // continua tendo que ser uma data válida.
  if (profile.birthDate && !DATE_PATTERN.test(profile.birthDate)) {
    return "Data de nascimento inválida — use o seletor de data.";
  }

  // O responsável é conferido ANTES do contato do aluno. A ordem importa para a
  // mensagem: sem isto, menor sem responsável nenhum era recusado com "informe
  // o celular do aluno" — verdade formal que aponta para o campo errado e faz
  // a pessoa preencher um telefone que não resolve nada.
  const minor = profileRequiresGuardian(profile);
  if (minor) {
    const guardianProblem = validateContractGuardian(profile);
    if (guardianProblem) return guardianProblem;
  }

  // Aluno menor tem contato próprio dispensado quando o do responsável está
  // completo: quem assina, recebe o link e responde pela dívida é ele, e travar
  // a venda porque uma aluna de 16 anos não tem e-mail próprio seria barrar por
  // um campo que não muda nada no documento.
  const guardianContact = minor && Boolean(profile.guardian?.email?.trim() && profile.guardian?.phone?.trim());

  const phone = profile.phone?.replace(/\D/g, "") ?? "";
  if (!guardianContact && phone.length < 10) return "Informe o celular do aluno com DDD.";

  const email = profile.email?.trim() ?? "";
  if (!guardianContact && !EMAIL_PATTERN.test(email)) {
    return "Informe um e-mail válido — é para lá que vai o contrato.";
  }
  if (email && !EMAIL_PATTERN.test(email)) return "E-mail do aluno inválido — confira o endereço.";

  if ((profile.state?.trim().length ?? 0) !== 2) return "Informe a UF com duas letras (ex.: SP).";
  if ((profile.zip?.replace(/\D/g, "").length ?? 0) !== 8) return "Informe o CEP com 8 dígitos.";

  // Os demais são texto livre: basta não estarem vazios. O contrato impresso
  // não aceita lacuna em campo nenhum do quadro.
  for (const field of REQUIRED_CONTRACT_FIELDS) {
    // `phone` e `email` já foram tratados acima, com a exceção do menor.
    if (guardianContact && (field === "phone" || field === "email")) continue;
    const value = profile[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      return `Preencha ${FIELD_LABELS[field]} — o contrato não sai com esse campo em branco.`;
    }
  }

  return null;
}

/**
 * O quadro do responsável, quando o aluno é menor.
 *
 * CPF e e-mail dele são obrigatórios pelo mesmo motivo que os do aluno maior:
 * é o CPF que confere na hora de assinar e é para o e-mail que vai o código de
 * verificação. Responsável sem e-mail é contrato que ninguém consegue assinar
 * eletronicamente — e a descoberta disso hoje acontece na cara do cliente.
 */
export function validateContractGuardian(profile: ContractStudentProfile): string | null {
  if (!profileRequiresGuardian(profile)) return null;

  const guardian = profile.guardian;
  if (!guardian || !guardian.fullName?.trim()) {
    return "Aluno menor de idade: informe o responsável legal, que é quem assina o contrato.";
  }
  const name = guardian.fullName.trim();
  if (!name.includes(" ")) return "O nome do responsável precisa ser completo (nome e sobrenome).";

  if (!normalizeCpf(guardian.cpf)) return "Informe o CPF do responsável legal.";
  if (!isValidCpf(guardian.cpf)) return "CPF do responsável inválido — confira os números.";

  const email = guardian.email?.trim() ?? "";
  if (!EMAIL_PATTERN.test(email)) {
    return "Informe o e-mail do responsável — é para ele que vai o link e o código da assinatura.";
  }

  const phone = guardian.phone?.replace(/\D/g, "") ?? "";
  if (phone.length < 10) return "Informe o celular do responsável com DDD.";

  if (guardian.birthDate && !DATE_PATTERN.test(guardian.birthDate)) {
    return "Data de nascimento do responsável inválida — use o seletor de data.";
  }
  return null;
}

/** Item 3 do contrato: o que descreve o curso vendido. */
export interface ContractCourseInfo {
  /** Texto livre — "48 horas", "6 meses / 72h". */
  hours: string;
  /** Turma/horário combinado. */
  className: string;
}

export const EMPTY_COURSE_INFO: ContractCourseInfo = { hours: "", className: "" };

export function validateCourseInfo(info: ContractCourseInfo): string | null {
  if (!info.hours?.trim()) return "Informe a carga horária total (item 3 do contrato).";
  if (!info.className?.trim()) return "Informe a turma (item 3 do contrato).";
  return null;
}

export function normalizeCourseInfo(raw: Partial<ContractCourseInfo> | null | undefined): ContractCourseInfo {
  const text = (value: unknown, max: number) =>
    typeof value === "string" ? value.trim().slice(0, max) : "";
  return { hours: text(raw?.hours, 80), className: text(raw?.className, 120) };
}

/** UF sempre em duas letras maiúsculas; o resto é texto livre aparado. */
export function normalizeContractProfile(raw: Partial<ContractStudentProfile>): ContractStudentProfile {
  const text = (value: unknown, max = 200): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim().slice(0, max);
    return trimmed.length > 0 ? trimmed : null;
  };

  return {
    fullName: (text(raw.fullName, 200) ?? "").trim(),
    cpf: normalizeCpf(raw.cpf),
    rg: text(raw.rg, 40),
    birthDate: raw.birthDate && DATE_PATTERN.test(raw.birthDate) ? raw.birthDate : null,
    profession: text(raw.profession, 120),
    company: text(raw.company, 120),
    landline: text(raw.landline, 40),
    phone: text(raw.phone, 40),
    email: text(raw.email, 160),
    address: text(raw.address, 240),
    neighborhood: text(raw.neighborhood, 120),
    city: text(raw.city, 120),
    state: text(raw.state, 2)?.toUpperCase() ?? null,
    zip: text(raw.zip, 12),
    guardian: normalizeContractGuardian(raw.guardian),
  };
}

/** Responsável sem nome nenhum é "não tem responsável", não um quadro vazio. */
export function normalizeContractGuardian(
  raw: Partial<ContractGuardian> | null | undefined
): ContractGuardian | null {
  if (!raw) return null;
  const text = (value: unknown, max = 200): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim().slice(0, max);
    return trimmed.length > 0 ? trimmed : null;
  };
  const fullName = (text(raw.fullName, 200) ?? "").trim();
  const cpf = normalizeCpf(raw.cpf);
  if (!fullName && !cpf) return null;
  return {
    fullName,
    cpf,
    email: text(raw.email, 160),
    phone: text(raw.phone, 40),
    relationship: text(raw.relationship, 60),
    birthDate: raw.birthDate && DATE_PATTERN.test(raw.birthDate) ? raw.birthDate : null,
  };
}

/** Uma linha do item 4 do contrato, do jeito que o vendedor divide na venda. */
export interface ContractPlanSplit {
  matricula: number;
  material: number;
  curso: number;
}

export const EMPTY_PLAN_SPLIT: ContractPlanSplit = { matricula: 0, material: 0, curso: 0 };

export function planSplitTotal(split: ContractPlanSplit): number {
  return Math.round((split.matricula + split.material + split.curso) * 100) / 100;
}

/**
 * O que ainda BLOQUEIA o contrato.
 *
 * Até 25/08/2026 a soma das três linhas era obrigada a bater com o valor
 * fechado da matrícula. Isso deixou de ser regra por decisão do usuário: o
 * contrato passou a aceitar um total próprio (ver
 * `describePlanSplitDivergence`). O que continua barrado é valor negativo, que
 * não é uma escolha de negócio — é erro de digitação.
 */
export function validatePlanSplit(split: ContractPlanSplit, amount: number): string | null {
  void amount;
  if (split.matricula < 0 || split.material < 0 || split.curso < 0) {
    return "Os valores do contrato não podem ser negativos.";
  }
  return null;
}

/**
 * Aviso quando o total do contrato difere do valor da matrícula.
 *
 * Divergir é permitido, mas nunca em silêncio: o contrato é o documento legal e
 * a matrícula é quem cobra, calcula comissão e reconhece receita. Se os dois
 * discordam, alguém precisa ter escolhido isso — e continuar vendo.
 *
 * Um centavo de tolerância cobre o arredondamento de quem divide o valor em
 * três. A comparação é em centavos inteiros porque em ponto flutuante 99,99
 * contra 100,00 dá 0,010000000000005 e escaparia de um `> 0.01`.
 */
export function describePlanSplitDivergence(
  split: ContractPlanSplit,
  amount: number
): string | null {
  const totalContrato = Math.round(planSplitTotal(split) * 100);
  const totalMatricula = Math.round(amount * 100);
  if (Math.abs(totalContrato - totalMatricula) <= 1) return null;

  const dinheiro = (centavos: number) =>
    (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    `O contrato soma ${dinheiro(totalContrato)} e a matrícula é de ` +
    `${dinheiro(totalMatricula)}. O contrato vale como documento, mas quem cobra, ` +
    "calcula comissão e reconhece receita é a matrícula."
  );
}
