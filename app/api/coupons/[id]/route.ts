import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { deleteCoupon, updateCoupon, type CouponInput } from "@/lib/coupons";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

async function requireManage() {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }
  if (!hasPermission(session.user, "coupons.manage")) {
    return NextResponse.json({ error: "Sem permissao para gerenciar cupons." }, { status: 403 });
  }
  return null;
}

function parseId(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("Cupom invalido.");
  }
  return parsed;
}

function parseInput(body: Record<string, unknown>): CouponInput {
  return {
    code: typeof body.code === "string" ? body.code : "",
    description: typeof body.description === "string" ? body.description : null,
    maxUses:
      body.maxUses === null || body.maxUses === undefined || body.maxUses === ""
        ? null
        : Number(body.maxUses),
    validUntil: typeof body.validUntil === "string" && body.validUntil ? body.validUntil : null,
    active: body.active === undefined ? true : Boolean(body.active),
  };
}

export async function PATCH(request: Request, context: RouteContext) {
  const denied = await requireManage();
  if (denied) return denied;

  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    await updateCoupon(parseId(id), parseInput(body));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao salvar o cupom." },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const denied = await requireManage();
  if (denied) return denied;

  try {
    const { id } = await context.params;
    await deleteCoupon(parseId(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao excluir o cupom." },
      { status: 400 }
    );
  }
}
