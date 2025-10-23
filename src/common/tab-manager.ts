import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

const CHANNEL_NAME = 'voicekom_tab_manager_v3';
const LOCK_KEY = 'voicekom_leader_lock';
const HEARTBEAT_INTERVAL = 2000; // Leader sends a heartbeat every 2 seconds
const WATCHDOG_TIMEOUT = 5000;  // Standby tabs expect a heartbeat at least every 5 seconds

type Message = {
  type: 'HEARTBEAT' | 'SHUTDOWN';
  tabId: string;
};

export class TabManager {
  private readonly tabId = `${Date.now()}-${Math.random().toString(36).substring(2)}`;
  private channel: BroadcastChannel;
  private isLeader = false;
  private heartbeatInterval: number | null = null;
  private watchdogTimeout: number | null = null;

  public onBecameLeader: () => void = () => {};
  public onBecameStandby: () => void = () => {};

  constructor() {
    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.channel.onmessage = this.handleMessage.bind(this);
    window.addEventListener('beforeunload', this.shutdown.bind(this));
    
    logger.info(`TabManager [${this.tabId}]: Initializing.`);
  }

  public start(): void {
    logger.info(`TabManager [${this.tabId}]: Starting election process.`);
    this.attemptToBecomeLeader();
  }

  private handleMessage(event: MessageEvent<Message>): void {
    if (event.data.tabId === this.tabId) return;

    switch (event.data.type) {
      case 'HEARTBEAT':
        if (!this.isLeader) {
          this.resetWatchdog();
        }
        break;
        
      case 'SHUTDOWN':
        logger.info(`TabManager [${this.tabId}]: Leader [${event.data.tabId}] shut down. Attempting to take over.`);
        this.attemptToBecomeLeader();
        break;
    }
  }

  private sendMessage(type: Message['type']): void {
    this.channel.postMessage({ type, tabId: this.tabId });
  }

  private attemptToBecomeLeader(): void {
    const leaderId = localStorage.getItem(LOCK_KEY);

    if (leaderId === null) {
      // No leader exists, try to claim it.
      localStorage.setItem(LOCK_KEY, this.tabId);
      // Double-check to ensure atomicity.
      if (localStorage.getItem(LOCK_KEY) === this.tabId) {
        this.becomeLeader();
      } else {
        // Lost the race, another tab claimed it just now.
        this.becomeStandby();
      }
    } else if (leaderId === this.tabId) {
      // This can happen on a page refresh. We are still the leader.
      this.becomeLeader();
    } else {
      // A leader already exists.
      this.becomeStandby();
    }
  }

  private becomeLeader(): void {
    if (this.isLeader) return;

    logger.info(`TabManager [${this.tabId}]: Leadership acquired.`);
    this.isLeader = true;
    this.stopWatchdog();
    this.startHeartbeat();
    this.onBecameLeader();
  }

  private becomeStandby(): void {
    // No need to call onBecameStandby if we are already in that state.
    if (!this.isLeader && this.watchdogTimeout) return; 

    logger.info(`TabManager [${this.tabId}]: Becoming standby.`);
    this.isLeader = false;
    this.stopHeartbeat();
    this.resetWatchdog();
    this.onBecameStandby();
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = window.setInterval(() => {
      // Ensure we are still the leader before sending heartbeat.
      if (localStorage.getItem(LOCK_KEY) === this.tabId) {
        this.sendMessage('HEARTBEAT');
      } else {
        // Lost leadership somehow (e.g., localStorage cleared manually).
        logger.warn(`TabManager [${this.tabId}]: Lost leadership unexpectedly. Becoming standby.`);
        this.becomeStandby();
      }
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private resetWatchdog(): void {
    this.stopWatchdog();
    this.watchdogTimeout = window.setTimeout(() => {
      logger.warn(`TabManager [${this.tabId}]: Leader heartbeat timed out. Attempting to take over.`);
      // Assume leader is dead, remove the lock and try to become leader.
      const currentLeader = localStorage.getItem(LOCK_KEY);
      if (currentLeader) {
        // Only remove the lock if it's still there. This prevents a race condition
        // where a new leader is chosen while we are about to remove the lock.
        // A more advanced implementation might check if the leader ID has changed
        // to a new one, but for now, just attempting to take over is reasonable.
        localStorage.removeItem(LOCK_KEY);
      }
      this.attemptToBecomeLeader();
    }, WATCHDOG_TIMEOUT);
  }

  private stopWatchdog(): void {
    if (this.watchdogTimeout) {
      clearTimeout(this.watchdogTimeout);
      this.watchdogTimeout = null;
    }
  }

  private shutdown(): void {
    if (this.isLeader) {
      logger.info(`TabManager [${this.tabId}]: Leader shutting down gracefully.`);
      localStorage.removeItem(LOCK_KEY);
      this.sendMessage('SHUTDOWN');
    }
    this.channel.close();
  }
}