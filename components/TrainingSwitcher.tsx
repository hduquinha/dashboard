'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import type { TrainingOption } from '@/types/training';

interface TrainingSwitcherProps {
  options: TrainingOption[];
  selectedId?: string;
}

export default function TrainingSwitcher({ options, selectedId }: TrainingSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set('treinamento', value);
    } else {
      params.delete('treinamento');
    }
    const query = params.toString();
    const target = query.length ? `${pathname}?${query}` : pathname;
    startTransition(() => router.push(target));
  }

  return (
    <label className="flex flex-col gap-2 text-sm font-medium text-[rgb(var(--slate-12))]">
      Treinamento
      <select
        className="h-10 w-full rounded-lg border border-[rgb(var(--border-strong))] bg-[rgb(var(--surface-1))] px-3 text-sm text-[rgb(var(--slate-12))] shadow-[0_1px_2px_rgba(28,32,36,0.04)] outline-none transition focus:border-[rgb(var(--blue-9))] focus:ring-2 focus:ring-[rgba(var(--border-blue))]"
        value={selectedId ?? ''}
        onChange={(event) => handleChange(event.target.value)}
        disabled={isPending}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
