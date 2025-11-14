'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Inscrições' },
  { href: '/recrutadores', label: 'Recrutadores' },
  { href: '/rede', label: 'Rede' },
];

export default function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-2">
      {LINKS.map((link) => {
        const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-full border px-3 py-1 text-sm font-semibold transition ${
              isActive
                ? 'border-neutral-900 bg-neutral-900 text-white'
                : 'border-neutral-300 text-neutral-700 hover:border-neutral-400 hover:text-neutral-900'
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
