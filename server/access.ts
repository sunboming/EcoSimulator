import { createHash, timingSafeEqual } from 'node:crypto';

/** A fixed-size global budget suits a single-owner service and cannot grow with attacker IPs. */
class Budget {
  private tokens: number;
  private last: number;
  constructor(private capacity: number, private perMs: number, private now: () => number) {
    this.tokens = capacity; this.last = now();
  }
  take() {
    const time = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + Math.max(0, time - this.last) * this.perMs);
    this.last = time;
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }
}

export class PrivateAccess {
  private expected: Buffer;
  private requests: Budget;
  private failures: Budget;
  constructor(private enabled: boolean, secret: string, now = () => performance.now()) {
    if (enabled && (secret.length < 32 || secret === 'replace-with-a-long-random-secret')) {
      throw new Error('私有模式要求 ADMIN_TOKEN 至少 32 个字符，且不能使用示例口令；请用 openssl rand -hex 32 生成');
    }
    this.expected = this.digest(`admin:${secret}`);
    this.requests = new Budget(60, 10 / 1000, now);
    this.failures = new Budget(6, 1 / 10000, now);
  }
  private digest(value: string) { return createHash('sha256').update(value).digest(); }
  probe() { return !this.enabled || this.requests.take(); }
  check(header: string | undefined): 200 | 401 | 429 {
    if (!this.enabled) return 200;
    if (!this.requests.take()) return 429;
    // Fixed-length digest comparison avoids comparing attacker-controlled password lengths.
    const encoded = header && header.length <= 2048 ? /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(header)?.[1] : undefined;
    const valid = encoded && timingSafeEqual(this.digest(Buffer.from(encoded, 'base64').toString('utf8')), this.expected);
    if (valid) return 200;
    return this.failures.take() ? 401 : 429;
  }
}
