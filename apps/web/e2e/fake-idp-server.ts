/**
 * Test-only IdP for the E2E run (apps/server/test/fake-idp.ts on a fixed port): consents at once and signs in the
 * account `e2e-account`, whose userinfo has a name and an email but no picture (nothing loads from outside the test).
 */
import { startFakeIdp } from '../../server/test/fake-idp';
import { E2E_CLIENT_SECRET, FAKE_IDP_PORT } from './e2e-env';

const idp = await startFakeIdp({
  clientId: 'lockin-web',
  clientSecret: E2E_CLIENT_SECRET,
  sub: 'e2e-account',
  port: FAKE_IDP_PORT,
  profile: { name: 'Người Thử E2E', email: 'e2e@example.com' },
});
console.log(`fake IdP at ${idp.issuer}`);
const stop = (): void => {
  void idp.close().finally(() => process.exit(0));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
