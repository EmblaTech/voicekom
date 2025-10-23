import { Logger } from '../../utils/logger';
import { AudioCapturer, VADConfig } from '../../types';
import { EventBus, SpeechEvents } from '../../common/eventbus';

/**
 * An AudioCapturer implementation that uses the browser's built-in Web Speech API.
 * 
 * This class correctly uses the SpeechRecognition API's lifecycle events to provide
 * a better user experience. It emits LISTEN_STARTED when waiting for speech, and
 * RECORDING_STARTED only when speech is actually detected.
 */

export class WebSpeechAPICapturer implements AudioCapturer {
  private recognition: SpeechRecognition | null = null;
  
  // State Management
  private isMonitoring = false; // Is the system supposed to be listening? (controlled by start/stopListening)
  private isRecording = false;  // Is the API actively capturing a single utterance? (controlled by onspeechstart/onend)
  
  private language: string;
  private readonly logger = Logger.getInstance();


  private readonly AVAILABLE_LANGUAGES: string[] = 
  [
  'af', 'am', 'ar', 'az', 'be', 'bg', 'bn', 'bs', 'ca', 'cs', 
  'cy', 'da', 'de', 'el', 'en', 'es', 'et', 'eu', 'fa', 'fi', 
  'fil', 'fr', 'gl', 'gu', 'he', 'hi', 'hr', 'hu', 'hy', 'id', 
  'is', 'it', 'ja', 'jv', 'ka', 'kk', 'km', 'kn', 'ko', 'lo', 
  'lt', 'lv', 'mi', 'mk', 'ml', 'mr', 'ms', 'nb', 'ne', 'nl', 
  'no', 'pl', 'pt', 'ro', 'ru', 'si', 'sk', 'sl', 'sq', 'sr', 
  'su', 'sv', 'sw', 'ta', 'te', 'th', 'tr', 'uk', 'ur', 'vi', 
  'zh', 'zu', 'nb', 'nn'
];


  constructor(
    private readonly eventBus: EventBus,
    private lang: string | undefined
  ) {
    this.language = lang || 'en-US'; // Default to English if no language is provided
  }

  public async startListening(config: VADConfig): Promise<void> {
    if (this.isMonitoring) {
      this.logger.warn('WebSpeechApiCapturer is already monitoring.');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      const errorMsg = 'CRITICAL: Web Speech API is not supported by this browser.';
      this.logger.error(errorMsg);
      this.eventBus.emit(SpeechEvents.ERROR_OCCURRED, new Error(errorMsg));
      return;
    }

    this.logger.info(`Starting Web Speech API monitoring in language: ${this.language}`);
    this.isMonitoring = true;
    
    this.recognition = new SpeechRecognition();
    this.recognition.lang = this.language;
    this.recognition.continuous = false; // We manage the continuous loop via the 'onend' event.
    this.recognition.interimResults = false;
    this.recognition.maxAlternatives = 1;

    // --- REVISED Event Handlers for SpeechRecognition ---

    // Fired when the service starts listening. We are now WAITING for speech.
    this.recognition.onstart = () => {
      this.logger.info('Listening cycle started. Waiting for speech...');
      // We are not "recording" yet, just listening.
      this.isRecording = false; 
      // This is the correct event to signal the "listening" state.
      this.eventBus.emit(SpeechEvents.LISTEN_STARTED);
    };

    // *** NEW/CORRECTED ***
    // Fired when the service detects audible speech. THIS is when recording starts.
    this.recognition.onspeechstart = () => {
      this.logger.info('Speech detected! Capturing utterance.');
      this.isRecording = true;
      this.eventBus.emit(SpeechEvents.RECORDING_STARTED);
    };

    // Fired when the service returns a final result.
    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0][0].transcript.trim();
      this.logger.info(`Transcription received from Web Speech API: "${transcript}"`);
      
      this.eventBus.emit(SpeechEvents.TRANSCRIPTION_COMPLETED, transcript);
    };

    // Fired when an error occurs.
    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'no-speech') {
        this.logger.warn('No speech was detected in this listening cycle.');
      } else if (event.error === 'aborted') {
        this.logger.info('Speech recognition aborted by user (stopListening).');
      } else {
        this.logger.error('Speech recognition error:', event.error, event.message);
        this.eventBus.emit(SpeechEvents.ERROR_OCCURRED, event.error);
      }
    };
    
    // Fired when the service disconnects. This is our loop control point.
    this.recognition.onend = () => {
      this.logger.info('Listening cycle ended.');
      // If we were in a recording state, it means the utterance has now finished.
      // We must emit RECORDING_STOPPED to correctly reset UI states.
      if (this.isRecording) {
        this.isRecording = false;
        this.eventBus.emit(SpeechEvents.RECORDING_STOPPED);
      }
      
      // If the session is still supposed to be active, start listening for the next utterance.
      if (this.isMonitoring) {
        // A small delay can prevent some rapid-fire restart issues on certain browsers.
        setTimeout(() => this.recognition?.start(), 100);
      } else {
        this.logger.info('Web Speech API monitoring has been fully stopped.');
      }
    };
    
    // Kick off the first listening cycle.
    this.recognition.start();
  }

  public stopListening(): void {
    if (!this.isMonitoring) return;
    
    this.logger.info('Stopping Web Speech API monitoring.');
    // This flag is crucial. It prevents the 'onend' handler from restarting the recognition.
    this.isMonitoring = false;
    
    if (this.recognition) {
      // Abort gracefully stops the current recognition cycle.
      this.recognition.abort(); 
      this.recognition = null;
    }
  }

  public getIsRecording(): boolean {
    return this.isRecording;
  }
}