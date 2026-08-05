import { NextResponse, type NextRequest } from "next/server";
import { requireTasks } from "@/lib/tasksApi";
import { userCanAccessTask } from "@/lib/tasks";
import { deleteAttachment, getAttachmentFile, taskIdOfAttachment } from "@/lib/taskDetails";

export const dynamic = "force-dynamic";

/** Baixa (ou exibe, para imagem) o arquivo do anexo. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  const file = await getAttachmentFile(id);
  if (!file) return NextResponse.json({ error: "Anexo nao encontrado." }, { status: 404 });
  if (!(await userCanAccessTask(auth.user, file.taskId))) {
    return NextResponse.json({ error: "Sem acesso." }, { status: 403 });
  }
  // Imagem abre no navegador (é o que faz a capa e a pré-visualização
  // funcionarem); o resto baixa.
  const inline = file.mime.startsWith("image/") || file.mime === "application/pdf";
  return new NextResponse(new Uint8Array(file.buffer), {
    headers: {
      "Content-Type": file.mime,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${file.name.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  const taskId = await taskIdOfAttachment(id);
  if (taskId === null || !(await userCanAccessTask(auth.user, taskId))) {
    return NextResponse.json({ error: "Sem acesso." }, { status: 403 });
  }
  await deleteAttachment(id);
  return NextResponse.json({ ok: true });
}
