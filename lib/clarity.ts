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
 * Observação: os parâmetros de query usados nos deep links abaixo ("url")
 * não são API documentada do Clarity — se o Clarity ignorar, o link ainda
 * abre a área certa (heatmaps/gravações) e o filtro é aplicado à mão.
 */

export const CLARITY_PROJECT_ID: string =
  process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID || "__CLARITY_ID__";

export function hasClarityProject(): boolean {
  return CLARITY_PROJECT_ID.length > 0 && !CLARITY_PROJECT_ID.startsWith("__");
}

function base(view: "dashboard" | "heatmaps" | "recordings"): string {
  return `https://clarity.microsoft.com/projects/view/${CLARITY_PROJECT_ID}/${view}`;
}

/** Mapa de calor de uma página específica (cliques, scroll, área). */
export function clarityHeatmapUrl(pageUrl?: string | null): string {
  const params = new URLSearchParams({ date: "Last 30 days" });
  if (pageUrl) params.set("url", pageUrl);
  return `${base("heatmaps")}?${params.toString()}`;
}

/** Gravações de sessão; filtre por Campanha/Conteúdo UTM na UI do Clarity. */
export function clarityRecordingsUrl(): string {
  return `${base("recordings")}?${new URLSearchParams({ date: "Last 30 days" }).toString()}`;
}

export function clarityDashboardUrl(): string {
  return `${base("dashboard")}?${new URLSearchParams({ date: "Last 30 days" }).toString()}`;
}
