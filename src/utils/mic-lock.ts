/**
 * Cross-tab microphone lock using BroadcastChannel leader election.
 * Ensures only one tab/session owns the mic at a time.
 */

export interface MicLockHandle {
  isOwner(): boolean;
  release(): void;
  dispose(): void;
}

type MicLockMessage =
  | { type: 'who-is-owner'; from: string }
  | { type: 'i-am-owner'; from: string }
  | { type: 'request-ownership'; from: string }
  | { type: 'resign'; from: string };

const CHANNEL_NAME = 'voicekom-mic-lock';
const HEARTBEAT_MS = 1500;
const OWNER_STALE_MS = 3500;

export class MicLock implements MicLockHandle {
  private bc: BroadcastChannel | null = null;
  private id = crypto.randomUUID();
  private ownerLastBeat = 0;
  private heartbeatTimer: number | null = null;
  private owning = false;

  constructor() {
    if (typeof BroadcastChannel !== 'undefined') {
      this.bc = new BroadcastChannel(CHANNEL_NAME);
      this.bc.onmessage = (e: MessageEvent<MicLockMessage>) => this.onMessage(e.data);
      // Probe existing owner
      this.post({ type: 'who-is-owner', from: this.id });
    }
  }

  private post(msg: MicLockMessage) {
    try {
      this.bc?.postMessage(msg);
    } catch {
      // ignore
    }
  }

  private onMessage(msg: MicLockMessage) {
    if (!msg || (msg as any).from === this.id) return;
    switch (msg.type) {
      case 'i-am-owner':
        this.ownerLastBeat = Date.now();
        break;
      case 'who-is-owner':
        if (this.owning) this.post({ type: 'i-am-owner', from: this.id });
        break;
      case 'request-ownership':
        if (this.owning) this.post({ type: 'i-am-owner', from: this.id });
        break;
      case 'resign':
        // followers will naturally attempt to acquire if stale
        break;
    }
  }

  /**
   * Try to acquire ownership. Returns true if this tab now owns the mic.
   */
  async acquire(timeoutMs = 2000): Promise<boolean> {
    if (!this.bc) {
      // No BroadcastChannel support; assume single-tab context owns it.
      this.owning = true;
      return true;
    }

    const start = Date.now();
    // Ask current owner to announce
    this.post({ type: 'request-ownership', from: this.id });

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    // Wait briefly for any existing owner heartbeat
    while (Date.now() - start < timeoutMs) {
      if (Date.now() - this.ownerLastBeat < OWNER_STALE_MS) {
        // Someone else is owning
        this.owning = false;
        return false;
      }
      await sleep(150);
    }

    // No active owner detected; become owner
    this.owning = true;
    this.ownerLastBeat = Date.now();
    this.startHeartbeat();
    return true;
  }

  private startHeartbeat() {
    if (!this.bc || this.heartbeatTimer) return;
    this.heartbeatTimer = (setInterval(() => {
      if (!this.owning) return;
      this.ownerLastBeat = Date.now();
      this.post({ type: 'i-am-owner', from: this.id });
    }, HEARTBEAT_MS) as unknown) as number;
  }

  isOwner(): boolean {
    return this.owning;
  }

  release(): void {
    if (!this.owning) return;
    this.owning = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.post({ type: 'resign', from: this.id });
  }

  dispose(): void {
    this.release();
    try {
      this.bc?.close();
    } catch {
      // ignore
    }
    this.bc = null;
  }
}

/**
 * Convenience helper to acquire the mic lock and return the handle.
 */
export async function tryAcquireMicLock(): Promise<MicLockHandle & { acquired: boolean }> {
  const lock = new MicLock();
  const acquired = await lock.acquire();
  return { acquired, isOwner: () => lock.isOwner(), release: () => lock.release(), dispose: () => lock.dispose() };
}
 
