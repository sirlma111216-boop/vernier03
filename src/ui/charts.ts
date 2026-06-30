/** Chart.js wrappers for the two synchronized graphs. */

import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Title,
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
  Title,
  Tooltip,
  Legend,
);

const TRIAL_COLORS = ["#0E9E94", "#F4623A"];

function baseConfig(yLabel: string, xLabel: string): ChartConfiguration<"line"> {
  return {
    type: "line",
    data: { datasets: [] },
    options: {
      responsive: true,
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

  constructor(distanceCanvas: HTMLCanvasElement, speedCanvas: HTMLCanvasElement) {
    this.distance = new Chart(distanceCanvas, baseConfig("이동 거리(cm)", "시간(s)"));
    this.speed = new Chart(speedCanvas, baseConfig("속력(cm/s)", "시간(s)"));
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

  /** Live-append a single point to trial 0 (used during recording). */
  pushLivePoint(sample: MotionSample): void {
    ensureDataset(this.distance, 0, "측정 중", TRIAL_COLORS[0]);
    ensureDataset(this.speed, 0, "측정 중", TRIAL_COLORS[0]);
    (this.distance.data.datasets[0].data as { x: number; y: number }[]).push({
      x: sample.elapsedTimeS,
      y: sample.movementDistanceCm,
    });
    (this.speed.data.datasets[0].data as { x: number; y: number }[]).push({
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

  clearTrial(index: number): void {
    removeDataset(this.distance, index);
    removeDataset(this.speed, index);
    this.distance.update("none");
    this.speed.update("none");
  }

  destroy(): void {
    this.distance.destroy();
    this.speed.destroy();
  }
}

function ensureDataset(chart: Chart<"line">, index: number, label: string, color: string) {
  if (!chart.data.datasets[index]) {
    chart.data.datasets[index] = {
      label,
      data: [],
      borderColor: color,
      backgroundColor: color,
      pointRadius: 2,
      borderWidth: 2.5,
      tension: 0.15,
    };
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

function removeDataset(chart: Chart<"line">, index: number) {
  if (chart.data.datasets[index]) {
    chart.data.datasets[index].data = [];
    chart.data.datasets[index].label = "";
  }
}
