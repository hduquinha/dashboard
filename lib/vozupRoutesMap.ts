/**
 * Referência estática das rotas de landing page criadas em landingpage-vozup
 * (projeto separado, sem import compartilhado em tempo de build) para a
 * página /vozup/rotas. Se uma rota mudar em landingpage-vozup/src/lib/landingPages.ts,
 * atualizar aqui também.
 *
 * A variante curta atual é "3-perguntas" (nome, telefone e profissão). As rotas
 * antigas "2-perguntas" continuam no ar apenas redirecionando, por causa dos
 * anúncios já veiculados. Ver LEGACY_ROUTE_REDIRECTS em landingPages.ts.
 *
 * Uma rota pode servir um formulário diferente do que o nome dela diz: trocar a
 * URL de um anúncio em veiculação zera o aprendizado da campanha no Meta, então
 * a rota fica onde está, sem redirect, e o formulário é que muda
 * (ADVERTISED_ROUTE_FORMS em landingPages.ts). A coluna "variante" abaixo é o
 * que a pessoa realmente responde — é ela que casa com a origem gravada no lead.
 *
 * Rota única por tema/variante — o canal (direto, Google Ads, Meta) não vem
 * da URL, vem do UTM (ou clique automático gclid/fbclid) capturado no
 * instante do clique no anúncio. Ver getTrafficSource() em
 * landingpage-vozup/src/lib/trafficSource.ts e a condição de cada pasta em
 * dashboard/lib/vozupFolders.ts.
 */

export interface VozupRouteRow {
  rota: string;
  tema: string;
  variante: string;
}

export const VOZUP_ROUTES: VozupRouteRow[] = [
  { rota: "/", tema: "Home", variante: "—" },
  { rota: "/forms/vendas/6-perguntas", tema: "Vendas", variante: "6 perguntas" },
  { rota: "/forms/vendas/4-perguntas", tema: "Vendas", variante: "4 perguntas" },
  { rota: "/forms/vendas/3-perguntas", tema: "Vendas", variante: "3 perguntas" },
  // Destino dos anúncios de LP de Gravar Vídeos: URL mantida, formulário de 3
  // perguntas desde 28/08/2026.
  { rota: "/forms/gravar-videos/6-perguntas", tema: "Gravar Vídeos", variante: "3 perguntas" },
  { rota: "/forms/gravar-videos/4-perguntas", tema: "Gravar Vídeos", variante: "4 perguntas" },
  { rota: "/forms/gravar-videos/3-perguntas", tema: "Gravar Vídeos", variante: "3 perguntas" },
  // Destino dos anúncios de LP de Falar em Público: URL antiga mantida (era
  // redirect até 28/08/2026), hoje página real com o formulário de 3 perguntas.
  { rota: "/forms/falar-em-publico/2-perguntas", tema: "Falar em Público", variante: "3 perguntas" },
  { rota: "/forms/falar-em-publico/6-perguntas", tema: "Falar em Público", variante: "6 perguntas" },
  { rota: "/forms/falar-em-publico/4-perguntas", tema: "Falar em Público", variante: "4 perguntas" },
  { rota: "/forms/falar-em-publico/3-perguntas", tema: "Falar em Público", variante: "3 perguntas" },
  { rota: "/forms/reunioes/6-perguntas", tema: "Reuniões", variante: "6 perguntas" },
  { rota: "/forms/reunioes/4-perguntas", tema: "Reuniões", variante: "4 perguntas" },
  { rota: "/forms/reunioes/3-perguntas", tema: "Reuniões", variante: "3 perguntas" },
];
