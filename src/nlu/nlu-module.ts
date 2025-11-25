import { AudioCapturer, CommandRegistry, TranscriptionConfig, RecognitionConfig, TranscriptionProviders, RecognitionProvider } from '../types';
import { EventBus, SpeechEvents } from '../common/eventbus';
import { Status, StatusType } from '../common/status';
import { TranscriptionDriver } from './transcription/driver';
import { RecognitionDriver } from './recognition/driver';
import { DriverFactory } from './driver-factory';
import { Logger } from '../utils/logger';
import { fetchContent } from '../utils/resource-fetcher';
import { VoiceKomCompoundDriver } from './compound/voicekom-compound-driver';

export class NLUModule {
  private commandRegistry: CommandRegistry | null = null;
  private language: string = 'en';
  private audioCapturer!: AudioCapturer;
  private transcriptionDriver: TranscriptionDriver | null = null;
  private recognitionDriver: RecognitionDriver | null = null;
  private compoundDriver: VoiceKomCompoundDriver | null = null;
  private readonly logger = Logger.getInstance();

  // VAD Configuration with defaults
  private silenceTimeout = 1500;
  private speakingThreshold = 0.05;
  
  // Internal state to manage the session loop
  private isSessionActive = false;

  constructor(
    private readonly eventBus: EventBus,
    private readonly status: Status
  ) {
    this.eventBus.on(SpeechEvents.AUDIO_CAPTURED, (blob: Blob) => {
      this.eventBus.emit(SpeechEvents.RECORDING_STOPPED);
      if(this.compoundDriver) {
        this.sendAudioChunk(blob);
      }
      else if(this.transcriptionDriver) {
        this.processAudioChunk(blob);
      }
    });

    this.eventBus.on(SpeechEvents.TRANSCRIPTION_COMPLETED, (transcription: string) => {
      this.processTranscription(transcription);
    });

    this.eventBus.on(SpeechEvents.ACTUATOR_COMPLETED, () => {
      if (this.isSessionActive) {
        this.startSingleListeningCycle();
      }
    });
    this.eventBus.on(SpeechEvents.TRANSCRIPTION_UPDATED, (text: string) => {
      // Use the updated text to run intent recognition
      // if (this.isSessionActive) {
      //   this.processTranscription(text);
      // }
      this.processTranscription(text)
    });
  }


 // in NLUModule.ts
  public async init(transConfig: TranscriptionConfig, recogConfig: RecognitionConfig): Promise<void> {
      this.logger.info("NLUModule.init() starting...");
      try {
        this.language = transConfig.lang || 'en';
        this.compoundDriver = DriverFactory.getCompoundDriver(transConfig, recogConfig);
        if (this.compoundDriver != null) {
              // SCENARIO 1: Both transcription and recognition use the 'voicekom' backend.
              // Use the unified driver that sends audio and gets back transcription + intent.
              this.logger.info("Using compound voicekom for audio -> intent processing.");
          } else {
              // SCENARIO 2: Any other combination. Use separate, modular drivers.
              this.logger.info("Using separate drivers for transcription and recognition.");
              this.transcriptionDriver = DriverFactory.getTranscriptionDriver(transConfig);
              this.recognitionDriver = DriverFactory.getRecognitionDriver(recogConfig);
              // this.backendDriver will remain null, which is correct for this mode.
          }

        // Get audio capturer based on transcription config
        this.audioCapturer = DriverFactory.getAudioCapturer(transConfig, this.eventBus);
        
        // Load command registry
        // this.commandRegistry = await fetchContent('../../src/nlu/command-registry.json');
        
        this.logger.info("NLUModule.init() completed successfully");
      } catch (error) {
        this.logger.error('CRITICAL ERROR in NLUModule init:', error);
        throw error;
      }
  }

  /**
   * Starts the entire listening session. Called once by CoreModule.
   */
  public startListeningSession(): void {
    if (this.isSessionActive) {
        this.logger.warn("Listening session is already active.");
        return;
    }
    this.isSessionActive = true;
    this.startSingleListeningCycle();
  }

  /**
   * Forcibly stops the entire listening session and cleans up resources. Called once by CoreModule.
   */
  public forceStopSession(): void {
    if (!this.isSessionActive) return;
    this.isSessionActive = false;
    this.audioCapturer.stopListening(); // Tells AudioCapturer to stop VAD and release the mic.
    this.eventBus.emit(SpeechEvents.LISTENING_STOPPED);
    this.logger.info("Listening session forced to stop by user.");
  }
  
  /**
   * Internal method to start a single listening cycle.
   * This is called at the beginning of a session and after each command is processed.
   */
  private startSingleListeningCycle(): void {
    // Guard against starting if the session was just stopped.
    if (!this.isSessionActive) return;
    try{
        this.audioCapturer.startListening({
        silenceDelay: this.silenceTimeout,
        speakingThreshold: this.speakingThreshold
    });
    this.eventBus.emit(SpeechEvents.LISTEN_STARTED);
  } catch (error) {
    this.handleAndEmitError(error,'Capturing Audio')
    //this.eventBus.emit(SpeechEvents.ERROR_OCCURRED, this.getErrorMessage(error));
    return;
  }
}

  private async sendAudioChunk(audioBlob: Blob): Promise<void> {
    if (!this.compoundDriver) {
      this.logger.error('Backend Driver not initialized');
      return;
    }

    try {
      const result = await this.compoundDriver.getIntentFromAudio(audioBlob);
      
      // Emit transcription result
      if (result.transcription) {
        this.eventBus.emit(SpeechEvents.TRANSCRIPTION_COMPLETED, result.transcription);
      }
      
      // Emit intent results array
      if (result.intent && result.intent.length > 0) {
        this.eventBus.emit(SpeechEvents.NLU_COMPLETED, result.intent);
      } else {
        this.logger.warn('No intents detected in the response');
      }
    } catch (error) {
        this.handleAndEmitError(error,'Backend Processing')

      //this.eventBus.emit(SpeechEvents.ERROR_OCCURRED, this.getErrorMessage(error));
    }
  }

  
  private async processAudioChunk(audioBlob: Blob): Promise<void> {
    if (!this.transcriptionDriver) { 
      
      this.logger.error('Transcription or Recognition Driver not initialized');
      return; 
    }
    try {
      const transcription = await this.transcriptionDriver.transcribe(audioBlob);
      this.eventBus.emit(SpeechEvents.TRANSCRIPTION_COMPLETED, transcription);
    } catch (error) {
      this.handleAndEmitError(error,'Transcription')
      //this.eventBus.emit(SpeechEvents.ERROR_OCCURRED, this.getErrorMessage(error));
    }
  }

  // in NLUModule.ts
  private async processTranscription(transcription: string): Promise<void> {
      // This method is only called in the "separate drivers" mode.
      // So, we only need to check for the recognitionDriver.
      if (!this.recognitionDriver) {
        this.logger.error('Recognition Driver not initialized for processing transcription.');
        return;
      }

      if (!transcription || transcription.trim() === '') {
        this.logger.warn('Skipping intent recognition for empty transcription.');
        return;
      }

      try {
        // Always use the dedicated recognition driver.
        const intentResult = await this.recognitionDriver.detectIntent(transcription);

        if (intentResult) {
          this.eventBus.emit(SpeechEvents.NLU_COMPLETED, intentResult);
        } else {
          this.logger.warn(`No intents detected for transcription: "${transcription}"`);
          // Optionally emit an event for "intent not found"
        }
      } catch (error) {
        this.logger.error('Error during intent recognition:', error);
        this.handleAndEmitError(error,'Recognition')
        //this.eventBus.emit(SpeechEvents.ERROR_OCCURRED, this.getErrorMessage(error));
      }
  }

  public getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;}
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
      return error.message;}
    return 'An unknown error occurred.';
    }

  
  public getAvailableLanguages(): string[] {
    if (!this.transcriptionDriver) return [];
    return this.transcriptionDriver.getAvailableLanguages();
  }

  // This method appears to be unused. The command registry is now loaded from the JSON file.
  // You can likely remove this method for cleanup.
  private getCommands(): CommandRegistry {
    return {
      intents: [
        {
          name: "click_element",
          utterances: ["click (target)", "press (target)", "tap (target)"],
          entities: ["target"]
        }
      ]
    };
  }

  private handleAndEmitError(error: unknown, source: 'Transcription' | 'Recognition' | 'Capturing Audio'| 'Backend Processing'): void {
        this.logger.error(`Error during ${source}:`, error);

        let userMessage = `An unknown error occurred during ${source}.`;

        if (error instanceof Error) {
            const message = error.message.toLowerCase(); // Use lowercase for case-insensitive matching

            // Case 1: Network Error (Highest priority check)
            if (message.includes('failed to fetch')) {
                userMessage = `${source} failed. Please check your internet connection.`;
            }
            // Case 2: Invalid API Key (look for 401 or "invalid api key")
            else if (message.includes('401') || message.includes('invalid_api_key')) {
                userMessage = `${source} failed: Invalid API Key provided.`;
            }
            // Case 3: Quota or Rate Limit Error
            else if (message.includes('429') || message.includes('quota') || message.includes('rate limit')) {
                userMessage = `${source} failed: API quota has been reached.`;
            }
            // Case 4: Server-side Error
            else if (message.includes('500') || message.includes('503')) {
                userMessage = `The ${source} service is currently unavailable. Please try again later.`;
            }
            // Case 5: Invalid Response from our driver logic
            else if (message.includes('invalid transcription format')) {
                userMessage = `The ${source} service returned an invalid or empty response.`;
            }
        }
        
        this.eventBus.emit(SpeechEvents.ERROR_OCCURRED, userMessage);
    }

  // Inside NLUModule
  public get sessionActive(): boolean {
      return this.isSessionActive;
  }

  public get thisSession() {
    return this.startSingleListeningCycle;
  }
}