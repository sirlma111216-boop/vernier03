/** Client wrapper for the secure /api/feedback backend. */

import type { GeminiFeedback } from "../model";
import type { GeminiPayload } from "../geminiPayload";

export interface GeminiResult {
  ok: boolean;
  feedback?: GeminiFeedback;
  error?: string;
}

export async function requestFeedback(payload: GeminiPayload): Promise<GeminiResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 28000);
  try {
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data?.error ?? `요청 실패 (${res.status})` };
    }
    if (!isFeedback(data)) {
      return { ok: false, error: "AI 응답 형식이 올바르지 않습니다." };
    }
    return { ok: true, feedback: data };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      error: aborted ? "AI 응답 시간이 초과되었습니다. 다시 시도해 주세요." : "AI 요청 중 오류가 발생했습니다.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isFeedback(v: any): v is GeminiFeedback {
  return (
    v &&
    typeof v.overallSummary === "string" &&
    Array.isArray(v.strengths) &&
    v.conceptUnderstanding &&
    v.graphInterpretation
  );
}
