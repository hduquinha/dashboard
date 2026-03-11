import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type {
  EOParticipant,
  EOAttendance,
  EOEngagement,
  EOSummary,
  EOAttendanceReport,
} from "@/types/encontroOnline";

export const dynamic = "force-dynamic";

export async function GET() {
  const pool = getPool();

  try {
    // Run all three queries in parallel
    const [participantsRes, attendanceRes, engagementRes] = await Promise.all([
      pool.query(
        `SELECT id, name, phone, registered_at AS "registeredAt"
         FROM encontro_online.participants
         ORDER BY registered_at DESC`
      ),
      pool.query(
        `SELECT oder_id AS "oderId", phone, status,
                percent_watched AS "percentWatched",
                total_watched_seconds AS "totalWatchedSeconds",
                completed,
                first_access_at AS "firstAccessAt",
                last_access_at AS "lastAccessAt"
         FROM encontro_online.attendance`
      ),
      pool.query(
        `SELECT oder_id AS "oderId", phone, sessions,
                farthest_point AS "farthestPoint",
                duration,
                forward_skips AS "forwardSkips",
                rewatch_count AS "rewatchCount",
                playback_speed AS "playbackSpeed",
                focus_percent AS "focusPercent",
                segment_data AS "segmentData"
         FROM encontro_online.engagement`
      ),
    ]);

    const participants: EOParticipant[] = participantsRes.rows;
    const attendance: EOAttendance[] = attendanceRes.rows;
    const engagement: EOEngagement[] = engagementRes.rows;

    // Build summary from actual data
    const totalRegistered = participants.length;
    const totalCompleted = attendance.filter((a) => a.completed).length;
    const totalWatching = attendance.filter(
      (a) => a.status === "assistindo"
    ).length;
    const totalStarted = attendance.filter(
      (a) => a.status === "iniciou"
    ).length;
    const totalNotWatched = attendance.filter(
      (a) => a.status === "nao_assistiu"
    ).length;
    const totalWatched = attendance.filter(
      (a) => a.totalWatchedSeconds > 0
    ).length;

    const avgPercentWatched =
      attendance.length > 0
        ? Math.round(
            attendance.reduce((s, a) => s + a.percentWatched, 0) /
              attendance.length
          )
        : 0;
    const avgWatchTimeSeconds =
      attendance.length > 0
        ? Math.round(
            attendance.reduce((s, a) => s + a.totalWatchedSeconds, 0) /
              attendance.length
          )
        : 0;
    const avgFocusPercent =
      engagement.length > 0
        ? Math.round(
            engagement.reduce((s, e) => s + e.focusPercent, 0) /
              engagement.length
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

    const report: EOAttendanceReport = {
      _meta: {
        description: "Relatório de presença do Encontro Online",
        linkField: "phone",
        tables: ["participants", "attendance", "engagement", "summary"],
      },
      participants,
      attendance,
      engagement,
      summary,
    };

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
