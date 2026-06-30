# 등속 운동하는 물체의 운동 그래프 (파스코 척척박사)

PASCO Wireless Motion Sensor **PS-3219** 호환 교육용 웹앱. 중학생이 초음파 운동 센서로
장난감 자동차의 운동을 측정해 **시간–이동 거리 그래프**와 **시간–속력 그래프**를 만들고
등속 운동을 탐구합니다. labbitory.com 파스코 척척박사 시리즈의 실험 앱입니다.

## 특징

- 7단계 학습 흐름: 예상 → 준비 → 센서 연결 → 운동 측정 → 자료 분석 → AI 피드백 → 보고서
- **Web Bluetooth**로 브라우저에서 직접 PASCO 운동 센서 연결 (Chrome/Edge, HTTPS)
- 실시간 시간–이동 거리 / 시간–속력 그래프 (Chart.js)
- 자동 표 생성(1초 간격), 회귀 기울기·R²·평균 속력 등 결정론적 분석
- 1·2차 측정 비교, 교사용 측정 설정 및 PASCO 연결 진단 패널
- **센서 없이 시연(데모) 모드**, 인쇄용 보고서 / PDF 저장
- Gemini AI 피드백 (Cloudflare Pages Function, API 키 비노출, 개인정보 미전송)

## 개발

```bash
npm install
npm run dev      # 로컬 개발 서버 (secure context = localhost)
npm run lint
npm run test     # Vitest 단위 테스트
npm run build    # tsc --noEmit && vite build  → dist/
```

## 배포 (Cloudflare Pages)

- 빌드 명령: `npm run build`, 출력 디렉터리: `dist`
- Functions: `functions/` (자동 인식)
- 시크릿: `wrangler pages secret put GEMINI_API_KEY` (선택: `GEMINI_MODEL`, 기본 `gemini-1.5-flash`)

## 문서

- [docs/PASCO_MOTION_EXPERIMENT_NOTES.md](docs/PASCO_MOTION_EXPERIMENT_NOTES.md) — 아키텍처·BLE 구현 상태·데이터 처리 규칙·한계
- [docs/PASCO_MOTION_HARDWARE_TEST_CHECKLIST.md](docs/PASCO_MOTION_HARDWARE_TEST_CHECKLIST.md) — 실제 PS-3219 점검표
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) — 제3자 고지 및 상표

> PASCO 및 관련 제품명은 해당 권리자의 상표입니다. 이 웹앱은 PASCO의 공식 제품 또는 공식
> 승인 서비스가 아닙니다.
