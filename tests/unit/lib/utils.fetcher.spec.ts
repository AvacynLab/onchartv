import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { ChatSDKError } from '@/lib/errors';
import { fetchWithErrorHandlers, fetcher } from '@/lib/utils';

const OK_RESPONSE_BODY = { data: 'ok' };

function createResponse({
  ok,
  status,
  json,
}: {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}): Response {
  return {
    ok,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json,
  } as unknown as Response;
}

describe('fetch helpers', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    fetchMock = vi
      .fn()
      .mockResolvedValue(
        createResponse({
          ok: true,
          status: 200,
          json: () => Promise.resolve(OK_RESPONSE_BODY),
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns the parsed payload when the response is successful', async () => {
    const result = await fetcher('/api/example');

    expect(result).toEqual(OK_RESPONSE_BODY);
    expect(fetchMock).toHaveBeenCalledWith('/api/example');
  });

  it('throws a ChatSDKError with the server message and cause when provided', async () => {
    const envelope = {
      error: {
        code: 'forbidden:chat',
        message: 'Regular session required',
        cause: 'Missing regular session cookie',
      },
    };

    fetchMock = vi
      .fn()
      .mockResolvedValue(
        createResponse({
          ok: false,
          status: 403,
          json: () => Promise.resolve(envelope),
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const request = fetcher('/api/chat');
    await expect(request).rejects.toBeInstanceOf(ChatSDKError);
    const error = (await request.catch((caught) => caught)) as ChatSDKError;

    expect(error.statusCode).toBe(403);
    expect(error.message).toBe('Regular session required');
    expect(error.cause).toBe('Missing regular session cookie');
  });

  it('wraps malformed envelopes in a deterministic ChatSDKError and logs the failure', async () => {
    fetchMock = vi
      .fn()
      .mockResolvedValue(
        createResponse({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ unexpected: true }),
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const request = fetcher('/api/broken');
    await expect(request).rejects.toBeInstanceOf(ChatSDKError);
    const error = (await request.catch((caught) => caught)) as ChatSDKError;

    expect(error.statusCode).toBe(400);
    expect(error.message).toMatch(/Unexpected error response/);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('handles network fetch failures while preserving the offline guard', async () => {
    const response = createResponse({
      ok: false,
      status: 422,
      json: () => Promise.resolve({
        error: { code: 'bad_request:api', message: 'invalid payload' },
      }),
    });

    fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);

    const request = fetchWithErrorHandlers('/api/example', { method: 'POST' });
    await expect(request).rejects.toBeInstanceOf(ChatSDKError);
    const error = (await request.catch((caught) => caught)) as ChatSDKError;

    expect(error.message).toBe('invalid payload');
    expect(fetchMock).toHaveBeenCalledWith('/api/example', { method: 'POST' });
  });
});
