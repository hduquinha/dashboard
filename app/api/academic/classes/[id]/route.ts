import { NextResponse } from "next/server";
import { recordFinanceEvent } from "@/lib/financeAudit";
import { hasPermission } from "@/lib/permissions";
import {
  closeClass,
  deleteClass,
  getClassById,
  listClassHistory,
  listClassRoster,
  updateClass,
} from "@/lib/academicClasses";
import { parseClassInput, requireClassAccess } from "../route";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function parseId(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error("Turma invalida.");
  return parsed;
}

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireClassAccess(false);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const classId = parseId(id);
  // Contrato e valor pago só entram na resposta para quem pode ver dinheiro — a
  // lista de chamada é aberta a mais gente do que a Gestão Financeira.
  const includeFinance = hasPermission(auth.session!.user, "view.finance");
  const [turma, roster, history] = await Promise.all([
    getClassById(classId),
    listClassRoster(classId, { includeFinance }),
    listClassHistory(classId).catch(() => []),
  ]);
  if (!turma) return NextResponse.json({ error: "Turma nao encontrada." }, { status: 404 });
  return NextResponse.json({ class: turma, roster, history, includeFinance });
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireClassAccess(true);
  if (auth.error) return auth.error;

  try {
    const { id } = await context.params;
    const classId = parseId(id);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const before = await getClassById(classId);
    await updateClass(classId, parseClassInput(body));
    const after = await getClassById(classId);

    await recordFinanceEvent({
      entity: "turma",
      entityId: classId,
      action: "update",
      label: after?.name ?? before?.name ?? null,
      note: null,
      actorName: auth.session!.user.name,
      actorEmail: auth.session!.user.email,
      before: before ? (before as unknown as Record<string, unknown>) : null,
      after: after ? (after as unknown as Record<string, unknown>) : null,
      changes: [],
    }).catch(() => undefined);

    return NextResponse.json({ ok: true, class: after });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar turma." },
      { status: 400 }
    );
  }
}

/**
 * Encerrar a turma fechando os vínculos ativos de uma vez.
 *
 * Fica numa ação própria em vez de virar efeito colateral do PATCH de status: mudar
 * o status pela tela de edição é correção de cadastro (a turma nem começou), e
 * encerrar de verdade mexe na vida de todos os alunos — as duas não podem ser o
 * mesmo clique.
 */
export async function POST(request: Request, context: RouteContext) {
  const auth = await requireClassAccess(true);
  if (auth.error) return auth.error;

  try {
    const { id } = await context.params;
    const classId = parseId(id);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const linkStatus = body.linkStatus === "cancelada" ? "cancelada" : "concluida";

    const before = await getClassById(classId);
    const result = await closeClass(classId, linkStatus);
    const after = await getClassById(classId);

    await recordFinanceEvent({
      entity: "turma",
      entityId: classId,
      action: "update",
      label: after?.name ?? before?.name ?? null,
      note: `Turma encerrada · ${result.closedLinks} vínculo(s) marcados como ${linkStatus}`,
      actorName: auth.session!.user.name,
      actorEmail: auth.session!.user.email,
      before: before ? (before as unknown as Record<string, unknown>) : null,
      after: after ? (after as unknown as Record<string, unknown>) : null,
      changes: [],
    }).catch(() => undefined);

    return NextResponse.json({ ok: true, class: after, closedLinks: result.closedLinks });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao encerrar a turma." },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireClassAccess(true);
  if (auth.error) return auth.error;

  try {
    const { id } = await context.params;
    const classId = parseId(id);
    const before = await getClassById(classId);
    await deleteClass(classId);

    await recordFinanceEvent({
      entity: "turma",
      entityId: classId,
      action: "delete",
      label: before?.name ?? null,
      note: null,
      actorName: auth.session!.user.name,
      actorEmail: auth.session!.user.email,
      before: before ? (before as unknown as Record<string, unknown>) : null,
      after: null,
      changes: [],
    }).catch(() => undefined);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao excluir turma." },
      { status: 400 }
    );
  }
}
