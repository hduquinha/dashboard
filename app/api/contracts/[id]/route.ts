import { NextRequest, NextResponse } from "next/server";
import {
  cancelContract,
  getContractById,
  getContractCharge,
  listContractEvents,
  reissueContractLink,
  updateContract,
  type ContractChargeInput,
} from "@/lib/contracts";
import type { ContractSignerRole } from "@/lib/contractRules";
import type { ContractCoStudent, ContractPlanRow } from "@/lib/contractTemplate";
import { PLAN_ROW_LABELS } from "@/lib/contractTemplate";
import { requireContractAccess } from "../route";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function parseId(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function optionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

/**
 * Alunos adicionais mandados pela tela. Lista vazia é legítima (remover a
 * segunda pessoa do documento); ausente preserva a que está gravada.
 */
/** Id opcional: ausente preserva, null limpa, número troca. */
function optionalId(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function readCharge(value: unknown): ContractChargeInput | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  return {
    saleDate: optionalText(raw.saleDate),
    sellerId: optionalId(raw.sellerId),
    branchId: optionalId(raw.branchId),
    cardBrandId: optionalId(raw.cardBrandId),
  };
}

function readCoStudents(value: unknown): ContractCoStudent[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, 5).map((item) => {
    const raw = (item ?? {}) as Record<string, unknown>;
    const student = (raw.student ?? {}) as Record<string, unknown>;
    const course = (raw.course ?? {}) as Record<string, unknown>;
    const text = (input: unknown): string | null => {
      const trimmed = typeof input === "string" ? input.trim() : "";
      return trimmed.length > 0 ? trimmed : null;
    };
    const amount = Number(raw.amount);
    return {
      student: {
        name: typeof student.name === "string" ? student.name.trim() : "",
        rg: text(student.rg),
        cpf: text(student.cpf),
        birthDate: text(student.birthDate),
        profession: text(student.profession),
        company: text(student.company),
        phone: text(student.phone),
        mobile: text(student.mobile),
        email: text(student.email),
        address: text(student.address),
        neighborhood: text(student.neighborhood),
        city: text(student.city),
        state: text(student.state)?.toUpperCase() ?? null,
        zip: text(student.zip),
      },
      course: {
        name: typeof course.name === "string" ? course.name.trim() : "",
        hours: text(course.hours),
        className: text(course.className),
      },
      amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0,
    };
  });
}

function readRole(value: unknown): ContractSignerRole | undefined {
  return value === "responsavel" || value === "aluno" ? (value as ContractSignerRole) : undefined;
}

function readRecord<T>(value: unknown, map: (record: Record<string, unknown>) => T): T | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return map(value as Record<string, unknown>);
}

function money(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
}

function count(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 1;
}

/**
 * O plano financeiro chega inteiro ou não chega — mandar meia tabela deixaria
 * o contrato somando um total que ninguém pediu. Linha com chave que o quadro
 * não conhece é descartada em vez de virar uma linha nova no quadro de resumo.
 *
 * As chaves válidas são as do próprio quadro (`PLAN_ROW_LABELS`), e não uma
 * lista repetida aqui: a lista escrita à mão ficou para trás quando a ENTRADA
 * passou a existir, e o quadro salvo apagava em silêncio a entrada da cobrança.
 */
function readPlan(value: unknown): ContractPlanRow[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows: ContractPlanRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.key !== "string" || !(row.key in PLAN_ROW_LABELS)) continue;
    const key = row.key as ContractPlanRow["key"];
    const amount = money(row.amount);
    const installments = count(row.installments);
    rows.push({
      key,
      label: PLAN_ROW_LABELS[key],
      amount,
      installments,
      installmentAmount:
        money(row.installmentAmount) || Math.round((amount / installments) * 100) / 100,
      paymentMethod: optionalText(row.paymentMethod) ?? null,
      firstDueDate: optionalText(row.firstDueDate) ?? null,
    });
  }
  return rows;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { error } = await requireContractAccess(false);
  if (error) return error;

  const id = parseId((await context.params).id);
  if (!id) return NextResponse.json({ error: "Contrato invalido." }, { status: 400 });

  const contract = await getContractById(id);
  if (!contract) return NextResponse.json({ error: "Contrato nao encontrado." }, { status: 404 });

  // `charge` é o financeiro da matrícula (vendedor, unidade, bandeira, data da
  // venda). Vem por aqui, e não por /api/finance, porque quem gerencia contrato
  // pode não ter permissão no Financeiro.
  const [events, charge] = await Promise.all([listContractEvents(id), getContractCharge(id)]);
  return NextResponse.json({ contract, events, charge });
}

/**
 * Três ações no mesmo verbo, escolhidas por `action`: preencher o quadro de
 * resumo (aluno, signatário, curso e plano financeiro), reemitir o link e
 * cancelar. São todas edições do mesmo recurso e exigem a mesma permissão.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { error, session } = await requireContractAccess(true);
  if (error) return error;

  const id = parseId((await context.params).id);
  if (!id) return NextResponse.json({ error: "Contrato invalido." }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "signer";

  try {
    if (action === "cancel") {
      const reason = typeof body.reason === "string" ? body.reason : "";
      if (!reason.trim()) {
        return NextResponse.json({ error: "Diga o motivo do cancelamento." }, { status: 400 });
      }
      return NextResponse.json({ contract: await cancelContract(session.user, id, reason) });
    }

    if (action === "reissue") {
      return NextResponse.json({ contract: await reissueContractLink(session.user, id) });
    }

    // O papel pode chegar dentro de `signer` (formato novo) ou solto na raiz
    // (como a tela mandava antes); vale o primeiro que for um papel válido.
    const signerBody = body.signer && typeof body.signer === "object" ? (body.signer as Record<string, unknown>) : {};
    const role = readRole(signerBody.role) ?? readRole(body.role);
    const contract = await updateContract(session.user, id, {
      student: readRecord(body.student, (student) => ({
        name: typeof student.name === "string" ? student.name : undefined,
        rg: optionalText(student.rg),
        cpf: optionalText(student.cpf),
        birthDate: optionalText(student.birthDate),
        profession: optionalText(student.profession),
        company: optionalText(student.company),
        phone: optionalText(student.phone),
        mobile: optionalText(student.mobile),
        email: optionalText(student.email),
        address: optionalText(student.address),
        neighborhood: optionalText(student.neighborhood),
        city: optionalText(student.city),
        state: optionalText(student.state),
        zip: optionalText(student.zip),
      })),
      signer: readRecord(body.signer, (signer) => ({
        name: typeof signer.name === "string" ? signer.name : undefined,
        cpf: optionalText(signer.cpf),
        email: optionalText(signer.email),
        phone: optionalText(signer.phone),
        role,
      })),
      course: readRecord(body.course, (course) => ({
        name: typeof course.name === "string" ? course.name : undefined,
        hours: optionalText(course.hours),
        className: optionalText(course.className),
      })),
      plan: readPlan(body.plan),
      charge: readCharge(body.charge),
      coStudents: readCoStudents(body.coStudents),
      notes: optionalText(body.notes),
    });
    return NextResponse.json({ contract });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Nao foi possivel atualizar o contrato.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
