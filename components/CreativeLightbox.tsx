"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, ImageOff, Loader2, X } from "lucide-react";
import type { AdRow, CreativeVideoSource } from "@/types/metaAds";

interface CreativeLightboxProps {
  ad: AdRow;
  onClose: () => void;
}

type VideoState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; source: string | null; permalinkUrl: string | null }
  | { status: "error" };

/**
 * Visualizador de criativo em tela cheia. Resolve a virtual: os cards da
 * galeria são propositalmente compactos (o gestor reclamou que os grandões
 * exigiam scroll infinito), então quem quer ver o criativo INTEIRO — imagem em
 * resolução plena ou o vídeo tocando — abre aqui. Para vídeo, a URL tocável é
 * buscada sob demanda (o `source` da Meta expira em horas); se a Graph recusar,
 * cai pro link "abrir no Facebook".
 */
export default function CreativeLightbox({ ad, onClose }: CreativeLightboxProps) {
  const [video, setVideo] = useState<VideoState>({ status: ad.videoId ? "loading" : "idle" });
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const imageSrc = ad.imageUrl ?? ad.thumbnailUrl;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    if (!ad.videoId) return;
    let cancelled = false;
    fetch(`/api/campanhas/creative-video?videoId=${encodeURIComponent(ad.videoId)}`)
      .then((res) => res.json())
      .then((data: CreativeVideoSource & { error?: string }) => {
        if (cancelled) return;
        if (data.error) setVideo({ status: "error" });
        else setVideo({ status: "ready", source: data.source, permalinkUrl: data.permalinkUrl });
      })
      .catch(() => {
        if (!cancelled) setVideo({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [ad.videoId]);

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/80 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Criativo do anúncio ${ad.adName}`}
    >
      <button
        type="button"
        ref={closeButtonRef}
        onClick={onClose}
        aria-label="Fechar"
        className="absolute right-4 top-4 rounded-full bg-black/40 p-2 text-white/90 hover:bg-black/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        <X className="h-6 w-6" />
      </button>

      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        {ad.videoId ? (
          <div className="flex w-full items-center justify-center">
            {video.status === "loading" ? (
              <div className="relative flex w-full items-center justify-center">
                {imageSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element -- pôster do CDN do Meta
                  <img src={imageSrc} alt="" className="max-h-[80vh] w-auto rounded-lg object-contain opacity-60" />
                ) : null}
                <span className="absolute inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-sm font-medium text-white">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando vídeo…
                </span>
              </div>
            ) : null}

            {/* Vídeo direto (raro): quando a Graph devolve um `source` tocável. */}
            {video.status === "ready" && video.source ? (
              <video
                src={video.source}
                poster={imageSrc ?? undefined}
                controls
                autoPlay
                playsInline
                className="max-h-[80vh] w-auto rounded-lg bg-black"
              />
            ) : null}

            {/* Sem `source` (caso dos Reels): toca embutido pelo plugin de vídeo
                do Facebook, com link de "abrir lá" como rede de segurança. */}
            {video.status === "ready" && !video.source && video.permalinkUrl ? (
              <div className="flex w-full flex-col items-center gap-2">
                <div className="aspect-[9/16] w-full max-w-[340px] overflow-hidden rounded-lg bg-black">
                  <iframe
                    src={`https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(video.permalinkUrl)}&show_text=false&autoplay=true`}
                    title={`Vídeo do anúncio ${ad.adName}`}
                    className="h-full w-full"
                    allow="autoplay; encrypted-media; picture-in-picture; clipboard-write"
                    allowFullScreen
                  />
                </div>
                <a
                  href={video.permalinkUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-white/70 hover:text-white"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Não carregou? Abrir no Facebook
                </a>
              </div>
            ) : null}

            {/* Falha total: nem source nem permalink — mostra o pôster. */}
            {video.status === "error" || (video.status === "ready" && !video.source && !video.permalinkUrl) ? (
              <div className="flex flex-col items-center gap-3">
                {imageSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element -- pôster do CDN do Meta
                  <img src={imageSrc} alt={`Criativo do anúncio ${ad.adName}`} className="max-h-[70vh] w-auto rounded-lg object-contain" />
                ) : null}
                <span className="text-sm text-white/80">Não foi possível carregar o vídeo aqui.</span>
              </div>
            ) : null}
          </div>
        ) : imageSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- imagem do CDN do Meta
          <img
            src={imageSrc}
            alt={`Criativo do anúncio ${ad.adName}`}
            className="max-h-[80vh] w-auto rounded-lg object-contain"
          />
        ) : (
          <div className="flex h-64 w-64 items-center justify-center rounded-lg bg-white/10">
            <ImageOff className="h-12 w-12 text-white/50" />
          </div>
        )}

        <p className="max-w-full truncate text-center text-sm font-medium text-white/90" title={ad.adName}>
          {ad.adName}
          {ad.videoId ? <span className="ml-2 rounded bg-white/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">vídeo</span> : null}
        </p>
      </div>
    </div>
  );
}
