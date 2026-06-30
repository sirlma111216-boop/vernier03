/**
 * Cloudflare Pages Function: secure Gemini proxy.
 *
 * The Gemini API key lives ONLY in the GEMINI_API_KEY environment variable and
 * is never sent to the browser. The browser POSTs the (PII-free) analysis
 * payload here; this function calls Gemini and returns a validated JSON object.
 *
 * Configure the key with:  wrangler pages secret put GEMINI_API_KEY
 */

interface Env {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
}

interface GeminiFeedback {
  overallSummary: string;
  strengths: string[];
  conceptUnderstanding: { level: string; feedback: string };
  dataEvidence: { level: string; feedback: string };
  graphInterpretation: { level: string; feedback: string };
  errorAnalysis: { level: string; feedback: string };
  revisionQuestion: string;
  modelConclusion: string;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (!env.GEMINI_API_KEY) {
    return json(
      { error: "AI 피드백 기능이 아직 설정되지 않았습니다. (GEMINI_API_KEY 없음)" },
      503,
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "요청 형식이 올바르지 않습니다." }, 400);
  }

  // Defense in depth: strip any identity fields that should never reach Gemini.
  const safePayload = stripForbidden(payload);

  const model = env.GEMINI_MODEL ?? "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

  const prompt = buildPrompt(safePayload);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: JSON_HEADERS,
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return json(
        { error: "AI 서버 응답에 문제가 있습니다. 잠시 후 다시 시도해 주세요.", detail: detail.slice(0, 300) },
        502,
      );
    }

    const data = (await res.json()) as any;
    const text: string | undefined =
      data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return json({ error: "AI 응답을 받지 못했습니다." }, 502);
    }

    const feedback = validateFeedback(text);
    if (!feedback) {
      return json({ error: "AI 응답 형식을 해석하지 못했습니다.", raw: text.slice(0, 500) }, 502);
    }
    return json(feedback, 200);
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return json(
      { error: aborted ? "AI 응답 시간이 초과되었습니다." : "AI 요청 중 오류가 발생했습니다." },
      504,
    );
  } finally {
    clearTimeout(timeout);
  }
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const FORBIDDEN = ["school", "grade", "classNo", "studentNo", "studentName", "identity"];
function stripForbidden(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripForbidden);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN.includes(k)) continue;
      out[k] = stripForbidden(v);
    }
    return out;
  }
  return value;
}

function buildPrompt(payload: unknown): string {
  return [
    "당신은 중학교 과학 교사를 돕는 AI 보조교사입니다.",
    "학생이 PASCO 초음파 운동 센서로 '등속 운동하는 물체의 운동 그래프'를 탐구했습니다.",
    "아래 JSON은 학생의 예상, 실제 측정 자료(시간–이동 거리, 시간–속력), 자동 분석 결과, 학생의 답변입니다.",
    "개인정보(학교/학년/반/번호/이름)는 포함되어 있지 않습니다.",
    "",
    "지침:",
    "1. 반드시 학생의 실제 측정값(숫자)을 근거로 인용하세요.",
    "2. '같은 시간 동안 같은 거리'(등속) 개념 이해 여부를 확인하세요.",
    "3. 두 그래프(시간–이동 거리는 직선, 시간–속력은 수평선)의 해석을 점검하세요.",
    "4. 그래프 기울기와 속력의 관계를 설명하세요.",
    "5. 이상적인 등속 운동과 실제 실험 자료의 차이를 구분하세요. 작은 흔들림을 무조건 틀렸다고 하지 마세요.",
    "6. 분석 결과가 자료 품질이 나쁘다고 나오면 등속 운동이라고 단정하지 마세요.",
    "7. 강점 1가지와 보완할 점 1가지, 그리고 학생이 답을 고치도록 돕는 질문 1가지를 제시하세요.",
    "8. modelConclusion은 학생이 결론을 제출한 경우(hasSubmittedConclusion=true)에만 작성하고, 아니면 빈 문자열로 두세요.",
    "9. 모든 내용은 중학생이 이해하기 쉬운 한국어로 작성하세요.",
    "",
    "반드시 아래 JSON 스키마로만 답하세요(추가 텍스트 금지):",
    JSON.stringify(
      {
        overallSummary: "",
        strengths: [],
        conceptUnderstanding: { level: "충분함 | 부분적으로 이해함 | 보완 필요", feedback: "" },
        dataEvidence: { level: "충분함 | 부분적으로 사용함 | 보완 필요", feedback: "" },
        graphInterpretation: { level: "충분함 | 부분적으로 이해함 | 보완 필요", feedback: "" },
        errorAnalysis: { level: "충분함 | 부분적으로 분석함 | 보완 필요", feedback: "" },
        revisionQuestion: "",
        modelConclusion: "",
      },
      null,
      0,
    ),
    "",
    "학생 탐구 자료(JSON):",
    JSON.stringify(payload),
  ].join("\n");
}

function validateFeedback(text: string): GeminiFeedback | null {
  let obj: any;
  try {
    obj = JSON.parse(text);
  } catch {
    // Try to recover a JSON object embedded in the text.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      obj = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const sec = (v: any): { level: string; feedback: string } => ({
    level: str(v?.level),
    feedback: str(v?.feedback),
  });
  if (typeof obj !== "object" || obj === null) return null;
  return {
    overallSummary: str(obj.overallSummary),
    strengths: Array.isArray(obj.strengths) ? obj.strengths.map(str).filter(Boolean) : [],
    conceptUnderstanding: sec(obj.conceptUnderstanding),
    dataEvidence: sec(obj.dataEvidence),
    graphInterpretation: sec(obj.graphInterpretation),
    errorAnalysis: sec(obj.errorAnalysis),
    revisionQuestion: str(obj.revisionQuestion),
    modelConclusion: str(obj.modelConclusion),
  };
}

// Minimal type shim so this file type-checks without @cloudflare/workers-types.
type PagesFunction<E = unknown> = (context: {
  request: Request;
  env: E;
}) => Response | Promise<Response>;
