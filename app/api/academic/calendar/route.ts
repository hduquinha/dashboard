import { NextRequest, NextResponse } from "next/server";
import {
  deleteCalendarDay,
  listCalendarDays,
  upsertCalendarDay,
} from "@/lib/academicClasses";
import { recordFinanceEvent } from "@/lib/financeAudit";
import { requireClassAccess } from "@/app/api/academic/classes/route";
import type { CalendarDayKind, CalendarDayScope } from "@/types/academic";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireClassAccess(false);
  if (auth.error) return auth.error;
  return NextResponse.json({ days: await listCalendarDays() });
}

export async function POST(request: Request) {
  const auth = await requireClassAccess(true);
  if (auth.error) return auth.error;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const day = typeof body.day === "string" ? body.day : "";
    const before = (await listCalendarDays()).find((item) => item.day === day) ?? null;
    await upsertCalendarDay({
      day,
      kind: body.kind as CalendarDayKind,
      label: typeof body.label === "string" ? body.label : null,
      scope: body.scope as CalendarDayScope,
    });
    const after = (await listCalendarDays()).find((item) => item.day === day) ?? null;
    await recordFinanceEvent({
      entity: "calendario",
      entityId: null,
      action: before ? "update" : "create",
      label: after?.label ?? day,
      note: day,
      actorName: auth.session!.user.name,
      actorEmail: auth.session!.user.email,
      before: before ? (before as unknown as Record<string, unknown>) : null,
      after: after ? (after as unknown as Record<string, unknown>) : null,
      changes: [],
    }).catch(() => undefined);
    return NextResponse.json({ ok: true, day: after, days: await listCalendarDays() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao salvar calendário." },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireClassAccess(true);
  if (auth.error) return auth.error;

  try {
    const day = request.nextUrl.searchParams.get("day") ?? "";
    const before = (await listCalendarDays()).find((item) => item.day === day) ?? null;
    await deleteCalendarDay(day);
    await recordFinanceEvent({
      entity: "calendario",
      entityId: null,
      action: "delete",
      label: before?.label ?? day,
      note: day,
      actorName: auth.session!.user.name,
      actorEmail: auth.session!.user.email,
      before: before ? (before as unknown as Record<string, unknown>) : null,
      after: null,
      changes: [],
    }).catch(() => undefined);
    return NextResponse.json({ ok: true, days: await listCalendarDays() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao remover data do calendário." },
      { status: 400 }
    );
  }
}
