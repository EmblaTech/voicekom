import { StatusType } from './status';

const CHANNEL_NAME = 'voicekom_tab_manager';
const LOCK_KEY = 'voicekom_leader_lock';
const HEARTBEAT_INTERVAL = 1500;
const WATCHDOG_TIMEOUT = 4000;

type Message = {
  type: 'HEARTBEAT' | 'SHUTDOWN' | 'REQUEST_LEADERSHIP' | 'RELINQUISH_LEADERSHIP';
  tabId: string;
  status?: StatusType;
};

export class TabManager {
  private readonly tabId = `${Date.now()}-${Math.random().toString(36).substring(2)}`;
  private channel: BroadcastChannel;
  private isLeader = false;
  private isProbing = false;
  private heartbeatInterval: number | null = null;
  private watchdogTimeout: number | null = null;
  private appStatus: StatusType = StatusType.IDLE;
  private lastKnownLeaderStatus: StatusType = StatusType.IDLE;

  public onBecameLeader: () => void = () => {};
  public onBecameStandby: () => void = () => {};

  constructor() {
    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.channel.onmessage = this.handleMessage.bind(this);
    window.addEventListener('beforeunload', this.shutdown.bind(this));
    window.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
    
    console.log(`TabManager [${this.tabId}]: Initializing.`);
  }

  public start(): void {
    console.log(`TabManager [${this.tabId}]: Starting election process.`);
    this.attemptToBecomeLeader();
  }

  public setStatus(status: StatusType): void {
    this.appStatus = status;
  }

  private handleVisibilityChange(): void {
    if (document.visibilityState === 'visible' && !this.isLeader) {
      console.log(`TabManager [${this.tabId}]: Tab became visible. Last known leader status: ${this.lastKnownLeaderStatus}`);
      if (this.lastKnownLeaderStatus === StatusType.IDLE) {
        console.log(`TabManager [${this.tabId}]: Requesting leadership from idle leader.`);
        this.sendMessage('REQUEST_LEADERSHIP');
      }
    }
  }

  private handleMessage(event: MessageEvent<Message>): void {
    if (event.data.tabId === this.tabId) return;

    switch (event.data.type) {
      case 'HEARTBEAT':
        if (this.isProbing) {
          this.isProbing = false;
          this.lastKnownLeaderStatus = event.data.status || StatusType.IDLE;
          console.log(`TabManager [${this.tabId}]: Probing finished. Leader status is ${this.lastKnownLeaderStatus}.`);

          if (this.lastKnownLeaderStatus === StatusType.IDLE) {
            this.sendMessage('REQUEST_LEADERSHIP');
          } else {
            this.onBecameStandby();
          }
        }

        if (!this.isLeader) {
          this.lastKnownLeaderStatus = event.data.status || StatusType.IDLE;
          this.resetWatchdog();
        }
        break;
      
      case 'REQUEST_LEADERSHIP':
        if (this.isLeader && this.appStatus === StatusType.IDLE) {
          console.log(`TabManager [${this.tabId}]: Received leadership request. Relinquishing leadership.`);
          this.sendMessage('RELINQUISH_LEADERSHIP');
          this.relinquishLeadership();
        }
        break;

      case 'RELINQUISH_LEADERSHIP':
        console.log(`TabManager [${this.tabId}]: Previous leader relinquished control. Attempting to take over.`);
        this.attemptToBecomeLeader();
        break;

      case 'SHUTDOWN':
        console.log(`TabManager [${this.tabId}]: Leader [${event.data.tabId}] shut down. Attempting to take over.`);
        this.attemptToBecomeLeader();
        break;
    }
  }

  private sendMessage(type: Message['type']): void {
    const message: Message = { type, tabId: this.tabId };
    if (type === 'HEARTBEAT') {
      message.status = this.appStatus;
    }
    this.channel.postMessage(message);
  }

  private attemptToBecomeLeader(): void {
    setTimeout(() => {
      const leaderId = localStorage.getItem(LOCK_KEY);

      if (leaderId === null) {
        localStorage.setItem(LOCK_KEY, this.tabId);
        if (localStorage.getItem(LOCK_KEY) === this.tabId) {
          this.becomeLeader();
        } else {
          this.becomeStandby();
        }
      } else if (leaderId === this.tabId) {
        this.becomeLeader();
      } else {
        this.becomeStandby(true);
      }
    }, 50); 
  }

  private becomeLeader(): void {
    if (this.isLeader) return;

    console.log(`TabManager [${this.tabId}]: Leadership acquired.`);
    this.isLeader = true;
    this.stopWatchdog();
    this.startHeartbeat();
    this.onBecameLeader();
  }

  private becomeStandby(isInitialProbe = false): void {
    if (isInitialProbe) {
      console.log(`TabManager [${this.tabId}]: Entering probing mode.`);
      this.isProbing = true;
      this.isLeader = false;
      this.stopHeartbeat();
      this.resetWatchdog();
      return;
    }

    if (!this.isLeader && this.watchdogTimeout && !this.isProbing) return; 

    console.log(`TabManager [${this.tabId}]: Becoming standby.`);
    this.isProbing = false;
    this.isLeader = false;
    this.stopHeartbeat();
    this.resetWatchdog();
    this.onBecameStandby();
  }

  private relinquishLeadership(): void {
    if (!this.isLeader) return;
    console.log(`TabManager [${this.tabId}]: Gracefully relinquishing leadership.`);
    localStorage.removeItem(LOCK_KEY);
    this.becomeStandby();
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = window.setInterval(() => {
      if (localStorage.getItem(LOCK_KEY) === this.tabId) {
        this.sendMessage('HEARTBEAT');
      } else {
        console.log(`TabManager [${this.tabId}]: Lost leadership unexpectedly. Becoming standby.`);
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
      console.log(`TabManager [${this.tabId}]: Leader heartbeat timed out. Attempting to take over.`);
      const currentLeader = localStorage.getItem(LOCK_KEY);
      if (currentLeader) {
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
      console.log(`TabManager [${this.tabId}]: Leader shutting down gracefully.`);
      localStorage.removeItem(LOCK_KEY);
      this.sendMessage('SHUTDOWN');
    }
    this.channel.close();
  }
}