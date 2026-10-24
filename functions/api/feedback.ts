// Temporarily paused before reading student content or contacting any AI provider.
export const onRequestPost = async (_context?: unknown): Promise<Response> => new Response(
  JSON.stringify({ error: '학생용 AI 피드백을 일시 중단했습니다.', code: 'student_ai_paused' }),
  { status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } },
);
