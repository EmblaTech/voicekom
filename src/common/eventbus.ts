// eventbus.ts
import { EventEmitter } from 'events';
import { Logger } from '../utils/logger';

//TODO: Remove this class and set status from necessary places to avoid complexity
// Define event types
export enum SpeechEvents {
  //Wakeword Events
  WAKE_WORD_DETECTED = 'wakeWordDetected',
  STOP_WORD_DETECTED = 'stop_word_detected', 

  // UI Events
  RECORD_BUTTON_PRESSED = 'primaryButtonPressed',
  LISTEN_BUTTON_PRESSED = 'listenButtonPressed',
  STOP_BUTTON_PRESSED = 'stopButtonPressed',
  LISTENING_TIMED_OUT='listening_timed_out', // <-- ADD THIS
  // Listening Events
  LISTEN_STARTED = 'listeningStarted',
  LISTENING_STOPPED = 'listeningStopped',
  // Recording Events
  RECORDING_STARTED = 'recordingStarted',
  RECORDING_STOPPED = 'recordingStopped',
  AUDIO_CAPTURED = 'audioCaptured',  
  
  // Processing Events
  TRANSCRIPTION_STARTED = 'transcriptionStarted',
  TRANSCRIPTION_COMPLETED = 'transcriptionCompleted',
  NLU_COMPLETED ='nluCompleted',
  

  // Action Events
  ACTION_PERFORMED = 'actionPerformed',
  ACTION_PAUSED = 'actionPaused',
  EXECUTION_COMPLETE = 'execution-complete',
  ACTUATOR_COMPLETED = 'actuatorCompleted',
  // Error Events
  ERROR_OCCURRED = 'errorOccurred'
}

export class EventBus {
  private readonly events = new EventEmitter();
  private readonly logger = Logger.getInstance();

  constructor() {
    this.events.setMaxListeners(20);
  }
  
  public on(eventName: SpeechEvents, callback: (...args: any[]) => void): void {
    this.events.on(eventName, callback);
  }
  
  public emit(eventName: SpeechEvents, ...args: any[]): void {
    this.logger.debug(`[SpeechEventBus] Event emitted: ${eventName}`, ...args);;
    this.events.emit(eventName, ...args);
  }
}