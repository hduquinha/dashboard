"use client";

import { useState } from "react";
import ModernSidebar from "@/components/ModernSidebar";

interface DashboardLayoutClientProps {
  children: React.ReactNode;
  duplicateCount: number;
}

export default function DashboardLayoutClient({ children, duplicateCount }: DashboardLayoutClientProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-neutral-50">
      <ModernSidebar
        duplicateCount={duplicateCount}
        isCollapsed={isCollapsed}
        toggleSidebar={() => setIsCollapsed(!isCollapsed)}
      />
      <main className="flex-1 overflow-y-auto overflow-x-hidden transition-all duration-300">
        <div className="min-h-full p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
