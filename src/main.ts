/**
 * 등속 운동하는 물체의 운동 그래프 — 단계별 학습 컨트롤러.
 * 7개 단계(0~6)를 하나의 페이지에서 렌더링하고 상태를 관리한다.
 */
import "./styles.css";
import { el, clear, qs, fmt } from "./ui/dom";
import { setupIllustrationSVG, predictionGraphSVG } from "./ui/illustration";
import { MotionCharts } from "./ui/charts";
import { MeasurementController, type MeasurementPhase } from "./ui/measurement";
import { buildReportHtml } from "./ui/report";
import { requestFeedback } from "./ui/gemini";
import { buildGeminiPayload } from "./geminiPayload";
import {
  createEmptyModel,
  type AppModel,
  type TrialData,
  type MeasurementSettings,
} from "./model";
import type { MotionSensorAdapter, MotionSample } from "./sensors/types";
import { PascoMotionAdapter } from "./sensors/pasco/PascoMotionAdapter";
import { DemoMotionAdapter, type DemoSpeedProfile } from "./sensors/demo/DemoMotionAdapter";
import { compareTrials } from "./sensors/motion/motionAnalysis";
import { describeMotionQuality } from "./sensors/motion/motionQuality";

const STEP_TITLES = [
  "예상하기",
  "실험 준비",
  "센서 연결",
  "운동 측정",
  "자료 분석과 해석",
  "AI 평가와 피드백",
  "결론과 보고서",
];

// ---- app state ----
const model: AppModel = createEmptyModel();
let adapter: MotionSensorAdapter | null = null;
// Keeps the most recent PASCO attempt so the teacher diagnostics panel can show
// discovered services / timeline / errors even when a connection FAILS.
let lastPascoAttempt: PascoMotionAdapter | null = null;
let isDemoAdapter = false;
let connected = false;
let charts: MotionCharts | null = null;
let measurement: MeasurementController | null = null;
let currentStep = 0;
let maxStep = 0;
let checklistDone = false;

const appHost = qs("#app")!;
const stepperHost = qs("#stepper")!;

// ============================================================
// Stepper + navigation
// ============================================================
function canEnter(step: number): boolean {
  if (step <= maxStep) return true;
  return false;
}

function renderStepper(): void {
  clear(stepperHost);
  STEP_TITLES.forEach((title, i) => {
    const chip = el("button", {
      class: `step-chip ${i === currentStep ? "active" : ""} ${i < currentStep ? "done" : ""}`,
      onclick: () => {
        if (canEnter(i)) goTo(i);
      },
    });
    chip.disabled = !canEnter(i) && i !== currentStep;
    chip.append(el("span", { class: "n", textContent: String(i) }), document.createTextNode(title));
    stepperHost.append(chip);
  });
}

function goTo(step: number): void {
  if (step === currentStep) return;
  // Clean up charts/measurement when leaving the measurement step.
  if (currentStep === 3 && step !== 3) {
    measurement?.abort();
    charts?.destroy();
    charts = null;
  }
  currentStep = step;
  maxStep = Math.max(maxStep, step);
  renderStepper();
  renderStep();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function unlockNext(): void {
  maxStep = Math.max(maxStep, currentStep + 1);
  renderStepper();
}

function navRow(opts: { nextLabel?: string; nextEnabled?: boolean; onNext?: () => void } = {}): HTMLElement {
  const row = el("div", { class: "nav-row" });
  const prev = el("button", {
    class: "btn btn-neutral",
    textContent: "← 이전",
    onclick: () => goTo(Math.max(0, currentStep - 1)),
  });
  prev.style.visibility = currentStep === 0 ? "hidden" : "visible";
  row.append(prev);
  if (currentStep < 6) {
    const next = el("button", {
      class: "btn btn-primary",
      textContent: opts.nextLabel ?? "다음 →",
      onclick: () => {
        // The button is only clickable when enabled, so navigation is always allowed here.
        if (next.disabled) return;
        opts.onNext?.();
        goTo(currentStep + 1);
      },
    });
    next.disabled = opts.nextEnabled === false;
    row.append(next);
  } else {
    row.append(el("span"));
  }
  return row;
}

// ============================================================
// Step renderers
// ============================================================
function renderStep(): void {
  clear(appHost);
  switch (currentStep) {
    case 0: return renderPredict();
    case 1: return renderPrepare();
    case 2: return renderConnect();
    case 3: return renderMeasure();
    case 4: return renderAnalyze();
    case 5: return renderFeedback();
    case 6: return renderReport();
  }
}

// ---- STEP 0: 예상하기 ----
function renderPredict(): void {
  const card = el("div", { class: "card" });
  card.append(
    el("h2", { textContent: "등속 운동의 그래프를 예상해 볼까요?" }),
    el("p", {
      class: "lead",
      textContent:
        "장난감 자동차가 일정한 속력으로 움직인다면, 같은 시간 동안 이동하는 거리는 어떻게 될까요? 실험 전에 먼저 예상해 보세요.",
    }),
  );

  // Q1 radio choices
  card.append(el("h3", { textContent: "예상 1. 등속 운동하는 자동차가 1초마다 이동하는 거리는 어떻게 될까요?" }));
  card.append(
    radioChoices("q1", [
      { key: "same", label: "매초 거의 같은 거리를 이동한다." },
      { key: "more", label: "시간이 지날수록 더 먼 거리를 이동한다." },
      { key: "less", label: "시간이 지날수록 더 짧은 거리를 이동한다." },
    ], model.predictions.q1, (v) => (model.predictions.q1 = v)),
  );

  // Q2 graph cards
  card.append(el("h3", { textContent: "예상 2. 시간–이동 거리 그래프는 어떤 모양에 가까울까요?" }));
  card.append(
    graphChoices("q2", [
      { key: "rising-straight", svg: "rising-straight", label: "오른쪽 위로 기울어진 직선" },
      { key: "curve-up", svg: "curve-up", label: "위로 굽은 곡선" },
      { key: "horizontal", svg: "horizontal", label: "수평선" },
    ], model.predictions.q2, (v) => (model.predictions.q2 = v)),
  );

  // Q3 graph cards
  card.append(el("h3", { textContent: "예상 3. 시간–속력 그래프는 어떤 모양에 가까울까요?" }));
  card.append(
    graphChoices("q3", [
      { key: "horizontal-positive", svg: "horizontal-positive", label: "0보다 큰 값에서 수평인 선" },
      { key: "rising", svg: "rising", label: "시간이 지날수록 높아지는 선" },
      { key: "falling", svg: "falling", label: "시간이 지날수록 낮아지는 선" },
    ], model.predictions.q3, (v) => (model.predictions.q3 = v)),
  );

  card.append(el("label", { class: "field", textContent: "그렇게 예상한 까닭을 써 보세요." }));
  const reason = el("textarea", { value: model.predictions.reason });
  reason.addEventListener("input", () => (model.predictions.reason = reason.value));
  card.append(reason);

  card.append(
    el("p", { class: "notice info", textContent: "정답은 실험을 마친 뒤에 스스로 확인하게 됩니다. 지금은 자유롭게 예상해 보세요." }),
    navRow({ onNext: unlockNext }),
  );
  appHost.append(card);
}

// ---- STEP 1: 실험 준비 ----
function renderPrepare(): void {
  const card = el("div", { class: "card" });
  card.append(
    el("h2", { textContent: "초음파 운동 센서와 자동차를 준비해요" }),
    el("p", { class: "lead", textContent: "아래 그림처럼 장치를 준비하고, 안전 수칙과 측정 범위를 확인하세요." }),
  );

  card.append(el("div", { class: "subcard", html: setupIllustrationSVG() }));

  card.append(el("h3", { textContent: "준비물" }));
  const mats = [
    "PASCO 무선 운동 센서",
    "일정한 속력으로 움직이는 장난감 자동차 또는 카트",
    "평평한 이동 경로",
    "자 또는 표시 테이프 (선택)",
    "Chrome 또는 Edge가 실행되는 기기",
  ];
  const ul = el("ul");
  mats.forEach((m) => ul.append(el("li", { textContent: m })));
  card.append(ul);

  card.append(
    el("div", {
      class: "notice safety",
      html: "<b>안전</b> · 자동차의 이동 경로를 비우고, 센서 앞에 손이나 다른 물체를 넣지 마세요. 자동차가 책상에서 떨어지지 않도록 주의하세요.",
    }),
    el("div", {
      class: "notice info",
      textContent:
        "측정 범위 안내: 자동차는 센서에서 20 cm 이상 떨어진 곳에서 출발하고, 약 20 cm ~ 350 cm 범위 안에서 센서로부터 멀어지는 방향으로 움직이게 하세요.",
    }),
  );

  card.append(el("h3", { textContent: "준비 확인 체크리스트" }));
  const items = [
    "센서의 초음파 발신부가 자동차를 향하고 있다.",
    "자동차가 센서에서 20 cm 이상 떨어져 있다.",
    "자동차가 센서에서 멀어지는 방향으로 움직인다.",
    "자동차의 이동 경로에 장애물이 없다.",
    "센서와 자동차의 전원이 켜져 있다.",
  ];
  const checks = items.map(() => false);
  const list = el("div", { class: "checklist" });
  const nextBtnRef: { row?: HTMLElement } = {};
  function refreshChecklist() {
    checklistDone = checks.every(Boolean);
    const btn = nextBtnRef.row?.querySelector(".btn-primary") as HTMLButtonElement | null;
    if (btn) btn.disabled = !checklistDone;
  }
  items.forEach((text, i) => {
    const wrap = el("label", { class: "check-item" });
    const cb = el("input", { type: "checkbox" });
    cb.addEventListener("change", () => {
      checks[i] = cb.checked;
      wrap.classList.toggle("checked", cb.checked);
      refreshChecklist();
    });
    wrap.append(cb, el("span", { textContent: text }));
    list.append(wrap);
  });
  card.append(list);

  const nav = navRow({ nextEnabled: checklistDone, onNext: unlockNext });
  nextBtnRef.row = nav;
  card.append(nav);
  appHost.append(card);
  refreshChecklist();
}

// ---- STEP 2: 센서 연결 ----
let connState = "연결되지 않음";
function renderConnect(): void {
  const card = el("div", { class: "card" });
  card.append(
    el("h2", { textContent: "PASCO 무선 운동 센서를 연결해요" }),
    el("p", {
      class: "lead",
      textContent:
        "아래 버튼을 누르면 블루투스 기기 선택 창이 열립니다. 이름에 Motion 또는 센서의 6자리 식별번호가 표시된 PASCO 운동 센서를 선택하세요.",
    }),
  );

  // environment guards
  if (!PascoMotionAdapter.isSupported()) {
    card.append(el("div", { class: "notice warn", html: "<b>지원하지 않는 브라우저</b> · 이 브라우저는 Web Bluetooth를 지원하지 않습니다. Chrome 또는 Edge에서 열어 주세요. (센서 없이 시연하기는 사용할 수 있습니다.)" }));
  } else if (!PascoMotionAdapter.isSecureContext()) {
    card.append(el("div", { class: "notice warn", html: "<b>HTTPS 연결 필요</b> · 보안 연결(HTTPS)에서만 센서를 연결할 수 있습니다." }));
  }

  const pill = el("div", { class: "state-pill idle", id: "connPill" });
  pill.append(el("span", { class: "dot" }), el("span", { id: "connText", textContent: connState }));
  card.append(el("div", { style: "margin:8px 0 4px" }, [pill]));

  const btnRow = el("div", { class: "btn-row" });
  const connectBtn = el("button", { class: "btn btn-primary", textContent: "센서 연결하기" });
  const disconnectBtn = el("button", { class: "btn btn-ghost", textContent: "연결 해제" });
  const demoBtn = el("button", { class: "btn btn-neutral", textContent: "센서 없이 시연하기" });
  disconnectBtn.disabled = !connected;
  connectBtn.disabled = !PascoMotionAdapter.isSupported() || !PascoMotionAdapter.isSecureContext();
  btnRow.append(connectBtn, disconnectBtn, demoBtn);
  card.append(btnRow);

  // live cards
  const live = el("div", { class: "live-grid" });
  live.append(
    liveCard("센서로부터의 거리", "connDist", "—", "cm"),
    liveCard("현재 속력", "connSpeed", "—", "cm/s"),
    liveCard("센서 상태", "connStatus", connected ? "연결됨" : "대기 중", ""),
  );
  card.append(live);

  card.append(diagnosticsPanel());

  const nav = navRow({ nextEnabled: connected || isDemoAdapter, onNext: () => unlockNext() });
  card.append(nav);
  appHost.append(card);

  const setState = (s: string, kind: "idle" | "busy" | "ok" | "err") => {
    connState = s;
    const t = qs("#connText");
    const p = qs("#connPill");
    if (t) t.textContent = s;
    if (p) p.className = `state-pill ${kind}`;
  };

  connectBtn.addEventListener("click", async () => {
    connectBtn.disabled = true;
    demoBtn.disabled = true;
    const pasco = new PascoMotionAdapter();
    lastPascoAttempt = pasco;
    const off = pasco.onSample((raw) => {
      const d = qs("#connDist");
      const sp = qs("#connSpeed");
      if (d) d.textContent = fmt((raw.rawPositionM) * 100, 1);
      if (sp) sp.textContent = raw.rawVelocityMps !== null ? fmt(Math.abs(raw.rawVelocityMps * 100), 1) : "—";
    });
    try {
      setState("기기 선택 중", "busy");
      const info = await pasco.connect();
      if (!info.hasValidPosition) throw new Error("측정값 해석 오류");
      adapter = pasco;
      isDemoAdapter = false;
      connected = true;
      setState("연결 완료", "ok");
      const st = qs("#connStatus"); if (st) st.textContent = "연결 완료";
      disconnectBtn.disabled = false;
      // start a light live stream for the connection cards
      await pasco.startStreaming({ sampleRateHz: 10 });
      pasco.onDisconnect(() => {
        connected = false;
        setState("연결 끊김", "err");
      });
      unlockNext();
      enableNextButton(nav);
      refreshDiagnostics();
    } catch (err) {
      off();
      const msg = err instanceof Error ? err.message : String(err);
      const kind = msg.includes("취소") || msg.toLowerCase().includes("cancel") ? "idle" : "err";
      setState(msg.includes("해석") ? "측정값 해석 오류" : (kind === "idle" ? "연결되지 않음" : "연결 끊김"), kind === "idle" ? "idle" : "err");
      connectBtn.disabled = false;
      demoBtn.disabled = false;
      // Surface diagnostics immediately so the teacher can see what failed.
      const panel = qs<HTMLDetailsElement>("#diagPanel");
      if (panel) panel.open = true;
      refreshDiagnostics();
    }
  });

  disconnectBtn.addEventListener("click", async () => {
    await adapter?.disconnect();
    connected = false;
    isDemoAdapter = false;
    adapter = null;
    setState("연결 끊김", "idle");
    disconnectBtn.disabled = true;
    connectBtn.disabled = false;
    demoBtn.disabled = false;
  });

  demoBtn.addEventListener("click", async () => {
    const demo = new DemoMotionAdapter({ profile: "slow" });
    await demo.connect();
    adapter = demo;
    isDemoAdapter = true;
    connected = false; // demo is not a real "연결 완료"
    setState("센서 없이 시연 중", "busy");
    const st = qs("#connStatus"); if (st) st.textContent = "시연 모드";
    unlockNext();
    enableNextButton(nav);
  });
}

function enableNextButton(nav: HTMLElement): void {
  const btn = nav.querySelector(".btn-primary") as HTMLButtonElement | null;
  if (btn) btn.disabled = false;
}

// ---- STEP 3: 운동 측정 ----
let liveSampleBuffer: MotionSample[] = [];
function renderMeasure(): void {
  const card = el("div", { class: "card" });
  card.append(
    el("h2", { textContent: "자동차의 운동을 측정해요" }),
    el("p", { class: "lead", textContent: "‘측정 준비’를 누르면 3초 카운트다운 뒤 출발 위치를 확인하고, 자동차가 출발하면 자동으로 기록을 시작합니다." }),
  );

  if (isDemoAdapter) {
    card.append(el("div", { class: "notice demo", textContent: "센서 없이 시연 중 — 모든 결과에는 ‘시연’ 표시가 붙고, 실제 센서 자료로 저장되지 않습니다." }));
  }
  if (!adapter) {
    card.append(el("div", { class: "notice warn", textContent: "먼저 2단계에서 센서를 연결하거나 시연 모드를 선택해 주세요." }), navRow());
    appHost.append(card);
    return;
  }

  card.append(teacherSettingsPanel());

  // state pill + countdown
  const phasePill = el("div", { class: "state-pill idle" });
  phasePill.append(el("span", { class: "dot" }), el("span", { id: "phaseText", textContent: "대기 중" }));
  card.append(el("div", { style: "margin:8px 0", id: "phaseWrap" }, [phasePill]));
  const countdownEl = el("div", { class: "countdown", id: "countdown", style: "display:none" });
  card.append(countdownEl);

  // live stats
  const live = el("div", { class: "live-grid" });
  live.append(
    liveCard("경과 시간", "mElapsed", "0.0", "s", true),
    liveCard("처음 위치로부터 이동 거리", "mDist", "0.0", "cm", true),
    liveCard("현재 속력", "mSpeed", "0.0", "cm/s"),
    liveCard("현재 센서 거리", "mRaw", "—", "cm"),
  );
  card.append(live);

  // graphs
  const graphs = el("div", { class: "graphs" });
  const g1 = el("div", { class: "graph-box" });
  g1.append(el("h4", { textContent: "시간–이동 거리 그래프" }), wrapCanvas("distChart"));
  const g2 = el("div", { class: "graph-box" });
  g2.append(el("h4", { textContent: "시간–속력 그래프" }), wrapCanvas("speedChart"));
  graphs.append(g1, g2);
  card.append(graphs);

  // controls
  const ctl = el("div", { class: "btn-row" });
  const prepBtn = el("button", { class: "btn btn-primary", textContent: "측정 준비" });
  const startBtn = el("button", { class: "btn btn-primary", textContent: "측정 시작" });
  const stopBtn = el("button", { class: "btn btn-orange", textContent: "측정 중지" });
  const redoBtn = el("button", { class: "btn btn-ghost", textContent: "다시 측정" });
  const clearBtn = el("button", { class: "btn btn-neutral", textContent: "측정값 초기화" });
  startBtn.disabled = true;
  stopBtn.disabled = true;
  ctl.append(prepBtn, startBtn, stopBtn, redoBtn, clearBtn);
  card.append(ctl);

  const resultHost = el("div", { id: "measureResult" });
  card.append(resultHost);

  const nav = navRow({ nextEnabled: model.trials.length > 0, onNext: unlockNext });
  card.append(nav);
  appHost.append(card);

  // init charts
  charts?.destroy();
  charts = new MotionCharts(qs<HTMLCanvasElement>("#distChart")!, qs<HTMLCanvasElement>("#speedChart")!);
  // redraw existing trials
  model.trials.forEach((t, i) => charts!.setTrial(i, t.label, t.samples));

  const settings = model.measurementSettings;
  const setPhase = (phase: MeasurementPhase, message: string) => {
    const t = qs("#phaseText"); if (t) t.textContent = message;
    const wrap = qs("#phaseWrap .state-pill");
    if (wrap) {
      wrap.className = "state-pill " + (phase === "recording" || phase === "baseline" || phase === "waiting-motion" || phase === "countdown" ? "busy" : phase === "done" ? "ok" : phase === "error" ? "err" : "idle");
    }
    const cd = qs("#countdown"); if (cd && phase !== "countdown") cd.style.display = "none";
    // "측정 시작" is available only while waiting for the car to start moving.
    startBtn.disabled = phase !== "waiting-motion";
    if (phase === "done" || phase === "error" || phase === "idle") {
      prepBtn.disabled = false;
      stopBtn.disabled = true;
    }
  };

  const startMeasurement = () => {
    if (!adapter) return;
    liveSampleBuffer = [];
    charts!.resetLive();
    model.trials.forEach((t, i) => charts!.setTrial(i + 1, t.label, t.samples)); // keep prior trials visible offset
    qs("#measureResult")!.replaceChildren();
    prepBtn.disabled = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;

    measurement = new MeasurementController(adapter, settings, {
      onPhase: setPhase,
      onCountdown: (n) => {
        const cd = qs("#countdown");
        if (cd) { cd.style.display = "block"; cd.textContent = String(n); }
      },
      onLiveSample: (s) => {
        liveSampleBuffer.push(s);
        charts!.pushLivePoint(s);
      },
      onLiveStats: (st) => {
        setText("mElapsed", fmt(st.elapsedS, 1));
        setText("mDist", fmt(st.movementCm, 1));
        setText("mSpeed", fmt(st.speedCmps, 1));
        setText("mRaw", fmt(st.rawPositionM * 100, 1));
      },
      onReverse: () => {
        qs("#measureResult")!.replaceChildren(
          el("div", { class: "notice warn", textContent: "운동 방향이 바뀌었습니다. 등속 직선 운동을 분석하려면 한 방향으로만 움직여 주세요." }),
        );
      },
      onError: (m) => {
        prepBtn.disabled = false;
        stopBtn.disabled = true;
        qs("#measureResult")!.replaceChildren(el("div", { class: "notice warn", textContent: m }));
      },
      onComplete: (partial) => {
        prepBtn.disabled = false;
        stopBtn.disabled = true;
        finalizeTrial(partial, settings);
      },
    }, isDemoAdapter);
    void measurement.start();
  };

  prepBtn.addEventListener("click", startMeasurement);
  startBtn.addEventListener("click", () => { measurement?.forceStart(); });
  stopBtn.addEventListener("click", () => { void measurement?.stop(); });
  redoBtn.addEventListener("click", startMeasurement);
  clearBtn.addEventListener("click", () => {
    model.trials = [];
    model.comparison = null;
    charts!.resetLive();
    qs("#measureResult")!.replaceChildren();
    ["mElapsed", "mDist", "mSpeed", "mRaw"].forEach((id) => setText(id, id === "mRaw" ? "—" : "0.0"));
    disableNext(nav);
  });
}

function finalizeTrial(partial: Omit<TrialData, "index" | "label">, settings: MeasurementSettings): void {
  const index = (model.trials.length === 0 ? 1 : 2) as 1 | 2;
  const trial: TrialData = { ...partial, index, label: `${index}차 측정` };
  if (model.trials.length >= 2) model.trials = [model.trials[0]]; // replace 2nd on redo
  model.trials.push(trial);
  charts?.resetLive();
  model.trials.forEach((t, i) => charts!.setTrial(i, t.label, t.samples));

  if (model.trials.length === 2) {
    model.comparison = compareTrials(model.trials[0].analysis, model.trials[1].analysis);
  }

  renderTrialResult(trial, settings);
  unlockNext();
  const nav = appHost.querySelector(".nav-row");
  if (nav) enableNextButton(nav as HTMLElement);
}

function renderTrialResult(trial: TrialData, settings: MeasurementSettings): void {
  const host = qs("#measureResult")!;
  const verdict = describeMotionQuality(trial.analysis);
  const wrap = el("div");

  wrap.append(el("h3", { html: `${trial.label} 결과 ${trial.isDemo ? "<span class='tag demo'>시연</span>" : "<span class='tag'>실측</span>"}` }));

  // result chips
  const rl = el("div", { class: "result-list" });
  verdict.messages.forEach((m) =>
    rl.append(el("div", { class: `result-item ${verdict.level === "good" ? "quality-good" : verdict.level === "poor" ? "quality-poor" : ""}`, textContent: m })),
  );
  wrap.append(rl);

  // tables with hide/reveal
  wrap.append(buildTablesUI(trial));

  // analysis summary
  const a = trial.analysis;
  wrap.append(el("div", { class: "subcard", html:
    `<b>자동 계산</b><br>기울기(=속력) <b>${fmt(a.distance.fit.slope)}</b> cm/s · R²=${fmt(a.distance.fit.r2, 3)} · 평균 속력 <b>${fmt(a.speed.meanCmps)}</b> cm/s · 속력 변동 ${fmt(a.speed.coefficientOfVariation * 100)}% · 속력 자료: ${trial.velocitySource === "sensor" ? "PASCO 센서 측정값" : "위치 자료로부터 계산한 값"}` }));

  // second trial offer
  if (model.trials.length === 1 && settings.enableSecondTrial) {
    const offer = el("div", { class: "subcard" });
    offer.append(el("b", { textContent: "다른 속력으로 한 번 더 측정해 볼까요?" }));
    const row = el("div", { class: "btn-row" });
    row.append(
      profileBtn("더 느린 운동 측정", "slow"),
      profileBtn("더 빠른 운동 측정", "fast"),
      el("button", { class: "btn btn-neutral", textContent: "한 번만 측정하고 계속하기", onclick: () => goTo(4) }),
    );
    offer.append(row);
    wrap.append(offer);
  }

  if (model.comparison) {
    const c = model.comparison;
    wrap.append(el("div", { class: "subcard", html:
      `<b>두 측정 비교</b><br>측정값 기준 더 빠른 운동: <b>${c.fasterTrial}차 측정</b> (평균 속력 ${fmt(c.trial1MeanSpeedCmps)} vs ${fmt(c.trial2MeanSpeedCmps)} cm/s) · 더 가파른 거리 그래프: <b>${c.steeperTrial}차 측정</b>` }));
  }

  host.replaceChildren(wrap);
}

function profileBtn(label: string, profile: DemoSpeedProfile): HTMLElement {
  return el("button", {
    class: "btn btn-ghost",
    textContent: label,
    onclick: async () => {
      // For demo mode, swap the demo speed profile. For real sensor, just re-measure.
      if (isDemoAdapter) {
        await adapter?.disconnect();
        const demo = new DemoMotionAdapter({ profile });
        await demo.connect();
        adapter = demo;
      }
      const prep = appHost.querySelector(".btn-primary") as HTMLButtonElement | null;
      prep?.click();
    },
  });
}

function buildTablesUI(trial: TrialData): HTMLElement {
  const box = el("div");
  let revealed = false;
  const tdTable = el("table", { class: "data-table hidden-values" });
  tdTable.innerHTML =
    `<caption>시간–이동 거리</caption><thead><tr><th>시간(s)</th><th>이동 거리(cm)</th></tr></thead><tbody>` +
    trial.timeDistanceTable.map((r) => `<tr><td>${r.timeS}</td><td class="calc">${fmt(r.distanceCm)}${r.interpolated ? " (보간)" : ""}</td></tr>`).join("") +
    `</tbody>`;
  const ivTable = el("table", { class: "data-table hidden-values" });
  ivTable.innerHTML =
    `<caption>구간 분석</caption><thead><tr><th>구간</th><th>구간 이동 거리(cm)</th><th>구간 평균 속력(cm/s)</th></tr></thead><tbody>` +
    trial.intervalTable.map((r) => `<tr><td>${r.label}</td><td class="calc">${fmt(r.intervalDistanceCm)}</td><td class="calc">${fmt(r.averageSpeedCmps)}</td></tr>`).join("") +
    `</tbody>`;

  const reveal = el("button", { class: "btn btn-ghost", textContent: "계산 결과 확인", style: "margin:10px 0" });
  reveal.addEventListener("click", () => {
    revealed = !revealed;
    tdTable.classList.toggle("hidden-values", !revealed);
    ivTable.classList.toggle("hidden-values", !revealed);
    reveal.textContent = revealed ? "계산 결과 숨기기" : "계산 결과 확인";
  });

  box.append(el("p", { class: "lead", style: "margin:14px 0 4px", textContent: "먼저 값을 예상하거나 직접 계산해 본 다음, 버튼을 눌러 계산 결과를 확인하세요." }), reveal);
  const tablesRow = el("div", { style: "display:flex;gap:16px;flex-wrap:wrap" });
  tablesRow.append(tdTable, ivTable);
  box.append(tablesRow);
  return box;
}

// ---- STEP 4: 자료 분석과 해석 ----
const ANALYSIS_QUESTIONS: { key: keyof AppModel["analysisAnswers"]; q: string }[] = [
  { key: "q1", q: "1초 동안 이동한 거리는 각 구간에서 어떠했나요? 측정값을 근거로 설명하세요." },
  { key: "q2", q: "시간이 지날수록 처음 위치로부터의 이동 거리는 어떻게 변했나요?" },
  { key: "q3", q: "시간–이동 거리 그래프가 직선에 가까운 까닭은 무엇인가요?" },
  { key: "q4", q: "시간–이동 거리 그래프의 기울기는 무엇을 뜻하나요?" },
  { key: "q5", q: "시간–속력 그래프가 수평선에 가까운 까닭은 무엇인가요?" },
  { key: "q6", q: "그래프가 완벽한 직선이나 수평선이 되지 않은 까닭을 한 가지 이상 써 보세요." },
];

function renderAnalyze(): void {
  const card = el("div", { class: "card" });
  card.append(
    el("h2", { textContent: "그래프와 표를 분석해요" }),
    el("p", { class: "lead", textContent: "측정한 그래프와 표를 보면서 질문에 답해 보세요. 답은 자동으로 저장됩니다." }),
  );

  if (model.trials.length === 0) {
    card.append(el("div", { class: "notice warn", textContent: "먼저 3단계에서 운동을 측정해 주세요." }), navRow());
    appHost.append(card);
    return;
  }

  // recap chips
  const t0 = model.trials[0];
  card.append(el("div", { class: "subcard", html:
    `<b>${t0.label} 요약</b> · 기울기(속력) ${fmt(t0.analysis.distance.fit.slope)} cm/s · R²=${fmt(t0.analysis.distance.fit.r2, 3)} · 평균 속력 ${fmt(t0.analysis.speed.meanCmps)} cm/s` }));

  ANALYSIS_QUESTIONS.forEach((item, i) => {
    card.append(el("label", { class: "field", textContent: `질문 ${i + 1}. ${item.q}` }));
    const ta = el("textarea", { value: model.analysisAnswers[item.key] ?? "" });
    ta.addEventListener("input", () => (model.analysisAnswers[item.key] = ta.value));
    card.append(ta);
  });

  if (model.trials.length === 2) {
    card.append(el("label", { class: "field", textContent: "비교 질문. 더 빠른 운동에서는 두 그래프가 어떻게 달라졌나요? (실제 측정값을 근거로 쓰세요)" }));
    const ta = el("textarea", { value: model.analysisAnswers.comparison ?? "" });
    ta.addEventListener("input", () => (model.analysisAnswers.comparison = ta.value));
    card.append(ta);
  }

  card.append(navRow({ onNext: unlockNext }));
  appHost.append(card);
}

// ---- STEP 5: AI 평가와 피드백 ----
function renderFeedback(): void {
  const card = el("div", { class: "card" });
  card.append(
    el("h2", { textContent: "AI와 함께 탐구 결과를 점검해요" }),
    el("p", { class: "lead", textContent: "지금까지의 예상과 측정 자료, 분석 답변을 바탕으로 AI가 피드백을 제공합니다. 개인정보는 전송되지 않습니다." }),
  );

  if (model.trials.length === 0) {
    card.append(el("div", { class: "notice warn", textContent: "먼저 운동을 측정하고 분석 질문에 답해 주세요." }), navRow());
    appHost.append(card);
    return;
  }

  const runBtn = el("button", { class: "btn btn-primary", textContent: model.feedback ? "AI 피드백 다시 받기" : "AI 피드백 받기" });
  const out = el("div", { id: "aiOut" });
  card.append(el("div", { class: "btn-row" }, [runBtn]), out);

  if (model.feedback) renderFeedbackCard(out, model.feedback);

  runBtn.addEventListener("click", async () => {
    runBtn.disabled = true;
    out.replaceChildren(el("div", { class: "ai-card" }, [el("span", { class: "spinner" }), document.createTextNode(" AI가 자료를 살펴보고 있어요…")]));
    const payload = buildGeminiPayload(model);
    const result = await requestFeedback(payload);
    runBtn.disabled = false;
    if (!result.ok || !result.feedback) {
      out.replaceChildren(el("div", { class: "notice warn", textContent: (result.error ?? "AI 피드백을 받지 못했습니다.") + " 다시 시도해 주세요." }));
      return;
    }
    model.feedback = result.feedback;
    renderFeedbackCard(out, result.feedback);
  });

  card.append(navRow({ onNext: unlockNext }));
  appHost.append(card);
}

function renderFeedbackCard(host: HTMLElement, fb: AppModel["feedback"]): void {
  if (!fb) return;
  const lvlClass = (l: string) => (l.includes("충분") ? "lvl-ok" : l.includes("부분") ? "lvl-mid" : "lvl-low");
  const card = el("div", { class: "ai-card" });
  card.append(el("div", { class: "ai-section", html: `<b>총평</b>${escapeHtml(fb.overallSummary)}` }));
  if (fb.strengths.length) {
    card.append(el("div", { class: "ai-section", html: `<b>잘한 점</b>${fb.strengths.map(escapeHtml).join("<br>")}` }));
  }
  const sec = (title: string, s: { level: string; feedback: string }) =>
    el("div", { class: "ai-section", html: `<b>${title}<span class="ai-level ${lvlClass(s.level)}">${escapeHtml(s.level)}</span></b>${escapeHtml(s.feedback)}` });
  card.append(
    sec("개념 이해", fb.conceptUnderstanding),
    sec("자료 활용", fb.dataEvidence),
    sec("그래프 해석", fb.graphInterpretation),
    sec("오차 분석", fb.errorAnalysis),
  );
  card.append(el("div", { class: "ai-section", html: `<b>고쳐 볼 질문</b>${escapeHtml(fb.revisionQuestion)}` }));
  if (fb.modelConclusion && model.studentConclusion.trim()) {
    card.append(el("div", { class: "ai-section", html: `<b>예시 결론(참고)</b>${escapeHtml(fb.modelConclusion)}` }));
  } else {
    card.append(el("div", { class: "notice info", textContent: "예시 결론은 6단계에서 스스로 결론을 먼저 작성한 뒤에 확인할 수 있습니다." }));
  }
  host.replaceChildren(card);
}

// ---- STEP 6: 결론과 보고서 ----
function renderReport(): void {
  const card = el("div", { class: "card" });
  card.append(
    el("h2", { textContent: "나의 탐구 보고서를 완성해요" }),
    el("p", { class: "lead", textContent: "두 그래프를 이용해 결론을 쓰고, 보고서를 만들어 인쇄하거나 PDF로 저장하세요." }),
  );

  card.append(el("label", { class: "field", textContent: "결론. 등속 운동하는 물체의 이동 거리와 속력이 시간에 따라 어떻게 변하는지, 두 그래프를 이용하여 설명하세요." }));
  const conc = el("textarea", { value: model.studentConclusion, style: "min-height:120px" });
  conc.addEventListener("input", () => (model.studentConclusion = conc.value));
  card.append(conc);

  card.append(el("div", { class: "subcard", html:
    "<b>결론 작성 도우미</b><br>· 같은 시간 동안 이동한 거리<br>· 시간–이동 거리 그래프의 모양<br>· 그래프의 기울기가 뜻하는 것<br>· 시간–속력 그래프의 모양<br>· 실제 자료가 이상적인 그래프와 조금 다른 까닭" }));

  // identity fields (local only)
  card.append(el("h3", { textContent: "보고서 정보 (이 기기에만 저장되며 AI로 전송되지 않습니다)" }));
  const idGrid = el("div", { style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px" });
  idField(idGrid, "학교", "school");
  idField(idGrid, "학년", "grade");
  idField(idGrid, "반", "classNo");
  idField(idGrid, "번호", "studentNo");
  idField(idGrid, "이름", "studentName");
  idField(idGrid, "실험 날짜", "experimentDate", "date");
  card.append(idGrid);

  const btnRow = el("div", { class: "btn-row" });
  const makeBtn = el("button", { class: "btn btn-primary", textContent: "보고서 만들기" });
  const printBtn = el("button", { class: "btn btn-ghost", textContent: "인쇄하기" });
  printBtn.disabled = true;
  btnRow.append(makeBtn, printBtn);
  card.append(btnRow);
  card.append(el("div", { class: "notice info", html: "<b>PDF로 저장하는 방법</b> · ‘인쇄하기’를 누른 뒤 인쇄 대화상자에서 프린터 대신 ‘PDF로 저장’ 또는 ‘Microsoft Print to PDF’를 선택하세요." }));

  const preview = el("div", { id: "reportPreview", style: "margin-top:16px" });
  card.append(preview);

  makeBtn.addEventListener("click", async () => {
    makeBtn.disabled = true;
    makeBtn.textContent = "보고서 만드는 중…";
    try {
      const images = await renderChartImages();
      const html = buildReportHtml(model, images);
      qs("#report")!.innerHTML = html;
      // on-screen preview
      preview.innerHTML = `<div class="subcard" style="overflow:auto">${html}</div>`;
      printBtn.disabled = false;
      makeBtn.textContent = "보고서 다시 만들기";
    } catch (err) {
      preview.innerHTML = "";
      preview.append(el("div", { class: "notice warn", textContent: "보고서를 만들지 못했습니다. 다시 시도해 주세요." }));
      void err;
      makeBtn.textContent = "보고서 만들기";
    } finally {
      makeBtn.disabled = false;
    }
  });

  printBtn.addEventListener("click", () => {
    try { window.print(); } catch { alert("인쇄를 시작할 수 없습니다. 브라우저 메뉴에서 인쇄를 사용해 주세요."); }
  });

  card.append(navRow());
  appHost.append(card);
}

function idField(host: HTMLElement, label: string, key: keyof AppModel["identity"], type = "text"): void {
  const wrap = el("div");
  wrap.append(el("label", { class: "field", textContent: label, style: "margin-top:0" }));
  const input = el("input", { type, value: model.identity[key] });
  input.addEventListener("input", () => (model.identity[key] = input.value));
  wrap.append(input);
  host.append(wrap);
}

/** Render each trial onto offscreen charts and capture PNG data URLs. */
async function renderChartImages(): Promise<{ distance: string; speed: string }[]> {
  const images: { distance: string; speed: string }[] = [];
  for (const trial of model.trials) {
    const dist = document.createElement("canvas");
    const speed = document.createElement("canvas");
    dist.width = 520; dist.height = 320; speed.width = 520; speed.height = 320;
    const host = el("div", { style: "position:fixed;left:-9999px;top:0;width:520px" });
    host.append(dist, speed);
    document.body.append(host);
    const c = new MotionCharts(dist, speed);
    c.setTrial(0, trial.label, trial.samples);
    // Chart.js renders synchronously (animation:false); a short tick is enough.
    await new Promise((r) => setTimeout(r, 40));
    images.push({ distance: dist.toDataURL("image/png"), speed: speed.toDataURL("image/png") });
    c.destroy();
    host.remove();
  }
  return images;
}

// ============================================================
// shared widgets
// ============================================================
function radioChoices(
  name: string,
  options: { key: string; label: string }[],
  selected: string,
  onChange: (v: string) => void,
): HTMLElement {
  const wrap = el("div", { class: "choices" });
  options.forEach((o) => {
    const label = el("label", { class: `choice ${selected === o.key ? "selected" : ""}` });
    const input = el("input", { type: "radio", name, value: o.key });
    input.checked = selected === o.key;
    input.addEventListener("change", () => {
      onChange(o.key);
      wrap.querySelectorAll(".choice").forEach((c) => c.classList.remove("selected"));
      label.classList.add("selected");
    });
    label.append(input, el("span", { textContent: o.label }));
    wrap.append(label);
  });
  return wrap;
}

function graphChoices(
  name: string,
  options: { key: string; svg: string; label: string }[],
  selected: string,
  onChange: (v: string) => void,
): HTMLElement {
  const wrap = el("div", { class: "graph-choices" });
  options.forEach((o) => {
    const div = el("div", { class: `graph-choice ${selected === o.key ? "selected" : ""}`, html: predictionGraphSVG(o.svg) });
    div.append(el("span", { textContent: o.label }));
    div.addEventListener("click", () => {
      onChange(o.key);
      wrap.querySelectorAll(".graph-choice").forEach((c) => c.classList.remove("selected"));
      div.classList.add("selected");
    });
    wrap.append(div);
  });
  void name;
  return wrap;
}

function liveCard(k: string, id: string, v: string, u: string, accent = false): HTMLElement {
  const card = el("div", { class: `live-card ${accent ? "accent" : ""}` });
  card.append(
    el("div", { class: "k", textContent: k }),
    el("div", { class: "v", id, textContent: v }),
    u ? el("div", { class: "u", textContent: u }) : el("span"),
  );
  return card;
}

function wrapCanvas(id: string): HTMLElement {
  const wrap = el("div", { class: "graph-canvas-wrap" });
  wrap.append(el("canvas", { id }));
  return wrap;
}

function setText(id: string, text: string): void {
  const node = qs("#" + id);
  if (node) node.textContent = text;
}

function disableNext(nav: HTMLElement): void {
  const btn = nav.querySelector(".btn-primary") as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
}

function escapeHtml(s: string): string {
  return (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

// ---- teacher settings panel (collapsed) ----
function teacherSettingsPanel(): HTMLElement {
  const s = model.measurementSettings;
  const det = el("details", { class: "diag" });
  det.append(el("summary", { textContent: "교사용 측정 설정" }));
  const body = el("div", { class: "diag-body" });

  const numField = (label: string, value: number, min: number, max: number, step: number, on: (n: number) => void) => {
    const w = el("div");
    w.append(el("label", { class: "field", textContent: label, style: "margin-top:8px" }));
    const inp = el("input", { type: "number", value: String(value), min: String(min), max: String(max), step: String(step) });
    inp.addEventListener("change", () => on(Number(inp.value)));
    w.append(inp);
    return w;
  };

  body.append(
    numField("측정 시간 (3–10초)", s.durationS, 3, 10, 1, (n) => (s.durationS = clampNum(n, 3, 10))),
    numField("자료 수집 간격 (Hz)", s.sampleRateHz, 2, 20, 1, (n) => (s.sampleRateHz = clampNum(n, 2, 20))),
    numField("운동 시작 판단 속력 (cm/s)", s.startThresholdCmps, 1, 20, 1, (n) => (s.startThresholdCmps = clampNum(n, 1, 20))),
  );

  const dirWrap = el("div");
  dirWrap.append(el("label", { class: "field", textContent: "운동 방향" }));
  const dirSel = el("select");
  [["away", "센서에서 멀어짐"], ["toward", "센서에 가까워짐"], ["auto", "자동 판단"]].forEach(([v, t]) => {
    const opt = el("option", { value: v, textContent: t });
    if (s.direction === v) opt.selected = true;
    dirSel.append(opt);
  });
  dirSel.addEventListener("change", () => (s.direction = dirSel.value as MeasurementSettings["direction"]));
  dirWrap.append(dirSel);

  const velWrap = el("div");
  velWrap.append(el("label", { class: "field", textContent: "속력 자료" }));
  const velSel = el("select");
  [["sensor", "PASCO 속도 자료 우선"], ["derived", "위치 자료로 계산"]].forEach(([v, t]) => {
    const opt = el("option", { value: v, textContent: t });
    if ((s.preferSensorVelocity ? "sensor" : "derived") === v) opt.selected = true;
    velSel.append(opt);
  });
  velSel.addEventListener("change", () => (s.preferSensorVelocity = velSel.value === "sensor"));
  velWrap.append(velSel);

  const cmpWrap = el("label", { class: "check-item", style: "margin-top:10px" });
  const cmpCb = el("input", { type: "checkbox" });
  cmpCb.checked = s.enableSecondTrial;
  cmpCb.addEventListener("change", () => (s.enableSecondTrial = cmpCb.checked));
  cmpWrap.append(cmpCb, el("span", { textContent: "두 번째 측정 비교 기능 사용" }));

  body.append(dirWrap, velWrap, cmpWrap);
  det.append(body);
  return det;
}

function clampNum(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

// ---- diagnostics panel ----
function diagnosticsPanel(): HTMLElement {
  const det = el("details", { class: "diag", id: "diagPanel" });
  det.append(el("summary", { textContent: "PASCO 운동 센서 연결 진단 (교사용)" }));
  const body = el("div", { class: "diag-body", id: "diagBody" });
  body.append(el("p", { class: "lead", textContent: "센서를 연결하거나 시연을 시작하면 진단 정보가 표시됩니다." }));
  det.append(body);
  det.addEventListener("toggle", () => { if (det.open) refreshDiagnostics(); });
  return det;
}

function refreshDiagnostics(): void {
  const body = qs("#diagBody");
  if (!body) return;
  // Use the live adapter if present, otherwise the most recent PASCO attempt so
  // a FAILED connection still shows its timeline / discovered services / error.
  const src = adapter ?? lastPascoAttempt;
  if (!src) return;
  const d = src.getDiagnostics();
  const pasco = src instanceof PascoMotionAdapter ? src : null;

  const grid = el("div", { class: "diag-grid" });
  const row = (k: string, v: string) => { grid.append(el("div", { class: "k", textContent: k }), el("div", { class: "v", textContent: v })); };
  row("기기 이름", d.deviceName ?? "—");
  row("센서 ID", d.parsedSensorId ?? "—");
  row("인터페이스 ID", d.interfaceId !== null ? String(d.interfaceId) : "—");
  row("연결 상태", d.connectionState);
  row("발견한 서비스", d.services.join(", ") || "—");
  row("발견한 특성 수", String(d.characteristics.length));
  row("측정 항목", d.measurementNames.join(", ") || "—");
  row("단위", d.units.join(", ") || "—");
  row("현재 위치(m)", d.currentRawPositionM !== null ? fmt(d.currentRawPositionM, 3) : "—");
  row("현재 속도 후보(m/s)", d.currentRawVelocityMps !== null ? fmt(d.currentRawVelocityMps, 3) : "—");
  row("속력 자료 출처", d.velocitySource === "sensor" ? "PASCO 센서 측정값" : d.velocitySource === "derived" ? "위치 자료로부터 계산한 값" : "—");
  row("시연 여부", d.isDemo ? "예 (센서 없이 시연 중)" : "아니오");
  row("마지막 오류", d.lastError ?? "—");

  const body2 = el("div");
  body2.append(grid);

  // Discovered characteristics with properties (helps locate the data service).
  if (d.characteristics.length) {
    body2.append(el("div", { class: "k", style: "margin-top:10px", textContent: "발견한 특성 (UUID · 속성)" }));
    body2.append(el("pre", {
      textContent: d.characteristics.map((c) => `${c.uuid}  [${c.properties.join(", ")}]`).join("\n"),
    }));
  }

  body2.append(el("div", { class: "k", style: "margin-top:10px", textContent: "최근 원시 패킷(hex)" }));
  body2.append(el("pre", { textContent: d.lastRawPacketHex ?? "—" }));

  // Latest packet per characteristic — reveals which char carries live data.
  const byChar = d.lastPacketByChar ?? {};
  if (Object.keys(byChar).length) {
    body2.append(el("div", { class: "k", style: "margin-top:10px", textContent: "특성별 최근 패킷(hex)" }));
    body2.append(el("pre", {
      textContent: Object.entries(byChar).map(([uuid, hex]) => `${uuid.slice(0, 13)} · ${hex}`).join("\n"),
    }));
  }

  // Connection timeline — the key evidence when a connection fails.
  if (d.timeline.length) {
    body2.append(el("div", { class: "k", style: "margin-top:10px", textContent: "연결 진행 기록" }));
    body2.append(el("pre", {
      textContent: d.timeline.map((t) => `+${(t.timeMs / 1000).toFixed(1)}s  ${t.message}`).join("\n"),
    }));
  }

  const btns = el("div", { class: "btn-row" });
  btns.append(
    el("button", { class: "btn btn-neutral", textContent: "진단 정보 복사", onclick: () => navigator.clipboard?.writeText(JSON.stringify(d, null, 2)) }),
    el("button", { class: "btn btn-neutral", textContent: "진단 정보 JSON 저장", onclick: () => downloadJson("pasco-motion-diagnostics.json", d) }),
  );
  if (pasco && !d.isDemo) {
    btns.append(
      el("button", { class: "btn btn-neutral", textContent: "원시 패킷 기록 시작", onclick: () => { pasco.startPacketLog(); } }),
      el("button", { class: "btn btn-neutral", textContent: "원시 패킷 기록 중지", onclick: () => { pasco.stopPacketLog(); refreshDiagnostics(); } }),
    );
  }
  btns.append(el("button", { class: "btn btn-neutral", textContent: "새로고침", onclick: () => refreshDiagnostics() }));
  body2.append(btns);

  body.replaceChildren(body2);
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ============================================================
// boot
// ============================================================
renderStepper();
renderStep();
