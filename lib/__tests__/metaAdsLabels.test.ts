import { isAdvantagePlusAdset, readableAdsetName, readableCampaignName } from "@/lib/metaAdsLabels";

describe("nomes legíveis do Meta Ads", () => {
  test.each([
    [
      "PROXON | CAPTAÇÃO | IG/FB | AUTO | FRIO | LP FALAR EM PÚBLICO",
      "Proxon · Captação · IG/FB · Auto · Frio · Falar em público",
    ],
    [
      "PROXON | CAPTAÇÃO | IG/FB | AUTO | FRIO | TESTE DE CRIATIVO | LP FALAR EM PÚBLICO",
      "Proxon · Captação · IG/FB · Auto · Frio · Teste de criativo · Falar em público",
    ],
    [
      "PROXON | CAPTAÇÃO | IG/FB | AUTO | FRIO | LP GRAVAR VÍDEOS",
      "Proxon · Captação · IG/FB · Auto · Frio · Gravar vídeos",
    ],
    [
      "PROXON | CAPTAÇÃO | IG/FB | AUTO | FRIO | LP REUNIÕES",
      "Proxon · Captação · IG/FB · Auto · Frio · Reuniões",
    ],
    [
      "PROXON | CAPTAÇÃO | IG/FB | AUTO | FRIO | LP VENDAS",
      "Proxon · Captação · IG/FB · Auto · Frio · Vendas",
    ],
    [
      "PROXON | ENGAJAMENTO DA PUBLICAÇÃO | IG/FB",
      "Proxon · Engajamento da publicação · IG/FB",
    ],
  ])("mantém a identidade completa da campanha ao humanizar %s", (raw, expected) => {
    expect(readableCampaignName(raw)).toBe(expected);
  });

  it("gera rótulos diferentes para campanhas que só compartilham o tema final", () => {
    const a = readableCampaignName("PROXON | CAPTAÇÃO | IG/FB | AUTO | FRIO | LP FALAR EM PÚBLICO");
    const b = readableCampaignName(
      "PROXON | CAPTAÇÃO | IG/FB | AUTO | FRIO | TESTE DE CRIATIVO | LP FALAR EM PÚBLICO"
    );
    expect(a).not.toBe(b);
  });

  test.each([
    ["Conjunto 1 - Aberto", "Público aberto"],
    ["Conjunto 2 - Engajamento IG/FB", "Engajados no IG/FB"],
    ["Conjunto 3 - LAL Leads Vox2You", "Semelhante aos leads Vox2You"],
    ["Conjunto 4 - LAL 1% - ADV+", "Semelhante 1%"],
  ])("humaniza conjunto %s", (raw, expected) => {
    expect(readableAdsetName(raw)).toBe(expected);
  });

  it("identifica ADV+ para exibição separada do nome", () => {
    expect(isAdvantagePlusAdset("Conjunto 4 - LAL 1% - ADV+")).toBe(true);
    expect(isAdvantagePlusAdset("Conjunto 1 - Aberto")).toBe(false);
  });
});
