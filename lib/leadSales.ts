import type { PoolClient } from "pg";
import { getPool, listInscricoesByIds } from "@/lib/db";
import { logLeadTimelineEvent } from "@/lib/commercial";
import {
  createEnrollment,
  deleteEnrollment,
  updateEnrollment,
  type EnrollmentScheduleItem,
} from "@/lib/finance";
import { ensureTrainingCatalogSchema } from "@/lib/trainingCatalog";
import { normalizeBusinessUnit, type FinanceBusinessUnit } from "@/lib/financeBusinessUnits";
import type { DashboardUser } from "@/lib/auth";
import type { ContractCourseInfo, ContractPlanSplit } from "@/lib/contractProfile";
import { normalizeEnrollmentInstallments } from "@/lib/enrollmentInstallments";

/**
 * Venda de treinamento registrada a partir do lead no CRM.
 *
 * A regra que segura este arquivo: **quem guarda dinheiro é o Financeiro.**
 * Registrar a venda não grava um "valor" solto no card — cria a matrícula
 * (`finance_enrollments`) com as parcelas em `finance_revenues`, exatamente
 * como se tivesse sido lançada na aba Matrículas, e carimba nela o lead de
 * origem (`lead_inscricao_id`). É esse carimbo que permite ao relatório dizer
 * "esta campanha gerou R$ X" sem depender de casar nome de aluno com nome de
 * lead, que era como a conciliação funcionava até aqui.
 *
 * Consequências que valem lembrar:
 * - a receita nasce como **prevista**; ela vira dinheiro de fato quando alguém
 *   registra o pagamento no Financeiro. Fechar venda não é receber;
 * - cada lead tem no máximo UMA venda. Corrigir valor, parcelas ou treinamento
 *   reescreve a matrícula existente (e regenera as parcelas), em vez de criar
 *   uma segunda matrícula fantasma para a mesma pessoa.
 */

const SCHEMA = "dashboard";

export interface LeadSaleInput {
  courseId: number;
  /** Valor efetivamente fechado, já com desconto. */
  amount: number;
  /** Entrada paga na contratação: sai do valor dividido nas mensais e vira a
   *  parcela 0 da matrícula. */
  downPaymentAmount?: number | null;
  installments: number;
  saleDate: string;
  firstMonth?: string | null;
  paymentMethodId?: number | null;
  cardBrandId?: number | null;
  sellerId?: number | null;
  branchId?: number | null;
  discountReason?: string | null;
  notes?: string | null;
  /** Parcelas combinadas uma a uma (valor, vencimento e forma de pagamento
   *  próprios). Sem isso, o valor é dividido em fatias iguais mês a mês. */
  schedule?: EnrollmentScheduleItem[] | null;
  /** Divisão do item 4 do contrato (matrícula / material / curso). O
   *  Financeiro continua vendo só o total. */
  contractPlan?: ContractPlanSplit | null;
  /** Item 3 do contrato: carga horária total e turma combinadas na venda. */
  contractCourse?: ContractCourseInfo | null;
  /**
   * Soma do valor de tabela dos cursos dos alunos adicionais (contrato de
   * casal). Entra no cálculo do desconto: sem ela, um contrato de duas pessoas
   * comparava a tabela de UM curso com o valor fechado dos DOIS e o desconto
   * saía zerado, escondendo o abatimento real.
   */
  extraListPrice?: number | null;
}

export interface LeadSale {
  enrollmentId: number;
  leadId: number;
  student: string;
  courseId: number | null;
  courseName: string | null;
  /** Valor de tabela do treinamento no dia da venda — congelado, para o
   *  desconto continuar fazendo sentido depois que o preço mudar. */
  listPrice: number | null;
  amount: number;
  discountAmount: number;
  discountReason: string | null;
  installments: number;
  installmentAmount: number;
  saleDate: string;
  firstMonth: string;
  paymentMethodId: number | null;
  cardBrandId: number | null;
  sellerId: number | null;
  sellerName: string | null;
  branchId: number | null;
  notes: string | null;
  /** Quanto já entrou de dinheiro dessa venda. */
  paid: number;
  balance: number;
  createdByName: string | null;
  createdAt: string | null;
  /** Parcelas como estão hoje no Financeiro. */
  schedule: LeadSaleInstallment[];
}

export interface LeadSaleInstallment {
  number: number;
  amount: number;
  dueDate: string | null;
  paymentMethodId: number | null;
  /** Nome da forma de pagamento — quem só lê a venda (ficha do lead) não
   *  carrega o catálogo do Financeiro para traduzir o id. */
  paymentMethodName: string | null;
  cardBrandId: number | null;
  cardBrandName: string | null;
  status: string;
  paid: number;
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return null;
}

/** "2026-08-07" → "2026-08". */
function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}



const SALE_SELECT = `
  SELECT e.id, e.student, e.course_id, e.total_amount, e.installments, e.first_month, e.sale_date,
         e.payment_method_id, e.card_brand_id, e.seller_id, e.branch_id, e.notes,
         e.lead_inscricao_id, e.list_price, e.discount_amount, e.discount_reason,
         e.created_by_name, e.created_at,
         c.name AS course_name,
         s.name AS seller_name,
         COALESCE((
           SELECT SUM(p.amount) FROM ${SCHEMA}.finance_enrollment_payments p WHERE p.enrollment_id = e.id
         ), 0) AS paid,
         COALESCE((
           SELECT JSON_AGG(json_build_object(
                    'number', r.installment_number,
                    'amount', r.amount,
                    'dueDate', COALESCE(r.due_date, r.date)::text,
                    'paymentMethodId', r.payment_method_id,
                    'paymentMethodName', pm.name,
                    'cardBrandId', r.card_brand_id,
                    'cardBrandName', cb.name,
                    'status', r.status,
                    'paid', COALESCE((
                      SELECT SUM(ep.amount) FROM ${SCHEMA}.finance_enrollment_payments ep
                      WHERE ep.revenue_id = r.id
                    ), 0)
                  ) ORDER BY r.installment_number)
           FROM ${SCHEMA}.finance_revenues r
           LEFT JOIN ${SCHEMA}.finance_payment_methods pm ON pm.id = r.payment_method_id
           LEFT JOIN ${SCHEMA}.finance_card_brands cb ON cb.id = r.card_brand_id
           WHERE r.enrollment_id = e.id
         ), '[]'::json) AS schedule
  FROM ${SCHEMA}.finance_enrollments e
  LEFT JOIN ${SCHEMA}.finance_courses c ON c.id = e.course_id
  LEFT JOIN ${SCHEMA}.finance_sellers s ON s.id = e.seller_id
`;

function mapSale(row: Record<string, unknown>): LeadSale {
  const amount = num(row.total_amount);
  const paid = num(row.paid);
  const installments = Number(row.installments) || 1;
  const saleDate = toIsoDate(row.sale_date) ?? "";
  return {
    enrollmentId: Number(row.id),
    leadId: Number(row.lead_inscricao_id),
    student: String(row.student ?? ""),
    courseId: row.course_id === null || row.course_id === undefined ? null : Number(row.course_id),
    courseName: (row.course_name as string | null) ?? null,
    listPrice: row.list_price === null || row.list_price === undefined ? null : num(row.list_price),
    amount,
    discountAmount: num(row.discount_amount),
    discountReason: (row.discount_reason as string | null) ?? null,
    installments,
    installmentAmount: round2(amount / installments),
    saleDate,
    firstMonth: monthOf(toIsoDate(row.first_month) ?? saleDate),
    paymentMethodId:
      row.payment_method_id === null || row.payment_method_id === undefined ? null : Number(row.payment_method_id),
    cardBrandId: row.card_brand_id === null || row.card_brand_id === undefined ? null : Number(row.card_brand_id),
    sellerId: row.seller_id === null || row.seller_id === undefined ? null : Number(row.seller_id),
    sellerName: (row.seller_name as string | null) ?? null,
    branchId: row.branch_id === null || row.branch_id === undefined ? null : Number(row.branch_id),
    notes: (row.notes as string | null) ?? null,
    paid,
    balance: round2(amount - paid),
    createdByName: (row.created_by_name as string | null) ?? null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at as string | null) ?? null,
    schedule: (Array.isArray(row.schedule) ? row.schedule : []).map((item: Record<string, unknown>) => ({
      number: Number(item.number) || 0,
      amount: num(item.amount),
      dueDate: typeof item.dueDate === "string" ? item.dueDate.slice(0, 10) : null,
      paymentMethodId: item.paymentMethodId === null || item.paymentMethodId === undefined ? null : Number(item.paymentMethodId),
      paymentMethodName: (item.paymentMethodName as string | null) ?? null,
      cardBrandId: item.cardBrandId === null || item.cardBrandId === undefined ? null : Number(item.cardBrandId),
      cardBrandName: (item.cardBrandName as string | null) ?? null,
      status: String(item.status ?? "previsto"),
      paid: num(item.paid),
    })),
  };
}

export async function getLeadSale(inscricaoId: number): Promise<LeadSale | null> {
  await ensureTrainingCatalogSchema();
  const { rows } = await getPool().query(
    `${SALE_SELECT} WHERE e.lead_inscricao_id = $1 ORDER BY e.id DESC LIMIT 1`,
    [inscricaoId]
  );
  return rows[0] ? mapSale(rows[0]) : null;
}

/**
 * A mesma venda, mas procurada pela matrícula em vez do lead. O contrato
 * digital nasce da matrícula (que existe sempre) e não do lead (que pode
 * faltar em venda lançada direto no Financeiro).
 */
export async function getSaleByEnrollmentId(enrollmentId: number): Promise<LeadSale | null> {
  await ensureTrainingCatalogSchema();
  const { rows } = await getPool().query(`${SALE_SELECT} WHERE e.id = $1 LIMIT 1`, [enrollmentId]);
  return rows[0] ? mapSale(rows[0]) : null;
}

/** Vendas de vários leads de uma vez — usado pelas listas e pelo Kanban. */
export async function getLeadSalesByIds(inscricaoIds: number[]): Promise<Map<number, LeadSale>> {
  const ids = Array.from(new Set(inscricaoIds.filter((id) => Number.isFinite(id))));
  if (ids.length === 0) return new Map();

  await ensureTrainingCatalogSchema();
  const { rows } = await getPool().query(`${SALE_SELECT} WHERE e.lead_inscricao_id = ANY($1::bigint[])`, [ids]);
  const map = new Map<number, LeadSale>();
  for (const row of rows) {
    const sale = mapSale(row);
    map.set(sale.leadId, sale);
  }
  return map;
}

/**
 * Vendedor do Financeiro correspondente ao responsável do lead no CRM. O
 * casamento é por nome porque as duas listas são cadastros independentes
 * (equipe do Chatwoot × vendedores com percentual de comissão). Sem
 * correspondência, a venda fica sem vendedor e sem comissão — melhor do que
 * atribuir comissão à pessoa errada.
 */
function unaccentedUpper(expression: string): string {
  return `UPPER(TRIM(TRANSLATE(${expression},
    'áàãâäéèêëíìîïóòõôöúùûüçÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')))`;
}

async function findFinanceSellerIdByName(name: string | null | undefined): Promise<number | null> {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  const { rows } = await getPool().query(
    `SELECT id FROM ${SCHEMA}.finance_sellers
     WHERE ${unaccentedUpper("name")} = ${unaccentedUpper("$1")}
     ORDER BY active DESC, id LIMIT 1`,
    [trimmed]
  );
  return rows[0] ? Number(rows[0].id) : null;
}

/**
 * Preço de tabela do treinamento, congelado no momento da venda — e a empresa
 * dona dele. A unidade de negócio vem do CURSO e não da tela: quem fecha um
 * treinamento do Instituto UP não escolhe onde o dinheiro entra, senão a mesma
 * venda cairia ora num lado ora no outro conforme quem clicou.
 */
async function getListPrice(courseId: number): Promise<{
  price: number | null;
  name: string | null;
  businessUnit: FinanceBusinessUnit;
  commissionPct: number | null;
}> {
  const { rows } = await getPool().query(
    `SELECT name, default_price, business_unit, commission_pct
       FROM ${SCHEMA}.finance_courses WHERE id = $1`,
    [courseId]
  );
  if (!rows[0]) throw new Error("Treinamento não encontrado no catálogo.");
  return {
    price: rows[0].default_price === null ? null : num(rows[0].default_price),
    name: rows[0].name ?? null,
    businessUnit: normalizeBusinessUnit(rows[0].business_unit),
    commissionPct: rows[0].commission_pct === null ? null : num(rows[0].commission_pct),
  };
}

/** Carimba o lead de origem na matrícula e em todas as parcelas geradas. */
async function stampLeadOnEnrollment(
  client: PoolClient | ReturnType<typeof getPool>,
  enrollmentId: number,
  lead: { id: number; nome: string | null; telefone: string | null },
  extra: { listPrice: number | null; discountAmount: number; discountReason: string | null; createdBy: { id: number | null; name: string | null } }
): Promise<void> {
  await client.query(
    `UPDATE ${SCHEMA}.finance_enrollments
     SET lead_inscricao_id = $2,
         list_price = $3,
         discount_amount = $4,
         discount_reason = $5,
         created_by_user_id = COALESCE(created_by_user_id, $6),
         created_by_name = COALESCE(created_by_name, $7)
     WHERE id = $1`,
    [
      enrollmentId,
      lead.id,
      extra.listPrice,
      extra.discountAmount,
      extra.discountReason,
      extra.createdBy.id,
      extra.createdBy.name,
    ]
  );

  await client.query(
    `UPDATE ${SCHEMA}.finance_revenues
     SET lead_inscricao_id = $2, lead_name = $3, lead_phone = $4
     WHERE enrollment_id = $1`,
    [enrollmentId, lead.id, lead.nome, lead.telefone]
  );
}

export interface RegisterLeadSaleResult {
  sale: LeadSale;
  created: boolean;
}

export async function registerLeadSale(
  user: DashboardUser | null | undefined,
  inscricaoId: number,
  input: LeadSaleInput
): Promise<RegisterLeadSaleResult> {
  await ensureTrainingCatalogSchema();

  const amount = round2(num(input.amount));
  if (!(amount > 0)) {
    throw new Error("Informe o valor fechado da venda.");
  }
  if (!Number.isFinite(input.courseId) || input.courseId < 1) {
    throw new Error("Escolha o treinamento vendido.");
  }
  const saleDate = toIsoDate(input.saleDate) ?? new Date().toISOString().slice(0, 10);
  const installments = normalizeEnrollmentInstallments(input.installments);

  const [lead] = await listInscricoesByIds([inscricaoId]);
  if (!lead) {
    throw new Error("Lead não encontrado.");
  }

  const course = await getListPrice(input.courseId);
  // Desconto é o que ficou abaixo da tabela. Valor acima do padrão (upsell,
  // material extra) não vira "desconto negativo" — fica zerado.
  const listPrice =
    course.price === null ? null : round2(course.price + num(input.extraListPrice));
  const discountAmount = listPrice === null ? 0 : Math.max(0, round2(listPrice - amount));

  const sellerId =
    input.sellerId ?? (await findFinanceSellerIdByName(lead.commercial?.assignedSellerName ?? null));

  const existing = await getLeadSale(inscricaoId);
  const enrollmentInput = {
    student: lead.nome?.trim() || `Lead #${inscricaoId}`,
    courseId: input.courseId,
    totalAmount: amount,
    downPaymentAmount: round2(num(input.downPaymentAmount)),
    installments,
    paymentMethodId: input.paymentMethodId ?? null,
    cardBrandId: input.cardBrandId ?? null,
    firstMonth: input.firstMonth?.trim() || monthOf(saleDate),
    saleDate,
    sellerId,
    branchId: input.branchId ?? null,
    notes: input.notes?.trim() || null,
    schedule: input.schedule ?? null,
    // A matrícula (e cada parcela que ela gera) nasce carimbada com a empresa
    // do curso vendido. É o que mantém a venda de um treinamento do Instituto
    // UP fora dos números da Voz UP, sem tirar dela o contrato nem o Kanban.
    businessUnit: course.businessUnit,
    // Curso com percentual próprio manda; sem percentual, vale o do vendedor.
    // Zero apaga a comissão de propósito (ver syncEnrollmentCommission).
    commissionPct: course.commissionPct,
  };

  const enrollmentId = existing
    ? (await updateEnrollment(existing.enrollmentId, enrollmentInput), existing.enrollmentId)
    : await createEnrollment(enrollmentInput);

  // Itens 3 e 4 do contrato: ficam na matrícula porque é dela que o contrato
  // nasce. COALESCE não serve aqui — o vendedor tem que conseguir corrigir.
  if (input.contractPlan || input.contractCourse) {
    await getPool().query(
      `UPDATE ${SCHEMA}.finance_enrollments
          SET contract_plan = COALESCE($2::jsonb, contract_plan),
              contract_course_hours = COALESCE($3, contract_course_hours),
              contract_class_name   = COALESCE($4, contract_class_name)
        WHERE id = $1`,
      [
        enrollmentId,
        input.contractPlan ? JSON.stringify(input.contractPlan) : null,
        input.contractCourse?.hours?.trim() || null,
        input.contractCourse?.className?.trim() || null,
      ]
    );
  }

  await stampLeadOnEnrollment(
    getPool(),
    enrollmentId,
    { id: inscricaoId, nome: lead.nome ?? null, telefone: lead.telefone ?? null },
    {
      listPrice,
      discountAmount,
      discountReason: input.discountReason?.trim() || null,
      createdBy: { id: user?.id ?? null, name: user?.name ?? user?.email ?? null },
    }
  );

  // Espelho no CRM: o card mostra o que foi vendido sem precisar consultar o
  // Financeiro. A matrícula continua sendo a fonte da verdade do dinheiro.
  // Lead que nunca entrou no Kanban não tem linha aqui e o UPDATE não afeta
  // nada — de propósito: sem card, não há o que espelhar, e criar a linha
  // jogaria o lead na etapa de entrada de um funil como se fosse novo.
  await getPool().query(
    `UPDATE ${SCHEMA}.commercial_leads
     SET closed_course = $2, closed_value = $3, closed_at = COALESCE(closed_at, NOW()), updated_at = NOW()
     WHERE inscricao_id = $1`,
    [inscricaoId, course.name, amount]
  );

  await logLeadTimelineEvent(user, inscricaoId, existing ? "sale_updated" : "sale_registered", {
    enrollmentId,
    courseId: input.courseId,
    courseName: course.name,
    listPrice,
    amount,
    discountAmount,
    discountReason: input.discountReason?.trim() || null,
    installments,
    saleDate,
  });

  // Contrato digital da matrícula. Import dinâmico de propósito: `contracts.ts`
  // lê a venda por `getSaleByEnrollmentId` daqui, e o ciclo estático entre os
  // dois módulos quebraria a inicialização. A função nunca lança — falha ao
  // gerar contrato não pode derrubar o registro da venda, que é o que o
  // vendedor está fazendo neste clique.
  const { syncContractOnSale } = await import("@/lib/contracts");
  await syncContractOnSale(user, enrollmentId, { saleWasUpdated: Boolean(existing) });

  const sale = await getLeadSale(inscricaoId);
  if (!sale) throw new Error("Venda não encontrada após o registro.");
  return { sale, created: !existing };
}

/**
 * Desfaz a venda: apaga a matrícula (e por cascade as parcelas previstas) e
 * limpa o espelho no CRM. Bloqueado quando já entrou dinheiro — pagamento
 * recebido não pode sumir do caixa por causa de uma correção no Kanban.
 */
export async function deleteLeadSale(
  user: DashboardUser | null | undefined,
  inscricaoId: number
): Promise<void> {
  const sale = await getLeadSale(inscricaoId);
  if (!sale) throw new Error("Este lead não tem venda registrada.");
  if (sale.paid > 0) {
    throw new Error(
      "Esta venda já tem pagamento recebido. Cancele os pagamentos no Financeiro antes de excluir a venda."
    );
  }

  await deleteEnrollment(sale.enrollmentId);
  await getPool().query(
    `UPDATE ${SCHEMA}.commercial_leads
     SET closed_course = NULL, closed_value = NULL, updated_at = NOW()
     WHERE inscricao_id = $1`,
    [inscricaoId]
  );
  await logLeadTimelineEvent(user, inscricaoId, "sale_deleted", {
    enrollmentId: sale.enrollmentId,
    courseName: sale.courseName,
    amount: sale.amount,
  });
}


/**
 * Rateio do contrato gravado na matrícula (item 4). Null quando a venda é
 * anterior ao rateio ou foi registrada fora do modal.
 */
export async function getSaleContractPlan(enrollmentId: number): Promise<ContractPlanSplit | null> {
  const { rows } = await getPool().query<{ contract_plan: unknown }>(
    `SELECT contract_plan FROM ${SCHEMA}.finance_enrollments WHERE id = $1`,
    [enrollmentId]
  );
  const raw = rows[0]?.contract_plan;
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const num = (key: string) => {
    const parsed = Number(value[key]);
    return Number.isFinite(parsed) && parsed > 0 ? round2(parsed) : 0;
  };
  return { matricula: num("matricula"), material: num("material"), curso: num("curso") };
}


/** Item 3 do contrato gravado na matrícula. */
export async function getSaleContractCourse(enrollmentId: number): Promise<ContractCourseInfo> {
  const { rows } = await getPool().query<{
    contract_course_hours: string | null;
    contract_class_name: string | null;
  }>(
    `SELECT contract_course_hours, contract_class_name
       FROM ${SCHEMA}.finance_enrollments WHERE id = $1`,
    [enrollmentId]
  );
  return {
    hours: rows[0]?.contract_course_hours ?? "",
    className: rows[0]?.contract_class_name ?? "",
  };
}


export interface CommissionSellerOption {
  /** Id em `finance_sellers` — é o que a matrícula grava. */
  id: number;
  name: string;
}

/**
 * Vendedores oferecidos no fechamento: a **equipe de verdade**.
 *
 * `finance_sellers` nasceu de uma constante no código e ficou com gente que não
 * trabalha mais na escola e com o mesmo vendedor cadastrado duas vezes, com
 * grafias diferentes — o que partia a comissão em dois. A equipe real vive em
 * `team_members` (marca `is_seller`), então é dela que a lista sai; a linha em
 * `finance_sellers` continua existindo porque é para lá que aponta a comissão
 * lançada, e é criada aqui se ainda não houver.
 *
 * O casamento é por nome sem acento e sem caixa — é o único campo que as duas
 * tabelas têm em comum (`finance_sellers` não guarda e-mail).
 */
export async function listCommissionSellers(): Promise<CommissionSellerOption[]> {
  const pool = getPool();
  const { rows: team } = await pool.query<{ name: string }>(
    `SELECT name FROM ${SCHEMA}.team_members
      WHERE active AND is_seller AND COALESCE(TRIM(name), '') <> ''
      ORDER BY name`
  );

  const options: CommissionSellerOption[] = [];
  for (const member of team) {
    const name = member.name.trim();
    let id = await findFinanceSellerIdByName(name);
    if (!id) {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO ${SCHEMA}.finance_sellers (name) VALUES ($1)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [name]
      );
      id = Number(rows[0].id);
    }
    // Vendedor que voltou à equipe reabre o cadastro de comissão.
    await pool.query(`UPDATE ${SCHEMA}.finance_sellers SET active = TRUE WHERE id = $1`, [id]);
    options.push({ id, name });
  }

  return options;
}
