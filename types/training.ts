export type TrainingKind = "online" | "up-day-plus";

export interface TrainingOption {
  id: string;
  label: string;
  startsAt?: string | null;
  cluster?: number | null;
  days?: number; // 1 or 2 — defaults to 1
  kind?: TrainingKind;
  aliases?: string[];
}
