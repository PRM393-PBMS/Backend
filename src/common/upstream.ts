import { AppError } from './errors';

export async function upstreamJson(
  url: string,
  init: RequestInit = {},
  timeoutMs = 10000,
): Promise<Record<string, any>> {
  const attempts = !init.method || init.method === 'GET' ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status >= 500 && attempt + 1 < attempts) {
        await response.body?.cancel();
        continue;
      }
      if (!response.ok)
        throw new AppError(
          response.status === 429 ? 503 : 502,
          'UPSTREAM_REJECTED',
          'Dịch vụ bên ngoài chưa xử lý được yêu cầu',
        );
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid JSON');
      return value as Record<string, any>;
    } catch (error) {
      if (error instanceof AppError) throw error;
      const timedOut =
        error instanceof Error &&
        ['TimeoutError', 'AbortError'].includes(error.name);
      if (attempt + 1 === attempts)
        throw new AppError(
          timedOut ? 504 : 502,
          timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
          timedOut
            ? 'Dịch vụ phản hồi quá chậm; vui lòng kiểm tra trạng thái trước khi thử lại'
            : 'Không nhận được phản hồi hợp lệ từ dịch vụ bên ngoài',
        );
    }
  }
  throw new AppError(
    502,
    'UPSTREAM_UNAVAILABLE',
    'Dịch vụ bên ngoài chưa sẵn sàng',
  );
}
