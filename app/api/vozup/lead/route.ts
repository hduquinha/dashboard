import { type NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

const ALLOWED_ORIGINS = new Set([
  "https://www.escolavozup.com",
  "https://escolavozup.com",
  "https://vozup-workshop.vercel.app",
  "https://aula-experimental.vercel.app",
]);

const NOTIFY_NUMBER = "5511988874277";

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55")) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function corsHeaders(origin: string | null) {
  const allowed = origin && (
    ALLOWED_ORIGINS.has(origin) ||
    /^https:\/\/vozup-workshop-.*\.vercel\.app$/.test(origin) ||
    /^https:\/\/aula-experimental-.*\.vercel\.app$/.test(origin)
  );
  return {
    "Access-Control-Allow-Origin": allowed ? origin! : "",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

async function parseBody(req: NextRequest): Promise<Record<string, unknown>> {
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      return await req.json();
    }
    const text = await req.text();
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function buildNotifyMessage(payload: Record<string, unknown>): string {
  const nome = String(payload.nome || payload.name || "—");
  const tel = String(payload.telefone || payload.whatsapp || payload.phone || "—");
  const objetivo = String(payload.objetivo || payload.interesse_workshop || "—");
  const origem = String(payload.origem || "VozUP");
  const hora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  return [
    "🎤 *Novo lead VozUP*",
    `Nome: ${nome}`,
    `WhatsApp: ${tel}`,
    `Objetivo: ${objetivo}`,
    `Origem: ${origem}`,
    `Recebido: ${hora}`,
  ].join("\n");
}

async function sendWhatsApp(text: string): Promise<void> {
  const baseUrl = (process.env.UAZAPI_SERVER_URL ?? "https://vozup.uazapi.com").replace(/\/+$/, "");
  const token = process.env.UAZAPI_INSTANCE_TOKEN?.trim();
  if (!token) {
    console.warn("[vozup/lead] UAZAPI_INSTANCE_TOKEN não configurado — WhatsApp ignorado.");
    return;
  }

  const res = await fetch(`${baseUrl}/send/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token },
    body: JSON.stringify({ number: NOTIFY_NUMBER, text, readchat: false }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[vozup/lead] Falha UazAPI:", res.status, body.slice(0, 200));
  }
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  const raw = await parseBody(req);

  const nome = String(raw.nome || raw.name || "").trim();
  const telefone = String(raw.telefone || raw.whatsapp || raw.phone || "").trim();
  const objetivo = String(raw.objetivo || raw.interesse_workshop || "").trim();
  const metaFinal = (raw._meta as Record<string, unknown> | undefined)?.final;
  const isFinal = raw._final === true || raw._final === "true" || metaFinal === true;

  const origemValor = String(raw.origem || "VozUP Landing");
  const isLandingPage = origemValor.toLowerCase().includes("landing");

  const payload = {
    ...raw,
    nome,
    telefone,
    objetivo,
    unidade_negocio: "Voz UP",
    origem: origemValor,
    _final: "true",
    aguarda_distribuicao: isLandingPage ? "true" : undefined,
  };

  // Salvar no banco
  let savedId: number | null = null;
  try {
    const pool = getPool();
    const result = await pool.query<{ id: number }>(
      "INSERT INTO inscricoes.inscricoes (payload) VALUES ($1) RETURNING id",
      [JSON.stringify(payload)]
    );
    savedId = result.rows[0]?.id ?? null;
  } catch (err) {
    console.error("[vozup/lead] Erro ao salvar no banco:", err);
    return NextResponse.json(
      { ok: false, error: "Erro ao salvar cadastro." },
      { status: 500, headers }
    );
  }

  // Notificar WhatsApp (fire and forget)
  if (isFinal || nome) {
    sendWhatsApp(buildNotifyMessage(payload)).catch((err) => {
      console.error("[vozup/lead] Erro ao enviar WhatsApp:", err);
    });
  }

  return NextResponse.json({ ok: true, id: savedId }, { headers });
}
