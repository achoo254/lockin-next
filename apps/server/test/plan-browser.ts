/** A browser with its own cookie jar, and plan request bodies, for the plan API tests. */
import type { PlanView } from '../src/plans/plan-view';
import type { ManageLink, ShareLink } from '../src/plans/plan-routes';
import { api } from './sign-in';
import type { TestServer } from './test-server';

export interface PlanAnswer {
  plan: PlanView;
}

export interface CreatedPlan extends PlanAnswer {
  share: ShareLink;
  manage: ManageLink;
}

/** Keeps the cookies the server sets, like a browser (one per name, deleted when expired). */
export class Browser {
  private readonly cookies = new Map<string, string>();

  constructor(private readonly server: TestServer) {}

  /** Adds a `name=value` cookie (a session from signIn). */
  add(pair: string): void {
    const eq = pair.indexOf('=');
    this.cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
  }

  cookieNames(): string[] {
    return [...this.cookies.keys()];
  }

  /** The value of one cookie, if the browser holds it. */
  cookie(name: string): string | undefined {
    return this.cookies.get(name);
  }

  async call(path: string, init: RequestInit = {}): Promise<Response> {
    const cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    const res = await api(this.server, path, { ...init, ...(cookie ? { cookie } : {}) });
    for (const header of res.headers.getSetCookie()) {
      const [pair = '', ...attributes] = header.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const expired = attributes.some((a) => /^\s*max-age=0\s*$/i.test(a));
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, pair.slice(eq + 1).trim());
    }
    return res;
  }
}

/** A plan like the mockup's: two times and two places, deadline in a day (of the app clock `now`). */
export function planBody(now: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const hour = 60 * 60 * 1000;
  return {
    title: 'Cà phê thứ Bảy',
    activity: 'coffee',
    area: 'Quận 3',
    budgetPerPerson: 60000,
    voteDeadline: new Date(now + 24 * hour).toISOString(),
    options: [
      { kind: 'time', startsAt: new Date(now + 48 * hour).toISOString() },
      { kind: 'time', startsAt: new Date(now + 72 * hour).toISOString() },
      { kind: 'place', label: 'Quán cà phê A' },
      { kind: 'place', label: 'Quán cà phê B' },
    ],
    ...overrides,
  };
}
