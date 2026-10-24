import { expect, it, vi } from 'vitest';
import { onRequestPost } from '../functions/api/feedback';
import { requestFeedback } from './ui/gemini';

it('does not read student content or send any AI request while paused', async () => {
  const fetchMock = vi.fn(() => { throw new Error('Unexpected network call'); });
  vi.stubGlobal('fetch', fetchMock);
  try {
    const context = new Proxy({}, { get() { throw new Error('Request/env must not be accessed'); } });
    const response = await onRequestPost(context as never);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'student_ai_paused' });
    expect((await requestFeedback({} as never)).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});
