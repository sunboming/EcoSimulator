import { IdleDeadline } from '../shared/idle';

/** Only trusted, visible-page input reports activity; automatic network traffic does not. */
export class IdleMonitor {
  private deadline = new IdleDeadline(30 * 60 * 1000);
  private notified = false;
  private dirty = false;
  constructor(private socket: () => WebSocket | undefined, private onExpire: () => void) {
    const activity = (event: Event) => {
      if (!event.isTrusted || document.hidden || !this.check()) return;
      this.deadline.touch(); this.dirty = true;
    };
    for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) {
      document.addEventListener(type, activity, { passive: true, capture: true });
    }
    document.addEventListener('visibilitychange', () => this.check());
    setInterval(() => {
      if (!this.check()) return;
      const ws = this.socket();
      if (this.dirty && ws?.readyState === WebSocket.OPEN && !document.hidden) {
        ws.send(JSON.stringify({ type: 'activity' })); this.dirty = false;
      }
    }, 1000);
  }
  configure(timeoutMs: number) { this.deadline.configure(timeoutMs); this.check(); }
  check() {
    if (!this.deadline.expired()) return true;
    if (!this.notified) { this.notified = true; this.onExpire(); }
    return false;
  }
  stop() { this.deadline.stop(); this.check(); }
  resume() { this.deadline.resume(); this.notified = false; this.dirty = false; }
}
