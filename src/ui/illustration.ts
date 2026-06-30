/**
 * Original, copyright-safe SVG of the experiment setup. Drawn from scratch:
 * a PASCO ultrasonic motion sensor at the left end of a flat track, pointing
 * at a toy car that moves away from the sensor. No textbook artwork is copied.
 */
export function setupIllustrationSVG(): string {
  return `
<svg viewBox="0 0 640 280" role="img" aria-label="초음파 운동 센서가 센서에서 멀어지는 방향으로 움직이는 장난감 자동차를 향하고 있는 실험 장치 그림" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="track" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#E6F7F4"/><stop offset="1" stop-color="#CFEDE7"/>
    </linearGradient>
    <linearGradient id="carBody" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#F4623A"/><stop offset="1" stop-color="#D94f2a"/>
    </linearGradient>
  </defs>
  <!-- table / track -->
  <rect x="20" y="190" width="600" height="26" rx="6" fill="url(#track)" stroke="#9FD6CC"/>
  <line x1="20" y1="216" x2="620" y2="244" stroke="#CFE6E0" stroke-width="10" stroke-linecap="round"/>

  <!-- sensor -->
  <g>
    <rect x="36" y="120" width="74" height="70" rx="10" fill="#1E2A32"/>
    <rect x="44" y="128" width="58" height="30" rx="5" fill="#2DD4BF"/>
    <circle cx="100" cy="173" r="9" fill="#0E9E94"/>
    <circle cx="100" cy="173" r="3.5" fill="#ECFBF6"/>
    <text x="73" y="150" font-size="11" font-weight="700" text-anchor="middle" fill="#ECFBF6">PASCO</text>
  </g>

  <!-- ultrasonic waves -->
  <g fill="none" stroke="#0E9E94" stroke-width="2.5" opacity="0.55">
    <path d="M120 160 q16 13 0 26"/>
    <path d="M134 152 q26 21 0 42"/>
    <path d="M148 144 q36 29 0 58"/>
  </g>

  <!-- toy car (moving away, to the right) -->
  <g transform="translate(360 150)">
    <rect x="0" y="14" width="120" height="34" rx="9" fill="url(#carBody)"/>
    <path d="M22 14 h60 l-12 -20 h-30 z" fill="#FFB59D"/>
    <circle cx="28" cy="52" r="13" fill="#1E2A32"/><circle cx="28" cy="52" r="5" fill="#9AA7AC"/>
    <circle cx="94" cy="52" r="13" fill="#1E2A32"/><circle cx="94" cy="52" r="5" fill="#9AA7AC"/>
  </g>

  <!-- direction arrow -->
  <g stroke="#0E9E94" stroke-width="3" fill="#0E9E94">
    <line x1="150" y1="100" x2="540" y2="100"/>
    <path d="M540 100 l-16 -8 v16 z"/>
    <text x="345" y="88" font-size="15" font-weight="700" text-anchor="middle" fill="#0E9E94" stroke="none">센서에서 멀어지는 방향</text>
  </g>

  <!-- distance label -->
  <g stroke="#5A6B72" stroke-width="1.5">
    <line x1="100" y1="232" x2="420" y2="232"/>
    <line x1="100" y1="226" x2="100" y2="238"/>
    <line x1="420" y1="226" x2="420" y2="238"/>
    <text x="260" y="226" font-size="12" text-anchor="middle" fill="#5A6B72" stroke="none">처음 위치로부터 이동 거리</text>
  </g>
</svg>`;
}

/** Small prediction graph cards (original, schematic). */
export function predictionGraphSVG(kind: string): string {
  const axes = `<line x1="14" y1="76" x2="116" y2="76" stroke="#9AA7AC" stroke-width="2"/>
    <line x1="14" y1="76" x2="14" y2="10" stroke="#9AA7AC" stroke-width="2"/>`;
  const line = (d: string, color = "#0E9E94") =>
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`;
  let body = "";
  switch (kind) {
    case "rising-straight":
      body = line("M16 72 L112 18");
      break;
    case "curve-up":
      body = line("M16 72 Q86 70 112 16");
      break;
    case "horizontal":
      body = line("M16 44 L112 44");
      break;
    case "horizontal-positive":
      body = line("M16 40 L112 40");
      break;
    case "rising":
      body = line("M16 70 L112 22");
      break;
    case "falling":
      body = line("M16 22 L112 70");
      break;
    default:
      body = "";
  }
  return `<svg viewBox="0 0 124 86" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${axes}${body}</svg>`;
}
