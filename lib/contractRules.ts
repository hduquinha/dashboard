/**
 * Regras do contrato digital que não dependem de banco nem de PDF.
 *
 * Mesma ideia de `lib/academicRules.ts`: o que decide se uma assinatura vale
 * fica separado do que fala com o Postgres, para poder ser testado sem subir
 * nada. A rota pública de assinatura e a tela do CRM chamam as MESMAS funções
 * daqui — se a validação viver só no formulário, ela não existe.
 */

import { createHash, randomInt } from "node:crypto";

import { isValidCpf, normalizeCpf, requiresGuardian } from "@/lib/academicRules";
import { planTotal, type ContractSnapshot } from "@/lib/contractTemplate";

export const CONTRACT_STATUSES = ["pendente", "assinado", "cancelado"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  pendente: "Aguardando assinatura",
  assinado: "Assinado",
  cancelado: "Cancelado",
};

export type ContractSignerRole = "aluno" | "responsavel";

export const SIGNER_ROLE_LABELS: Record<ContractSignerRole, string> = {
  aluno: "O próprio aluno",
  responsavel: "Responsável legal",
};

/** Prazo padrão do link. Contrato parado por mais de um mês é renegociação, não assinatura. */
export const CONTRACT_LINK_DAYS = 30;

export type SignRejectionReason =
  | "cancelado"
  | "ja_assinado"
  | "expirado"
  | "documento_incompleto"
  | "nome_incompleto"
  | "cpf_invalido"
  | "cpf_divergente"
  | "aceite_ausente"
  | "leitura_incompleta"
  | "leitura_rapida"
  | "otp_ausente"
  | "otp_invalido"
  | "otp_expirado"
  | "otp_esgotado"
  | "muitas_tentativas";

export const SIGN_REJECTION_MESSAGES: Record<SignRejectionReason, string> = {
  cancelado: "Este contrato foi cancelado pela escola. Fale com quem te atendeu.",
  ja_assinado: "Este contrato já foi assinado.",
  expirado: "O prazo deste link terminou. Peça um link novo para a escola.",
  documento_incompleto: "O contrato ainda não está pronto para assinatura. Fale com a escola.",
  nome_incompleto: "Escreva seu nome completo, como está no documento.",
  cpf_invalido: "CPF inválido. Confira os números e tente de novo.",
  cpf_divergente: "O CPF informado não é o que está no cadastro deste contrato.",
  aceite_ausente: "É preciso marcar a confirmação de leitura para assinar.",
  leitura_incompleta: "Role a página até o fim do contrato antes de assinar.",
  leitura_rapida:
    "O contrato precisa ficar aberto por pelo menos um minuto e meio antes da assinatura. Termine a leitura e tente de novo.",
  otp_ausente: "Peça o código de verificação e digite o que chegou no seu e-mail.",
  otp_invalido: "Código incorreto. Confira o e-mail e digite os 6 dígitos de novo.",
  otp_expirado: "Esse código expirou. Peça um novo e use dentro de 15 minutos.",
  otp_esgotado:
    "Muitas tentativas com código errado. Peça um código novo para continuar.",
  muitas_tentativas:
    "Muitas tentativas seguidas com dados que não conferem. Espere alguns minutos e tente de novo, ou fale com a escola.",
};

/**
 * Quantas tentativas erradas seguidas antes de travar o link.
 *
 * O CPF é o segundo fator do aceite; sem limite, quem tivesse o link poderia
 * varrer CPFs até acertar o do cadastro. Dez tentativas cobre com folga quem
 * digitou errado e é pouco para quem está tentando adivinhar.
 */
export const MAX_SIGN_FAILURES = 10;
export const SIGN_FAILURE_WINDOW_MINUTES = 15;

/**
 * Via assinada em papel: o que a escola consegue digitalizar.
 *
 * PDF do scanner é o caso ideal, mas foto do celular é o caso real — a folha
 * assinada na recepção costuma virar JPG antes de virar PDF. Recusar a foto
 * empurraria a operação de volta para o arquivo de papel.
 */
export const SCANNED_UPLOAD_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
/**
 * Teto do arquivo digitalizado.
 *
 * Subiu de 20 para 40 MB em 26/08/2026, contra um caso real: a via assinada de
 * um contrato de 4 páginas saiu do scanner com 24,6 MB e não tinha como ser
 * arquivada. Scanner de recepção sai colorido e em 300 dpi por padrão, e pedir
 * para a secretaria reduzir a resolução antes de cada envio é a certeza de que
 * a via vai acabar ficando na gaveta.
 *
 * 40 MB é folgado para esse caso e continua pequeno perto do 3 GB do container
 * (o arquivo passa por memória uma vez, no `arrayBuffer`). Sobe para o
 * `bytea` do contrato, que só é lido no download — nunca na listagem.
 */
export const SCANNED_UPLOAD_MAX_BYTES = 40 * 1024 * 1024;
export const SCANNED_UPLOAD_MIN_BYTES = 100;

/**
 * Validação do arquivo antes de ele virar a via oficial do contrato.
 *
 * Confere o **começo do arquivo**, e não só o `type` que o navegador declara:
 * qualquer arquivo renomeado para .pdf chega aqui anunciado como
 * "application/pdf". Devolve a mensagem de erro, ou null quando está tudo
 * certo.
 */
export function validatePhysicalContractUpload(file: {
  name: string;
  type: string;
  size: number;
  /** Primeiros bytes do arquivo, em ascii. */
  header: string;
}): string | null {
  if (file.size < SCANNED_UPLOAD_MIN_BYTES) return "O arquivo enviado está vazio ou incompleto.";
  if (file.size > SCANNED_UPLOAD_MAX_BYTES) {
    return `O arquivo pode ter no máximo ${Math.round(SCANNED_UPLOAD_MAX_BYTES / 1024 / 1024)} MB.`;
  }

  const type = (file.type || "").toLowerCase();
  if (!SCANNED_UPLOAD_MIME_TYPES.includes(type)) {
    return "Anexe o contrato assinado em PDF, JPG, PNG ou WEBP.";
  }
  if (type === "application/pdf" && !file.header.startsWith("%PDF")) {
    return "Este arquivo não é um PDF de verdade. Gere o PDF de novo no scanner e tente outra vez.";
  }
  return null;
}


/**
 * Tempo mínimo entre a PRIMEIRA abertura do link e o aceite.
 *
 * O contrato tem 4 páginas; 90 segundos é o piso combinado com a escola. Não é
 * capricho de UX: o CDC art. 46 desobriga o consumidor que não teve
 * "oportunidade prévia de conhecer o conteúdo", e um termo de evidências que
 * mostra 20 segundos entre abrir e assinar é prova contra a escola, não a
 * favor. Com o piso, o próprio termo passa a registrar que houve tempo de
 * leitura.
 */
export const MIN_READING_SECONDS = 90;

/** Validade do código enviado por e-mail. Curto o bastante para que um e-mail
 *  antigo não sirva, longo o bastante para quem demora a achar a mensagem. */
export const OTP_TTL_MINUTES = 15;

/** Erros seguidos antes de exigir um código novo — trava força bruta nos
 *  1.000.000 de combinações sem punir quem só errou de digitar. */
export const MAX_OTP_ATTEMPTS = 5;

export const OTP_DIGITS = 6;

export interface SignAttemptContract {
  status: ContractStatus;
  /** ISO. Null = sem prazo. */
  expiresAt: string | null;
  /** CPF do cadastro; null quando a escola não tinha o documento na hora da venda. */
  signerCpf: string | null;
  /** Quadro de resumo ou dados da escola incompletos = contrato com lacuna. */
  documentReady: boolean;
  /** ISO da primeira abertura do link. Base do tempo mínimo de leitura. */
  openedAt: string | null;
  /**
   * Código pendente. `null` em `hash` = nunca foi pedido código para este
   * contrato, e a assinatura fica bloqueada até pedir — o e-mail é o segundo
   * fator, e sem ele a autoria volta a depender só de quem tem o link.
   */
  otp: {
    hash: string | null;
    expiresAt: string | null;
    attempts: number;
    verifiedAt: string | null;
  };
}

export interface SignAttemptInput {
  name: string;
  cpf: string;
  accepted: boolean;
  /** O texto inteiro chegou a ser exibido — declarado pela página. */
  reachedEnd: boolean;
  /** Os 6 dígitos que chegaram por e-mail. */
  otpCode: string;
}

export type SignAttemptResult =
  | {
      ok: true;
      name: string;
      cpf: string;
      cpfVerified: boolean;
      readingSeconds: number;
      /** Consumiu um código válido agora, ou reaproveitou um já conferido. */
      otpVerified: boolean;
    }
  | { ok: false; reason: SignRejectionReason; message: string };

function reject(reason: SignRejectionReason): SignAttemptResult {
  return { ok: false, reason, message: SIGN_REJECTION_MESSAGES[reason] };
}

/** Nome "completo" para efeito de assinatura: pelo menos duas palavras de verdade. */
export function isCompleteName(value: string): boolean {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter((part) => part.replace(/[^\p{L}]/gu, "").length >= 2);
  return parts.length >= 2;
}

export function normalizePersonName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Segundos decorridos desde a abertura do link. Data ausente ou ilegível conta
 * como zero: sem registro de abertura não há tempo de leitura comprovado, e o
 * caminho seguro é barrar — a página registra a abertura no servidor antes de
 * renderizar, então zero aqui significa algo fora do fluxo normal.
 */
/**
 * Confere o código digitado contra o que está guardado.
 *
 * Compara HASH, nunca o código em claro: o banco guarda só o hash, então quem
 * ler a tabela não consegue assinar no lugar de ninguém.
 *
 * Já verificado antes (`verifiedAt`) passa direto: quem confirmou o código e
 * errou o CPF na primeira tentativa não precisa pedir outro e-mail.
 */
export function checkOtp(
  otp: SignAttemptContract["otp"],
  code: string,
  now: Date
): { problem: SignRejectionReason | null; verified: boolean } {
  if (otp.verifiedAt) return { problem: null, verified: true };
  if (!otp.hash) return { problem: "otp_ausente", verified: false };
  if (otp.attempts >= MAX_OTP_ATTEMPTS) return { problem: "otp_esgotado", verified: false };

  const expires = otp.expiresAt ? new Date(otp.expiresAt) : null;
  if (!expires || !Number.isFinite(expires.getTime()) || expires.getTime() <= now.getTime()) {
    return { problem: "otp_expirado", verified: false };
  }

  const typed = (code ?? "").replace(/\D/g, "");
  if (typed.length !== OTP_DIGITS) return { problem: "otp_ausente", verified: false };
  if (hashOtp(typed) !== otp.hash) return { problem: "otp_invalido", verified: false };

  return { problem: null, verified: true };
}

/** Hash do código. Sem salt de propósito: o valor é efêmero, tem 15 minutos de
 *  vida e no máximo 5 tentativas — o que protege aqui é o TTL, não o custo. */
export function hashOtp(code: string): string {
  return createHash("sha256").update(code.trim(), "utf8").digest("hex");
}

/** Código de 6 dígitos com entropia criptográfica — `Math.random` não serve
 *  para nada que autentica alguém. */
export function generateOtp(): string {
  const max = 10 ** OTP_DIGITS;
  return String(randomInt(0, max)).padStart(OTP_DIGITS, "0");
}

function secondsSince(iso: string | null, now: Date): number {
  if (!iso) return 0;
  const opened = new Date(iso);
  if (!Number.isFinite(opened.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - opened.getTime()) / 1000));
}

/**
 * A decisão inteira de "esta assinatura pode ser registrada".
 *
 * O CPF é o segundo fator do aceite: o link vai para o telefone da pessoa e o
 * documento tem que bater com o que a escola já tinha cadastrado. Quando o
 * cadastro não tem CPF (venda registrada sem documento), a assinatura acontece
 * com o CPF **declarado no ato** — e isso fica marcado em `cpfVerified: false`
 * para o termo de evidências não afirmar mais do que aconteceu.
 */
export function evaluateSignAttempt(
  contract: SignAttemptContract,
  input: SignAttemptInput,
  now: Date = new Date()
): SignAttemptResult {
  if (contract.status === "cancelado") return reject("cancelado");
  if (contract.status === "assinado") return reject("ja_assinado");
  if (!contract.documentReady) return reject("documento_incompleto");

  if (contract.expiresAt) {
    const expires = new Date(contract.expiresAt);
    if (Number.isFinite(expires.getTime()) && expires.getTime() < now.getTime()) {
      return reject("expirado");
    }
  }

  if (!input.accepted) return reject("aceite_ausente");

  // Leitura. Duas evidências de naturezas diferentes, e a diferença importa
  // para o valor de cada uma: `reachedEnd` é DECLARADO pela página (como o
  // aceite, vale como declaração do signatário), enquanto o tempo é medido no
  // servidor entre `first_opened_at` e agora — esse não depende de o cliente
  // dizer a verdade, e é o que sustenta o termo de evidências.
  if (!input.reachedEnd) return reject("leitura_incompleta");

  const readingSeconds = secondsSince(contract.openedAt, now);
  if (readingSeconds < MIN_READING_SECONDS) return reject("leitura_rapida");

  // Código por e-mail: o segundo fator de verdade. O link prova posse do link;
  // o CPF está impresso no contrato que a pessoa está lendo, então não é
  // segredo. Só o código prova que quem assinou controlava a caixa de entrada
  // cadastrada — é o que se opõe ao "não fui eu que assinei".
  const otpOutcome = checkOtp(contract.otp, input.otpCode, now);
  if (otpOutcome.problem) return reject(otpOutcome.problem);

  const name = normalizePersonName(input.name ?? "");
  if (!isCompleteName(name)) return reject("nome_incompleto");

  const cpf = normalizeCpf(input.cpf);
  if (!cpf || !isValidCpf(cpf)) return reject("cpf_invalido");

  const registered = normalizeCpf(contract.signerCpf);
  if (registered && registered !== cpf) return reject("cpf_divergente");

  return {
    ok: true,
    name,
    cpf,
    cpfVerified: Boolean(registered),
    readingSeconds,
    otpVerified: otpOutcome.verified,
  };
}

/** Caminho público do link de assinatura. A origem quem monta é quem copia. */
export function contractLinkPath(token: string): string {
  return `/contrato/${token}`;
}

export function contractWhatsAppMessage(input: {
  signerName: string;
  courseName: string;
  link: string;
  companyName: string;
}): string {
  const firstName = normalizePersonName(input.signerName).split(" ")[0] || "Olá";
  return [
    `Oi, ${firstName}! Tudo certo?`,
    "",
    `Segue o contrato de matrícula do treinamento ${input.courseName} para você ler e assinar digitalmente:`,
    input.link,
    "",
    "É rápido: confirme seu CPF, seu nome completo e pronto. Qualquer dúvida antes de assinar, é só chamar aqui.",
    input.companyName ? `— ${input.companyName}` : "",
  ]
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    .join("\n")
    .trim();
}

/** Empresa incompleta gera contrato com lacunas — a tela avisa antes de enviar. */
export function missingCompanyFields(company: {
  name: string;
  cnpj: string;
  address: string;
  city: string;
}): string[] {
  const missing: string[] = [];
  if (!company.name.trim()) missing.push("razão social");
  if (!company.cnpj.trim()) missing.push("CNPJ");
  if (!company.address.trim()) missing.push("endereço");
  if (!company.city.trim()) missing.push("cidade");
  return missing;
}

/**
 * O que ainda falta no quadro de resumo para o contrato poder ser assinado.
 *
 * A régua é o contrato em papel: os campos que a secretaria sempre preencheu à
 * mão antes de entregar para assinar. RG, profissão e empresa ficam de fora
 * porque o papel também era entregue sem eles quando o aluno não trazia — o
 * que trava a assinatura é o que identifica a pessoa, o curso e o preço.
 */
export function missingContractFields(snapshot: ContractSnapshot): string[] {
  const missing: string[] = [];
  if (!snapshot.student.name.trim()) missing.push("nome do aluno");

  // Menor de idade não assina o próprio contrato: até os 16 é absolutamente
  // incapaz, dos 16 aos 18 precisa ser assistido (CC arts. 3º e 4º). Sem esta
  // checagem o contrato saía com o MENOR como signatário — o `resolvePeople`
  // só troca para o responsável quando existe um cadastrado, e caía de volta no
  // aluno quando não existia. Documento assinado assim é anulável, e o defeito
  // só apareceria no dia em que a escola precisasse dele.
  if (requiresGuardian(snapshot.student.birthDate) && snapshot.signer.role !== "responsavel") {
    missing.push("responsável legal (o aluno é menor de idade e não pode assinar sozinho)");
  }

  if (!normalizeCpf(snapshot.signer.cpf)) {
    missing.push(snapshot.signer.role === "responsavel" ? "CPF do responsável" : "CPF do aluno");
  }
  if (!snapshot.course.name.trim()) missing.push("curso");
  if (planTotal(snapshot.plan) <= 0) missing.push("plano financeiro");
  missing.push(...missingCompanyFields(snapshot.company).map((field) => `${field} da escola`));
  return missing;
}
