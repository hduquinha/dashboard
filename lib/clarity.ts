/**
 * Integração com o Microsoft Clarity (mapa de calor / gravação de sessões
 * das landing pages e formulários).
 *
 * Usamos UM projeto Clarity para o ecossistema inteiro (VozUP + Instituto UP);
 * cada página é distinguida pela própria URL e cada sessão carrega tags
 * customizadas (produto, anuncio, campanha — ver clarity.js de cada repo).
 *
 * O ID é carimbado por tools/set-clarity-id.sh (mesmo ID dos formulários);
 * NEXT_PUBLIC_CLARITY_PROJECT_ID, se definido no build, tem prioridade.
 *
 * Observação: o deep link de heatmap usa o formato que a PRÓPRIA UI do
 * Clarity gera ao focar uma página (capturado em 2026-07-19 no projeto demo
 * público): ?heatmapDeviceType=2&heatmapType=0&URL=2;<op>;<url>, onde
 * op 0 = "starts with" e op 4 = "is exactly". Não é API documentada — se a
 * Microsoft mudar o formato, o link degrada para a lista de heatmaps e o
 * usuário escolhe a página à mão (nada quebra).
 */

export const CLARITY_PROJECT_ID: string =
  process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID || "xonuuydq5e";

export function hasClarityProject(): boolean {
  return CLARITY_PROJECT_ID.length > 0 && !CLARITY_PROJECT_ID.startsWith("__");
}

function base(view: "dashboard" | "heatmaps" | "recordings"): string {
  return `https://clarity.microsoft.com/projects/view/${CLARITY_PROJECT_ID}/${view}`;
}

/**
 * Mapa de calor de uma página específica (cliques, scroll, área), já aberto
 * focado nela. match "prefix" (padrão) casa também as visitas com query
 * string (?utm_..., gclid, fbclid) — essencial para tráfego de anúncio;
 * "exact" serve para a home, onde prefixo casaria o site inteiro.
 */
export function clarityHeatmapUrl(
  pageUrl?: string | null,
  opts: { match?: "prefix" | "exact" } = {}
): string {
  const params = new URLSearchParams({ date: "Last 30 days" });
  if (pageUrl) {
    params.set("heatmapDeviceType", "2"); // aba desktop (troca-se na UI)
    params.set("heatmapType", "0"); // mapa de cliques
    params.set("URL", `2;${opts.match === "exact" ? "4" : "0"};${pageUrl}`);
  }
  return `${base("heatmaps")}?${params.toString()}`;
}

/** Gravações de sessão; filtre por Campanha/Conteúdo UTM na UI do Clarity. */
export function clarityRecordingsUrl(): string {
  return `${base("recordings")}?${new URLSearchParams({ date: "Last 30 days" }).toString()}`;
}

export function clarityDashboardUrl(): string {
  return `${base("dashboard")}?${new URLSearchParams({ date: "Last 30 days" }).toString()}`;
}
