import type { ParticipantTag } from "@/lib/participantTags";
import {
  TAG_CATEGORY_LABELS,
  participantTagClassName,
  participantTagDotClassName,
} from "@/lib/participantTags";
import { cn } from "@/lib/utils";

interface TagBadgeProps {
  tag: ParticipantTag;
  size?: "xs" | "sm";
  showCategory?: boolean;
  className?: string;
}

const SIZE_CLASS_NAMES: Record<NonNullable<TagBadgeProps["size"]>, string> = {
  xs: "max-w-[220px] px-2 py-0.5 text-[10px]",
  sm: "max-w-full px-2.5 py-1 text-xs",
};

export function TagBadge({ tag, size = "xs", showCategory = false, className }: TagBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 rounded-md border font-semibold leading-snug",
        SIZE_CLASS_NAMES[size],
        participantTagClassName(tag),
        className
      )}
      title={tag.description ?? tag.label}
    >
      <span className={cn("h-1.5 w-1.5 flex-shrink-0 rounded-full", participantTagDotClassName(tag))} />
      {showCategory ? (
        <span className="flex-shrink-0 text-[0.72em] font-bold uppercase text-current opacity-70">
          {TAG_CATEGORY_LABELS[tag.category]}
        </span>
      ) : null}
      <span className="min-w-0 truncate">{tag.label}</span>
    </span>
  );
}

interface TagOverflowBadgeProps {
  count: number;
  title?: string;
}

export function TagOverflowBadge({ count, title }: TagOverflowBadgeProps) {
  if (count <= 0) {
    return null;
  }

  return (
    <span
      className="inline-flex items-center rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[10px] font-semibold text-neutral-600"
      title={title}
    >
      +{count}
    </span>
  );
}
