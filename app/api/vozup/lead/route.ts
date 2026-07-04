import { type NextRequest, NextResponse } from "next/server";
import { ingestVozupLead } from "@/lib/vozupLeadIngest";

export const dynamic = "force-dynamic";

const ALLOWED_ORIGINS = new Set([
  "https://www.escolavozup.com",
  "https://escolavozup.com",
  "https://vozup-workshop.vercel.app",
  "https://aula-experimental.vercel.app",
  "https://landingpage-vozup.vercel.app",
]);

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
    /^https:\/\/aula-experimental-.*\.vercel\.app$/.test(origin) ||
    /^https:\/\/landingpage-vozup-.*\.vercel\.app$/.test(origin)
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

  // Origem dinâmica: preserva o valor enviado pela landing page.
  // O padrão é "Landing Page VozUP" para compatibilidade com os filtros da Dashboard.
  const origemValor = String(raw.origem || "Landing Page VozUP").trim();
  const isLandingPage = origemValor.toLowerCase().includes("landing");

  const payload = {
    ...raw,
    nome,
    telefone,
    objetivo,
    unidade_negocio: "Voz UP",
    origem: origemValor,
    // treinamento_nome = origemValor garante que o sistema de etiquetas
    // gere "Entrada: <nome da landing page>" automaticamente.
    treinamento_nome: origemValor,
    _final: "true",
    aguarda_distribuicao: isLandingPage ? "true" : undefined,
  };

  const savedId = await ingestVozupLead(payload, { notify: isFinal || Boolean(nome) });
  if (savedId === null) {
    return NextResponse.json(
      { ok: false, error: "Erro ao salvar cadastro." },
      { status: 500, headers }
    );
  }

  return NextResponse.json({ ok: true, id: savedId }, { headers });
}
