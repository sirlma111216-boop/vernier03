# PASCO 운동 센서 실험 개발 노트 — 등속 운동하는 물체의 운동 그래프

> 앱: `등속 운동하는 물체의 운동 그래프` · 브랜드: `파스코 척척박사`
> 대상 센서: **PASCO Wireless Motion Sensor PS-3219** (초음파 운동 센서)

---

## 1. 저장소 아키텍처 (Repository architecture)

`labbitory-cloudflare`는 **정적 허브 사이트**입니다 (Cloudflare Pages). 프레임워크/번들러
없이 루트의 HTML 파일(`index.html`, `science.html`, `vernier.html` 등)을 그대로 서빙합니다.
실제 센서 탐구 앱들은 **별도의 서브도메인 앱**으로 배포됩니다(예: `vernier01.labbitory.com`,
`vernier02.labbitory.com`). 허브의 `vernier.html`은 그 앱들을 카드로 링크합니다.

따라서 이 PASCO 운동 실험도 **자체 완결형 서브 프로젝트**로 만들었습니다. 기존 정적 사이트와
다른 Vernier/PASCO 앱을 전혀 건드리지 않으며, 빌드/테스트 파이프라인을 갖춥니다.

```
labbitory-cloudflare/
  index.html, vernier.html, science.html ...   ← 기존 허브(그대로 유지)
  pasco.html                                    ← (신규) 파스코 척척박사 허브 페이지
  docs/
    PASCO_MOTION_EXPERIMENT_NOTES.md            ← (신규) 이 문서
    PASCO_MOTION_HARDWARE_TEST_CHECKLIST.md     ← (신규) 하드웨어 점검표
  THIRD_PARTY_NOTICES.md                        ← (신규) 제3자 고지
  apps/
    pasco-motion/                               ← (신규) 운동 실험 앱 (Vite + TS + Vitest)
      index.html
      src/
        main.ts                                 ← 7단계 학습 흐름 컨트롤러
        model.ts                                ← 앱 데이터 모델(예상/측정/답변/보고서)
        geminiPayload.ts                        ← 개인정보 제외 Gemini 페이로드 빌더
        styles.css                              ← Labbitory 비주얼 아이덴티티
        sensors/
          types.ts                              ← MotionSensorAdapter 등 공통 타입
          motion/
            motionDataProcessing.ts             ← 단위변환·이동거리 정규화·필터·속도유도
            motionAnalysis.ts                   ← 회귀/R²/표/구간/속력통계/비교
            motionQuality.ts                    ← 품질 휴리스틱 → 학생 친화 문구
          pasco/
            pascoBluetoothConstants.ts          ← UUID 패턴·char id·이름 파싱
            pascoProtocol.ts                    ← one-shot 명령·Motion 채널 레이아웃
            pascoPacketDecoder.ts               ← float/uint 디코드·알림 파싱
            pascoTypes.ts
            pascoDiagnostics.ts                 ← 진단 수집기
            PascoMotionAdapter.ts               ← Web Bluetooth 어댑터
          demo/
            DemoMotionAdapter.ts                ← 과학적으로 현실적인 시연 데이터
        ui/
          dom.ts, illustration.ts, charts.ts, measurement.ts, report.ts, gemini.ts
      functions/api/feedback.ts                 ← Cloudflare Pages Function (Gemini 보안 프록시)
      *.test.ts                                 ← Vitest 단위 테스트(38개)
```

- **프레임워크/빌드 시스템:** Vite 5 + TypeScript 5 (앱 단위). 테스트는 Vitest, 린트는 ESLint.
- **차트 라이브러리:** 기존 저장소에 차트 라이브러리가 없어 **Chart.js 4**를 도입(가정, 아래 참고).
- **상태 관리:** 외부 라이브러리 없이 `model.ts`의 단일 `AppModel` + `main.ts`의 단계 컨트롤러.
- **Gemini:** Cloudflare Pages Function(`functions/api/feedback.ts`)에서 `GEMINI_API_KEY`
  환경변수로 호출. **키는 절대 브라우저에 노출되지 않습니다.**
- **인쇄 스타일:** `src/styles.css`의 `@media print` 블록 + 차트를 PNG로 임베드해 페이지 분할 방지.
- **데모 모드 / 교사 설정:** 각각 `DemoMotionAdapter`, 측정 단계의 접이식 "교사용 측정 설정" 패널.

### 가정(Assumptions) — 문서화
1. "기존 센서 앱"은 이 저장소에 코드가 없고 서브도메인에 있으므로, **동일한 비주얼 아이덴티티
   (색/폰트/헤더/마스코트 자산)를 재사용**하되 운동 실험 앱을 새 서브 프로젝트로 구현했습니다.
2. 저장소에 차트 라이브러리·Gemini 백엔드가 없으므로, 표준적이고 교실 친화적인 **Chart.js**와
   **Cloudflare Pages Function**을 도입했습니다(서브도메인 배포 패턴과 일치).
3. 배포 시 이 앱은 자체 Pages 프로젝트(예: `pasco03.labbitory.com`)로 올라가며, 허브의
   `pasco.html`이 이를 링크합니다.

---

## 2. 변경/추가된 파일 (Files changed)

- **추가:** `apps/pasco-motion/**` (앱 전체), `pasco.html`, `docs/PASCO_MOTION_*`,
  `THIRD_PARTY_NOTICES.md`.
- **수정:** `index.html`(네비게이션의 "파스코 척척박사"를 `pasco.html`로 연결, "준비중" 제거),
  `.claude/launch.json`(개발 서버 설정 추가).
- **삭제 없음.** 기존 Vernier/PASCO 관련 페이지와 자산은 그대로 보존했습니다.

---

## 3. 대상 센서 (Target sensor)

- **PASCO Wireless Motion Sensor PS-3219.** 초음파로 센서–물체 사이 거리를 측정하고,
  위치(Position, m)와 속도(Velocity, m/s)를 제공합니다. 가속도도 제공하지만 **학생 화면에는
  포함하지 않습니다**(요구사항).

---

## 4. BLE 구현 상태 (BLE implementation status)

공식 레퍼런스 **`PASCOscientific/pasco_python`**(`src/pasco/pasco_ble_device.py`)에서
검증한 프로토콜 사실만 사용했습니다. 발명한 값은 없습니다.

검증된 사실(코드에 반영):
- **UUID 패턴:** `4a5c000{service}-000{characteristic}-0000-0000-5c1e741f1c00`
- **서비스 0**이 센서 동작용. 고정 characteristic id: **SEND_CMD=2, RECV_CMD=3, SEND_ACK=5**
- **기기 이름 파싱:** `name.rsplit(' ', 1)` → devType, serial=token[0:7],
  interface=base64(token[8])+1024
- **단일 표본 읽기 명령:** `[0x05, packetSize]` (GCMD_READ_ONE_SAMPLE=0x05)
- **알림 응답:** GRSP_RESULT=`0xC0`, `data[1]==0x00`이면 성공, `data[2]`=에코된 명령,
  payload=`data[3:]`. 주기 패킷은 마커 `<= 0x1F`, payload=`data[1:]`.
- **디코드:** "Direct" 측정은 **4바이트 little-endian IEEE-754 float**, "RawDigital"은
  다바이트 little-endian 정수.

### 미확보 정보(문서화된 공백) — Fallback 적용
PS-3219의 **정확한 채널/측정 바이트 레이아웃**(측정 순서·ID·DataSize·단위)은 공식 라이브러리가
기기별 **내장 XML 데이터시트**(`datasheets.py`)에서 읽어옵니다. 이 데이터시트의 Motion 항목을
이 환경에서 확보하지 못했습니다. 따라서:

- `pascoProtocol.ts`의 `MOTION_CHANNEL_LAYOUT`은 **임시 가정**입니다:
  `[Position(4, Direct, m), Velocity(4, Direct, m/s)]`.
- 이는 **실제 하드웨어로 검증되기 전까지 "검증된 지원"으로 간주하지 않습니다.**
- 합성 데이터를 실측 모드로 사용하지 않습니다. 실측에서 위치/속도를 해석하지 못하면
  `센서에는 연결했지만 위치 또는 속력 자료를 해석하지 못했습니다…` 메시지를 띄우고,
  **교사용 진단 패널**에서 서비스/특성/측정/원시 패킷(hex)을 내보내 2차 디버깅을 준비합니다.
- `연결 완료`는 **물리적으로 타당한 위치값을 1개 이상 디코드한 뒤에만** 표시합니다
  (GATT 연결만으로는 불충분).

### 레이아웃 비의존 디코드 (실측 1차 결과 반영, 2026-07-01)
실제 PS-3219 연결 시 GATT/특성/알림은 정상이지만 고정 오프셋 가정(Position@0, Velocity@4)으로는
위치를 해석하지 못해 `측정값 해석 오류`가 발생했습니다. 원인은 위 "미확보 정보"대로 정확한
바이트 레이아웃을 모르기 때문이며, 다음과 같이 **레이아웃에 의존하지 않도록** 보강했습니다
(`pascoPacketDecoder.ts`의 `scanMotionFromRaw`, `PascoMotionAdapter`):

- **위치:** 원시 패킷의 **모든 바이트 오프셋**을 훑어, 물리적으로 타당한 범위(약 0.15–5 m)의
  첫 4바이트 LE float를 위치로 채택합니다. 정지 상태에서는 속도·가속도가 ~0이라 범위 밖이므로
  위치 필드가 안정적으로 선택됩니다. one-shot 응답(payload@3)과 주기 패킷(payload@1) 모두 처리.
- **패킷 수신:** one-shot 읽기 명령으로 **nudge** 하면서 동시에 **자동 스트리밍 패킷도 수용**합니다.
  (장치가 어느 방식이든 동작) 명령 쓰기 실패는 무시하고 들어오는 알림을 그대로 사용합니다.
- **속력:** 위치 필드 위치만 확실하므로 **속력은 위치 자료로부터 유도**합니다(`velocitySource =
  "위치 자료로부터 계산한 값"`). 위치 다음 4바이트의 속도 후보값은 **진단 패널에만** 기록합니다.
- 모든 원시 패킷(hex)·채택 오프셋·속도 후보는 진단에 남으므로, 실제 레이아웃 확정 후 센서 속도를
  바로 활성화할 수 있습니다.

### 2차 하드웨어 디버깅에서 확정해야 할 것
1. PS-3219 채널의 측정 순서와 각 DataSize(Position/Velocity가 4바이트 float가 맞는지), 위치 오프셋.
2. 위치/속도의 단위와 부호(멀어질 때 위치가 증가하는지).
3. 주기 스트리밍을 쓸지(8패킷마다 ACK) vs one-shot 폴링 — 현재는 양쪽 모두 수용.

---

## 5. 위치·속도 측정 이름 (Measurement names)

- 위치: 내부 `rawPositionM`(m). 학생용 진단 라벨 **`센서로부터의 거리`**.
- 속도: 내부 `rawVelocityMps`(m/s, 부호 있음, 교사 진단 전용).
- 학생 그래프: **`속력(cm/s)`** = `Math.abs(rawVelocityMps * 100)`.
- PASCO 데이터시트의 NameTag 추정값은 `Position`, `Velocity`(대소문자/철자는 하드웨어로 확인 필요).

---

## 6. 단위 변환 (Unit conversion)

| 변환 | 식 | 구현 |
|---|---|---|
| m → cm | `× 100` | `meterToCm` |
| m/s → cm/s | `× 100` | `mpsToCmps` |
| 속도 → 속력 | `|v| × 100` | `speedFromVelocityMps` |

---

## 7. 과학적 데이터 처리 규칙 (Scientific data-processing rules)

- **이동 거리(처음 위치 기준):** 노이즈 누적 합산 금지. 시작 위치를 0으로 잡고 한 방향 운동을
  정규화. 멀어짐: `(current−initial)×100`, 가까워짐: `(initial−current)×100`.
- **시작 위치:** 측정 시작 전 0.6초간 baseline 표본을 모아 **중앙값**으로 결정.
- **운동 시작:** 한 노이즈 표본으로 트리거하지 않음. 임계 속력(기본 4 cm/s)을 **연속 3표본**
  초과할 때 `t=0` 시작.
- **방향 전환 감지:** 노이즈 허용치(1.5 cm) 이상으로 전/후진이 모두 나타나면 경고 표시.
- **위치 필터:** 작은 창의 **중앙값 필터**(가장자리 대칭 축소 → 시작점 ~0 보존). 과도한 평활화 금지.
- **속력:** 센서 속도 우선. 없으면 짧은 창의 **국소 선형 회귀(중심차분)**로 유도. 출처를 진단에
  `PASCO 센서 측정값` / `위치 자료로부터 계산한 값`으로 명시.
- **유효성:** NaN/Infinity/범위 밖(0.1–6 m)/급격한 점프(>1 m)/타임스탬프 이상 등은 거부·플래그.
  실측 무효 데이터를 시연 데이터로 **몰래 대체하지 않음**.
- **결정론적 분석(AI 호출 전):** 거리–시간 회귀 기울기/절편/R²/잔차(RMSE), 속력 평균/중앙값/
  최소/최대/표준편차/변동계수. 시작·끝 0.2초 전이는 품질 판정에서 제외(그래프엔 전부 표시).
  교실 휴리스틱: 거리 R²≥0.98 → 직선에 가깝다, 속력 변동계수≤0.15 → 수평에 가깝다.

---

## 8. 한계 (Limitations)

1. PS-3219 측정 바이트 레이아웃이 하드웨어로 미검증(§4). 실제 센서로 확정 필요.
2. 실측은 Web Bluetooth + HTTPS + Chrome/Edge에서만 동작. iOS Safari 등은 미지원.
3. one-shot 폴링 방식이라 매우 빠른 운동(>~5 m/s)에서는 ~10 Hz로 샘플이 성길 수 있음.
4. AI 피드백은 `GEMINI_API_KEY`가 설정된 Pages 환경에서만 동작(미설정 시 친절한 안내 표시).

---

## 9. 하드웨어 시험 절차 (Hardware test procedure)

자세한 항목은 `docs/PASCO_MOTION_HARDWARE_TEST_CHECKLIST.md` 참고. 요약:
HTTPS 배포본을 Chrome/Edge에서 열고 → PS-3219 전원 → `센서 연결하기` → Motion 센서 선택 →
`센서로부터의 거리`/`현재 속력` 확인 → 자동 측정 → 그래프·표 확인 → (필요시) 교사용 진단의
원시 패킷 기록으로 채널 레이아웃 검증 → 진단 JSON 저장.

---

## 10. 개발/실행 명령 (Commands)

```bash
cd apps/pasco-motion
npm install
npm run lint     # ESLint
npm run test     # Vitest (38 tests)
npm run build    # tsc --noEmit && vite build
npm run dev      # 로컬 개발 서버(secure context = localhost)
```

배포: `apps/pasco-motion`을 Cloudflare Pages 프로젝트로 빌드(`dist/`)하고, Functions로
`functions/`를 사용. 비밀값: `wrangler pages secret put GEMINI_API_KEY` (선택: `GEMINI_MODEL`).
