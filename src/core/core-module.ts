import { UIHandler } from '../ui/ui-handler';
import { EventBus, SpeechEvents } from '../common/eventbus';
import { Status, StatusType } from '../common/status';
import { CoreConfig, IntentResult } from '../types';
import { VoiceActuator } from '../actuator/voice-actuator';
import { NLUModule } from '../nlu/nlu-module';
import {WebspeechWakewordDetector} from '../wakeword/WebspeechAPICapturer';

export class CoreModule {
  private isListeningModeActive = false;
  private isRecordingModeActive = false;

  constructor(
    private readonly nluModule: NLUModule,
    private readonly uiHandler: UIHandler,
    private readonly voiceActuator: VoiceActuator,
    private readonly eventBus: EventBus,
    private readonly status: Status,
    private readonly wakeWordDetector: WebspeechWakewordDetector

  ) {}

  public async init(config: CoreConfig): Promise<void> {
    await this.uiHandler.init(config.uiConfig);
    await this.nluModule.init(config.transcriptionConfig, config.recognitionConfig);
    this.bindEvents();

    this.status.set(StatusType.IDLE);
    this.uiHandler.updateUIStatus();
    console.log('CoreModule initialized with config:', config);
    if (config.wakeWords) {
      console.log(`Initializing wake word detector with: ${config.wakeWords.join(', ')}`);
      console.log(`Sleep words are: ${config.sleepWords ? config.sleepWords.join(', ') : 'none'}`);
      this.wakeWordDetector.init(config.lang, config.wakeWords, config.sleepWords); // Added lang parameter
      this.wakeWordDetector.start();
    }
  }

  private bindEvents(): void {

    const resettoIdleLogic = () => {
        this.status.set(StatusType.IDLE);
        this.uiHandler.updateUIStatus();
        this.wakeWordDetector.start();
    };

    const onActionFinished = () => {
      // After processing a command, check if we should continue listening.
      if (this.isListeningModeActive && !this.isRecordingModeActive)  {
        // If so, just reset the status. The VAD is still running.
        console.log('[INTERRUPT] Continuing listening mode after action completion.');
        this.status.set(StatusType.LISTENING);
        this.uiHandler.updateUIStatus();
      }
      // If isListeningModeActive is false, the user must have pressed "STOP".
      // In that case, the STOP_BUTTON_PRESSED handler has already reset the state to IDLE.
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

    this.eventBus.on(SpeechEvents.STOP_BUTTON_PRESSED, () => {
      stopSessionLogic();
    });
    this.eventBus.on(SpeechEvents.STOP_WORD_DETECTED, () => {
      stopSessionLogic();
    });

    this.eventBus.on(SpeechEvents.ERROR_OCCURRED, (error: Error) => {
      if(this.status.get().value!=StatusType.ERROR && this.status.get().value!= StatusType.IDLE){
        console.log(`MANGO1:${this.status.get().value}`)
        this.status.set(StatusType.ERROR, error.message)
        this.uiHandler.displayError(error)
        stopSessionLogic();
        setTimeout(resettoIdleLogic, 3000);
        console.log(`MANGO timeout: ${this.status.get().value}`)
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
      const currentStatus = this.status.get().value;
        if (currentStatus === StatusType.ERROR) {
            return; // Do nothing and let the error state persist.
        }
      this.status.set(StatusType.RECORDING);
      this.uiHandler.updateUIStatus();
    });

    this.eventBus.on(SpeechEvents.RECORDING_STOPPED, () => {
        this.isRecordingModeActive = false;
        const currentStatus = this.status.get().value;
        if (currentStatus === StatusType.ERROR) {
            return; // Do nothing and let the error state persist.
        }
        // If we are still in listening mode, we should not change the status.
        // The VAD will continue to run and listen for wake words.
        if (this.isListeningModeActive) {
          this.status.set(StatusType.LISTENING);
        } else {
          this.status.set(StatusType.IDLE);
        }
        this.uiHandler.updateUIStatus();  
      // if (this.isListeningModeActive) {
      //   this.status.set(StatusType.PROCESSING);
      //   this.uiHandler.updateUIStatus();
      // }
    });

    this.eventBus.on(SpeechEvents.LISTENING_STOPPED, () => {
      const currentStatus = this.status.get().value;
      
      console.log(`BANANA: Current status is: ${currentStatus}`);
      if (currentStatus !== StatusType.ERROR) {
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
        const actionPerformed = await this.voiceActuator.performAction(intents);
        if (!actionPerformed) {
          ;
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.eventBus.emit(SpeechEvents.ERROR_OCCURRED, err);
      }
      if(this.status.get().value === StatusType.EXECUTING) {
        this.eventBus.emit(SpeechEvents.ACTUATOR_COMPLETED);
      }
    });

    // Pause listening when editing starts
    this.eventBus.on(SpeechEvents.EDIT_TRANSCRIPTION_STARTED, () => {
        // if (this.isListeningModeActive) {
        //     console.log("Pausing listening for inline edit...");
        //     this.isListeningModeActive = false;
        //     this.nluModule.forceStopSession(); // stops audio capture
        // }

        stopSessionLogic();
    });

    // Resume listening when editing finishes
    this.eventBus.on(SpeechEvents.EDIT_TRANSCRIPTION_FINISHED, (updatedText: string) => {
        console.log("Inline edit finished, updated text:", updatedText);
        
        // Emit updated transcription to the system
        // this.isListeningModeActive = false;
        this.eventBus.emit(SpeechEvents.TRANSCRIPTION_UPDATED, updatedText);

        if (!this.isListeningModeActive) {
          this.isListeningModeActive = true;
          this.wakeWordDetector.stop();
          this.nluModule.startListeningSession();
        }
    });
  }
}