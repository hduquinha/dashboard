import { isOwnSiteDestination, landingPageCompletion } from "@/lib/metaAdsEngagement";
import type { EngagementMetrics } from "@/types/metaAds";

function metrics(linkClicks: number, landingPageViews: number): EngagementMetrics {
  return {
    videoViews: 0,
    linkClicks,
    landingPageViews,
    postEngagement: 0,
    pageEngagement: 0,
    reactions: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    messagingStarted: 0,
  };
}

describe("isOwnSiteDestination", () => {
  it("reconhece as páginas do próprio site", () => {
    expect(isOwnSiteDestination("https://www.escolavozup.com/forms/vendas/6-perguntas")).toBe(true);
    expect(isOwnSiteDestination("https://escolavozup.com/")).toBe(true);
    expect(isOwnSiteDestination("https://dashboard.escolavozup.com/x")).toBe(true);
  });

  it("recusa destinos onde o nosso pixel não roda", () => {
    // Anúncio de visita ao perfil e formulário nativo nunca geram
    // landing_page_view — incluí-los no cálculo inventa uma perda inexistente.
    expect(isOwnSiteDestination("http://instagram.com/escola_vozup")).toBe(false);
    expect(isOwnSiteDestination("https://fb.me/abc")).toBe(false);
    expect(isOwnSiteDestination(null)).toBe(false);
    expect(isOwnSiteDestination("")).toBe(false);
    expect(isOwnSiteDestination("nao-e-url")).toBe(false);
  });

  it("não confunde domínio de terceiro que só termina parecido", () => {
    expect(isOwnSiteDestination("https://escolavozup.com.exemplo.com/")).toBe(false);
  });
});

describe("landingPageCompletion", () => {
  it("mede a proporção de cliques que viraram carregamento de página", () => {
    expect(landingPageCompletion(metrics(274, 201))).toBeCloseTo(73.36, 1);
  });

  it("devolve null sem cliques, em vez de zero", () => {
    // Zero afirmaria "perdeu tudo"; a verdade é que não há o que medir.
    expect(landingPageCompletion(metrics(0, 0))).toBeNull();
  });
});
