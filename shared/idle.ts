/** Real-time inactivity; network frames and simulation time never refresh this deadline. */
export class IdleDeadline {
  private lastActivity: number;
  private stopped = false;
  constructor(private timeoutMs: number, private now = () => Date.now()) { this.lastActivity = now(); }
  configure(timeoutMs: number) {
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) this.timeoutMs = timeoutMs;
  }
  expired() {
    if (this.now() - this.lastActivity >= this.timeoutMs) this.stopped = true;
    return this.stopped;
  }
  touch() {
    if (this.expired()) return false;
    this.lastActivity = this.now(); return true;
  }
  stop() { this.stopped = true; }
  resume() { this.lastActivity = this.now(); this.stopped = false; }
}
