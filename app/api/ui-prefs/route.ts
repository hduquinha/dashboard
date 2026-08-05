import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { getUiPreferences, saveUiPreferences } from "@/lib/uiPreferences";

export const dynamic = "force-dynamic";

/** Preferências são sempre do dono da sessão — o e-mail nunca vem do cliente. */
async function requireSessionEmail(): Promise<string | null> {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  return session?.user.email ?? null;
}

export async function GET(request: NextRequest) {
  const email = await requireSessionEmail();
  if (!email) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const scope = new URL(request.url).searchParams.get("scope") ?? "";
  if (!scope) return NextResponse.json({ error: "Informe o escopo." }, { status: 400 });

  const prefs = await getUiPreferences(email, scope);
  return NextResponse.json({ prefs });
}

export async function PUT(request: NextRequest) {
  const email = await requireSessionEmail();
  if (!email) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { scope?: unknown; prefs?: unknown } | null;
  const scope = typeof body?.scope === "string" ? body.scope : "";
  const prefs = body?.prefs && typeof body.prefs === "object" && !Array.isArray(body.prefs) ? body.prefs : null;
  if (!scope || !prefs) {
    return NextResponse.json({ error: "Envie scope e prefs." }, { status: 400 });
  }

  try {
    const saved = await saveUiPreferences(email, scope, prefs as Record<string, unknown>);
    return NextResponse.json({ prefs: saved });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao salvar preferencias." },
      { status: 400 }
    );
  }
}
