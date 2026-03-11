// Types for the "Encontro Online" attendance system
// Real DB tables: online_users + online_watch_data (joined by user_id)

export type EOStatusDisplay =
  | "concluido"
  | "assistindo"
  | "iniciou"
  | "nao_assistiu"
  | "nao_cadastrado";

export interface EOParticipantRow {
  id: string;
  name: string;
  phone: string;
  registeredAt: string | null;
  status: EOStatusDisplay;
  percentWatched: number;
  totalWatchedSeconds: number;
  completed: boolean;
  lastWatchedAt: string | null;
  sessions: number | null;
  focusPercent: number | null;
  forwardSkips: number | null;
  playbackSpeed: number | null;
  rewatchCount: number | null;
  duration: number | null;
  farthestPoint: number | null;
}

export interface EOSummary {
  totalRegistered: number;
  totalWatched: number;
  totalCompleted: number;
  totalWatching: number;
  totalStarted: number;
  totalNotWatched: number;
  avgPercentWatched: number;
  avgWatchTimeSeconds: number;
  avgFocusPercent: number;
  generatedAt: string;
}

export interface EOReport {
  participants: EOParticipantRow[];
  summary: EOSummary;
}
