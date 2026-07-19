import {
  hasPaidMetaEvidence,
  isMetaAdsWithoutPaidEvidence,
  normalizeMetaAdsAttributionPayload,
} from "@/lib/vozupTrafficAttribution";

describe("normalizeMetaAdsAttributionPayload", () => {
  const organicLinkInBio = {
    origem: "Meta Ads VozUP - Home",
    treinamento_nome: "Meta Ads VozUP - Home",
    landing_page_grupo: "Home",
    campaign_name: "Home",
    utm_source: "ig",
    utm_medium: "social",
    utm_content: "link_in_bio",
    fbclid: "click-organico-meta",
    dashboard_origens_adicionais: [
      "Meta Ads VozUP - Home",
      "Landing Page VozUP - Home",
    ],
  };

  it("reclassifica link da bio como landing organica antes do merge", () => {
    const normalized = normalizeMetaAdsAttributionPayload(organicLinkInBio);

    expect(hasPaidMetaEvidence(organicLinkInBio)).toBe(false);
    expect(isMetaAdsWithoutPaidEvidence(organicLinkInBio)).toBe(true);
    expect(normalized).toMatchObject({
      origem: "Landing Page VozUP - Home",
      treinamento_nome: "Landing Page VozUP - Home",
      utm_source: "ig",
      utm_medium: "social",
      utm_content: "link_in_bio",
      fbclid: "click-organico-meta",
      campaign_name: "Home",
      dashboard_origens_adicionais: ["Landing Page VozUP - Home"],
    });
    expect(organicLinkInBio.origem).toBe("Meta Ads VozUP - Home");
  });

  it("reclassifica Meta sem evidencia paga mesmo fora do link da bio", () => {
    const normalized = normalizeMetaAdsAttributionPayload({
      origem: "Meta Ads - Vendas",
      utm_source: "facebook",
      utm_medium: "social",
      utm_campaign: "campanha-organica-de-conteudo",
      utm_content: "post-organico",
      fbclid: "click-organico-meta",
    });

    expect(normalized.origem).toBe("Landing Page VozUP - Vendas");
  });

  it.each([
    { utm_source: "ig", fbclid: "click-meta" },
    { utm_source: "facebook", utm_medium: "social", fbclid: "click-meta" },
    { fbclid: "click-meta" },
  ])("nao aceita fbclid/source generica como prova paga: %o", (tracking) => {
    const normalized = normalizeMetaAdsAttributionPayload({
      origem: "Meta Ads VozUP - Home",
      ...tracking,
    });

    expect(normalized.origem).toBe("Landing Page VozUP - Home");
  });

  it("preserva Meta pago real com UTMs completas", () => {
    const paid = {
      origem: "Meta Ads VozUP - Gravar Videos",
      treinamento_nome: "Meta Ads VozUP - Gravar Videos",
      utm_source: "facebookads",
      utm_medium: "cpc",
      utm_campaign: "PROXON | CAPTACAO",
      utm_term: "99_INTERESSES",
      utm_content: "VOZUP_AD09_IMG_AUTO",
      fbclid: "click-pago-meta",
    };

    expect(hasPaidMetaEvidence(paid)).toBe(true);
    expect(isMetaAdsWithoutPaidEvidence(paid)).toBe(false);
    expect(normalizeMetaAdsAttributionPayload(paid)).toBe(paid);
  });

  it.each([
    ["utm_medium", "ppc"],
    ["utm_medium", "paid_social"],
    ["utm_medium", "cpm"],
    ["utm_source", "metaads"],
    ["utm_source", "instagram_ads"],
    ["utm_source", "facebookads_custom"],
    ["campaign_id", "123"],
    ["adset_id", "456"],
    ["ad_id", "789"],
  ])("preserva Meta quando existe o sinal pago %s", (key, value) => {
    const payload = { ...organicLinkInBio, [key]: value };

    expect(hasPaidMetaEvidence(payload)).toBe(true);
    expect(isMetaAdsWithoutPaidEvidence(payload)).toBe(false);
    expect(normalizeMetaAdsAttributionPayload(payload)).toBe(payload);
  });

  it("trio textual de UTMs sem sinal pago continua organico", () => {
    const organic = {
      origem: "Meta Ads VozUP - Reunioes",
      utm_source: "facebook",
      utm_medium: "social",
      utm_campaign: "campanha-de-conteudo",
      utm_term: "publico-organico",
      utm_content: "post-organico",
      fbclid: "click-organico-meta",
    };

    expect(hasPaidMetaEvidence(organic)).toBe(false);
    expect(normalizeMetaAdsAttributionPayload(organic).origem).toBe(
      "Landing Page VozUP - Reunioes"
    );
  });

  it("nao usa medium pago do Google como evidencia Meta", () => {
    const google = {
      origem: "Meta Ads VozUP - Vendas",
      utm_source: "google",
      utm_medium: "cpc",
      gclid: "click-pago-google",
    };

    expect(hasPaidMetaEvidence(google)).toBe(false);
    expect(normalizeMetaAdsAttributionPayload(google).origem).toBe(
      "Landing Page VozUP - Vendas"
    );
  });

  it("nao altera a identidade de outro produto", () => {
    const aula = {
      origem: "Aula Exclusiva",
      treinamento_nome: "Aula Exclusiva 18/07/2026",
      utm_source: "ig",
      utm_medium: "social",
      utm_content: "link_in_bio",
      fbclid: "click-organico-meta",
    };

    expect(isMetaAdsWithoutPaidEvidence(aula)).toBe(false);
    expect(normalizeMetaAdsAttributionPayload(aula)).toBe(aula);
  });
});
