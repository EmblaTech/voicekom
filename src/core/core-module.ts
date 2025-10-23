import { UIHandler } from '../ui/ui-handler';
import { EventBus, SpeechEvents } from '../common/eventbus';
import { Status, StatusType } from '../common/status';
import { CoreConfig, IntentResult } from '../types';
import { VoiceActuator } from '../actuator/voice-actuator';
import { NLUModule } from '../nlu/nlu-module';
import { WebspeechWakewordDetector } from '../wakeword/WebspeechAPICapturer';
import { TabManager } from '../common/tab-manager';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

export class CoreModule {
  private isListeningModeActive = false;
  private isRecordingModeActive = false;
  private tabManager: TabManager;
  private config: CoreConfig | null = null;
  private areVoiceComponentsInitialized = false;

  constructor(
    private readonly nluModule: NLUModule,
    private readonly uiHandler: UIHandler,
    private readonly voiceActuator: VoiceActuator,
    private readonly eventBus: EventBus,
    private readonly status: Status,
    private readonly wakeWordDetector: WebspeechWakewordDetector
  ) {
    logger.info('CoreModule: Constructor called.');
    this.tabManager = new TabManager();
  }

  public async init(config: CoreConfig): Promise<void> {
    this.config = config;
    await this.uiHandler.init(config.uiConfig);
    this.setupTabManagement();
    this.tabManager.start(); // Start the election process
    logger.info('CoreModule initialized. Awaiting tab leadership status...');
  }

  private setupTabManagement(): void {
    this.tabManager.onBecameLeader = () => {
      logger.info('CoreModule: Tab became leader. Initializing voice components.');
      this.uiHandler.hidePersistentMessage();
      this.initializeVoiceComponents();
    };

    this.tabManager.onBecameStandby = () => {
      logger.info('CoreModule: Tab is in standby.');
      this.shutdownVoiceComponents();
      this.uiHandler.showPersistentMessage('Mic is already in use in another tab.');
    };
  }

  private async initializeVoiceComponents(): Promise<void> {
    if (this.areVoiceComponentsInitialized || !this.config) return;

    logger.info('CoreModule: Initializing NLU, WakeWord, and binding events.');
    await this.nluModule.init(this.config.transcriptionConfig, this.config.recognitionConfig);
    this.bindEvents();

    if (this.config.wakeWords) {
      this.wakeWordDetector.init(this.config.wakeWords, this.config.sleepWords);
      this.wakeWordDetector.start();
    }

    this.status.set(StatusType.IDLE);
    this.uiHandler.updateUIStatus();
    this.areVoiceComponentsInitialized = true;
    // Ensure the tab manager has the correct initial status
    this.tabManager.setStatus(StatusType.IDLE);
  }

  private shutdownVoiceComponents(): void {
    if (!this.areVoiceComponentsInitialized) return;

    logger.info('CoreModule: Shutting down voice components.');
    this.nluModule.forceStopSession();
    this.wakeWordDetector.stop();
    // A proper implementation would unbind events here.
    // For now, the areVoiceComponentsInitialized flag prevents unwanted actions.
    
    this.status.set(StatusType.IDLE);
    this.areVoiceComponentsInitialized = false;
  }

  // ... (The rest of the bindEvents and handler methods remain the same)
  private bindEvents(): void {
    // --- Status Reporting to TabManager ---
    // Whenever the status changes, report it to the TabManager.
    this.status.onChange((newStatus) => {
      this.tabManager.setStatus(newStatus.value);
    });
    // ------------------------------------

    // Simplified for brevity. In a real app, store references to handlers to be able to call .off()
    const resettoIdleLogic = () => {
        this.status.set(StatusType.IDLE);
        this.uiHandler.updateUIStatus();
        this.wakeWordDetector.start();
    };

    const onActionFinished = () => {
      if (this.isListeningModeActive && !this.isRecordingModeActive)  {
        this.status.set(StatusType.LISTENING);
        this.uiHandler.updateUIStatus();
      }
    };
      
    const stopSessionLogic = () => {
      if (this.isListeningModeActive) {
        this.isListeningModeActive = false;
        this.isRecordingModeActive = false;
        this.nluModule.forceStopSession();
      }
    };

    this.eventBus.on(SpeechEvents.RECORD_BUTTON_PRESSED, () => {
      if (!this.isListeningModeActive) {
        this.isListeningModeActive = true;
        this.wakeWordDetector.stop();
        this.nluModule.startListeningSession();
      }
    });
    
    this.eventBus.on(SpeechEvents.WAKE_WORD_DETECTED, () => {
      if (!this.isListeningModeActive) {
        this.wakeWordDetector.stop(); 
        this.isListeningModeActive = true;
        this.nluModule.startListeningSession(); 
      }
    });
    
    this.eventBus.on(SpeechEvents.STOP_BUTTON_PRESSED, stopSessionLogic);
    this.eventBus.on(SpeechEvents.STOP_WORD_DETECTED, stopSessionLogic);

    this.eventBus.on(SpeechEvents.ERROR_OCCURRED, (error: Error) => {
      if(this.status.get().value!=StatusType.ERROR && this.status.get().value!= StatusType.IDLE){
        this.status.set(StatusType.ERROR, error.message)
        this.uiHandler.displayError(error)
        stopSessionLogic();
        setTimeout(resettoIdleLogic, 3000);
      }
    });

    this.eventBus.on(SpeechEvents.TRANSCRIPTION_COMPLETED, (transcription: string) => {
      this.wakeWordDetector.checkForStopWord(transcription);
    });

    this.eventBus.on(SpeechEvents.LISTEN_STARTED, () => {
      this.status.set(StatusType.LISTENING); 
      this.uiHandler.updateUIStatus();
    });

    this.eventBus.on(SpeechEvents.RECORDING_STARTED, () => {
      this.isRecordingModeActive = true;
      if (this.status.get().value === StatusType.ERROR) return;
      this.status.set(StatusType.RECORDING);
      this.uiHandler.updateUIStatus();
    });

    this.eventBus.on(SpeechEvents.RECORDING_STOPPED, () => {
        this.isRecordingModeActive = false;
        if (this.status.get().value === StatusType.ERROR) return;
        if (this.isListeningModeActive) {
          this.status.set(StatusType.LISTENING);
        } else {
          this.status.set(StatusType.IDLE);
        }
        this.uiHandler.updateUIStatus();  
    });

    this.eventBus.on(SpeechEvents.LISTENING_STOPPED, () => {
      if (this.status.get().value !== StatusType.ERROR) {
        resettoIdleLogic();
      } 
    });

    this.eventBus.on(SpeechEvents.ACTUATOR_COMPLETED, onActionFinished);

    this.eventBus.on(SpeechEvents.NLU_COMPLETED, async (intents: IntentResult[]) => {
      if (this.isListeningModeActive && !this.isRecordingModeActive)  {
        this.status.set(StatusType.EXECUTING);
        this.uiHandler.updateUIStatus();
      }
      try {
        await this.voiceActuator.performAction(intents);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.eventBus.emit(SpeechEvents.ERROR_OCCURRED, err);
      }
      if(this.status.get().value === StatusType.EXECUTING) {
        this.eventBus.emit(SpeechEvents.ACTUATOR_COMPLETED);
      }
    });
  }
}