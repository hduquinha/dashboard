"use client";

import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Instagram, TrendingUp } from "lucide-react";
import { formatCurrency, formatDayShort, formatDayWithWeekday, formatNumber } from "@/lib/campaignFormat";
import type { InstagramProfileSeries } from "@/lib/instagramProfiles";

interface InstagramFollowersPanelProps {
  profiles: InstagramProfileSeries[];
  /** Investimento do recorte, para comparar crescimento com o que foi gasto. */
  spend: number;
}

const COLOR_MAIN = "#8E4EC6";
const COLOR_AXIS = "#60646c";
const COLOR_GRID = "#f0f0f3";

function FollowersChart({ points }: { points: Array<{ date: string; followersCount: number }> }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  if (!mounted) return <div className="h-[200px] w-full rounded-md bg-[rgb(var(--slate-3))]" />;

  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 5, right: 16, left: 8, bottom: 5 }}>
          <defs>
            <linearGradient id="followersFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLOR_MAIN} stopOpacity={0.26} />
              <stop offset="100%" stopColor={COLOR_MAIN} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={COLOR_GRID} />
          <XAxis dataKey="date" tickFormatter={formatDayShort} stroke={COLOR_AXIS} fontSize={12} tickLine={false} axisLine={false} />
          <YAxis
            stroke={COLOR_AXIS}
            fontSize={12}
            tickLine={false}
            axisLine={false}
            width={56}
            domain={["dataMin - 5", "dataMax + 5"]}
            tickFormatter={(value: number) => formatNumber(value)}
          />
          <Tooltip
            labelFormatter={(value) => formatDayWithWeekday(String(value))}
            contentStyle={{ backgroundColor: "#fff", borderRadius: "8px", border: "1px solid #eaeaea", fontSize: 12 }}
            formatter={(value: unknown) => [formatNumber(Number(value) || 0), "Seguidores"] as [string, string]}
          />
          <Area type="monotone" dataKey="followersCount" stroke={COLOR_MAIN} strokeWidth={2} fill="url(#followersFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Seguidores dos perfis que veiculam os anúncios. Mostra o total de hoje e,
 * quando já houver mais de um dia guardado, o crescimento no período ao lado do
 * investimento — declaradamente como comparação, não como atribuição: a Meta
 * não informa qual campanha trouxe qual seguidor (ver lib/instagramProfiles.ts).
 */
export default function InstagramFollowersPanel({ profiles, spend }: InstagramFollowersPanelProps) {
  if (profiles.length === 0) return null;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-[rgb(var(--slate-12))]">Seguidores no Instagram</h3>
        <p className="text-xs text-[rgb(var(--slate-9))]">
          Total do perfil e quanto ele cresceu no período, ao lado do que foi investido. A Meta não diz qual campanha
          trouxe qual seguidor — nenhuma ferramenta consegue esse número —, então isto é comparação, não atribuição.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {profiles.map((profile) => {
          const semSerie = profile.points.length < 2;
          return (
            <article
              key={profile.igUserId}
              className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 shadow-[0_1px_2px_rgba(28,32,36,0.04)]"
            >
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[rgb(var(--blue-3))]">
                    <Instagram className="h-4 w-4 text-[rgb(var(--blue-11))]" />
                  </span>
                  <div>
                    <a
                      href={`https://instagram.com/${profile.username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold text-[rgb(var(--slate-12))] hover:underline"
                    >
                      @{profile.username}
                    </a>
                    <p className="text-[11px] text-[rgb(var(--slate-9))]">
                      {profile.mediaNow !== null ? `${formatNumber(profile.mediaNow)} publicações` : "—"}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold tabular-nums text-[rgb(var(--slate-12))]">
                    {profile.followersNow !== null ? formatNumber(profile.followersNow) : "—"}
                  </p>
                  <p className="text-[11px] text-[rgb(var(--slate-9))]">seguidores hoje</p>
                </div>
              </div>

              {semSerie ? (
                <p className="rounded-lg bg-[rgb(var(--slate-2))] px-3 py-2 text-xs text-[rgb(var(--slate-10))]">
                  A série começou{" "}
                  {profile.primeiroRegistro ? `em ${formatDayShort(profile.primeiroRegistro)}` : "hoje"} — o
                  crescimento aparece a partir da segunda medição, amanhã. Não dá para reconstruir o histórico: a Meta
                  só entrega o total de agora.
                </p>
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap gap-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-[rgb(var(--slate-9))]">No período</p>
                      <p
                        className={`flex items-center gap-1 text-lg font-semibold tabular-nums ${
                          (profile.ganho ?? 0) >= 0 ? "text-[rgb(var(--teal-9))]" : "text-[rgb(var(--ruby-11))]"
                        }`}
                      >
                        <TrendingUp className="h-4 w-4" />
                        {(profile.ganho ?? 0) >= 0 ? "+" : ""}
                        {formatNumber(profile.ganho ?? 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-[rgb(var(--slate-9))]">Investido no mesmo período</p>
                      <p className="text-lg font-semibold tabular-nums text-[rgb(var(--slate-12))]">
                        {formatCurrency(spend)}
                      </p>
                    </div>
                  </div>
                  <FollowersChart points={profile.points} />
                </>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
