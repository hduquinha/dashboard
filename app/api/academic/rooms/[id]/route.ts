import { NextResponse } from "next/server";
import { deleteRoom, listRooms, updateRoom } from "@/lib/academicClasses";
import { recordFinanceEvent } from "@/lib/financeAudit";
import { requireClassAccess } from "@/app/api/academic/classes/route";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function parseId(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error("Sala invalida.");
  return parsed;
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireClassAccess(true);
  if (auth.error) return auth.error;

  try {
    const { id } = await context.params;
    const roomId = parseId(id);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const before = (await listRooms()).find((item) => item.id === roomId) ?? null;

    await updateRoom(roomId, {
      name: typeof body.name === "string" ? body.name : (before?.name ?? ""),
      capacity:
        body.capacity === null || body.capacity === undefined || body.capacity === ""
          ? null
          : Number(body.capacity),
      active: typeof body.active === "boolean" ? body.active : undefined,
    });

    const rooms = await listRooms();
    const after = rooms.find((item) => item.id === roomId) ?? null;
    await recordFinanceEvent({
      entity: "sala",
      entityId: roomId,
      action: "update",
      label: after?.name ?? before?.name ?? `Sala #${roomId}`,
      note: null,
      actorName: auth.session!.user.name,
      actorEmail: auth.session!.user.email,
      before: before ? (before as unknown as Record<string, unknown>) : null,
      after: after ? (after as unknown as Record<string, unknown>) : null,
      changes: [],
    }).catch(() => undefined);

    return NextResponse.json({ ok: true, rooms, room: after });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar a sala." },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireClassAccess(true);
  if (auth.error) return auth.error;

  try {
    const { id } = await context.params;
    const roomId = parseId(id);
    const before = (await listRooms()).find((item) => item.id === roomId) ?? null;
    await deleteRoom(roomId);

    await recordFinanceEvent({
      entity: "sala",
      entityId: roomId,
      action: "delete",
      label: before?.name ?? `Sala #${roomId}`,
      note: null,
      actorName: auth.session!.user.name,
      actorEmail: auth.session!.user.email,
      before: before ? (before as unknown as Record<string, unknown>) : null,
      after: null,
      changes: [],
    }).catch(() => undefined);

    return NextResponse.json({ ok: true, rooms: await listRooms() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao excluir a sala." },
      { status: 400 }
    );
  }
}
