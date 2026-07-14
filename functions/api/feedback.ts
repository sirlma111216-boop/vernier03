/**
 * Cloudflare Pages Function: secure Gemini proxy.
 *
 * The browser POSTs the (PII-free) analysis payload here; this function calls
 * Gemini server-side and returns a validated JSON feedback object. Credentials
 * never reach the browser.
 *
 * AI endpoint selection (see the gemini-ai-integration skill):
 *  - Production on Cloudflare's edge MUST use Vertex AI. The AI Studio endpoint
 *    (generativelanguage.googleapis.com) checks the caller's IP region, and the
 *    edge's outbound path can route through unsupported regions, causing
 *    intermittent 400 "User location is not supported" even with a valid key.
 *    Vertex AI (aiplatform.googleapis.com) has no such check.
 *  - So: if GCP_SERVICE_ACCOUNT is set, use Vertex AI (recommended).
 *    Otherwise fall back to GEMINI_API_KEY + AI Studio (local dev only, from a
 *    supported region).
 *
 * Configure with:
 *   wrangler pages secret put GCP_SERVICE_ACCOUNT   # JSON of the SA key file
 *   wrangler pages secret put GEMINI_API_KEY        # local-dev fallback only
 */

interface Env {
  GCP_SERVICE_ACCOUNT?: string;
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

// Both gemini-2.5-flash and gemini-2.5-flash-lite are available on the Vertex
// global endpoint. flash gives better reasoning for student feedback; override
// with GEMINI_MODEL (fall back to -lite if a model 404s).
const DEFAULT_MODEL = "gemini-2.5-flash";

const SYSTEM_INSTRUCTION =
  "당신은 중학교 과학 교사를 돕는 AI 보조교사입니다. 반드시 요청된 JSON 스키마로만, 추가 텍스트 없이 답하세요.";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (!env.GCP_SERVICE_ACCOUNT && !env.GEMINI_API_KEY) {
    return json(
      { error: "AI 피드백 기능이 아직 설정되지 않았습니다. (GCP_SERVICE_ACCOUNT 또는 GEMINI_API_KEY 없음)" },
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
  const prompt = buildPrompt(safePayload);

  try {
    const text = await runAi(env, SYSTEM_INSTRUCTION, prompt);
    const feedback = validateFeedback(text);
    if (!feedback) {
      return json({ error: "AI 응답 형식을 해석하지 못했습니다.", raw: text.slice(0, 500) }, 502);
    }
    return json(feedback, 200);
  } catch (err) {
    // Surface a short cause summary — it makes production debugging possible.
    const msg = err instanceof Error ? err.message : String(err);
    const status = /한도|quota|429/.test(msg) ? 429 : 502;
    return json({ error: msg }, status);
  }
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

// ============================================================
// AI call — Vertex AI (prod) with AI Studio fallback (local dev)
// Verified against the gemini-ai-integration skill reference.
// ============================================================

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id: string;
};

// Access-token cache reused for the life of the Worker isolate; refreshed 5 min
// before expiry.
let cachedToken: { token: string; expiresAt: number } | null = null;

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToBytes(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Service-account -> OAuth2 access token (RS256 JWT -> token exchange).
// WebCrypto is available in the Workers runtime, so no external library.
async function getVertexAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 300 > now) return cachedToken.token;

  const enc = new TextEncoder();
  const header = base64UrlEncode(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = base64UrlEncode(
    enc.encode(
      JSON.stringify({
        iss: sa.client_email,
        scope: "https://www.googleapis.com/auth/cloud-platform",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(sa.private_key).buffer as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(`${header}.${claims}`)),
  );
  const jwt = `${header}.${claims}.${base64UrlEncode(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI 인증 토큰 발급에 실패했습니다. (${res.status}: ${t.slice(0, 160)})`);
  }
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  cachedToken = { token: data.access_token, expiresAt: now + (data.expires_in ?? 3600) };
  return data.access_token;
}

type GenerateContentResponse = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  error?: { code?: number; message?: string; status?: string };
};

// Thinking models interleave thought:true parts — drop them, keep text.
function extractText(data: GenerateContentResponse): string {
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => p.thought !== true && typeof p.text === "string")
    .map((p) => p.text)
    .join("")
    .trim();
}

// generateContent call (Vertex and AI Studio share the request/response shape).
async function callGenerateContent(
  url: string,
  headers: Record<string, string>,
  system: string,
  prompt: string,
): Promise<string> {
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, responseMimeType: "application/json" },
  });

  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body,
      });
    } catch (e) {
      lastError = `network: ${String(e).slice(0, 160)}`;
      continue; // retry network errors once
    }
    const text = await res.text();
    if (res.ok) {
      const out = extractText(JSON.parse(text) as GenerateContentResponse);
      if (out) return out;
      lastError = "AI가 빈 응답을 반환했습니다.";
      continue;
    }
    lastError = `HTTP ${res.status}: ${text.slice(0, 220)}`;
    if (res.status === 429) {
      throw new Error("지금 AI 사용량이 몰려 잠시 한도(quota)에 걸렸습니다. 잠시 후 다시 시도해 주세요.");
    }
    if (res.status < 500) break; // 4xx: retrying is pointless
  }
  throw new Error(`AI 호출에 실패했습니다. 잠시 후 다시 시도해 주세요. (원인: ${lastError.slice(0, 180)})`);
}

async function runAi(env: Env, system: string, prompt: string): Promise<string> {
  const model = env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;

  const saRaw = env.GCP_SERVICE_ACCOUNT;
  if (saRaw) {
    let sa: ServiceAccount;
    try {
      sa = JSON.parse(saRaw) as ServiceAccount;
    } catch {
      throw new Error("GCP_SERVICE_ACCOUNT 값이 올바른 JSON 형식이 아닙니다.");
    }
    if (!sa.client_email || !sa.private_key || !sa.project_id) {
      throw new Error("GCP_SERVICE_ACCOUNT JSON에 필수 필드가 없습니다.");
    }
    const token = await getVertexAccessToken(sa);
    const url = `https://aiplatform.googleapis.com/v1/projects/${sa.project_id}/locations/global/publishers/google/models/${model}:generateContent`;
    return callGenerateContent(url, { Authorization: `Bearer ${token}` }, system, prompt);
  }

  // Local-dev fallback only (safe from a supported fixed-region IP).
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("AI 자격 증명이 없습니다. (GCP_SERVICE_ACCOUNT 또는 GEMINI_API_KEY 필요)");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  return callGenerateContent(url, { "x-goog-api-key": apiKey }, system, prompt);
}

// ============================================================
// Payload sanitization, prompt building, response validation
// ============================================================

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
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    // Recover a JSON object embedded in the text.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      obj = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const sec = (v: unknown): { level: string; feedback: string } => {
    const s = (v ?? {}) as Record<string, unknown>;
    return { level: str(s.level), feedback: str(s.feedback) };
  };
  return {
    overallSummary: str(o.overallSummary),
    strengths: Array.isArray(o.strengths) ? o.strengths.map(str).filter(Boolean) : [],
    conceptUnderstanding: sec(o.conceptUnderstanding),
    dataEvidence: sec(o.dataEvidence),
    graphInterpretation: sec(o.graphInterpretation),
    errorAnalysis: sec(o.errorAnalysis),
    revisionQuestion: str(o.revisionQuestion),
    modelConclusion: str(o.modelConclusion),
  };
}

// Minimal type shim so this file type-checks without @cloudflare/workers-types.
type PagesFunction<E = unknown> = (context: {
  request: Request;
  env: E;
}) => Response | Promise<Response>;
