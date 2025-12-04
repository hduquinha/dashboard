"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import ModernSidebar from "@/components/ModernSidebar";

interface DashboardLayoutClientProps {
  children: React.ReactNode;
  duplicateCount: number;
}

export default function DashboardLayoutClient({ children, duplicateCount }: DashboardLayoutClientProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const pathname = usePathname();

  // Close mobile sidebar on route change
  useEffect(() => {
    setIsMobileOpen(false);
  }, [pathname]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-neutral-50">
      {/* Mobile Header */}
      <div className="fixed top-0 left-0 right-0 z-20 flex h-16 items-center justify-between border-b border-neutral-200 bg-white px-4 shadow-sm lg:hidden">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsMobileOpen(true)}
            className="rounded-md p-2 text-neutral-600 hover:bg-neutral-100"
          >
            <Menu size={24} />
          </button>
          <span className="text-lg font-bold text-neutral-900">Nexus</span>
        </div>
      </div>

      <ModernSidebar
        duplicateCount={duplicateCount}
        isCollapsed={isCollapsed}
        toggleSidebar={() => setIsCollapsed(!isCollapsed)}
        isMobileOpen={isMobileOpen}
        closeMobileSidebar={() => setIsMobileOpen(false)}
      />
      
      <main className="flex-1 overflow-y-auto overflow-x-hidden transition-all duration-300 pt-16 lg:pt-0">
        <div className="min-h-full p-4 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
