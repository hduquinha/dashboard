import { NextResponse } from "next/server";
import { listTrainingOptions } from "@/lib/trainings";

export async function GET() {
  try {
    const trainings = listTrainingOptions();
    
    return NextResponse.json({
      trainings: trainings.map((t) => ({
        id: t.id,
        label: t.label,
        startsAt: t.startsAt,
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
