/**
 * Cidade e UF do lead a partir do IP de quem enviou o formulário.
 *
 * Por que existe: os formulários de captação (landing pages VozUP) pedem só
 * nome e WhatsApp — cada campo a mais derruba conversão —, então o CRM não
 * tinha NENHUMA localização de lead pago (0 dos 527 leads atribuídos a anúncio
 * nos 90 dias até 24/08/2026). Pelo lado da Meta também não vem: o breakdown
 * `city` não existe na Marketing API e o `region` devolve uma linha só
 * ("São Paulo (state)"), porque a entrega é toda no mesmo estado. O IP de quem
 * preencheu é a única cidade que se consegue sem custar uma pergunta no
 * formulário.
 *
 * Precisão: IP de banda larga costuma acertar a cidade; IP de operadora móvel
 * cai com frequência na central da operadora (em geral a capital). Por isso o
 * valor entra no payload marcado com `cidade_fonte: "ip"` — é o que permite
 * separar depois uma cidade estimada de uma que a própria pessoa informou.
 */

export interface LeadGeo {
  cidade: string;
  /** Sigla do estado ("SP"), no mesmo formato do campo `estado` que já existe
   * nos payloads antigos. */
  uf: string;
}

const ENDPOINT = "https://ipwho.is";
/** A consulta responde em ~50ms; o teto existe só para o cadastro nunca ficar
 * refém do serviço externo. */
const TIMEOUT_MS = 1500;
/** O mesmo visitante reenvia o formulário (retentativa, segunda landing page).
 * Guardar a resposta evita repetir a consulta a cada envio. */
const CACHE_LIMIT = 500;
const cache = new Map<string, LeadGeo>();

/**
 * Faixas privadas, de loopback e link-local. Atrás do Caddy o cabeçalho pode
 * trazer o IP da rede interna do Docker, e geolocalizar isso descreveria o
 * servidor, não o visitante (o IP de saída desta VPS, por exemplo, resolve
 * como Boston/EUA).
 */
function isPublicIp(ip: string): boolean {
  if (!ip) return false;
  if (/^(10\.|127\.|192\.168\.|169\.254\.)/.test(ip)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return false;
  if (ip === "::1" || /^f[cd][0-9a-f]{2}:/i.test(ip) || /^fe80:/i.test(ip)) return false;
  return /^[0-9.]+$/.test(ip) || ip.includes(":");
}

/** Primeiro IP público da cadeia de proxies. */
export function clientIpFromHeaders(headers: Headers): string | null {
  const chain = [...(headers.get("x-forwarded-for") ?? "").split(","), headers.get("x-real-ip") ?? ""];
  for (const entry of chain) {
    // IPv6 pode vir entre colchetes e IPv4 pode vir com porta.
    const ip = entry.trim().replace(/^\[|\]$/g, "").replace(/^((?:\d+\.){3}\d+):\d+$/, "$1");
    if (isPublicIp(ip)) return ip;
  }
  return null;
}

/**
 * Resolve a cidade do IP. Nunca lança: cadastro sem cidade é muito melhor que
 * cadastro perdido, então qualquer falha vira `null` e o lead segue.
 */
export async function lookupLeadGeo(ip: string | null): Promise<LeadGeo | null> {
  if (!ip) return null;

  const cached = cache.get(ip);
  if (cached) return cached;

  try {
    const res = await fetch(`${ENDPOINT}/${encodeURIComponent(ip)}?fields=success,city,region_code`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;

    const data = (await res.json()) as { success?: boolean; city?: string; region_code?: string };
    const cidade = typeof data.city === "string" ? data.city.trim() : "";
    if (!data.success || !cidade) return null;

    const geo: LeadGeo = {
      cidade,
      uf: typeof data.region_code === "string" ? data.region_code.trim() : "",
    };
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(ip, geo);
    return geo;
  } catch (err) {
    console.warn("[leadGeo] Falha ao resolver cidade pelo IP:", err instanceof Error ? err.message : err);
    return null;
  }
}
