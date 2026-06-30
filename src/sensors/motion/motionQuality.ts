/**
 * Translates deterministic analysis into middle-school-friendly Korean
 * observations and a data-quality verdict. These are classroom heuristics,
 * not absolute scientific laws.
 */

import type { MotionAnalysisResult } from "./motionAnalysis";

export type QualityLevel = "good" | "fair" | "poor";

export interface QualityVerdict {
  level: QualityLevel;
  /** Short student-facing messages (already in Korean). */
  messages: string[];
  /** True if the data is too noisy to draw uniform-motion conclusions. */
  recommendRemeasure: boolean;
}

export function describeMotionQuality(result: MotionAnalysisResult): QualityVerdict {
  const messages: string[] = [];
  const { distance, speed } = result;

  const r2 = distance.fit.r2;
  const cv = speed.coefficientOfVariation;

  // Distance–time linearity.
  if (distance.approximatelyLinear) {
    messages.push("이동 거리가 시간에 따라 거의 일정하게 증가했습니다.");
  } else if (r2 >= 0.9) {
    messages.push("이동 거리는 대체로 일정하게 증가했지만, 자료가 조금 흔들렸습니다.");
  } else {
    messages.push("이동 거리 그래프가 직선에서 많이 벗어났습니다.");
  }

  // Speed constancy.
  if (speed.approximatelyHorizontal) {
    messages.push("속력은 평균값 주변에서 조금씩 흔들렸습니다.");
  } else if (cv <= 0.3) {
    messages.push("출발 직후에는 속력이 변했지만, 이후에는 비교적 일정했습니다.");
  } else {
    messages.push("속력이 많이 변해서 등속 운동으로 보기 어려웠습니다.");
  }

  let level: QualityLevel;
  let recommendRemeasure = false;
  if (r2 >= 0.98 && cv <= 0.15) {
    level = "good";
  } else if (r2 >= 0.9 && cv <= 0.3) {
    level = "fair";
  } else {
    level = "poor";
    recommendRemeasure = true;
    messages.push("센서 자료의 흔들림이 커서 다시 측정하는 것이 좋습니다.");
  }

  return { level, messages, recommendRemeasure };
}
