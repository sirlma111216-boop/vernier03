# 제3자 고지 (Third-Party Notices)

이 저장소의 `apps/pasco-motion`(등속 운동 그래프 교육용 웹앱)은 다음 제3자 자료/소프트웨어를
이용합니다.

## 상표 고지 (Trademark)

PASCO 및 관련 제품명(예: PASCO Wireless Motion Sensor, PS-3219)은 해당 권리자
(PASCO scientific)의 상표입니다. **이 웹앱은 PASCO의 공식 제품 또는 공식 승인 서비스가
아닙니다.** "PASCO Wireless Motion Sensor 호환 교육용 웹앱"으로 표기합니다.

## BLE 프로토콜 레퍼런스

- **PASCOscientific/pasco_python** — https://github.com/PASCOscientific/pasco_python
  - 용도: PASCO 무선 센서의 BLE 프로토콜(서비스/특성 UUID 패턴, 기기 이름 파싱,
    one-shot 읽기 명령, 알림/패킷 디코드 규칙)을 **확인**하기 위한 1차 공식 레퍼런스.
  - 이 저장소는 해당 라이브러리를 **복사하지 않았습니다.** 운동 실험에 필요한 최소한의
    프로토콜 동작만 TypeScript로 독립 구현했습니다(`src/sensors/pasco/**`).
  - 배포 전 해당 라이브러리의 라이선스를 확인하십시오.

## 런타임/빌드 의존성 (npm)

| 패키지 | 용도 | 라이선스(일반) |
|---|---|---|
| chart.js | 시간–이동 거리 / 시간–속력 그래프 | MIT |
| vite | 개발 서버 및 번들러 | MIT |
| typescript | 타입 검사/컴파일 | Apache-2.0 |
| vitest | 단위 테스트 | MIT |
| eslint, @typescript-eslint/* | 린트 | MIT / BSD |
| @types/web-bluetooth | Web Bluetooth 타입 정의 | MIT |

각 패키지의 정확한 라이선스 전문은 해당 패키지의 배포물을 참조하십시오.

## 웹 폰트 / CSS (허브와 동일)

- Pretendard (오픈 폰트 라이선스) — CDN
- Sora (Google Fonts, OFL) — CDN

## AI 피드백

- Google **Gemini API** — 서버 사이드(Cloudflare Pages Function)에서만 호출하며 API 키는
  브라우저에 노출되지 않습니다. 학생 개인정보는 전송하지 않습니다.

## 일러스트레이션

실험 장치 그림과 예상용 그래프 카드는 이 프로젝트에서 **새로 그린 원본 SVG**입니다.
교과서 스캔 이미지나 그 도안을 복제하지 않았습니다.
