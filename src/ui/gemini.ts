/** Client wrapper for the secure /api/feedback backend. */

import type { GeminiFeedback } from "../model";
import type { GeminiPayload } from "../geminiPayload";

export interface GeminiResult {
  ok: boolean;
  feedback?: GeminiFeedback;
  error?: string;
}

export async function requestFeedback(_payload: GeminiPayload): Promise<GeminiResult> {
  return { ok: false, error: '학생용 AI 피드백을 일시 중단했습니다.' };
}
