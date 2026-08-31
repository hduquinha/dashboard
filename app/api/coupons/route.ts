import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import {
  createCoupon,
  listCoupons,
  listUnregisteredCouponCodes,
  type CouponInput,
} from "@/lib/coupons";

export const dynamic = "force-dynamic";

/** Ver quem ganhou cortesia é uma coisa; criar cortesia (dar entrada de graça
 *  num produto pago) é outra. */
async function requireCouponAccess(edit: boolean) {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) {
    return { error: NextResponse.json({ error: "Nao autorizado" }, { status: 401 }), session: null };
  }
  const permission = edit ? "coupons.manage" : "view.coupons";
  if (!hasPermission(session.user, permission)) {
    return {
      error: NextResponse.json(
        { error: edit ? "Sem permissao para gerenciar cupons." : "Sem permissao para ver cupons." },
        { status: 403 }
      ),
      session: null,
    };
  }
  return { error: null, session };
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

export async function GET() {
  const auth = await requireCouponAccess(false);
  if (auth.error) return auth.error;

  const [coupons, unregistered] = await Promise.all([listCoupons(), listUnregisteredCouponCodes()]);
  return NextResponse.json({ coupons, unregistered });
}

export async function POST(request: Request) {
  const auth = await requireCouponAccess(true);
  if (auth.error) return auth.error;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = await createCoupon(parseInput(body), auth.session?.user.name ?? null);
    return NextResponse.json({ id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao criar o cupom." },
      { status: 400 }
    );
  }
}
