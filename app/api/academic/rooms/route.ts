import { NextResponse } from "next/server";
import { createRoom, listRooms } from "@/lib/academicClasses";
import { recordFinanceEvent } from "@/lib/financeAudit";
import { requireClassAccess } from "@/app/api/academic/classes/route";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireClassAccess(false);
  if (auth.error) return auth.error;
  return NextResponse.json({ rooms: await listRooms() });
}

export async function POST(request: Request) {
  const auth = await requireClassAccess(true);
  if (auth.error) return auth.error;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const capacity = body.capacity === null || body.capacity === undefined || body.capacity === ""
      ? null
      : Number(body.capacity);
    const id = await createRoom({
      name: typeof body.name === "string" ? body.name : "",
      capacity,
    });
    const room = (await listRooms()).find((item) => item.id === id) ?? null;
    await recordFinanceEvent({
      entity: "sala",
      entityId: id,
      action: "create",
      label: room?.name ?? `Sala #${id}`,
      note: null,
      actorName: auth.session!.user.name,
      actorEmail: auth.session!.user.email,
      before: null,
      after: room ? (room as unknown as Record<string, unknown>) : null,
      changes: [],
    }).catch(() => undefined);
    return NextResponse.json({ ok: true, id, room });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao cadastrar sala." },
      { status: 400 }
    );
  }
}
