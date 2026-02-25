import { NextResponse } from "next/server";
import { listTrainingsWithStats } from "@/lib/db";

export async function GET() {
  try {
    const trainings = await listTrainingsWithStats();
    
    return NextResponse.json({
      trainings: trainings.map((t) => ({
        id: t.id,
        label: t.label,
        startsAt: t.startsAt,
        days: t.days ?? 1,
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
