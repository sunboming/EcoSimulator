/** One biological step always represents 200 ms, independent of timer frequency. */
export class FixedClock {
  private accumulator = 0;
  droppedSteps = 0;
  constructor(private budgetMs = 12, private now = () => performance.now()) {}
  advance(elapsedMs: number, speed: number, paused: boolean, step: () => void) {
    this.droppedSteps = 0;
    if (paused) { this.accumulator = 0; return 0; }
    this.accumulator = Math.min(8000, this.accumulator + Math.max(0, elapsedMs) * speed);
    let steps = 0;
    const start = this.now();
    while (this.accumulator >= 200 && steps < 40) {
      step(); this.accumulator -= 200; steps++;
      if (this.now() - start >= this.budgetMs) {
        this.droppedSteps = Math.floor(this.accumulator / 200);
        this.accumulator %= 200;
        break;
      }
    }
    return steps;
  }
}
