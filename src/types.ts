// enhanced-types.ts
export interface VoiceKomConfig { 
  //Key configs
  widgetId? :string;
  lang?: string;   

  //Speech engine configs
  transcription?: TranscriptionConfig;  //Transcription options
  recognition?: RecognitionConfig; // Intent Detection options    
  //WakewordConfig
  wakeWords?: string[]; // Optional wake word for start listening
  sleepWords?: string[]; // Optional sleep word to stop listening
  //UI configs
  autoStart?: boolean;
  position?: string;
  width?: string;
  height?: string;
  theme?: string;
  showProgress?: boolean;
  showTranscription?: boolean;
  
  //Other configs
  retries?: number; 
  timeout?: number;
  loglevel?: string; //TODO: Implement display log above configured log level
  ui?: Record<string, any>;
}

interface VoiceEngineConfig {
  provider: string; // Provider name (e.g., 'default' | 'openai' | 'google' | 'azure' | 'custom',)
  lang?: string;
  apiUrl?: string;  // API endpoint URL 
  apiKey?: string; // API key if required  
  model?: string;  // Model name if applicable
  confidence?: number; // Confidence threshold (0.0-1.0)    
  options?: Record<string, any>; // Any additional options needed
}

export interface RecognitionConfig extends VoiceEngineConfig {
  temperature?: number; // Optional temperature for LLM-based recognition
}

export interface TranscriptionConfig extends VoiceEngineConfig {
  temperature?: number; // Optional temperature for LLM-based transcription  
}

export interface CoreConfig {
  transcriptionConfig: TranscriptionConfig; 
  recognitionConfig: RecognitionConfig;
  uiConfig: UIConfig
  actuatorConfig: ActuatorConfig
  wakeWords?: string[]; // Optional wake word for start listening
  sleepWords?: string[]; // Optional wake word for stop listening
  lang: string; // Wakeword for language selection
}

export interface LanguageConfig {
  wake: string[];
  sleep: string[];
}

export interface UIConfig {
  widgetId?: string;
  autoStart?: boolean;
  position?: string;
  width?: string;
  height?: string;
  theme?: string;
  showProgress?: boolean;
  showTranscription?: boolean;
  styles?: Record<string, string>;
  styleUrl?: string;
}

export interface ActuatorConfig {
  retries?:number,
  timeout?: number,
}

export enum IntentTypes {
  CLICK_ELEMENT = 'click_element',
  CLICK_ELEMENT_IN_CONTEXT ='click_element_in_context',
  SCROLL= 'scroll',
  SCROLL_TO_ELEMENT = 'scroll_to_element',
  FILL_INPUT = 'fill_input',
  TYPE_TEXT = 'type_text',
  SPEAK_TEXT = 'speak_text',
  CHECK_CHECKBOX = 'check_checkbox',
  UNCHECK_CHECKBOX ='uncheck_checkbox',
  CHECK_ALL = 'check_all',
  UNCHECK_ALL = 'uncheck_all',
  SELECT_RADIO_OR_DROPDOWN = 'select_radio_or_dropdown',
  OPEN_DROPDOWN = 'open_dropdown',
  GO_BACK = 'go_back',
  FILL_FORM = 'fill_form',
  SUBMIT_FORM = 'submit_form',
  UNKNOWN = 'UNKNOWN',

  // Added by me to create additional functionality
  ZOOM = 'zoom',
  UNDO = 'undo',
  UNDO_TARGET = 'undo_target'
}

// Audio Capturer interface
export interface AudioCapturer {
  startListening(config: VADConfig): Promise<void>;
  stopListening(): void;
}

export interface VADConfig {
  silenceDelay: number;
  speakingThreshold: number;
}

//Wakeword detector interface
export interface WakewordDetector {
  start(): void;
  stop(): void;
}

// Intent recognition result
export interface IntentResult {
  intent: IntentTypes;
  confidence: number;
  entities?: Entities;
}
export type Entities = Record<string, EntityValue>;

export interface CommandIntent {
  name: string;
  utterances: string[];
  entities: string[];
}


export interface Actuator {
  performAction(intent: IntentResult): Promise<boolean>;
}

//Actuator
export interface Action {
  execute(entities: any): boolean;
}
export interface IActionRegistry {
  registerAction(name: string, action: Action): void;
  mapIntentToAction(intent: string, actionName: string): void;
  getActions(intent: string): Action[];
  getRegisteredActionNames(): string[];
}

export enum TranscriptionProviders {
  DEFAULT = 'default',
  GOOGLE = 'google',
  AZURE = 'azure',
  WEBSPEECH = 'webspeech', 
  WHISPER = 'whisper',
  VOICEKOM = 'voicekom'
}

export enum RecognitionProvider {
  DEFAULT = 'default',
  OPENAI = 'openai',
  COMPROMISE = 'compromise',
  VOICEKOM = 'voicekom'
}

// STT Driver interface
export interface ISTTDriver {
  //init( lang:string ,config: STTConfig): void;
  transcribe(audioBlob: Blob): Promise<string>;
  getAvailableLanguages(): string[];
}

// NLP Module interface
export interface INLPModule {
  init(config: any): Promise<void>;
  startListening(): void;
  stopListening(): Promise<void>;
  getAvailableLanguages(): string[];
}

// Audio Capturer interface
export interface IAudioCapturer {
  startRecording(): void;
  stopRecording(): Promise<Blob>;
}

// Core Module interface
export interface ICoreModule {
  init(config: CoreConfig): Promise<void>;
  startListening(): void;
  stopListening(): void;
}

// Voice Lib interface
export interface IVoiceLib {
  init(config: any): Promise<void>;
}

export interface INLUDriver {
  init(lang: string, config: any): void;
  identifyIntent(text: string): Promise<IntentResult[]> | IntentResult[];
  getAvailableIntents(): IntentTypes[];
}

export interface IVoiceActuator {
  performAction(intent: IntentResult[]): Promise<boolean>;
}

//================================================================//
// CORE MULTILINGUAL ENTITY DEFINITIONS (METHOD 3 IMPLEMENTATION) //
//================================================================//

/**
 * A structured entity for any UI element.
 * This is the core of the multilingual strategy, capturing both the original
 * spoken term and its English-normalized version for robust matching.
 */
export interface VoiceEntity {
  english: string;
  user_language: string;
}

/**
 * A type guard to safely check if a given entity is a `VoiceEntity`.
 * This is extremely useful in action handlers to determine how to process an entity.
 * @example
 * if (isVoiceEntity(entities.target)) {
 *   // We can now safely access entities.target.user_language
 * }
 */
export const isVoiceEntity = (entity: any): entity is VoiceEntity => {
  return entity && typeof entity.user_language === 'string' && typeof entity.english === 'string';
};

/**
 * A union type representing all possible value types for an entity.
 * It can be a simple primitive or a complex `VoiceEntity`.
 */
export type EntityValue = string | VoiceEntity;

/**
 * A strongly-typed record for all entities extracted from an intent.
 * The key is the entity name (e.g., "target", "value"), and the value
 * can be any of the types defined in `EntityValue`.
 */
//export type Entities = Record<string, EntityValue>;

//================================================================//
// MODULE AND DRIVER INTERFACES                                   //
//================================================================//

// --- Input / Processing Drivers ---

// export interface ISTTDriver {
//   init(lang: string, config: STTConfig): void;
//   transcribe(audioBlob: Blob): Promise<string>;
//   getAvailableLanguages(): string[];
// }

// export interface INLUDriver {
//   init(lang: string, config: NLUEngineConfig): void;
//   identifyIntent(text: string): Promise<IntentResult[]>; // Always returns a promise of an array for consistency
//   getAvailableIntents(): IntentTypes[];
// }

export interface IAudioCapturer {
  startRecording(): void;
  stopRecording(): Promise<Blob>;
}

// --- Output / Actuator Interfaces ---

export interface IUIComponent {
  init(config: UIConfig): void;
  updateFromState(): void;
  setTranscription(transcription: string): void;
}



export interface IActionRegistry {
  registerAction(name: string, action: Action): void;
  mapIntentToAction(intent: string, actionName: string): void;
  getActions(intent: string): Action[];
  getRegisteredActionNames(): string[];
}

export interface IVoiceActuator {
  performAction(intents: IntentResult[]): Promise<boolean>;
}



//================================================================//
// CONFIGURATION AND REGISTRY STRUCTURES                          //
//================================================================//

/**
 * Defines the structure for registering a new command intent.
 */
export interface CommandIntent {
  name: string;
  utterances: string[]; // Used by simpler NLU engines
  entities: string[];   // Defines expected entities for LLM-based engines
}

/**
 * Defines the overall structure for the command registry.
 */
export interface CommandRegistry {
  intents: CommandIntent[];
}
