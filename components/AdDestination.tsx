import { ExternalLink, FileQuestion, Flame, Link2, Video } from "lucide-react";
import { clarityHeatmapUrl, clarityRecordingsUrl, hasClarityProject } from "@/lib/clarity";

interface AdDestinationProps {
  landingUrl: string | null;
  compact?: boolean;
}

interface ParsedDestination {
  href: string | null;
  label: string;
  /** URL sem query string — é assim que o heatmap do Clarity agrupa páginas. */
  pageUrl: string | null;
}

function parseDestination(raw: string | null): ParsedDestination | null {
  const value = raw?.trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    const pathname = decodeURIComponent(url.pathname).replace(/\/$/, "");
    const isHttp = url.protocol === "http:" || url.protocol === "https:";
    return {
      href: isHttp ? url.href : null,
      label: `${url.hostname}${pathname}`,
      pageUrl: isHttp ? `${url.origin}${url.pathname}` : null,
    };
  } catch {
    return { href: null, label: value, pageUrl: null };
  }
}

export function AdDestination({ landingUrl, compact = false }: AdDestinationProps) {
  const destination = parseDestination(landingUrl);
  const showClarity = hasClarityProject() && Boolean(destination?.pageUrl);

  if (compact) {
    if (destination?.href) {
      return (
        <div className="flex min-w-0 items-center gap-1.5">
          <a
            href={destination.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-[rgb(var(--blue-3))] px-2.5 py-2 text-xs font-medium text-[rgb(var(--blue-11))] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--blue-8))]"
            title={landingUrl ?? undefined}
          >
            <Link2 className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="min-w-0 flex-1 truncate">Abrir página: {destination.label}</span>
            <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
          </a>
          {showClarity && (
            <a
              href={clarityHeatmapUrl(destination.pageUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-shrink-0 items-center justify-center rounded-md bg-[rgb(255_237_213)] p-2 text-[rgb(194_65_12)] hover:bg-[rgb(254_215_170)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--blue-8))]"
              title="Mapa de calor desta página no Microsoft Clarity"
              aria-label="Mapa de calor desta página no Microsoft Clarity"
            >
              <Flame className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      );
    }

    return (
      <span
        className="flex min-w-0 items-center gap-1.5 rounded-md bg-[rgb(var(--slate-3))] px-2.5 py-2 text-xs text-[rgb(var(--slate-10))]"
        title={landingUrl ?? "A Meta não informou uma URL; o anúncio pode usar um formulário nativo."}
      >
        <FileQuestion className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="truncate">{destination ? destination.label : "Destino não identificado ou formulário dentro do Meta"}</span>
      </span>
    );
  }

  return (
    <div className="mb-4 rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-2))] p-3">
      <p className="mb-1 text-[10px] font-semibold uppercase text-[rgb(var(--slate-9))]">Formulário / landing page</p>
      {destination ? (
        destination.href ? (
          <a
            href={destination.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex max-w-full items-center gap-1.5 text-sm font-medium text-[rgb(var(--blue-10))] hover:underline"
            title={landingUrl ?? undefined}
          >
            <Link2 className="h-4 w-4 flex-shrink-0" />
            <span className="truncate">{destination.label}</span>
            <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
          </a>
        ) : (
          <p className="break-all text-sm font-medium text-[rgb(var(--slate-12))]">{destination.label}</p>
        )
      ) : (
        <div className="flex items-start gap-1.5 text-sm text-[rgb(var(--slate-10))]">
          <FileQuestion className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>A Meta não informou uma URL para este anúncio; ele pode usar um formulário nativo.</p>
        </div>
      )}
      {showClarity && (
        <div className="mt-2 flex flex-wrap gap-2">
          <a
            href={clarityHeatmapUrl(destination!.pageUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-[rgb(255_237_213)] px-2.5 py-1.5 text-xs font-semibold text-[rgb(194_65_12)] hover:bg-[rgb(254_215_170)]"
            title="Cliques, scroll e áreas mais vistas desta página (Microsoft Clarity)"
          >
            <Flame className="h-3.5 w-3.5" />
            Mapa de calor
          </a>
          <a
            href={clarityRecordingsUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-[rgb(var(--slate-3))] px-2.5 py-1.5 text-xs font-semibold text-[rgb(var(--slate-11))] hover:bg-[rgb(var(--slate-4))]"
            title="Gravações de sessão no Clarity — filtre por Conteúdo UTM com o nome deste anúncio para ver só as visitas vindas dele"
          >
            <Video className="h-3.5 w-3.5" />
            Gravações de sessão
          </a>
        </div>
      )}
    </div>
  );
}
