import { NextResponse, type NextRequest } from "next/server";
import { actorOf, currentMemberId, requireTasks } from "@/lib/tasksApi";
import { getTask, userCanAccessTask } from "@/lib/tasks";
import {
  createFileAttachment,
  createLinkAttachment,
  logActivity,
  MAX_ATTACHMENT_BYTES,
} from "@/lib/taskDetails";

export const dynamic = "force-dynamic";

/**
 * Aceita os dois formatos de anexo do Trello: arquivo (multipart) e link
 * (JSON). O arquivo vai pro Postgres, igual aos comprovantes do Financeiro.
 */
export async function POST(request: NextRequest) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const contentType = request.headers.get("content-type") ?? "";
  const createdBy = await currentMemberId(auth.user);
  const actor = await actorOf(auth.user);

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const taskId = Number(formData.get("taskId"));
    const file = formData.get("file");
    if (!Number.isFinite(taskId) || !(file instanceof File)) {
      return NextResponse.json({ error: "taskId e arquivo sao obrigatorios." }, { status: 400 });
    }
    if (!(await userCanAccessTask(auth.user, taskId))) {
      return NextResponse.json({ error: "Sem acesso a esta tarefa." }, { status: 403 });
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json(
        { error: `Arquivo maior que ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB.` },
        { status: 413 }
      );
    }
    const attachment = await createFileAttachment({
      taskId,
      name: file.name || "anexo",
      mime: file.type || "application/octet-stream",
      buffer: Buffer.from(await file.arrayBuffer()),
      createdBy,
    });
    const task = await getTask(taskId);
    await logActivity({
      taskId,
      boardId: task?.boardId ?? null,
      actor,
      action: "attachment_added",
      detail: { name: attachment.name },
    });
    return NextResponse.json({ attachment });
  }

  const body = await request.json().catch(() => ({}));
  const taskId = Number(body?.taskId);
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!Number.isFinite(taskId) || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "taskId e url (http/https) sao obrigatorios." }, { status: 400 });
  }
  if (!(await userCanAccessTask(auth.user, taskId))) {
    return NextResponse.json({ error: "Sem acesso a esta tarefa." }, { status: 403 });
  }
  const attachment = await createLinkAttachment({
    taskId,
    name: typeof body?.name === "string" && body.name.trim() ? body.name.trim() : url,
    url,
    createdBy,
  });
  const task = await getTask(taskId);
  await logActivity({
    taskId,
    boardId: task?.boardId ?? null,
    actor,
    action: "attachment_added",
    detail: { name: attachment.name, link: true },
  });
  return NextResponse.json({ attachment });
}
