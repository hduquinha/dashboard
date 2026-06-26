import { NextRequest, NextResponse } from "next/server";
import { assertAuthenticatedRequest } from "@/lib/auth";
import {
  getChatMessages,
  importChatMessages,
  listChatDates,
  parseChatHistory,
} from "@/lib/encontroChat";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request, { requireSameOriginForSession: false });
  } catch {
    return NextResponse.json({ success: false, error: "Nao autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const data = searchParams.get("data");

  try {
    if (!data) {
      const dates = await listChatDates();
      return NextResponse.json({ success: true, dates });
    }

    const messages = await getChatMessages(data);
    return NextResponse.json({ success: true, messages });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request, { requireSameOriginForSession: false });
  } catch {
    return NextResponse.json({ success: false, error: "Nao autorizado" }, { status: 401 });
  }

  let body: { data?: string; raw?: string; messages?: { horario: string; nome: string; mensagem: string }[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "JSON inválido" }, { status: 400 });
  }

  const { data, raw, messages: providedMessages } = body;
  if (!data) {
    return NextResponse.json({ success: false, error: "Campo 'data' obrigatório (YYYY-MM-DD)" }, { status: 400 });
  }

  const messages = providedMessages ?? (raw ? parseChatHistory(raw) : []);

  try {
    const result = await importChatMessages(data, messages);
    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
