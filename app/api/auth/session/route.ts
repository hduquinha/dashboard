import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  DASHBOARD_COOKIE_NAME,
  getDashboardSession,
  getSessionCookieMaxAge,
} from "@/lib/auth";
import {
  dashboardUsersDiffer,
  getFreshDashboardSession,
  refreshedDashboardSessionValue,
} from "@/lib/dashboardSession";
import { listFunnelsForUser } from "@/lib/funnels";

export const dynamic = "force-dynamic";

function expireSessionCookie(response: NextResponse): void {
  response.cookies.set(DASHBOARD_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.DASHBOARD_COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

/** Mantém permissões e flags do usuário sincronizadas sem logout/login. */
export async function GET(): Promise<NextResponse> {
  const cookieStore = await cookies();
  const token = cookieStore.get(DASHBOARD_COOKIE_NAME)?.value;
  const previous = getDashboardSession(token);
  const current = await getFreshDashboardSession(token);

  if (!current) {
    const response = NextResponse.json({ authenticated: false }, { status: 401 });
    expireSessionCookie(response);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  const funnels = await listFunnelsForUser(current.user);
  const accessFingerprint = JSON.stringify(
    funnels.map((funnel) => ({
      id: funnel.id,
      updatedAt: funnel.updatedAt,
      sellerIds: funnel.sellerIds,
      stages: funnel.stages.map((stage) => ({
        id: stage.id,
        key: stage.key,
        label: stage.label,
        kind: stage.kind,
        board: stage.board,
        position: stage.position,
      })),
    }))
  );
  const changed =
    !previous ||
    dashboardUsersDiffer(previous.user, current.user) ||
    previous.accessFingerprint !== accessFingerprint;
  const response = NextResponse.json({ authenticated: true, changed });

  if (changed) {
    const sessionValue = refreshedDashboardSessionValue({ ...current, accessFingerprint });
    if (sessionValue) {
      response.cookies.set(DASHBOARD_COOKIE_NAME, sessionValue, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.DASHBOARD_COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production",
        path: "/",
        maxAge: getSessionCookieMaxAge(sessionValue),
        priority: "high",
      });
    }
  }

  response.headers.set("Cache-Control", "no-store");
  return response;
}
