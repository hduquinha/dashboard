import { NextRequest, NextResponse } from "next/server";
import { assertAuthenticatedRequest } from "@/lib/auth";
import { getPool } from "@/lib/db";
import type { EOParticipantRow, EOSummary, EOReport } from "@/types/encontroOnline";

export const dynamic = "force-dynamic";

function deriveStatus(row: {
  percent_watched: number | null;
  total_watched_seconds: number | null;
  completed: boolean | null;
}) {
  if (row.completed) return "concluido" as const;

  const pct = row.percent_watched ?? 0;
  const secs = row.total_watched_seconds ?? 0;

  if (pct >= 90) return "concluido" as const;
  if (pct > 0 || secs > 60) return "assistindo" as const;
  if (secs > 0) return "iniciou" as const;
  return "nao_assistiu" as const;
}

export async function GET(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request, {
      requireSameOriginForSession: false,
    });
  } catch {
    return NextResponse.json({ success: false, error: "Nao autorizado" }, { status: 401 });
  }

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

    const participants: EOParticipantRow[] = result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      name: row.name as string,
      phone: row.phone as string,
      registeredAt: row.registered_at ? String(row.registered_at) : null,
      status:
        row.total_watched_seconds != null
          ? deriveStatus(
              row as {
                percent_watched: number | null;
                total_watched_seconds: number | null;
                completed: boolean | null;
              }
            )
          : "nao_assistiu",
      percentWatched: Number(row.percent_watched ?? 0),
      totalWatchedSeconds: Number(row.total_watched_seconds ?? 0),
      completed: Boolean(row.completed),
      lastWatchedAt: row.last_watched_at ? String(row.last_watched_at) : null,
      sessions: row.sessions != null ? Number(row.sessions) : null,
      focusPercent: row.focus_percent != null ? Number(row.focus_percent) : null,
      forwardSkips: row.forward_skips != null ? Number(row.forward_skips) : null,
      playbackSpeed: row.playback_speed != null ? Number(row.playback_speed) : null,
      rewatchCount: row.rewatch_count != null ? Number(row.rewatch_count) : null,
      duration: row.duration != null ? Number(row.duration) : null,
      farthestPoint: row.farthest_point != null ? Number(row.farthest_point) : null,
    }));

    const totalRegistered = participants.length;
    const totalCompleted = participants.filter((participant) => participant.status === "concluido").length;
    const totalWatching = participants.filter((participant) => participant.status === "assistindo").length;
    const totalStarted = participants.filter((participant) => participant.status === "iniciou").length;
    const totalNotWatched = participants.filter((participant) => participant.status === "nao_assistiu").length;
    const totalWatched = participants.filter((participant) => participant.totalWatchedSeconds > 0).length;

    const withData = participants.filter((participant) => participant.totalWatchedSeconds > 0);
    const avgPercentWatched =
      withData.length > 0
        ? Math.round(
            withData.reduce((sum, participant) => sum + participant.percentWatched, 0) /
              withData.length
          )
        : 0;
    const avgWatchTimeSeconds =
      withData.length > 0
        ? Math.round(
            withData.reduce((sum, participant) => sum + participant.totalWatchedSeconds, 0) /
              withData.length
          )
        : 0;
    const withFocus = participants.filter((participant) => participant.focusPercent != null);
    const avgFocusPercent =
      withFocus.length > 0
        ? Math.round(
            withFocus.reduce((sum, participant) => sum + (participant.focusPercent ?? 0), 0) /
              withFocus.length
          )
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
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
