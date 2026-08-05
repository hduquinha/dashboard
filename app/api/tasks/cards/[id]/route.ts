import { NextResponse, type NextRequest } from "next/server";
import { actorOf, requireTasks } from "@/lib/tasksApi";
import {
  getTask,
  moveTask,
  setCustomValue,
  setTaskAssignees,
  setTaskLabels,
  updateTask,
  userCanAccessTask,
} from "@/lib/tasks";
import { logActivity } from "@/lib/taskDetails";
import { notifyTaskMembers, runAutomations } from "@/lib/taskAutomations";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const taskId = Number((await params).id);
  if (!(await userCanAccessTask(auth.user, taskId))) {
    return NextResponse.json({ error: "Sem acesso a esta tarefa." }, { status: 403 });
  }
  const task = await getTask(taskId);
  if (!task) return NextResponse.json({ error: "Tarefa nao encontrada." }, { status: 404 });
  return NextResponse.json({ task });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const taskId = Number((await params).id);
  if (!(await userCanAccessTask(auth.user, taskId))) {
    return NextResponse.json({ error: "Sem acesso a esta tarefa." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const actor = await actorOf(auth.user);
  const before = await getTask(taskId);
  if (!before) return NextResponse.json({ error: "Tarefa nao encontrada." }, { status: 404 });

  // Mover entre colunas / reordenar
  if (body?.action === "move" && Array.isArray(body?.orderedTaskIds)) {
    const columnId = typeof body.columnId === "number" ? body.columnId : null;
    try {
      await moveTask(
        taskId,
        columnId,
        body.orderedTaskIds.filter((n: unknown) => typeof n === "number")
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao mover a tarefa.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (before.columnId !== columnId) {
      await logActivity({
        taskId,
        boardId: before.boardId,
        actor,
        action: "card_moved",
        detail: { fromColumnId: before.columnId, toColumnId: columnId },
      });
      await runAutomations({ type: "card_moved", boardId: before.boardId, taskId, columnId, actor });
      const after = await getTask(taskId);
      if (after?.completedAt && !before.completedAt) {
        await runAutomations({ type: "card_completed", boardId: before.boardId, taskId, actor });
      }
    }
    return NextResponse.json({ ok: true });
  }

  // Atualização de campos
  const touchesFields =
    body?.title !== undefined ||
    body?.description !== undefined ||
    body?.priority !== undefined ||
    body?.startDate !== undefined ||
    body?.dueDate !== undefined ||
    body?.completed !== undefined ||
    body?.completedAt !== undefined ||
    body?.archived !== undefined ||
    body?.coverColor !== undefined ||
    body?.coverAttachmentId !== undefined;

  if (touchesFields) {
    await updateTask(taskId, {
      title: body?.title,
      description: body?.description,
      priority: body?.priority,
      startDate: body?.startDate,
      dueDate: body?.dueDate,
      completed: body?.completed,
      completedAt: body?.completedAt,
      archived: body?.archived,
      coverColor: body?.coverColor,
      coverAttachmentId: body?.coverAttachmentId,
    });

    // O histórico guarda só o que realmente mudou — "editou o card" sem dizer o
    // quê não serve para auditar nada.
    const changes: Record<string, { de: unknown; para: unknown }> = {};
    if (body?.title !== undefined && body.title !== before.title) changes.titulo = { de: before.title, para: body.title };
    if (body?.priority !== undefined && body.priority !== before.priority)
      changes.prioridade = { de: before.priority, para: body.priority };
    if (body?.dueDate !== undefined && (body.dueDate || null) !== before.dueDate)
      changes.prazo = { de: before.dueDate, para: body.dueDate || null };
    if (body?.startDate !== undefined && (body.startDate || null) !== before.startDate)
      changes.inicio = { de: before.startDate, para: body.startDate || null };
    if (body?.description !== undefined && (body.description || null) !== before.description)
      changes.descricao = { de: before.description ? "(texto anterior)" : null, para: body.description ? "(novo texto)" : null };

    if (body?.archived === true) {
      await logActivity({ taskId, boardId: before.boardId, actor, action: "card_archived", detail: {} });
    } else if (body?.archived === false) {
      await logActivity({ taskId, boardId: before.boardId, actor, action: "card_restored", detail: {} });
    }

    // O que vale é o estado depois do UPDATE: dá pra concluir pelo checkbox ou
    // simplesmente informando a data de conclusão, e mudar só a data de um card
    // que já estava concluído não é "concluir de novo".
    const afterFields = await getTask(taskId);
    if (afterFields?.completedAt && !before.completedAt) {
      await logActivity({ taskId, boardId: before.boardId, actor, action: "card_completed", detail: {} });
      await runAutomations({ type: "card_completed", boardId: before.boardId, taskId, actor });
    } else if (
      afterFields?.completedAt &&
      before.completedAt &&
      afterFields.completedAt.slice(0, 10) !== before.completedAt.slice(0, 10)
    ) {
      changes.conclusao = { de: before.completedAt.slice(0, 10), para: afterFields.completedAt.slice(0, 10) };
    }
    if (Object.keys(changes).length > 0) {
      await logActivity({ taskId, boardId: before.boardId, actor, action: "card_updated", detail: changes });
    }
  }

  if (Array.isArray(body?.assigneeIds)) {
    const ids: number[] = body.assigneeIds.filter((n: unknown) => typeof n === "number");
    await setTaskAssignees(taskId, ids);
    const added = ids.filter((id) => !before.assigneeIds.includes(id));
    if (added.length > 0) {
      await logActivity({ taskId, boardId: before.boardId, actor, action: "members_changed", detail: { added } });
      await notifyTaskMembers(added, before, "task_assigned", `${actor.name} atribuiu esta tarefa a você.`);
      for (const memberId of added) {
        await runAutomations({ type: "member_assigned", boardId: before.boardId, taskId, memberId, actor });
      }
    }
  }

  if (Array.isArray(body?.labelIds)) {
    const ids: number[] = body.labelIds.filter((n: unknown) => typeof n === "number");
    await setTaskLabels(taskId, ids);
    const added = ids.filter((id) => !before.labelIds.includes(id));
    if (added.length > 0) {
      await logActivity({ taskId, boardId: before.boardId, actor, action: "labels_changed", detail: { added } });
      for (const labelId of added) {
        await runAutomations({ type: "label_added", boardId: before.boardId, taskId, labelId, actor });
      }
    }
  }

  // Campos personalizados: { fieldId: valor } — string vazia apaga o valor.
  if (body?.customValues && typeof body.customValues === "object") {
    for (const [fieldId, value] of Object.entries(body.customValues as Record<string, unknown>)) {
      await setCustomValue(taskId, Number(fieldId), value === null || value === "" ? null : String(value));
    }
    await logActivity({ taskId, boardId: before.boardId, actor, action: "custom_fields_changed", detail: {} });
  }

  const task = await getTask(taskId);
  return NextResponse.json({ ok: true, task });
}

/** Exclusão definitiva. O botão "Arquivar" da UI usa PATCH archived=true. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const taskId = Number((await params).id);
  if (!(await userCanAccessTask(auth.user, taskId))) {
    return NextResponse.json({ error: "Sem acesso a esta tarefa." }, { status: 403 });
  }
  const task = await getTask(taskId);
  const { getPool } = await import("@/lib/db");
  await getPool().query("DELETE FROM dashboard.tasks WHERE id = $1", [taskId]);
  if (task) {
    await logActivity({
      boardId: task.boardId,
      actor: await actorOf(auth.user),
      action: "card_deleted",
      detail: { title: task.title },
    });
  }
  return NextResponse.json({ ok: true });
}
