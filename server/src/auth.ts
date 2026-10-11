// Email sign-in with a 6-digit code. Codes work the same in a browser tab, an
// installed PWA, and on a second device, which magic links do not.

import type { Database } from "bun:sqlite";
import type { Config } from "./config";
import type { Mailer } from "./mail";

const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 5;
/** A session that isn't used for this long stops working. */
export const SESSION_IDLE_MS = 90 * 86_400_000;
const DAY = 86_400_000;

export interface User {
  id: string;
  email: string;
  plan: "free" | "pro";
  stripe_customer: string | null;
  sub_status: string | null;
  sub_period_end: number | null;
}

export class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const normalizeEmail = (e: string) => e.trim().toLowerCase();
const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;

export class Auth {
  constructor(
    private readonly db: Database,
    private readonly config: Config,
    private readonly mailer: Mailer,
  ) {}

  private hash(value: string): string {
    return new Bun.CryptoHasher("sha256").update(`${this.config.secret}:${value}`).digest("hex");
  }

  async requestCode(rawEmail: string, now = Date.now()): Promise<void> {
    const email = normalizeEmail(rawEmail);
    if (!isEmail(email)) throw new AuthError(400, "invalid_email");
    const prev = this.db.query<{ sent_count: number; window_start: number }, [string]>("SELECT sent_count, window_start FROM login_codes WHERE email = ?").get(email);
    const inWindow = prev && now - prev.window_start < 3_600_000;
    if (inWindow && prev.sent_count >= MAX_CODES_PER_HOUR) throw new AuthError(429, "too_many_codes");

    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
    this.db
      .query(
        `INSERT INTO login_codes (email, code_hash, expires_at, attempts, sent_count, window_start) VALUES ($email, $hash, $exp, 0, 1, $now)
         ON CONFLICT(email) DO UPDATE SET code_hash = $hash, expires_at = $exp, attempts = 0,
           sent_count = CASE WHEN $now - window_start < 3600000 THEN sent_count + 1 ELSE 1 END,
           window_start = CASE WHEN $now - window_start < 3600000 THEN window_start ELSE $now END`,
      )
      .run({ email, hash: this.hash(`code:${email}:${code}`), exp: now + CODE_TTL_MS, now });
    await this.mailer.send(email, `${code} is your Perennial code`, `Your sign-in code is ${code}.\n\nIt works for 10 minutes. If you did not ask for it, you can ignore this email.`);
  }

  /** Returns a session token for the user, creating the account on first sign-in. */
  verifyCode(rawEmail: string, code: string, now = Date.now()): { token: string; user: User } {
    const email = normalizeEmail(rawEmail);
    const row = this.db.query<{ code_hash: string; expires_at: number; attempts: number }, [string]>("SELECT code_hash, expires_at, attempts FROM login_codes WHERE email = ?").get(email);
    if (!row || row.expires_at < now) throw new AuthError(400, "code_expired");
    if (row.attempts >= MAX_ATTEMPTS) throw new AuthError(429, "too_many_attempts");
    if (row.code_hash !== this.hash(`code:${email}:${code.trim()}`)) {
      this.db.query("UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?").run(email);
      throw new AuthError(400, "wrong_code");
    }
    this.db.query("DELETE FROM login_codes WHERE email = ?").run(email);
    let user = this.userByEmail(email);
    if (!user) {
      this.db.query("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)").run(crypto.randomUUID(), email, now);
      user = this.userByEmail(email)!;
    }
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    this.db.query("INSERT INTO sessions (token_hash, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)").run(this.hash(`session:${token}`), user.id, now, now);
    return { token, user };
  }

  userByEmail(email: string): User | null {
    return this.db.query<User, [string]>("SELECT id, email, plan, stripe_customer, sub_status, sub_period_end FROM users WHERE email = ?").get(email);
  }

  userById(id: string): User | null {
    return this.db.query<User, [string]>("SELECT id, email, plan, stripe_customer, sub_status, sub_period_end FROM users WHERE id = ?").get(id);
  }

  /** Session tokens arrive as `Authorization: Session <token>`. */
  authenticate(req: Request, now = Date.now()): User | null {
    const m = req.headers.get("authorization")?.match(/^Session\s+(\S+)$/i);
    if (!m) return null;
    const hash = this.hash(`session:${m[1]}`);
    const row = this.db.query<{ user_id: string; last_seen: number | null; created_at: number }, [string]>("SELECT user_id, last_seen, created_at FROM sessions WHERE token_hash = ?").get(hash);
    if (!row) return null;
    const seen = row.last_seen ?? row.created_at;
    if (now - seen > SESSION_IDLE_MS) {
      this.db.query("DELETE FROM sessions WHERE token_hash = ?").run(hash);
      return null;
    }
    // Sliding expiry, written at most once a day.
    if (now - seen > DAY) this.db.query("UPDATE sessions SET last_seen = ? WHERE token_hash = ?").run(now, hash);
    return this.userById(row.user_id);
  }

  /** Daily housekeeping: expired sessions and unused sign-in codes. */
  purgeExpired(now = Date.now()): { sessions: number; codes: number } {
    const sessions = this.db.query("DELETE FROM sessions WHERE COALESCE(last_seen, created_at) < ?").run(now - SESSION_IDLE_MS).changes;
    const codes = this.db.query("DELETE FROM login_codes WHERE expires_at < ? AND window_start < ?").run(now, now - 3_600_000).changes;
    return { sessions, codes };
  }

  /** Remove the account and everything stored for it. The caller handles billing first. */
  deleteAccount(user: User): void {
    const tx = this.db.transaction(() => {
      this.db.query("DELETE FROM ops WHERE ns = ?").run(`user:${user.id}`);
      this.db.query("DELETE FROM usage WHERE user_id = ?").run(user.id);
      this.db.query("DELETE FROM daily_usage WHERE user_id = ?").run(user.id);
      this.db.query("DELETE FROM login_codes WHERE email = ?").run(user.email);
      this.db.query("DELETE FROM sessions WHERE user_id = ?").run(user.id);
      this.db.query("DELETE FROM users WHERE id = ?").run(user.id);
    });
    tx();
  }

  signOut(req: Request): void {
    const m = req.headers.get("authorization")?.match(/^Session\s+(\S+)$/i);
    if (m) this.db.query("DELETE FROM sessions WHERE token_hash = ?").run(this.hash(`session:${m[1]}`));
  }
}
