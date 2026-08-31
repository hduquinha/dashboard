/**
 * O contrato de matrícula da VozUP: quadro de resumo + cláusulas.
 *
 * O texto das cláusulas é **o contrato real da escola** (arquivo
 * "Contrato_Alunos_VozUP_CORRIGIDO_V4"), transcrito palavra por palavra. Não é
 * texto gerado: mudar qualquer frase daqui muda o que o aluno assina, então
 * alteração aqui é decisão da escola, não de quem mexe no código.
 *
 * Só existem duas diferenças em relação ao PDF de origem, ambas deliberadas:
 * 1. endereço da prestação (1.4) e foro (8.1) saem do cadastro da empresa em
 *    vez de estarem escritos à mão, para não divergirem quando a escola mudar
 *    de endereço;
 * 2. a cláusula 9 (assinatura eletrônica) **só entra na via digital** — a via
 *    impressa é assinada à caneta e não precisa dela.
 *
 * Este arquivo é puro de propósito: nada de banco, nada de pdfkit. É ele que os
 * testes cobrem.
 */

import { createHash } from "node:crypto";

export interface ContractCompany {
  /** Como a escola aparece no item 1 do quadro. */
  name: string;
  /** Razão social usada na linha de assinatura da CONTRATADA. */
  legalName: string;
  cnpj: string;
  address: string;
  neighborhood: string;
  city: string;
  state: string;
  zip: string;
  /** Comarca do foro; vazio cai para a cidade. */
  forum: string;
  email: string;
  phone: string;
  website: string;
  instagram: string;
  /** Quem assina pela escola no fecho do contrato (ex.: o CEO). */
  representativeName: string;
  /** Cargo impresso sob o nome — o do contrato social é o mais seguro. */
  representativeRole: string;
  /**
   * Assinatura do representante, como data URI (`data:image/png;base64,...`).
   *
   * Fica no banco, e não em `public/`, porque trocar quem assina pela escola
   * não pode depender de rebuild. Vazio = a linha da CONTRATADA sai em branco,
   * como era antes.
   */
  signatureImage: string;
}

/** Item 2 do quadro — os dados que a escola preenchia à mão no papel. */
export interface ContractStudent {
  name: string;
  rg: string | null;
  cpf: string | null;
  birthDate: string | null;
  profession: string | null;
  company: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

/** Quem assina. Igual ao aluno, exceto quando ele é menor de idade. */
export interface ContractSigner {
  name: string;
  cpf: string | null;
  email: string | null;
  phone: string | null;
  role: "aluno" | "responsavel";
}

/** Item 3 do quadro. */
export interface ContractCourse {
  name: string;
  /** Texto livre: "48 horas", "6 meses / 72h". */
  hours: string | null;
  className: string | null;
}

/** Uma linha do item 4 — matrícula, material didático, entrada ou curso. */
export interface ContractPlanRow {
  key: "matricula" | "material" | "entrada" | "curso";
  label: string;
  amount: number;
  installments: number;
  installmentAmount: number;
  paymentMethod: string | null;
  firstDueDate: string | null;
}

/**
 * Aluno que entra no mesmo contrato sem ser quem paga — o caso do casal que
 * compra junto. Tem quadro próprio (item 2), treinamento próprio (item 3) e
 * valor próprio (item 4); quem assina continua sendo um só, o pagador.
 */
export interface ContractCoStudent {
  student: ContractStudent;
  course: ContractCourse;
  amount: number;
}

export interface ContractSnapshot {
  company: ContractCompany;
  student: ContractStudent;
  signer: ContractSigner;
  course: ContractCourse;
  plan: ContractPlanRow[];
  /**
   * Alunos adicionais. Ausente na esmagadora maioria dos contratos (um aluno
   * só) e opcional de propósito: contrato emitido antes disto existir continua
   * abrindo sem migração.
   */
  coStudents?: ContractCoStudent[];
  notes: string | null;
  /** Data da venda — é a data que fecha o contrato ("São Paulo, ..."). */
  saleDate: string;
  generatedAt: string;
}

export type ContractBlock = { title: string; items: Array<{ number: string; text: string }> };

export const PLAN_ROW_LABELS: Record<ContractPlanRow["key"], string> = {
  matricula: "MATRÍCULA",
  material: "MATERIAL DIDÁTICO",
  entrada: "ENTRADA (NO ATO)",
  curso: "CURSO",
};

export const EMPTY_CONTRACT_COMPANY: ContractCompany = {
  name: "",
  legalName: "",
  cnpj: "",
  address: "",
  neighborhood: "",
  city: "",
  state: "",
  zip: "",
  forum: "",
  email: "",
  phone: "",
  website: "",
  instagram: "",
  representativeName: "",
  representativeRole: "",
  signatureImage: "",
};

/** Padrão do primeiro uso: os dados que já estão no contrato em papel da escola. */
export const VOZUP_CONTRACT_COMPANY: ContractCompany = {
  name: "Escola de Oratória e Liderança Emocional - VozUP",
  legalName: "VozUp Escola de Oratória",
  cnpj: "24.964.964/0001-18",
  address: "Rua Azevedo Soares, 1334",
  neighborhood: "Tatuapé",
  city: "São Paulo",
  state: "SP",
  zip: "03322-001",
  forum: "São Paulo",
  email: "",
  phone: "(11) 2090-1413",
  website: "www.escolavozup.com",
  instagram: "@escola_vozup",
  representativeName: "",
  representativeRole: "",
  signatureImage: "",
};

/** Lacuna visível: dado faltando tem que parecer faltando, nunca sumir na frase. */
const BLANK = "____________________";

export function fillOrBlank(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : BLANK;
}

/** No quadro de resumo, campo vazio fica vazio mesmo — é uma linha para preencher à mão. */
export function fieldValue(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/**
 * Telefone do jeito que se lê num documento: (11) 98765-4321.
 *
 * O CRM guarda o número como veio do formulário (às vezes com +55), e o
 * contrato impresso com "5511987654321" numa linha chamada CELULAR parece
 * erro de cadastro para quem assina.
 */
export function formatPhoneBR(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.length > 11 && digits.startsWith("55")) digits = digits.slice(2);
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  // Formato que não reconhecemos volta como veio: melhor o número original do
  // que um recorte errado num documento assinado.
  return raw;
}

/** CEP com hífen; o que não tiver 8 dígitos volta como veio. */
export function formatZip(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : raw;
}

export function formatMoneyBRL(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `R$ ${safe.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

export function formatDatePtBr(iso: string | null | undefined): string {
  const match = (iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export function formatLongDatePtBr(iso: string | null | undefined): string {
  const match = (iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return BLANK;
  const [, year, month, day] = match;
  return `${Number(day)} de ${MONTHS[Number(month) - 1] ?? BLANK} de ${year}`;
}

export function formatCpf(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length !== 11) return (value ?? "").trim();
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function companyAddressLine(company: ContractCompany): string {
  const cityState = [company.city.trim(), company.state.trim()].filter(Boolean).join(" - ");
  return [company.address.trim(), company.neighborhood.trim(), cityState]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}

export function contractForum(company: ContractCompany): string {
  return company.forum.trim() || company.city.trim();
}

const STATE_NAMES: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará",
  DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão",
  MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará",
  PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte", RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima",
  SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};

/**
 * Como o estado é citado na cláusula de foro.
 *
 * Contrato não diz "Estado de SP": diz "Estado de São Paulo". E o Distrito
 * Federal não é estado nenhum, então entra sem o prefixo.
 */
export function forumStateLabel(uf: string): string {
  const key = uf.trim().toUpperCase();
  const name = STATE_NAMES[key];
  if (!name) return key ? `Estado de ${uf.trim()}` : BLANK;
  return key === "DF" ? name : `Estado de ${name}`;
}

export function planTotal(plan: ContractPlanRow[]): number {
  return Math.round(plan.reduce((sum, row) => sum + (Number.isFinite(row.amount) ? row.amount : 0), 0) * 100) / 100;
}

/**
 * Linhas do item 4 a partir do que foi vendido.
 *
 * O quadro é o rateio comercial (matrícula / material / curso), mas o número
 * e o valor das parcelas têm que ser os da cobrança de verdade: `installments`
 * conta só as mensais, e a entrada paga no ato entra como linha própria.
 *
 * Matrícula e material já são cobrados no ato — a entrada paga primeiro esses
 * dois, e só o que sobra dela vira a linha ENTRADA e abate do curso. Sem esse
 * abatimento o quadro cobraria duas vezes o mesmo dinheiro; com ele, o valor
 * da parcela impressa é o do boleto que chega.
 */
export function buildPlanRows(input: {
  rateio: { matricula: number; material: number; curso: number };
  downPayment: number;
  installments: number;
  paymentMethod: string | null;
  entryMethod: string | null;
  /** Vencimento da 1ª mensal. */
  firstDueDate: string | null;
  /** Vencimento do que é cobrado no ato. */
  atDate: string | null;
}): ContractPlanRow[] {
  const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const installments = Math.max(1, Math.trunc(input.installments));
  const entryShare = Math.max(
    0,
    round2(input.downPayment - round2(input.rateio.matricula) - round2(input.rateio.material))
  );
  return (["matricula", "material", "entrada", "curso"] as const)
    .map((key) => {
      const amount =
        key === "entrada"
          ? entryShare
          : round2(input.rateio[key] - (key === "curso" ? entryShare : 0));
      // Linha zerada não vai para o contrato: campo com "R$ 0,00" no quadro
      // confunde quem assina.
      if (!(amount > 0)) return null;
      const rowInstallments = key === "curso" ? installments : 1;
      return {
        key,
        label: PLAN_ROW_LABELS[key],
        amount,
        installments: rowInstallments,
        installmentAmount: round2(amount / rowInstallments),
        paymentMethod: key === "entrada" ? input.entryMethod : input.paymentMethod,
        firstDueDate: key === "curso" ? input.firstDueDate : input.atDate,
      };
    })
    .filter((row): row is ContractPlanRow => row !== null);
}

/** O que o quadro do item 4 diz sobre a cobrança — vocabulário de `EnrollmentInput`. */
export interface ContractChargeTerms {
  /** Valor do contrato: a soma das quatro linhas. */
  totalAmount: number;
  /** Tudo o que é cobrado no ato: matrícula + material + entrada. */
  downPayment: number;
  /** Mensais depois da entrada — o número da linha CURSO. */
  installments: number;
  /** Nome da forma da linha CURSO (texto: quem resolve para id é quem tem banco). */
  paymentMethod: string | null;
  /** Nome da forma do que é cobrado no ato. */
  entryMethod: string | null;
  /** Vencimento da 1ª mensal. */
  firstDueDate: string | null;
  /** Vencimento do que é cobrado no ato. */
  atDate: string | null;
}

/**
 * O inverso de `buildPlanRows`: da tabela do contrato de volta para a cobrança.
 *
 * `buildPlanRows` desce da matrícula para o quadro; esta sobe. Existe porque a
 * tela de contratos deixa corrigir o quadro — a venda saiu em 48x no link do
 * Asaas e o CRM ficou em 24x — e essa correção precisa chegar ao cronograma de
 * verdade, não só ao papel.
 *
 * Somar as quatro linhas devolve o valor do contrato porque `buildPlanRows` já
 * abate a ENTRADA do CURSO ao montar o quadro; a mesma conta ao contrário não
 * conta o dinheiro duas vezes. E matrícula e material são cobrados no ato, por
 * isso entram na entrada da matrícula junto com a linha ENTRADA.
 */
export function planToChargeTerms(plan: ContractPlanRow[]): ContractChargeTerms {
  const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const row = (key: ContractPlanRow["key"]) => plan.find((item) => item.key === key) ?? null;
  const amountOf = (key: ContractPlanRow["key"]) => {
    const value = Number(row(key)?.amount);
    return Number.isFinite(value) && value > 0 ? round2(value) : 0;
  };
  const curso = row("curso");
  const noAto = round2(amountOf("matricula") + amountOf("material") + amountOf("entrada"));
  const installments = Math.trunc(Number(curso?.installments));

  return {
    totalAmount: round2(noAto + amountOf("curso")),
    downPayment: noAto,
    installments: Number.isFinite(installments) && installments > 0 ? installments : 1,
    paymentMethod: curso?.paymentMethod?.trim() || null,
    // A forma do que se paga no ato: a da linha ENTRADA, ou a das linhas que
    // sobraram no ato quando não há entrada separada.
    entryMethod:
      row("entrada")?.paymentMethod?.trim() ||
      row("matricula")?.paymentMethod?.trim() ||
      row("material")?.paymentMethod?.trim() ||
      null,
    firstDueDate: curso?.firstDueDate || null,
    atDate:
      row("entrada")?.firstDueDate || row("matricula")?.firstDueDate || row("material")?.firstDueDate || null,
  };
}

/**
 * Linhas do item 4 na ordem do contrato em papel, mesmo as zeradas.
 *
 * As quatro linhas são o formulário em papel e ficam sempre — inclusive a
 * ENTRADA (NO ATO). Omitir a entrada zerada dava a impressão de que o quadro
 * estava incompleto, já que matrícula e material aparecem com R$ 0,00 do lado;
 * "R$ 0,00" no lugar dela é a resposta explícita de que não há entrada.
 */
export function normalizePlan(plan: ContractPlanRow[]): ContractPlanRow[] {
  const order: ContractPlanRow["key"][] = ["matricula", "material", "entrada", "curso"];
  return order
    .map((key) => {
      const found = plan.find((row) => row.key === key);
      return (
        found ?? {
          key,
          label: PLAN_ROW_LABELS[key],
          amount: 0,
          installments: 0,
          installmentAmount: 0,
          paymentMethod: null,
          firstDueDate: null,
        }
      );
    });
}

/**
 * As cláusulas do contrato — texto oficial da escola.
 *
 * `digitalSignature` acrescenta a cláusula 9, que é o que dá lastro ao aceite
 * eletrônico (MP 2.200-2/2001, art. 10, §2º). Na via impressa ela não entra.
 */
export function renderContractClauses(
  snapshot: ContractSnapshot,
  options: { digitalSignature?: boolean } = {}
): ContractBlock[] {
  const { company } = snapshot;
  const serviceAddress = companyAddressLine(company) || BLANK;
  const forum = contractForum(company) || BLANK;
  const state = forumStateLabel(company.state);

  const blocks: ContractBlock[] = [
    {
      title: "1. OBJETO DO CONTRATO",
      items: [
        {
          number: "1.1.",
          text: "O presente contrato tem como OBJETO a prestação, pela CONTRATADA ao(à) CONTRATANTE, dos serviços educacionais descritos no ITEM 3 - CURSO/TREINAMENTO do Quadro de Resumo, conforme as diretrizes e metodologia da CONTRATADA, mediante contraprestação avençada no ITEM 4 - PLANO FINANCEIRO.",
        },
        {
          number: "1.2.",
          text: "O(s) Serviço(s) prestados pela CONTRATADA consistem em método próprio de ensino, composto de aulas presenciais e material didático próprio, desenvolvidos de acordo com as características e objetivos do curso.",
        },
        {
          number: "1.3.",
          text: "O Curso é presencial, ressalvadas situações atípicas e excepcionais que restrinjam, impeçam ou inviabilizem a sua realização nessa modalidade, ocasião em que o contrato ficará suspenso até ser possível o restabelecimento das aulas presenciais.",
        },
        { number: "1.4.", text: `A prestação de serviços ocorrerá na ${serviceAddress}.` },
        {
          number: "1.5.",
          text: "A CONTRATADA se reserva no direito de alterar o corpo docente, o conteúdo, a grade disciplinar e o calendário/cronograma, antes ou durante o curso, conforme seu exclusivo critério e necessidade, mantendo o bom andamento e a metodologia do curso.",
        },
      ],
    },
    {
      title: "2. AULAS",
      items: [
        {
          number: "2.1.",
          text: "A carga horária do curso está descrita no ITEM 3 do Quadro de Resumo. O início das aulas dependerá da formação da turma com o número mínimo de alunos matriculados, conforme critérios da CONTRATADA.",
        },
        {
          number: "2.2.",
          text: "Caso não seja atingido o número mínimo, a CONTRATADA poderá suspender o início do curso/turma pelo prazo necessário ou optar pelo cancelamento, conferindo ao(à) CONTRATANTE a opção de escolher outro curso com vagas, mediante pagamento da diferença e aquisição do novo material.",
        },
        {
          number: "2.3.",
          text: "Se em até 90 (noventa) dias a turma não alcançar o quórum mínimo e não for possível a inserção do(a) CONTRATANTE em outras turmas, a CONTRATADA realizará a devolução dos valores efetivamente pagos, retendo apenas os valores referentes ao material didático já disponibilizado.",
        },
        {
          number: "2.4.",
          text: "Para receber o certificado, o(a) CONTRATANTE deverá frequentar 100% (cem por cento) da carga horária. Faltas justificadas poderão ser repostas conforme disponibilidade da CONTRATADA, em outros dias, horários ou turmas.",
        },
      ],
    },
    {
      title: "3. PAGAMENTO",
      items: [
        {
          number: "3.1.",
          text: "Pelos serviços prestados, o(a) CONTRATANTE pagará os valores relacionados no ITEM 4 - PLANO FINANCEIRO, conforme condições e vencimentos ali discriminados.",
        },
        {
          number: "3.2.",
          text: "Havendo atraso no pagamento de qualquer parcela, será acrescido ao valor 2% (dois por cento) de multa contratual, 1% (um por cento) ao mês de juros de mora, além da correspondente atualização monetária, com base no INPC ou outro índice que venha substituí-lo.",
        },
      ],
    },
    {
      title: "4. MATERIAL DIDÁTICO",
      items: [
        {
          number: "4.1.",
          text: "O material didático faz parte da metodologia exclusiva da VozUp e seu valor consta discriminado no ITEM 4 do Quadro de Resumo.",
        },
        {
          number: "4.2.",
          text: "Por estratégia pedagógica da VozUp, o conteúdo da apostila é disponibilizado de forma progressiva. O(a) CONTRATANTE receberá um fichário no início do curso e, ao longo das aulas frequentadas, receberá os conteúdos correspondentes para complementação.",
        },
        {
          number: "4.3.",
          text: "Esta metodologia visa garantir o melhor aproveitamento do aluno, com acompanhamento aula a aula junto ao professor. A entrega integral do material ocorre com a conclusão de 100% da carga horária.",
        },
        {
          number: "4.4.",
          text: "Em caso de cancelamento, trancamento ou desistência, os valores referentes ao material didático já disponibilizado não são reembolsáveis. O(a) CONTRATANTE permanecerá com os conteúdos já recebidos.",
        },
        {
          number: "4.5.",
          text: "A falta de pagamento autoriza a CONTRATADA a suspender a entrega dos conteúdos seguintes, sem prejuízo da cobrança dos valores devidos.",
        },
      ],
    },
    {
      title: "5. VIGÊNCIA, RESCISÃO E MULTA",
      items: [
        {
          number: "5.1.",
          text: "O presente Contrato terá vigência da data de sua assinatura até o(a) CONTRATANTE concluir o curso ou pelo prazo de 12 (doze) meses, o que ocorrer primeiro.",
        },
        {
          number: "5.2.",
          text: "Em caso de desistência em até 72 (setenta e duas) horas antes da primeira aula: devolução dos valores pagos referentes ao curso. Valores de matrícula e material didático já disponibilizado serão retidos.",
        },
        {
          number: "5.3.",
          text: "Desistência após 72h ou após a primeira aula: incidirá multa de 20% (vinte por cento) sobre o valor proporcional do período remanescente do curso, além da retenção da matrícula e material didático já disponibilizado.",
        },
      ],
    },
    {
      title: "6. CONDIÇÕES GERAIS",
      items: [
        {
          number: "6.1.",
          text: "A CONTRATADA se compromete a atuar em conformidade com a Lei Geral de Proteção de Dados (LGPD). Os dados do CONTRATANTE serão utilizados exclusivamente para fins educacionais, administrativos e de comunicação sobre o curso.",
        },
      ],
    },
    {
      title: "7. USO DE IMAGEM",
      items: [
        {
          number: "7.1.",
          text: "O CONTRATANTE autoriza, de forma gratuita e por tempo indeterminado, o uso de sua imagem e voz capturadas em fotos e vídeos durante as aulas, para fins institucionais e de divulgação da CONTRATADA, em redes sociais, site e materiais promocionais.",
        },
      ],
    },
    {
      title: "8. FORO",
      items: [
        {
          number: "8.1.",
          text: `As partes elegem o foro de ${forum}, ${state}, para dirimir eventuais dúvidas e conflitos oriundos deste Instrumento.`,
        },
      ],
    },
  ];

  if (options.digitalSignature) {
    blocks.push({
      title: "9. ASSINATURA ELETRÔNICA",
      items: [
        {
          number: "9.1.",
          text: "As partes declaram, para todos os fins do art. 10, §2º, da Medida Provisória nº 2.200-2/2001, que reconhecem como válida, eficaz e vinculante a assinatura eletrônica deste contrato, realizada por meio do sistema da CONTRATADA, ainda que não utilizado certificado digital ICP-Brasil.",
        },
        {
          number: "9.2.",
          text: "O aceite eletrônico é registrado com data e hora, endereço IP, identificação do dispositivo utilizado e código de verificação (hash) do documento, informações que constam do termo de evidências anexo e que as partes reconhecem como prova da autoria e da integridade do que foi assinado.",
        },
      ],
    });
  }

  return blocks;
}

/** Fecho do contrato: "São Paulo, 18 de agosto de 2026". */
export function contractClosing(snapshot: ContractSnapshot): string {
  const city = snapshot.company.city.trim();
  return `${city ? `${city}, ` : ""}${formatLongDatePtBr(snapshot.saleDate)}`;
}

/**
 * Impressão digital do que foi contratado. Entra no termo de evidências: com
 * ela dá para provar que o arquivo guardado é o mesmo que a pessoa leu.
 */
export function hashContractSnapshot(snapshot: ContractSnapshot): string {
  const canonical = JSON.stringify({ snapshot, clauses: renderContractClauses(snapshot, { digitalSignature: true }) });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function hashContractFile(file: Buffer | Uint8Array): string {
  return createHash("sha256").update(file).digest("hex");
}
