import { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import DashboardLayoutClient from "@/components/DashboardLayoutClient";
import { assertToken } from "@/lib/auth";
import { listDuplicateSuspects } from "@/lib/db";

interface DashboardLayoutProps {
  children: ReactNode;
}

const DUPLICATE_TIMEOUT_MS = 3_000;

async function loadDuplicateCount(): Promise<number> {
  const summaryPromise = listDuplicateSuspects({ maxGroups: 1 });
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    setTimeout(() => resolve("timeout"), DUPLICATE_TIMEOUT_MS);
  });

  const result = await Promise.race([summaryPromise, timeoutPromise]);

  if (result === "timeout") {
    summaryPromise.catch((error) => {
      console.warn("Duplicate summary exceeded sidebar timeout", error);
    });
    return 0;
  }

  return result.totalGroups;
}

export default async function DashboardLayout({ children }: DashboardLayoutProps) {
  const cookieStore = await cookies();
  const token = cookieStore.get("dashboardToken")?.value;

  try {
    assertToken(token);
  } catch {
    redirect("/login");
  }

  let duplicateCount = 0;
  try {
    duplicateCount = await loadDuplicateCount();
  } catch (error) {
    console.error("Failed to load duplicate summary for sidebar", error);
    duplicateCount = 0;
  }

  return (
    <DashboardLayoutClient duplicateCount={duplicateCount}>
      {children}
    </DashboardLayoutClient>
  );
}
