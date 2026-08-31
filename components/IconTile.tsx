import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Pastilha de ícone — o mesmo desenho do menu lateral, para as telas claras.
 *
 * Existe para que ícone de KPI, de cabeçalho de seção e de card não sejam
 * inventados de novo em cada tela: antes cada uma tinha a sua caixinha (umas
 * quadradas, umas redondas, tamanhos e tons diferentes), e o painel parecia
 * feito por três pessoas distintas. Aqui ficam o raio, o degradê, o anel e a
 * sombra — quem usa escolhe só o tom e o tamanho.
 */
export type IconTileTone = "brand" | "teal" | "amber" | "ruby" | "slate";
export type IconTileSize = "sm" | "md" | "lg";

const TONE_SOFT: Record<IconTileTone, string> = {
  brand:
    "bg-gradient-to-br from-[rgb(var(--blue-3))] to-[rgb(var(--blue-5))] text-[rgb(var(--blue-11))] ring-[rgb(var(--blue-6))]",
  teal: "bg-gradient-to-br from-[rgb(224_248_243)] to-[rgb(203_243_233)] text-[rgb(var(--teal-9))] ring-[rgb(167_231_215)]",
  amber: "bg-gradient-to-br from-[rgb(255_244_214)] to-[rgb(255_233_176)] text-[rgb(161_98_7)] ring-[rgb(253_216_133)]",
  ruby: "bg-gradient-to-br from-[rgb(var(--ruby-3))] to-[rgb(var(--ruby-5))] text-[rgb(var(--ruby-11))] ring-[rgb(var(--ruby-6))]",
  slate:
    "bg-gradient-to-br from-[rgb(var(--slate-2))] to-[rgb(var(--slate-4))] text-[rgb(var(--slate-11))] ring-[rgb(var(--slate-6))]",
};

const TONE_SOLID: Record<IconTileTone, string> = {
  brand:
    "bg-gradient-to-br from-[rgb(var(--blue-9))] to-[rgb(var(--blue-11))] text-white shadow-[0_6px_16px_rgba(39,129,246,0.28)] ring-white/20",
  teal: "bg-gradient-to-br from-[rgb(var(--teal-9))] to-[rgb(13_148_164)] text-white shadow-[0_6px_16px_rgba(18,165,148,0.28)] ring-white/20",
  amber:
    "bg-gradient-to-br from-[rgb(var(--amber-9))] to-[rgb(234_161_23)] text-[rgb(69_39_3)] shadow-[0_6px_16px_rgba(255,197,61,0.32)] ring-white/30",
  ruby: "bg-gradient-to-br from-[rgb(var(--ruby-9))] to-[rgb(var(--ruby-11))] text-white shadow-[0_6px_16px_rgba(220,54,94,0.26)] ring-white/20",
  slate:
    "bg-gradient-to-br from-[rgb(var(--slate-11))] to-[rgb(var(--slate-12))] text-white shadow-[0_6px_16px_rgba(28,32,36,0.22)] ring-white/15",
};

const BOX_SIZE: Record<IconTileSize, string> = {
  sm: "h-8 w-8 rounded-lg",
  md: "h-10 w-10 rounded-xl",
  lg: "h-12 w-12 rounded-2xl",
};

const ICON_SIZE: Record<IconTileSize, number> = { sm: 15, md: 18, lg: 22 };

export interface IconTileProps {
  icon: LucideIcon;
  tone?: IconTileTone;
  size?: IconTileSize;
  /** Preenchida com a cor do tom — para o ícone principal de um bloco. */
  solid?: boolean;
  className?: string;
}

export default function IconTile({
  icon: Icon,
  tone = "brand",
  size = "md",
  solid = false,
  className,
}: IconTileProps) {
  return (
    <span
      className={cn(
        "inline-flex flex-shrink-0 items-center justify-center ring-1 ring-inset transition",
        BOX_SIZE[size],
        solid ? TONE_SOLID[tone] : TONE_SOFT[tone],
        className
      )}
      aria-hidden
    >
      <Icon size={ICON_SIZE[size]} strokeWidth={2} />
    </span>
  );
}
