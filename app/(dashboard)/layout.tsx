import { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import DashboardLayoutClient from "@/components/DashboardLayoutClient";
import { assertToken, DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { listDuplicateSuspects } from "@/lib/db";
import { ttlCache } from "@/lib/serverCache";
import { getTeamMemberById } from "@/lib/teamAuth";

interface DashboardLayoutProps {
  children: ReactNode;
}

const DUPLICATE_TIMEOUT_MS = 3_000;

async function loadDuplicateCount(): Promise<number> {
  const summaryPromise = ttlCache("dashboard:duplicate-sidebar-count", 60_000, async () =>
    listDuplicateSuspects({ maxGroups: 1, sampleSize: 200 })
  );
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
  const token = cookieStore.get(DASHBOARD_COOKIE_NAME)?.value;

  try {
    assertToken(token);
  } catch {
    redirect("/login");
  }

  const session = getDashboardSession(token);
  const currentMember = session?.user ? await getTeamMemberById(session.user.id) : null;

  let duplicateCount = 0;
  try {
    duplicateCount = await loadDuplicateCount();
  } catch (error) {
    console.error("Failed to load duplicate summary for sidebar", error);
    duplicateCount = 0;
  }

  return (
    <DashboardLayoutClient
      currentUser={session?.user ?? null}
      duplicateCount={duplicateCount}
      showPasswordResetPrompt={Boolean(currentMember && !currentMember.passwordResetPromptSeenAt)}
    >
      {children}
    </DashboardLayoutClient>
  );
}
