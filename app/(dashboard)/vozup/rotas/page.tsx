import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Download, Flame } from "lucide-react";
import CopyableRoute from "@/components/CopyableRoute";
import { clarityHeatmapUrl, hasClarityProject } from "@/lib/clarity";
import { VOZUP_ROUTES } from "@/lib/vozupRoutesMap";
import "./rotas.css";

const VOZUP_SITE_ORIGIN = "https://www.escolavozup.com";

export const metadata: Metadata = {
  title: "Mapa de Rotas — VozUP",
  description: "Referência de todas as rotas de landing page criadas, por tema e formulário.",
};

const TEMAS = Array.from(new Set(VOZUP_ROUTES.map((r) => r.tema)));

export default function VozupRotasPage() {
  const total = VOZUP_ROUTES.length;
  const showClarity = hasClarityProject();

  return (
    <div className="vrm-page">
      <div className="vrm-wrap">
        <header className="vrm-head">
          <div className="vrm-head-top">
            <Link href="/vozup" className="vrm-back">
              <ArrowLeft size={15} />
              Voltar para Leads
            </Link>
            <a href="/api/vozup/rotas/export-pdf" className="vrm-export" download>
              <Download size={15} />
              Exportar PDF
            </a>
          </div>
          <p className="vrm-eyebrow">VozUP · Landing Pages → Dashboard</p>
          <h1 className="vrm-h1">Mapa de rotas de captação</h1>
          <p className="vrm-sub">
            Uma rota única por tema de dor e variante de formulário. Clique numa rota para abrir a
            página em uma nova aba.
          </p>
          <div className="vrm-stat-row">
            <div className="vrm-stat"><b>{total}</b><span>rotas criadas</span></div>
            <div className="vrm-stat"><b>{TEMAS.length}</b><span>temas de dor</span></div>
            <div className="vrm-stat"><b>3</b><span>variantes de formulário</span></div>
          </div>
        </header>

        <section className="vrm-folder" id="rotas" data-folder="landing-pages">
          <div className="vrm-folder-head">
            <h2>Rotas</h2>
            <span className="vrm-folder-count">{total} rotas</span>
          </div>
          <div className="vrm-table-scroll">
            <table className="vrm-table">
              <thead>
                <tr>
                  <th>Rota</th>
                  <th>Tema</th>
                  <th>Formulário</th>
                  {showClarity && <th>Mapa de calor</th>}
                </tr>
              </thead>
              <tbody>
                {VOZUP_ROUTES.map((row) => (
                  <tr key={row.rota}>
                    <td><CopyableRoute route={row.rota} /></td>
                    <td>{row.tema}</td>
                    <td><span className="vrm-chip">{row.variante}</span></td>
                    {showClarity && (
                      <td>
                        <a
                          href={clarityHeatmapUrl(`${VOZUP_SITE_ORIGIN}${row.rota === "/" ? "/" : row.rota}`)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="vrm-heatmap-link"
                          title="Cliques, scroll e áreas mais vistas desta página (Microsoft Clarity)"
                        >
                          <Flame size={13} />
                          Ver calor
                        </a>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="vrm-notes">
          <h3>Como usar</h3>
          <ul>
            <li>
              O domínio de produção é <code>https://www.escolavozup.com</code> — a rota completa é o
              domínio + a coluna &quot;Rota&quot; (ex.: <code>https://www.escolavozup.com/forms/vendas/4-perguntas</code>).
            </li>
            <li>
              Use o mesmo link para tráfego direto, Google Ads e Meta Ads — o rastreio de canal
              (gclid/fbclid ou UTM manual) é automático, não precisa criar nenhuma URL específica por
              plataforma.
            </li>
            <li>
              Todas as rotas carregam o Pixel do Meta automaticamente (instalado uma vez no HTML raiz do
              site, vale para qualquer página).
            </li>
            <li>
              <strong>Ver calor</strong> abre o Microsoft Clarity com o mapa de calor da rota (cliques,
              scroll e gravações de sessão). Dentro do Clarity dá para filtrar por campanha/anúncio
              usando os filtros de UTM.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
