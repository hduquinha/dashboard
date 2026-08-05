import { addEngagement, emptyEngagement } from "@/lib/metaAdsEngagement";
import type { AdDestinationGroup, AdDestinationInfo, AdDestinationKind, AdRow } from "@/types/metaAds";

/**
 * Onde o anúncio entrega o clique — a pergunta "esse anúncio é do formulário
 * nativo da Meta ou manda pra uma landing page nossa?".
 *
 * A prova vem de `meta_ads.ads.landing_url` (extraído do criativo no sync):
 * anúncios de formulário instantâneo não têm página externa, então a Meta
 * devolve um placeholder no domínio dela (`fb.me`) — os leads desses anúncios
 * são exatamente os que chegam com `origem: "Facebook Lead Ads"` e `ad_id`.
 * Anúncios de landing page apontam pro `/forms/<tema>/<variante>` do site, que
 * é o que vira `origem: "Meta Ads VozUP - <Tema>"` via UTM.
 *
 * Isto NÃO muda o produto do lead (ver docs/cartilha-formularios-produtos.md
 * §4.1): é só o agrupamento de mídia, para comparar custo por lead entre o
 * formulário nativo e cada landing page.
 */

/** Domínios que a Meta usa quando o destino é um formulário dentro dela. */
const NATIVE_FORM_HOSTS = new Set(["fb.me", "www.fb.me", "m.me", "fb.com", "www.fb.com"]);

/** Temas das landing pages da VozUP (slug da rota → nome legível com acento).
 * Ver landingpage-vozup/src/lib/landingPages.ts (TOPICS) — manter em sincronia
 * quando um tema novo entrar no ar; slugs desconhecidos caem no fallback. */
const LANDING_TOPIC_LABELS: Record<string, string> = {
  vendas: "Vendas",
  "gravar-videos": "Gravar Vídeos",
  "falar-em-publico": "Falar em Público",
  reunioes: "Reuniões",
  "autoridade-digital": "Autoridade Digital",
};

const LANDING_VARIANT_LABELS: Record<string, string> = {
  "6-perguntas": "6 perguntas",
  "4-perguntas": "4 perguntas",
  // "3-perguntas" virou "2-perguntas" (só nome e telefone) e hoje só redireciona,
  // mas segue aqui porque anúncios antigos guardam a URL antiga no criativo.
  "3-perguntas": "3 perguntas",
  "2-perguntas": "2 perguntas",
};

export const NATIVE_FORM_GROUP_KEY = "native_form";
export const UNKNOWN_GROUP_KEY = "unknown";

function prettifySlug(slug: string): string {
  const words = slug.split(/[-_]/).filter(Boolean);
  if (words.length === 0) return slug;
  return words.map((word) => word.charAt(0).toLocaleUpperCase("pt-BR") + word.slice(1)).join(" ");
}

/** Classifica o destino de um anúncio a partir da URL do criativo. */
export function classifyAdDestination(landingUrl: string | null): AdDestinationInfo {
  const raw = landingUrl?.trim();
  if (!raw) {
    return {
      kind: "unknown",
      key: UNKNOWN_GROUP_KEY,
      label: "Sem destino de cadastro",
      detail: "A Meta não informou página — o caso típico é anúncio de engajamento, que não tem formulário",
      url: null,
    };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "unknown", key: `${UNKNOWN_GROUP_KEY}:${raw}`, label: raw, detail: null, url: null };
  }

  const host = url.hostname.toLocaleLowerCase("pt-BR");
  if (NATIVE_FORM_HOSTS.has(host)) {
    return {
      kind: "native_form",
      key: NATIVE_FORM_GROUP_KEY,
      label: "Formulário nativo do Meta",
      detail: "Lead Ads — a pessoa preenche dentro do Instagram/Facebook",
      url: null,
    };
  }

  const segments = decodeURIComponent(url.pathname).split("/").filter(Boolean);
  const pageUrl = `${url.origin}${url.pathname.replace(/\/$/, "")}`;

  if (segments[0] === "forms" && segments[1]) {
    const topic = segments[1];
    const variant = segments[2] ?? null;
    const topicLabel = LANDING_TOPIC_LABELS[topic] ?? prettifySlug(topic);
    const variantLabel = variant ? (LANDING_VARIANT_LABELS[variant] ?? prettifySlug(variant)) : null;
    return {
      kind: "landing_page",
      key: `lp:${topic}${variant ? `/${variant}` : ""}`,
      label: `LP ${topicLabel}`,
      detail: variantLabel,
      url: pageUrl,
    };
  }

  // Landing fora de /forms (home, página de campanha avulsa): agrupa pelo path.
  const pathLabel = segments.length > 0 ? prettifySlug(segments.join(" ")) : "Home";
  return {
    kind: "landing_page",
    key: `lp:${url.pathname.replace(/\/$/, "") || "/"}`,
    label: `LP ${pathLabel}`,
    detail: host,
    url: pageUrl,
  };
}

/** Investimento ÷ quantidade — o "custo médio" que a tela precisa em vários
 * níveis (grupo, dia, campanha, anúncio). Divisão por zero vira null para a UI
 * mostrar "—" em vez de "R$ 0,00", que leria como "de graça". */
export function costPer(spend: number, count: number): number | null {
  return count > 0 ? spend / count : null;
}

/** Ordem de exibição: formulário nativo primeiro (é o grupo de comparação),
 * depois as landing pages por gasto, e o que não deu pra identificar no fim. */
const KIND_ORDER: Record<AdDestinationKind, number> = {
  native_form: 0,
  landing_page: 1,
  unknown: 2,
};

/**
 * Agrupa os anúncios do recorte atual por destino. Os anúncios já vêm somados
 * por `ad_id` (um por conjunto), então o total de um grupo é a soma direta —
 * cada cadastro do CRM casa com exatamente um `ad_id` (ver LEAD_AD_ID em
 * lib/metaAds.ts), logo não há dupla contagem entre grupos.
 */
export function buildAdDestinationGroups(ads: AdRow[]): AdDestinationGroup[] {
  const byKey = new Map<string, AdDestinationGroup>();

  for (const ad of ads) {
    const destination = classifyAdDestination(ad.landingUrl);
    let group: AdDestinationGroup | undefined = byKey.get(destination.key);
    if (!group) {
      group = {
        ...emptyEngagement(),
        key: destination.key,
        kind: destination.kind,
        label: destination.label,
        detail: destination.detail,
        url: destination.url,
        ads: [],
        creativeCount: 0,
        campaignCount: 0,
        adsetCount: 0,
        spend: 0,
        impressions: 0,
        reach: 0,
        clicks: 0,
        leadsMeta: 0,
        cadastrosCrm: 0,
        envios: 0,
        descartados: 0,
        repetidos: 0,
        recontatos: 0,
        novos: 0,
        leadsCrm: 0,
        leadsQualificados: 0,
        leadsFechados: 0,
        valorFechado: 0,
        stageCounts: {},
        ctr: null,
        cpc: null,
        cpm: null,
        custoPorCadastro: null,
        custoPorContato: null,
        custoPorVenda: null,
      };
      byKey.set(destination.key, group);
    }

    group.ads.push(ad);
    group.spend += ad.spend;
    group.impressions += ad.impressions;
    group.reach += ad.reach;
    group.clicks += ad.clicks;
    group.leadsMeta += ad.leadsMeta;
    group.cadastrosCrm += ad.cadastrosCrm;
    group.envios += ad.envios;
    group.descartados += ad.descartados;
    group.repetidos += ad.repetidos;
    group.recontatos += ad.recontatos;
    group.novos += ad.novos;
    group.leadsCrm += ad.leadsCrm;
    group.leadsQualificados += ad.leadsQualificados;
    group.leadsFechados += ad.leadsFechados;
    group.valorFechado += ad.valorFechado;
    addEngagement(group, ad);
    for (const [stageKey, count] of Object.entries(ad.stageCounts)) {
      group.stageCounts[stageKey] = (group.stageCounts[stageKey] ?? 0) + count;
    }
  }

  const groups = Array.from(byKey.values());
  for (const group of groups) {
    group.creativeCount = new Set(group.ads.map((ad) => ad.adName)).size;
    group.campaignCount = new Set(group.ads.map((ad) => ad.campaignId)).size;
    group.adsetCount = new Set(group.ads.map((ad) => ad.adsetId)).size;
    group.ctr = group.impressions > 0 ? (group.clicks / group.impressions) * 100 : null;
    group.cpc = costPer(group.spend, group.clicks);
    group.cpm = group.impressions > 0 ? (group.spend / group.impressions) * 1000 : null;
    group.custoPorCadastro = costPer(group.spend, group.cadastrosCrm);
    group.custoPorContato = costPer(group.spend, group.leadsCrm);
    group.custoPorVenda = costPer(group.spend, group.leadsFechados);
    group.ads.sort((a, b) => b.spend - a.spend);
  }

  return groups.sort((a, b) => {
    const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (byKind !== 0) return byKind;
    if (b.spend !== a.spend) return b.spend - a.spend;
    return a.label.localeCompare(b.label, "pt-BR");
  });
}

export interface DestinationKindSummary {
  kind: AdDestinationKind;
  label: string;
  groupCount: number;
  spend: number;
  cadastrosCrm: number;
  leadsCrm: number;
  leadsQualificados: number;
  leadsFechados: number;
  custoPorCadastro: number | null;
  custoPorContato: number | null;
}

const KIND_LABELS: Record<AdDestinationKind, string> = {
  native_form: "Formulário nativo do Meta",
  landing_page: "Landing pages do site",
  unknown: "Sem destino de cadastro",
};

/** Rollup de um nível acima: nativo × landing pages, que é a comparação de
 * estratégia (formulário dentro da Meta vs site próprio). */
export function summarizeByKind(groups: AdDestinationGroup[]): DestinationKindSummary[] {
  const byKind = new Map<AdDestinationKind, DestinationKindSummary>();

  for (const group of groups) {
    let summary = byKind.get(group.kind);
    if (!summary) {
      summary = {
        kind: group.kind,
        label: KIND_LABELS[group.kind],
        groupCount: 0,
        spend: 0,
        cadastrosCrm: 0,
        leadsCrm: 0,
        leadsQualificados: 0,
        leadsFechados: 0,
        custoPorCadastro: null,
        custoPorContato: null,
      };
      byKind.set(group.kind, summary);
    }
    summary.groupCount += 1;
    summary.spend += group.spend;
    summary.cadastrosCrm += group.cadastrosCrm;
    summary.leadsCrm += group.leadsCrm;
    summary.leadsQualificados += group.leadsQualificados;
    summary.leadsFechados += group.leadsFechados;
  }

  const summaries = Array.from(byKind.values());
  for (const summary of summaries) {
    summary.custoPorCadastro = costPer(summary.spend, summary.cadastrosCrm);
    summary.custoPorContato = costPer(summary.spend, summary.leadsCrm);
  }

  return summaries.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}
