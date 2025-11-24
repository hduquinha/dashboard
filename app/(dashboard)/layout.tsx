import { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import SidebarNav from "@/components/SidebarNav";
import { assertToken } from "@/lib/auth";
import { listDuplicateSuspects } from "@/lib/db";
import { NAV_LINKS } from "@/lib/navLinks";

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
    <div className="flex min-h-screen bg-neutral-50">
      <SidebarNav duplicateCount={duplicateCount} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="sticky top-0 z-20 border-b border-neutral-200 bg-white/80 px-4 py-3 shadow-sm backdrop-blur lg:hidden">
          <nav className="flex items-center gap-3 overflow-x-auto text-sm font-semibold text-neutral-600" aria-label="Navegação mobile">
            {NAV_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="rounded-full border border-transparent px-3 py-1 transition hover:border-neutral-300 hover:text-neutral-900">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex-1 overflow-y-auto p-8">
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
