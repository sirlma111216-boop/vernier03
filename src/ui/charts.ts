/** Chart.js wrappers for the two synchronized graphs. */

import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Tooltip,
  Legend,
} from "chart.js";
import type { ChartConfiguration } from "chart.js";
import type { MotionSample } from "../sensors/types";

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Tooltip,
  Legend,
);

const TRIAL_COLORS = ["#0E9E94", "#F4623A"];

function baseConfig(yLabel: string, xLabel: string, responsive = true): ChartConfiguration<"line"> {
  return {
    type: "line",
    data: { datasets: [] },
    options: {
      // Responsive on-screen; fixed-size (uses the canvas width/height attributes)
      // for offscreen report capture so the image never stretches vertically.
      responsive,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "nearest", intersect: false },
      scales: {
        x: {
          type: "linear",
          beginAtZero: true,
          title: { display: true, text: xLabel, font: { weight: "bold" } },
          grid: { color: "#E4EBE9" },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: yLabel, font: { weight: "bold" } },
          grid: { color: "#E4EBE9" },
        },
      },
      plugins: {
        legend: { display: true, position: "top" },
        tooltip: { enabled: true },
      },
    },
  };
}

export class MotionCharts {
  private distance: Chart<"line">;
  private speed: Chart<"line">;

  constructor(
    distanceCanvas: HTMLCanvasElement,
    speedCanvas: HTMLCanvasElement,
    opts: { responsive?: boolean } = {},
  ) {
    const responsive = opts.responsive ?? true;
    this.distance = new Chart(distanceCanvas, baseConfig("이동 거리(cm)", "시간(s)", responsive));
    this.speed = new Chart(speedCanvas, baseConfig("속력(cm/s)", "시간(s)", responsive));
  }

  /** Replace one trial's data (index 0 or 1) on both charts. */
  setTrial(index: number, label: string, samples: MotionSample[]): void {
    const color = TRIAL_COLORS[index % TRIAL_COLORS.length];
    const distData = samples.map((s) => ({ x: s.elapsedTimeS, y: s.movementDistanceCm }));
    const speedData = samples.map((s) => ({ x: s.elapsedTimeS, y: s.speedCmps }));
    upsertDataset(this.distance, index, label, color, distData);
    upsertDataset(this.speed, index, label, color, speedData);
    this.distance.update("none");
    this.speed.update("none");
  }

  /** Live-append a single point to the dataset at `index` (used during recording). */
  pushLivePoint(index: number, sample: MotionSample): void {
    const color = TRIAL_COLORS[index % TRIAL_COLORS.length];
    ensureDataset(this.distance, index, "측정 중", color);
    ensureDataset(this.speed, index, "측정 중", color);
    (this.distance.data.datasets[index].data as { x: number; y: number }[]).push({
      x: sample.elapsedTimeS,
      y: sample.movementDistanceCm,
    });
    (this.speed.data.datasets[index].data as { x: number; y: number }[]).push({
      x: sample.elapsedTimeS,
      y: sample.speedCmps,
    });
    this.distance.update("none");
    this.speed.update("none");
  }

  resetLive(): void {
    this.distance.data.datasets = [];
    this.speed.data.datasets = [];
    this.distance.update("none");
    this.speed.update("none");
  }

  destroy(): void {
    this.distance.destroy();
    this.speed.destroy();
  }
}

function ensureDataset(chart: Chart<"line">, index: number, label: string, color: string) {
  // Fill any lower slots too — a sparse datasets array crashes Chart.js updates.
  for (let i = 0; i <= index; i++) {
    if (!chart.data.datasets[i]) {
      chart.data.datasets[i] = {
        label: i === index ? label : "",
        data: [],
        borderColor: i === index ? color : "transparent",
        backgroundColor: i === index ? color : "transparent",
        pointRadius: 2,
        borderWidth: 2.5,
        tension: 0.15,
      };
    }
  }
}

function upsertDataset(
  chart: Chart<"line">,
  index: number,
  label: string,
  color: string,
  data: { x: number; y: number }[],
) {
  ensureDataset(chart, index, label, color);
  chart.data.datasets[index].label = label;
  chart.data.datasets[index].data = data;
}
