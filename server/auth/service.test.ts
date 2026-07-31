import { describe, it, expect, beforeEach } from 'vitest';
import { AuthService } from './service';
import type { Store } from '../store';
import type { AuthUserRecord } from '../types';

// Minimal in-memory stand-in for Store — AuthService only touches data.users and
// save(). Avoids any disk I/O against the real data/weonline.json.
function fakeStore(): Store {
  const users: AuthUserRecord[] = [];
  return { data: { users }, save: () => {} } as unknown as Store;
}

let store: Store;
let auth: AuthService;
const NOW = 1_800_000_000_000;

beforeEach(() => {
  store = fakeStore();
  auth = new AuthService(store);
});

describe('AuthService', () => {
  it('bootstraps the first account as admin, later ones as technician', () => {
    const first = auth.createUser('admin@x.net', 'password1', 'Boss', NOW);
    expect(first.role).toBe('admin');
    const second = auth.createUser('tech@x.net', 'password2', null, NOW);
    expect(second.role).toBe('technician');
  });

  it('honors an explicit role only for non-bootstrap accounts', () => {
    auth.createUser('admin@x.net', 'password1', null, NOW); // bootstrap → admin
    const madeAdmin = auth.createUser('two@x.net', 'password2', null, NOW, { role: 'admin' });
    expect(madeAdmin.role).toBe('admin');
  });

  it('never stores the plaintext password', () => {
    auth.createUser('a@x.net', 'sup3rsecret', null, NOW);
    const rec = (store.data.users as AuthUserRecord[])[0];
    expect(rec.passwordHash).not.toContain('sup3rsecret');
    expect(rec.salt).toBeTruthy();
    expect(rec.iterations).toBeGreaterThanOrEqual(100_000);
  });

  it('verifies correct credentials and rejects wrong ones', () => {
    auth.createUser('a@x.net', 'correct-horse', null, NOW);
    expect(auth.verify('a@x.net', 'correct-horse')).not.toBeNull();
    expect(auth.verify('A@X.net', 'correct-horse')).not.toBeNull(); // case-insensitive email
    expect(auth.verify('a@x.net', 'wrong')).toBeNull();
    expect(auth.verify('nobody@x.net', 'whatever')).toBeNull();
  });

  it('rejects weak passwords and duplicate emails', () => {
    auth.createUser('a@x.net', 'password1', null, NOW);
    expect(() => auth.createUser('b@x.net', 'short', null, NOW)).toThrow(/8 characters/);
    expect(() => auth.createUser('a@x.net', 'password1', null, NOW)).toThrow(/already exists/);
    expect(() => auth.createUser('not-an-email', 'password1', null, NOW)).toThrow(/valid email/);
  });
});
