"use client";

import { ImageOff, Maximize2, Play } from "lucide-react";
import type { CreativeVisual } from "@/types/metaAds";

const SIZE_CLASS = {
  sm: "h-9 w-9",
  md: "h-12 w-12",
  lg: "h-16 w-16",
} as const;

interface CreativeThumbProps {
  creative: CreativeVisual;
  size?: keyof typeof SIZE_CLASS;
  /** Abre o criativo em tela cheia. Sem isto a miniatura fica só decorativa
   * (usado quando o clique do container já tem outro papel). */
  onOpen?: () => void;
}

/**
 * Miniatura do criativo, clicável para abrir em tela cheia. Existe porque em
 * toda lista/seletor de anúncio o gestor precisa VER o criativo — o nome
 * (`VOZUP_AD20_IMG_AUTO`) não diz qual peça é. Vídeo ganha o selo de play, pois
 * a miniatura é só o primeiro frame.
 */
export default function CreativeThumb({ creative, size = "sm", onOpen }: CreativeThumbProps) {
  const src = creative.thumbnailUrl ?? creative.imageUrl;
  const dimension = SIZE_CLASS[size];

  const content = (
    <>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL dinâmica do CDN do Meta
        <img
          src={src}
          alt={onOpen ? "" : `Criativo do anúncio ${creative.adName}`}
          loading="lazy"
          className="h-full w-full rounded object-cover"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded bg-[rgb(var(--slate-3))]">
          <ImageOff className="h-4 w-4 text-[rgb(var(--slate-8))]" />
        </span>
      )}
      {creative.videoId ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white">
            <Play className="h-2.5 w-2.5 translate-x-[1px]" fill="currentColor" />
          </span>
        </span>
      ) : null}
      {onOpen ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded bg-black/0 opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100">
          <Maximize2 className="h-3.5 w-3.5 text-white" />
        </span>
      ) : null}
    </>
  );

  if (!onOpen) {
    return <span className={`relative block flex-shrink-0 overflow-hidden rounded ${dimension}`}>{content}</span>;
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        // A miniatura vive dentro de linhas/opções clicáveis (expandir o dia,
        // escolher o anúncio): ver o criativo não pode disparar essa ação.
        event.preventDefault();
        event.stopPropagation();
        onOpen();
      }}
      title={`Ver criativo de ${creative.adName} em tela cheia`}
      aria-label={`Ver criativo de ${creative.adName} em tela cheia`}
      className={`group relative flex-shrink-0 overflow-hidden rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--blue-8))] ${dimension}`}
    >
      {content}
    </button>
  );
}
