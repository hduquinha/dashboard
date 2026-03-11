import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { EOParticipantRow, EOSummary, EOReport } from "@/types/encontroOnline";

export const dynamic = "force-dynamic";

function deriveStatus(row: { percent_watched: number | null; total_watched_seconds: number | null; completed: boolean | null }) {
  if (row.completed) return "concluido" as const;
  const pct = row.percent_watched ?? 0;
  const secs = row.total_watched_seconds ?? 0;
  if (pct >= 90) return "concluido" as const;
  if (pct > 0 || secs > 60) return "assistindo" as const;
  if (secs > 0) return "iniciou" as const;
  return "nao_assistiu" as const;
}

export async function GET() {
  const pool = getPool();

  try {
    const result = await pool.query(
      `SELECT
         u.id,
         u.name,
         u.phone,
         u.registered_at,
         w.total_watched_seconds,
         w.percent_watched,
         w.completed,
         w.last_watched_at,
         w.sessions,
         w.focus_percent,
         w.forward_skips,
         w.playback_speed,
         w.rewatch_count,
         w.duration,
         w.farthest_point
       FROM online_users u
       LEFT JOIN online_watch_data w ON w.user_id = u.id
       ORDER BY COALESCE(w.percent_watched, 0) DESC`
    );

    const participants: EOParticipantRow[] = result.rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      name: r.name as string,
      phone: r.phone as string,
      registeredAt: r.registered_at ? String(r.registered_at) : null,
      status: r.total_watched_seconds != null
        ? deriveStatus(r as { percent_watched: number | null; total_watched_seconds: number | null; completed: boolean | null })
        : "nao_assistiu",
      percentWatched: Number(r.percent_watched ?? 0),
      totalWatchedSeconds: Number(r.total_watched_seconds ?? 0),
      completed: Boolean(r.completed),
      lastWatchedAt: r.last_watched_at ? String(r.last_watched_at) : null,
      sessions: r.sessions != null ? Number(r.sessions) : null,
      focusPercent: r.focus_percent != null ? Number(r.focus_percent) : null,
      forwardSkips: r.forward_skips != null ? Number(r.forward_skips) : null,
      playbackSpeed: r.playback_speed != null ? Number(r.playback_speed) : null,
      rewatchCount: r.rewatch_count != null ? Number(r.rewatch_count) : null,
      duration: r.duration != null ? Number(r.duration) : null,
      farthestPoint: r.farthest_point != null ? Number(r.farthest_point) : null,
    }));

    // Build summary
    const totalRegistered = participants.length;
    const totalCompleted = participants.filter((p) => p.status === "concluido").length;
    const totalWatching = participants.filter((p) => p.status === "assistindo").length;
    const totalStarted = participants.filter((p) => p.status === "iniciou").length;
    const totalNotWatched = participants.filter((p) => p.status === "nao_assistiu").length;
    const totalWatched = participants.filter((p) => p.totalWatchedSeconds > 0).length;

    const withData = participants.filter((p) => p.totalWatchedSeconds > 0);
    const avgPercentWatched =
      withData.length > 0
        ? Math.round(withData.reduce((s, p) => s + p.percentWatched, 0) / withData.length)
        : 0;
    const avgWatchTimeSeconds =
      withData.length > 0
        ? Math.round(withData.reduce((s, p) => s + p.totalWatchedSeconds, 0) / withData.length)
        : 0;
    const withFocus = participants.filter((p) => p.focusPercent != null);
    const avgFocusPercent =
      withFocus.length > 0
        ? Math.round(withFocus.reduce((s, p) => s + (p.focusPercent ?? 0), 0) / withFocus.length)
        : 0;

    const summary: EOSummary = {
      totalRegistered,
      totalWatched,
      totalCompleted,
      totalWatching,
      totalStarted,
      totalNotWatched,
      avgPercentWatched,
      avgWatchTimeSeconds,
      avgFocusPercent,
      generatedAt: new Date().toISOString(),
    };

    const report: EOReport = { participants, summary };

    return NextResponse.json({ success: true, report });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("[encontro-online] DB error:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
