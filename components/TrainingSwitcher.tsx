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
    <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700">
      Treinamento
      <select
        className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
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
