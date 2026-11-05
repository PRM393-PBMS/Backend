/** Deployed HTTP checks without fixtures, direct DB access or financial writes.
 * Invalid auth bodies exercise validation before OTP/email/password services.
 * Authenticated business journeys require dedicated test accounts and a test bay.
 */
import { mkdir, writeFile } from 'node:fs/promises';

const origin = new URL(
  process.env.PBMS_API_BASE_URL || 'https://prm393backend.onrender.com',
);
if (origin.protocol !== 'https:' || origin.username || origin.password) {
  throw new Error(
    'PBMS_API_BASE_URL must be an HTTPS origin without credentials',
  );
}
if (origin.pathname !== '/' || origin.search || origin.hash) {
  throw new Error('Use the API origin without a path, query or fragment');
}

const cases = [
  { path: '/health', status: 200, kind: 'health', timeout: 45000 },
  { path: '/health/ready', status: 200, kind: 'ready' },
  { path: '/api/docs-json', status: 200, kind: 'openapi' },
  { path: '/api/ParkingOperation/availability', status: 200, kind: 'list' },
  {
    path: '/api/ParkingOperation/availability?vehicleTypeId=not-a-uuid',
    status: 400,
  },
  ...[
    '/api/profile',
    '/parkings/available',
    '/api/vehicles/my',
    '/api/ParkingSession/my',
    '/api/reservations/my-reservations',
    '/api/MonthlySubscription/my',
    '/api/wallet/11111111-1111-4111-8111-111111111199',
    '/api/payments/my',
    '/api/receipts/invoice-requests',
    '/api/IncidentReport/my-reports',
    '/api/Notification/my',
    '/api/GateScan/recent',
  ].map((path) => ({ path, status: 401 })),
  { path: '/api/profile', status: 401, malformedToken: true },
  ...[
    '/api/Auth/login',
    '/api/Auth/verify-register-otp',
    '/api/Auth/refresh-token',
  ].map((path) => ({ path, method: 'POST', status: 400 })),
];

const observations = [];
for (const item of cases) {
  const method = item.method || 'GET';
  const started = performance.now();
  let observation;
  try {
    const response = await fetch(new URL(item.path, origin), {
      method,
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        ...(item.malformedToken
          ? { Authorization: 'Bearer not-a-valid-token' }
          : {}),
      },
      body: method === 'POST' ? '{}' : undefined,
      signal: AbortSignal.timeout(item.timeout || 20000),
    });
    const body = await response.json();
    const reasons = [];
    if (response.status !== item.status) reasons.push('unexpected_http_status');
    if (item.status >= 400) {
      if (body.statusCode !== response.status || body.isSuccess !== false) {
        reasons.push('error_envelope_mismatch');
      }
      if (
        typeof body.message !== 'string' ||
        !body.message.trim() ||
        /invalid credentials?|unauthorized|prisma|stack trace/i.test(
          body.message,
        )
      ) {
        reasons.push('unsafe_or_untranslated_message');
      }
      if (typeof body.errorCode !== 'string')
        reasons.push('missing_error_code');
      if (!body.requestId && !response.headers.get('x-request-id')) {
        reasons.push('missing_request_id');
      }
    }
    if (item.kind === 'health' && body.status !== 'ok')
      reasons.push('not_alive');
    if (item.kind === 'ready' && body.status !== 'ready')
      reasons.push('not_ready');
    if (item.kind === 'openapi' && (!body.openapi || !body.paths)) {
      reasons.push('invalid_openapi');
    }
    if (
      item.kind === 'list' &&
      (body.isSuccess !== true || !Array.isArray(body.result))
    ) {
      reasons.push('invalid_availability_envelope');
    }
    observation = {
      method,
      path: item.path,
      ...(item.malformedToken ? { authentication: 'malformed-token' } : {}),
      expectedHttp: item.status,
      http: response.status,
      passed: reasons.length === 0,
      reasons,
      message: typeof body.message === 'string' ? body.message : undefined,
      errorCode: body.errorCode,
      requestId: body.requestId || response.headers.get('x-request-id'),
      ...(item.kind === 'openapi' && body.paths
        ? { documentedPaths: Object.keys(body.paths).length }
        : {}),
      ...(item.kind === 'list' && Array.isArray(body.result)
        ? { items: body.result.length }
        : {}),
    };
  } catch (error) {
    observation = {
      method,
      path: item.path,
      expectedHttp: item.status,
      passed: false,
      failure: error?.name || 'RequestError',
    };
  }
  observation.elapsedMs = Math.round(performance.now() - started);
  observations.push(observation);
  console.log(
    `${observation.passed ? 'PASS' : 'FAIL'} ${method} ${item.path} ${observation.http || observation.failure}`,
  );
}

const report = {
  origin: origin.origin,
  checkedAt: new Date().toISOString(),
  scope: 'deployed-read-only-and-invalid-auth-validation',
  total: observations.length,
  passed: observations.filter((item) => item.passed).length,
  failed: observations.filter((item) => !item.passed).length,
  limitations: [
    'No authenticated customer/staff/manager journey',
    'No financial transaction, OTP/email delivery or image upload',
    'No fixtures, direct database connection or local database tests',
    'Observed request times are not a load test or latency guarantee',
  ],
  observations,
};
const output = new URL('../.tmp/render-production-smoke.json', import.meta.url);
await mkdir(new URL('.', output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(`Result: ${report.passed}/${report.total} passed`);
process.exitCode = report.failed ? 1 : 0;
