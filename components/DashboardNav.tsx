'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface DashboardNavProps {
  duplicateCount?: number;
}

const LINKS = [
  {
    key: 'home',
    href: '/',
    label: 'Inscrições',
    description: 'Monitoramento em tempo real das submissões.',
    icon: '🗂️',
  },
  {
    key: 'importar',
    href: '/importar',
    label: 'Importar',
    description: 'Suba arquivos do Meta antes de gravar.',
    icon: '📥',
  },
  {
    key: 'duplicados',
    href: '/duplicados',
    label: 'Duplicados',
    description: 'Revise e confirme possíveis duplicidades.',
    icon: '⚠️',
  },
  {
    key: 'recrutadores',
    href: '/recrutadores',
    label: 'Recrutadores',
    description: 'Gerencie códigos e convites ativos.',
    icon: '🧭',
  },
  {
    key: 'rede',
    href: '/rede',
    label: 'Rede',
    description: 'Visualize o crescimento e conexões.',
    icon: '🌱',
  },
];

export default function DashboardNav({ duplicateCount = 0 }: DashboardNavProps) {
  const pathname = usePathname();

  return (
    <nav className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Navegação do painel">
      {LINKS.map((link) => {
        const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
        const showBadge = link.key === 'duplicados' && duplicateCount > 0;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`group relative flex items-center justify-between rounded-2xl border px-4 py-3 transition shadow-sm ${
              isActive
                ? 'border-neutral-900 bg-neutral-900 text-white shadow-lg'
                : 'border-neutral-200 bg-white text-neutral-800 hover:border-neutral-400 hover:shadow-md'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl" aria-hidden>
                {link.icon}
              </span>
              <div className="space-y-1">
                <p className={`text-sm font-semibold ${isActive ? 'text-white' : 'text-neutral-900'}`}>
                  {link.label}
                </p>
                <p className={`text-xs ${isActive ? 'text-white/80' : 'text-neutral-500'}`}>
                  {link.description}
                </p>
              </div>
            </div>
            <svg
              className={`h-4 w-4 flex-shrink-0 transition ${isActive ? 'text-white' : 'text-neutral-400 group-hover:text-neutral-600'}`}
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
            {showBadge ? (
              <span className="absolute right-3 top-3 inline-flex min-w-[1.5rem] justify-center rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white shadow">
                {duplicateCount > 99 ? '99+' : duplicateCount}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
