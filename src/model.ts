/** Central app data model shared by UI, report and Gemini payload. */

import type { MotionSample } from "./sensors/types";
import type {
  IntervalRow,
  MotionAnalysisResult,
  TimeDistanceRow,
  TrialComparison,
} from "./sensors/motion/motionAnalysis";

/** Personal identity fields — stay in the browser, NEVER sent to Gemini. */
export interface ReportIdentity {
  school: string;
  grade: string;
  classNo: string;
  studentNo: string;
  studentName: string;
  experimentDate: string;
}

export interface Predictions {
  q1: string; // 1초마다 이동 거리
  q2: string; // 시간–이동 거리 그래프 모양
  q3: string; // 시간–속력 그래프 모양
  reason: string;
}

export interface AnalysisAnswers {
  q1: string;
  q2: string;
  q3: string;
  q4: string;
  q5: string;
  q6: string;
  comparison?: string;
}

export interface TrialData {
  index: 1 | 2;
  isDemo: boolean;
  label: string; // "1차 측정"
  requestedProfile?: "slow" | "fast";
  samples: MotionSample[];
  timeDistanceTable: TimeDistanceRow[];
  intervalTable: IntervalRow[];
  analysis: MotionAnalysisResult;
  velocitySource: "sensor" | "derived";
  durationS: number;
}

export interface GeminiFeedback {
  overallSummary: string;
  strengths: string[];
  conceptUnderstanding: { level: string; feedback: string };
  dataEvidence: { level: string; feedback: string };
  graphInterpretation: { level: string; feedback: string };
  errorAnalysis: { level: string; feedback: string };
  revisionQuestion: string;
  modelConclusion: string;
}

export interface AppModel {
  identity: ReportIdentity;
  predictions: Predictions;
  trials: TrialData[];
  comparison: TrialComparison | null;
  analysisAnswers: AnalysisAnswers;
  studentConclusion: string;
  revisedConclusion: string;
  feedback: GeminiFeedback | null;
  measurementSettings: MeasurementSettings;
}

export interface MeasurementSettings {
  durationS: number;
  sampleRateHz: number;
  startThresholdCmps: number;
  direction: "away" | "toward" | "auto";
  preferSensorVelocity: boolean;
  enableSecondTrial: boolean;
}

export const DEFAULT_SETTINGS: MeasurementSettings = {
  durationS: 5,
  sampleRateHz: 10,
  startThresholdCmps: 4,
  direction: "away",
  preferSensorVelocity: true,
  enableSecondTrial: true,
};

export function createEmptyModel(): AppModel {
  return {
    identity: {
      school: "",
      grade: "",
      classNo: "",
      studentNo: "",
      studentName: "",
      experimentDate: new Date().toISOString().slice(0, 10),
    },
    predictions: { q1: "", q2: "", q3: "", reason: "" },
    trials: [],
    comparison: null,
    analysisAnswers: { q1: "", q2: "", q3: "", q4: "", q5: "", q6: "" },
    studentConclusion: "",
    revisedConclusion: "",
    feedback: null,
    measurementSettings: { ...DEFAULT_SETTINGS },
  };
}
