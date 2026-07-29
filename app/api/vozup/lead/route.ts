import { type NextRequest, NextResponse } from "next/server";
import { ingestVozupLead } from "@/lib/vozupLeadIngest";

export const dynamic = "force-dynamic";

const ALLOWED_ORIGINS = new Set([
  "https://www.escolavozup.com",
  "https://escolavozup.com",
  "https://vozup-workshop.vercel.app",
  "https://aula-experimental.vercel.app",
  "https://landingpage-vozup.vercel.app",
  "https://vozup-fala.vercel.app",
]);

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  // Um telefone local pode começar pelo DDD 55. Só considere o 55 como
  // código do país quando o tamanho já inclui os dois dígitos adicionais.
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    return digits;
  }
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isExplicitlyFinal(value: unknown): boolean {
  return value === true || value === "true";
}

function normalizePanfletoOrigin(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (normalized === "panfleto a") return "Panfleto A";
  if (normalized === "panfleto b") return "Panfleto B";
  return value.trim();
}

function isValidLeadName(value: string): boolean {
  const letters = value.match(/\p{L}/gu) ?? [];
  return value.length >= 2 && letters.length >= 2;
}

function isValidBrazilianPhone(value: string): boolean {
  const normalized = normalizePhone(value);
  if (normalized.length !== 12 && normalized.length !== 13) return false;

  const localNumber = normalized.slice(2);
  // DDD brasileiro válido tem dois algarismos e não começa com zero.
  return /^[1-9]\d/.test(localNumber);
}

function corsHeaders(origin: string | null) {
  const allowed = origin && (
    ALLOWED_ORIGINS.has(origin) ||
    /^https:\/\/vozup-workshop-.*\.vercel\.app$/.test(origin) ||
    /^https:\/\/aula-experimental-.*\.vercel\.app$/.test(origin) ||
    /^https:\/\/landingpage-vozup-.*\.vercel\.app$/.test(origin)
    || /^https:\/\/vozup-fala-.*\.vercel\.app$/.test(origin)
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
      const body: unknown = await req.json();
      return isRecord(body) ? body : {};
    }
    const text = await req.text();
    const body: unknown = JSON.parse(text);
    return isRecord(body) ? body : {};
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

  const nome = textValue(raw.nome) || textValue(raw.name);
  const telefone = textValue(raw.telefone) || textValue(raw.whatsapp) || textValue(raw.phone);
  const objetivo = textValue(raw.objetivo) || textValue(raw.interesse_workshop);
  const metaFinal = isRecord(raw._meta) ? raw._meta.final : undefined;
  const isFinal = isExplicitlyFinal(raw._final) || isExplicitlyFinal(metaFinal);

  // A rota é pública para as landing pages, portanto o servidor precisa ser
  // a última barreira contra interações de etapas intermediárias do formulário.
  // Não transformamos um payload parcial em cadastro final.
  if (!isFinal) {
    return NextResponse.json(
      {
        ok: false,
        error: "Conclua o formulário antes de enviar o cadastro.",
      },
      { status: 422, headers }
    );
  }

  if (!isValidLeadName(nome) || !isValidBrazilianPhone(telefone)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Informe um nome e um telefone brasileiro válidos para concluir o cadastro.",
      },
      { status: 422, headers }
    );
  }

  // Origem dinâmica: preserva o valor enviado pela landing page.
  // O padrão é "Landing Page VozUP" para compatibilidade com os filtros da Dashboard.
  const origemValor = normalizePanfletoOrigin(String(raw.origem || "Landing Page VozUP"));
  const isLandingPage = origemValor.toLowerCase().includes("landing");
  const isPanfleto = /^panfleto [ab]$/i.test(origemValor);

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
    aguarda_distribuicao: isLandingPage || isPanfleto ? "true" : undefined,
  };

  const savedId = await ingestVozupLead(payload, { notify: true });
  if (savedId === null) {
    return NextResponse.json(
      { ok: false, error: "Erro ao salvar cadastro." },
      { status: 500, headers }
    );
  }

  return NextResponse.json({ ok: true, id: savedId }, { headers });
}
