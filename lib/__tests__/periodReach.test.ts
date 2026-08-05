import { reachHint, resolveCampaignReach, resolveScopeReach } from "@/lib/periodReach";
import type { PeriodReachData } from "@/types/metaAds";

const periodReach: PeriodReachData = {
  from: "2026-07-27",
  to: "2026-08-02",
  account: { reach: 29899, impressions: 42505, spend: 1516.65, clicks: 635, leads: 0, frequency: 1.421619 },
  byCampaign: {
    "c1": { reach: 6662, impressions: 10426, spend: 377.85, clicks: 205, leads: 0, frequency: 1.564996 },
  },
  byAdset: {
    "s1": { reach: 2804, impressions: 3874, spend: 349.85, clicks: 121, leads: 0, frequency: 1.381598 },
  },
  syncedAt: "2026-08-03T14:31:19.000Z",
};

const baseScope = {
  periodReach,
  exactScope: true,
  selectedCampaignId: null,
  selectedAdsetId: null,
  summedReach: 40039,
  impressions: 42505,
};

describe("resolveScopeReach", () => {
  it("usa o alcance deduplicado da conta, não a soma dos anúncios", () => {
    const resolved = resolveScopeReach(baseScope);
    expect(resolved.reach).toBe(29899);
    expect(resolved.exact).toBe(true);
    expect(resolved.frequency).toBeCloseTo(1.42, 2);
  });

  it("desce para campanha e conjunto conforme a seleção", () => {
    expect(resolveScopeReach({ ...baseScope, selectedCampaignId: "c1" }).reach).toBe(6662);
    expect(resolveScopeReach({ ...baseScope, selectedCampaignId: "c1", selectedAdsetId: "s1" }).reach).toBe(2804);
  });

  it("cai para a soma — marcada como soma — quando o recorte não é um objeto da Meta", () => {
    const resolved = resolveScopeReach({ ...baseScope, exactScope: false });
    expect(resolved.reach).toBe(40039);
    expect(resolved.exact).toBe(false);
    expect(reachHint(resolved)).toContain("mais de uma vez");
  });

  it("cai para a soma quando a Meta ainda não respondeu aquela janela", () => {
    const semCache: PeriodReachData = { ...periodReach, account: null };
    const resolved = resolveScopeReach({ ...baseScope, periodReach: semCache });
    expect(resolved.reach).toBe(40039);
    expect(resolved.exact).toBe(false);
  });

  it("não confunde o alcance de uma campanha com o de outra", () => {
    const resolved = resolveCampaignReach({
      periodReach,
      exactScope: true,
      campaignId: "c2",
      summedReach: 1200,
      impressions: 1500,
    });
    expect(resolved.reach).toBe(1200);
    expect(resolved.exact).toBe(false);
  });
});
