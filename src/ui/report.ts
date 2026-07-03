/** Builds the printable report HTML from the app model. */

import type { AppModel, TrialData } from "../model";
import { fmt } from "./dom";
import { setupIllustrationSVG } from "./illustration";

const esc = (s: string): string =>
  (s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  );

const PREDICTION_LABELS: Record<string, Record<string, string>> = {
  q1: {
    same: "매초 거의 같은 거리를 이동한다.",
    more: "시간이 지날수록 더 먼 거리를 이동한다.",
    less: "시간이 지날수록 더 짧은 거리를 이동한다.",
  },
  q2: {
    "rising-straight": "오른쪽 위로 기울어진 직선",
    "curve-up": "위로 굽은 곡선",
    horizontal: "수평선",
  },
  q3: {
    "horizontal-positive": "0보다 큰 값에서 수평인 선",
    rising: "시간이 지날수록 높아지는 선",
    falling: "시간이 지날수록 낮아지는 선",
  },
};

function predLabel(group: string, key: string): string {
  return PREDICTION_LABELS[group]?.[key] ?? (key ? esc(key) : "—");
}

function trialTablesHtml(trial: TrialData): string {
  const td = trial.timeDistanceTable
    .map(
      (r) =>
        `<tr><td>${r.timeS}</td><td>${fmt(r.distanceCm)}${r.interpolated ? " <span class='interp'>(보간)</span>" : ""}</td></tr>`,
    )
    .join("");
  const iv = trial.intervalTable
    .map(
      (r) =>
        `<tr><td>${r.label}</td><td>${fmt(r.intervalDistanceCm)}</td><td>${fmt(r.averageSpeedCmps)}</td></tr>`,
    )
    .join("");
  return `
  <div class="rp-tables">
    <table class="rp-table"><caption>시간–이동 거리 (${esc(trial.label)})</caption>
      <thead><tr><th>시간(s)</th><th>이동 거리(cm)</th></tr></thead><tbody>${td}</tbody></table>
    <table class="rp-table"><caption>구간 분석 (${esc(trial.label)})</caption>
      <thead><tr><th>구간</th><th>구간 이동 거리(cm)</th><th>구간 평균 속력(cm/s)</th></tr></thead><tbody>${iv}</tbody></table>
  </div>`;
}

function trialAnalysisHtml(trial: TrialData): string {
  const a = trial.analysis;
  const src = trial.velocitySource === "sensor" ? "PASCO 센서 측정값" : "위치 자료로부터 계산한 값";
  return `
  <ul class="rp-analysis">
    <li>측정 시간: <b>${fmt(a.distance.durationS, 2)}초</b>${trial.isDemo ? " <span class='demo'>· 시연 자료</span>" : ""}</li>
    <li>전체 이동 거리: <b>${fmt(a.distance.totalMovementCm)} cm</b></li>
    <li>시간–이동 거리 그래프 기울기(=속력): <b>${fmt(a.distance.fit.slope)} cm/s</b> · R²=${fmt(a.distance.fit.r2, 3)}</li>
    <li>평균 속력: <b>${fmt(a.speed.meanCmps)} cm/s</b> (최소 ${fmt(a.speed.minCmps)} ~ 최대 ${fmt(a.speed.maxCmps)})</li>
    <li>속력의 상대 변동(변동계수): <b>${fmt(a.speed.coefficientOfVariation * 100)}%</b></li>
    <li>속력 자료 출처: <b>${src}</b></li>
  </ul>`;
}

export function buildReportHtml(model: AppModel, chartImages: { distance: string; speed: string }[]): string {
  const id = model.identity;
  const p = model.predictions;
  const a = model.analysisAnswers;
  const fb = model.feedback;
  const isDemo = model.trials.some((t) => t.isDemo);

  const trialsHtml = model.trials
    .map(
      (t, i) => `
    <section class="rp-trial">
      <h3>${esc(t.label)}${t.isDemo ? " <span class='demo'>(시연)</span>" : ""}</h3>
      ${trialTablesHtml(t)}
      ${trialAnalysisHtml(t)}
      <div class="rp-graphs">
        <figure><figcaption>시간–이동 거리 그래프</figcaption><img src="${chartImages[i]?.distance ?? ""}" alt="시간-이동 거리 그래프"></figure>
        <figure><figcaption>시간–속력 그래프</figcaption><img src="${chartImages[i]?.speed ?? ""}" alt="시간-속력 그래프"></figure>
      </div>
    </section>`,
    )
    .join("");

  const comparisonHtml = model.comparison
    ? `<section class="rp-section"><h2>두 측정 비교</h2>
        <ul class="rp-analysis">
          <li>1차 평균 속력: <b>${fmt(model.comparison.trial1MeanSpeedCmps)} cm/s</b>, 2차 평균 속력: <b>${fmt(model.comparison.trial2MeanSpeedCmps)} cm/s</b></li>
          <li>측정값 기준 더 빠른 운동: <b>${model.comparison.fasterTrial}차 측정</b></li>
          <li>시간–이동 거리 그래프가 더 가파른 측정: <b>${model.comparison.steeperTrial}차 측정</b></li>
        </ul></section>`
    : "";

  const feedbackHtml = fb
    ? `<section class="rp-section"><h2>AI 피드백</h2>
        <p><b>총평:</b> ${esc(fb.overallSummary)}</p>
        <p><b>잘한 점:</b> ${fb.strengths.map(esc).join(" / ") || "—"}</p>
        <p><b>개념 이해(${esc(fb.conceptUnderstanding.level)}):</b> ${esc(fb.conceptUnderstanding.feedback)}</p>
        <p><b>자료 활용(${esc(fb.dataEvidence.level)}):</b> ${esc(fb.dataEvidence.feedback)}</p>
        <p><b>그래프 해석(${esc(fb.graphInterpretation.level)}):</b> ${esc(fb.graphInterpretation.feedback)}</p>
        <p><b>오차 분석(${esc(fb.errorAnalysis.level)}):</b> ${esc(fb.errorAnalysis.feedback)}</p>
        <p><b>고쳐 볼 질문:</b> ${esc(fb.revisionQuestion)}</p>
       </section>`
    : "";

  return `
  <div class="report-doc">
    <h1>등속 운동하는 물체의 운동 그래프 탐구 보고서</h1>
    ${isDemo ? `<p class="demo-banner">※ 이 보고서에는 센서 없이 시연한 자료가 포함되어 있습니다.</p>` : ""}

    <table class="rp-id">
      <tr><th>학교</th><td>${esc(id.school)}</td><th>실험 날짜</th><td>${esc(id.experimentDate)}</td></tr>
      <tr><th>학년/반</th><td>${esc(id.grade)} / ${esc(id.classNo)}</td><th>번호</th><td>${esc(id.studentNo)}</td></tr>
      <tr><th>이름</th><td colspan="3">${esc(id.studentName)}</td></tr>
    </table>

    <section class="rp-section"><h2>1. 탐구 목적</h2>
      <p>PASCO 초음파 운동 센서로 등속 운동하는 물체의 이동 거리와 속력을 측정하여, 시간–이동 거리 그래프와 시간–속력 그래프를 그리고 그 의미를 해석한다.</p></section>

    <section class="rp-section"><h2>2. 준비물</h2>
      <p>PASCO 무선 운동 센서, 일정한 속력으로 움직이는 장난감 자동차(또는 카트), 평평한 이동 경로, 자 또는 표시 테이프(선택), Chrome 또는 Edge가 실행되는 기기</p></section>

    <section class="rp-section"><h2>3. 실험 장치</h2>
      <div class="rp-illust">${setupIllustrationSVG()}</div></section>

    <section class="rp-section"><h2>4. 실험 전 예상</h2>
      <ul class="rp-analysis">
        <li>1초마다 이동 거리: <b>${predLabel("q1", p.q1)}</b></li>
        <li>시간–이동 거리 그래프 예상: <b>${predLabel("q2", p.q2)}</b></li>
        <li>시간–속력 그래프 예상: <b>${predLabel("q3", p.q3)}</b></li>
        <li>예상한 까닭: ${esc(p.reason) || "—"}</li>
      </ul></section>

    <section class="rp-section"><h2>5. 측정 조건</h2>
      <p>측정 시간 ${model.measurementSettings.durationS}초 · 자료 수집 약 ${model.measurementSettings.sampleRateHz} Hz · 운동 방향: ${directionLabel(model.measurementSettings.direction)}</p></section>

    <section class="rp-section"><h2>6. 측정 결과와 그래프</h2>${trialsHtml}</section>
    ${comparisonHtml}

    <section class="rp-section"><h2>7. 분석 답변</h2>
      <ol class="rp-answers">
        <li>${esc(a.q1)}</li><li>${esc(a.q2)}</li><li>${esc(a.q3)}</li>
        <li>${esc(a.q4)}</li><li>${esc(a.q5)}</li><li>${esc(a.q6)}</li>
        ${a.comparison ? `<li>${esc(a.comparison)}</li>` : ""}
      </ol></section>

    ${feedbackHtml}

    <section class="rp-section"><h2>8. 나의 결론</h2>
      <p>${esc(model.studentConclusion) || "—"}</p></section>

    <section class="rp-section"><h2>9. 오차 원인과 개선 방법</h2>
      <p>${esc(a.q6) || "센서 잡음, 바닥의 평탄도, 바퀴의 마찰, 자동차 속력의 변화, 초음파 경로의 장애물 등이 오차의 원인이 될 수 있다."}</p></section>
  </div>`;
}

function directionLabel(d: string): string {
  if (d === "toward") return "센서에 가까워짐";
  if (d === "auto") return "자동 판단";
  return "센서에서 멀어짐";
}
