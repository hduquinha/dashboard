import { NextResponse, type NextRequest } from "next/server";
import { requireTasksMaster } from "@/lib/tasksApi";
import { createApiToken, listApiTokens } from "@/lib/taskAutomations";

export const dynamic = "force-dynamic";

/**
 * Tokens de API são chave de acesso ao módulo inteiro — só super master
 * cria e lista. O valor em claro aparece uma única vez, na criação.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTasksMaster(request);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ tokens: await listApiTokens() });
}

export async function POST(request: NextRequest) {
  const auth = await requireTasksMaster(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  const email = auth.user.email;
  if (!email) return NextResponse.json({ error: "Usuario sem email." }, { status: 400 });
  const created = await createApiToken(String(body?.name ?? "Token"), email);
  return NextResponse.json(created);
}
