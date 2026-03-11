// Types for the "Encontro Online" external attendance system

export interface EOParticipant {
  id: string;
  name: string;
  phone: string;
  registeredAt: string;
}

export interface EOAttendance {
  oderId: string;
  phone: string;
  status: "concluido" | "assistindo" | "iniciou" | "nao_assistiu";
  percentWatched: number;
  totalWatchedSeconds: number;
  completed: boolean;
  firstAccessAt: string;
  lastAccessAt: string;
}

export interface EOEngagement {
  oderId: string;
  phone: string;
  sessions: number;
  farthestPoint: number;
  duration: number;
  forwardSkips: number;
  rewatchCount: number;
  playbackSpeed: number;
  focusPercent: number;
  segmentData: number[];
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

export interface EOAttendanceReport {
  _meta: {
    description: string;
    linkField: string;
    tables: string[];
  };
  participants: EOParticipant[];
  attendance: EOAttendance[];
  engagement: EOEngagement[];
  summary: EOSummary;
}

export type EOStatusDisplay =
  | "concluido"
  | "assistindo"
  | "iniciou"
  | "nao_assistiu"
  | "nao_cadastrado";

export interface EOParticipantRow {
  name: string;
  phone: string;
  registeredAt: string | null;
  status: EOStatusDisplay;
  percentWatched: number;
  totalWatchedSeconds: number;
  completed: boolean;
  firstAccessAt: string | null;
  lastAccessAt: string | null;
  sessions: number | null;
  focusPercent: number | null;
  forwardSkips: number | null;
  playbackSpeed: number | null;
  rewatchCount: number | null;
}
