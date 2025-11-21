'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface SidebarNavProps {
  duplicateCount?: number;
}

export interface NavLink {
  key: string;
  href: string;
  label: string;
  description: string;
  icon: string;
}

export const NAV_LINKS: NavLink[] = [
  { key: 'home', href: '/', label: 'Início', description: 'Treinamento atual', icon: '🏠' },
  { key: 'crm', href: '/crm', label: 'CRM', description: 'Base completa', icon: '📋' },
  { key: 'duplicados', href: '/duplicados', label: 'Duplicados', description: 'Higienização', icon: '⚠️' },
  { key: 'recrutadores', href: '/recrutadores', label: 'Recrutadores', description: 'Gerencie códigos', icon: '🧭' },
  { key: 'rede', href: '/rede', label: 'Rede', description: 'Visualização da árvore', icon: '🌱' },
  { key: 'importar', href: '/importar', label: 'Importar', description: 'Planilhas e lotes', icon: '📥' },
];

export default function SidebarNav({ duplicateCount = 0 }: SidebarNavProps) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 flex-shrink-0 flex-col gap-5 rounded-3xl border border-neutral-100 bg-white p-5 shadow-lg/30 lg:flex">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-neutral-400">Painel</p>
        <h1 className="text-lg font-semibold text-neutral-900">Marketing Network</h1>
        <p className="text-xs text-neutral-500">Operação diária das inscrições.</p>
      </div>
      <nav className="space-y-2" aria-label="Navegação principal">
        {NAV_LINKS.map((link) => {
          const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
          const showBadge = link.key === 'duplicados' && duplicateCount > 0;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`group flex items-center justify-between gap-3 rounded-2xl border px-3 py-3 transition ${
                isActive
                  ? 'border-sky-200 bg-sky-50 text-sky-900 shadow-sm'
                  : 'border-transparent text-neutral-600 hover:border-neutral-200 hover:bg-neutral-50'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-xl" aria-hidden>
                  {link.icon}
                </span>
                <div className="text-left">
                  <p className={`text-sm font-semibold ${isActive ? 'text-sky-900' : 'text-neutral-900'}`}>{link.label}</p>
                  <p className={`text-xs ${isActive ? 'text-sky-700' : 'text-neutral-500'}`}>{link.description}</p>
                </div>
              </div>
              {showBadge ? (
                <span className="inline-flex min-w-[1.5rem] justify-center rounded-full bg-amber-400/90 px-2 py-0.5 text-[11px] font-bold text-white shadow">
                  {duplicateCount > 99 ? '99+' : duplicateCount}
                </span>
              ) : (
                <svg
                  className={`h-4 w-4 flex-shrink-0 transition ${isActive ? 'text-sky-600' : 'text-neutral-300 group-hover:text-neutral-500'}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
