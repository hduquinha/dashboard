import { classifyCampaignChannel } from "@/lib/productivityChannels";

describe("classifyCampaignChannel", () => {
  it("returns null when there is no campaign data", () => {
    expect(classifyCampaignChannel(null, null)).toBeNull();
    expect(classifyCampaignChannel("", "")).toBeNull();
  });

  it("classifies student referrals", () => {
    expect(classifyCampaignChannel("Indicacao de aluno", null)).toBe("indicacao_aluno");
  });

  it("classifies Instagram direct", () => {
    expect(classifyCampaignChannel("instagram direct", null)).toBe("instagram_direct_espontaneo");
  });

  it("classifies Google campaigns", () => {
    expect(classifyCampaignChannel("google_ads", "Campanha M4 Google")).toBe("m4_google");
  });

  it("classifies Meta WhatsApp campaigns before generic Meta", () => {
    expect(classifyCampaignChannel("meta", "Campanha WhatsApp")).toBe("m4_meta_wpp");
  });

  it("classifies generic Meta/Facebook campaigns", () => {
    expect(classifyCampaignChannel("facebook", "Campanha nativos")).toBe("m4_meta_nativos");
  });

  it("classifies organic site traffic", () => {
    expect(classifyCampaignChannel("site", null)).toBe("site");
  });

  it("returns null for unrecognized sources", () => {
    expect(classifyCampaignChannel("fonte-desconhecida-xyz", null)).toBeNull();
  });
});
