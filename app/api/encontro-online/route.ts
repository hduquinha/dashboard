import { NextResponse } from "next/server";
import type { EOAttendanceReport } from "@/types/encontroOnline";

const EO_BASE_URL = process.env.ENCONTRO_ONLINE_URL || "http://localhost:5175";
const EO_ADMIN_PASSWORD = process.env.ENCONTRO_ONLINE_PASSWORD || "";

async function getAdminToken(): Promise<string> {
  const res = await fetch(`${EO_BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: EO_ADMIN_PASSWORD }),
  });

  if (!res.ok) {
    throw new Error(`Encontro Online login failed: ${res.status}`);
  }

  const data = await res.json();
  return data.token;
}

export async function GET() {
  try {
    if (!EO_ADMIN_PASSWORD) {
      return NextResponse.json(
        { success: false, error: "ENCONTRO_ONLINE_PASSWORD não configurado" },
        { status: 500 }
      );
    }

    const token = await getAdminToken();

    const res = await fetch(`${EO_BASE_URL}/api/admin/attendance-report`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Attendance report request failed: ${res.status}`);
    }

    const report: EOAttendanceReport = await res.json();

    return NextResponse.json({ success: true, report });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("[encontro-online] Error fetching report:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 502 }
    );
  }
}
