import Fuse , { IFuseOptions } from 'fuse.js'; // NEW: Import Fuse.js
import { EventBus, SpeechEvents } from '../common/eventbus';
import { WakewordDetector } from '../types';
import { LANGUAGE_CONFIGS } from './language-config';

export class WebspeechWakewordDetector implements WakewordDetector {
  private readonly recognition: SpeechRecognition;
  private isListening = false;
  private hasShownError = false;
  
  // These will be initialized later
  private wakeWords: string[] = ['hey'];
  private sleepWords: string[] = ['stop listening'];

  // NEW: Fuse.js instances for wake and sleep word detection
  private fuseWake?: Fuse<string>;
  private fuseSleep?: Fuse<string>;

  // NEW: Centralized Fuse.js configuration
  private fuseOptions: IFuseOptions<string> = {
    // A threshold of 0.0 requires a perfect match.
    // A threshold of 1.0 would match anything.
    // 0.4 is a good starting point for slightly imperfect matches.
    threshold: 0.4,
    includeScore: true, // We want to see the score for debugging
    useExtendedSearch: true, // Allows for more complex search patterns
    ignoreLocation: true, // Search the entire string
  };

  constructor(private readonly eventBus: EventBus) {
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      throw new Error("Speech Recognition API is not supported in this browser.");
    }
    this.recognition = new SpeechRecognitionAPI();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';

    this.hasShownError = false; //Added by me to handle offline messages

    this.setupListeners();
  }

  /**
   * MODIFIED: Initializes Fuse.js instances with the provided words.
   */
  public init(lang: string, wakeWords: string[], sleepWords?: string[]): void {
    if (wakeWords && wakeWords.length > 0) {
      console.log(`Initializing WakeWordDetector with user provided wake words: ${wakeWords.join(', ')}`);
      this.wakeWords = wakeWords;
      this.sleepWords = sleepWords || [];
    }
    else {
      // Look up the language in LANGUAGE_CONFIGS if wakeWords not explicitly passed
      const langConfig = LANGUAGE_CONFIGS[lang];
      if (!langConfig) {
        throw new Error(`No language config found for '${lang}'. Please add it to LANGUAGE_CONFIGS.`);
      }
      console.log(`Initializing WakeWordDetector with default language specific wake words: ${langConfig.wake.join(', ')}`);
      this.wakeWords = langConfig.wake;
      this.sleepWords = langConfig.sleep;
    }

    console.log(`Initializing WakeWordDetector with wake words: ${this.wakeWords.join(', ')}`);
    if (!this.wakeWords || this.wakeWords.length === 0) {
      throw new Error("A wake word must be provided for the WakeWordDetector.");
    }

    this.recognition.lang = lang;

    // Create a Fuse instance for wake words.
    // We pass the words directly. Fuse.js handles normalization.
    this.fuseWake = new Fuse(this.wakeWords, this.fuseOptions);

    // Create a Fuse instance for sleep words.
    this.fuseSleep = new Fuse(this.sleepWords, this.fuseOptions);

    console.log(`Fuse.js initialized for wake and sleep words.`);
  }

   /**
   * MODIFIED: Iterates through known sleep words and checks if the transcription
   * contains any of them. This is more reliable for finding stop phrases
   * within a longer command.
   * 
   * @param transcription The text transcribed from the user's command.
   */
  public checkForStopWord(transcription: string): void {
    // We don't need Fuse.js for this check. A simple `includes` is more direct.
    // We normalize both the transcription and the sleep word to lower case for a more robust comparison.
    const normalizedTranscription = transcription.toLowerCase();

    for (const sleepWord of this.sleepWords) {
      // Check if the normalized transcription *contains* the sleep word.
      if (normalizedTranscription.includes(sleepWord.toLowerCase())) {
        console.log(`WakeWordDetector: Detected stop phrase in "${transcription}" (matched "${sleepWord}"). Emitting event.`);
        this.eventBus.emit(SpeechEvents.STOP_WORD_DETECTED);
        
        // We found a match, no need to check the other sleep words.
        return; 
      }
    }
  }
  
  // REMOVED: normalizeText is no longer needed as Fuse.js handles variations.
  // REMOVED: levenshteinDistance is no longer needed.

   private setupListeners(): void {
    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      const originalTranscription = Array.from(event.results)
        .map(r => r[0].transcript)
        .join('');

      if (!originalTranscription.trim()) {
        return;
      }
      
      // Modified expression to find a whole word match - supports multilingual characters
      const detectedWakeWord = this.wakeWords.find(wakeWord => {
        const escapedWord = wakeWord
          .normalize('NFC') // normalize Unicode combining marks
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // escape regex symbols

        const wakeWordRegex = new RegExp(`(^|[^\\p{L}\\p{N}])${escapedWord}([^\\p{L}\\p{N}]|$)`, 'iu');
        return wakeWordRegex.test(originalTranscription.normalize('NFC'));
      });


      if (detectedWakeWord) {
        // The log message is now much more reliable!
        console.log(`WakeWordDetector: Detected wake word "${detectedWakeWord}" in transcription: "${originalTranscription}"`);
        this.eventBus.emit(SpeechEvents.WAKE_WORD_DETECTED, detectedWakeWord);
      }
    };

    this.recognition.onend = () => {
      if (this.isListening) {
        if (!this.hasShownError) {
          console.warn("WakeWordDetector: Service ended unexpectedly, restarting...");
          this.hasShownError=true;
        }
        this.recognition.start();
      }
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error !== 'no-speech' && event.error !== 'audio-capture') {
        if (!this.hasShownError) {
          console.error("WakeWordDetector Error:", event.error);
        }
      }
    };
  }

  public start(): void {
    if (this.isListening || !this.wakeWords || this.wakeWords.length === 0) {
      return;
    }
    try {
      this.isListening = true;
      this.hasShownError = false;
      this.recognition.start();
      console.log(`WakeWordDetector: Passively listening for "${this.wakeWords.join(", ")}"...`);
    } catch (e) {
      this.isListening = false;
      console.error("Could not start WakeWordDetector:", e);
    }
  }

  public stop(): void {
    if (!this.isListening) {
      return;
    }
    this.isListening = false;
    this.hasShownError = false;
    this.recognition.stop();
    console.log("WakeWordDetector: Stopped.");
  }
}