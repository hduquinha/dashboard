import { NextRequest, NextResponse } from "next/server";
import { assertAuthenticatedRequest } from "@/lib/auth";
import { listTrainingsWithStats } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request, {
      requireSameOriginForSession: false,
    });
  } catch {
    return NextResponse.json({ error: "Nao autorizado", trainings: [] }, { status: 401 });
  }

  try {
    const trainings = await listTrainingsWithStats();

    return NextResponse.json({
      trainings: trainings.map((training) => ({
        id: training.id,
        label: training.label,
        startsAt: training.startsAt,
        days: training.days ?? 1,
      })),
    });
  } catch (error) {
    console.error("Error fetching trainings:", error);
    return NextResponse.json(
      { error: "Failed to fetch trainings", trainings: [] },
      { status: 500 }
    );
  }
}
