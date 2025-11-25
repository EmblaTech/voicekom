import { Logger } from "../../utils/logger";
import { TranscriptionConfig } from "../../types";
import { TranscriptionDriver } from "./driver";
import { Validator } from "../../utils/validator";

export class WhisperTranscriptionDriver implements TranscriptionDriver {
    private readonly logger = Logger.getInstance();
    private language: string = 'en';
    private apiKey: string = '';
    private apiEndpoint: string = 'https://api.openai.com/v1/audio/transcriptions';

    private readonly DEFAULT_LANGUAGE = 'en';
    private readonly DEFAULT_MODEL = 'whisper-1';
    private readonly DEFAULT_TEMPERATURE = '0.0';

    private readonly AVAILABLE_LANGUAGES: string[] = 
    ['af','ar','hy','az','be','bs','bg','ca',
        'zh','hr','cs','da','nl','en','et','fi',
        'fr','gl','de','el','he','hi','hu','is',
        'id','it','ja','kn','kk','ko','lv','lt',
        'mk','ms','mi','mr','ne','no','fa','pl',
        'pt','ro','ru','sr','sk','sl','es','sw',
    'sv','tl','ta','th','tr','uk','ur','vi','cy'];

    constructor(config: TranscriptionConfig) {
        this.validateConfig(config);
        this.language = config.lang? config.lang.split(/[-_]/)[0].toLowerCase() : this.DEFAULT_LANGUAGE;
        this.apiKey = config.apiKey!; // Assuming apiKey is validated to exist before this class is instantiated
        this.apiEndpoint = config.apiUrl || this.apiEndpoint;
        this.logger.info(`WhisperTranscriptionDriver initialized with language: ${this.language}`);
    }

    async transcribe(rawAudio: Blob): Promise<string> {
        this.logger.info('Starting transcription with Whisper');
        const formData = this.buildFormData(rawAudio);

        try {
            const response = await fetch(this.apiEndpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: formData
            });

            if (!response.ok) {
                await this.handleApiError(response);
            }

            const data = await response.json();
            // const transcription = data.text;
            
            // if (typeof transcription !== 'string') {
            //     throw new Error('Invalid transcription format in API response.');
            // }

            // this.logger.info(`Transcription successful: ${transcription}`);
            // return transcription;

            let transcription = (data.text || "").trim().toLowerCase();

            if (typeof transcription !== 'string') {
            throw new Error('Invalid transcription format in API response.');
            }

            // 🔥 1. Common Whisper hallucinations when noise is present
            const noiseHallucinations = [
                "thank you",
                "thanks",
                "thanks for watching",
                "bye",
                "bye bye",
                "bye-bye",
                "you",
                "ok",
                "okay",
                "alright",
                "thankyou"
            ];

            // 2. If the transcription is VERY short and exactly matches a hallucination → reject
            const isShortHallucination =
                transcription.split(" ").length <= 3 &&
                noiseHallucinations.includes(transcription);

            if (isShortHallucination) {
                this.logger.info(`Rejected hallucinated noise transcription: '${transcription}'`);
                return "";
            }

            // 3. If the entire text contains only a hallucination phrase → reject
            if (noiseHallucinations.some(h => transcription.includes(h)) &&
                transcription.length < 30 // prevents rejecting valid long sentences
            ) {
                this.logger.info(`Rejected likely noise-based hallucination: '${transcription}'`);
                return "";
            }

            this.logger.info(`Transcription accepted: ${transcription}`);

            return transcription;
        } catch (error) {
            this.logger.error('Error during Whisper transcription:', error);
            throw error;
        }
    }


    private async handleApiError(response: Response): Promise<never> {
        // Read the body as text ONCE. This is safe and always works.
        const errorText = await response.text();

        try {
            const errorData = JSON.parse(errorText);
            const errorMessage = errorData.error?.message || 'Unknown API error message.';
            // Throw a detailed, specific error.
            throw new Error(`Whisper API error (${response.status}): ${errorMessage}`);
        } catch (jsonParseError) {
            throw new Error(`Whisper API error (${response.status} ${response.statusText}). Response: ${errorText}`);
        }
    }

    
    getAvailableLanguages(): string[] {
        return [...this.AVAILABLE_LANGUAGES];
    }

    setApiEndpoint(endpoint: string): void {
        if (!endpoint || !Validator.isValidUrl(endpoint)) {
            throw new Error('Invalid API endpoint provided');
        }
        this.apiEndpoint = endpoint;
    }
   
    getCurrentLanguage(): string {
        return this.language;
    }

    private validateConfig(config: TranscriptionConfig): void {
        if (!config.apiKey) {
            throw new Error('Whisper driver requires an API key in the configuration.');
        }
        if (config.apiUrl && !Validator.isValidUrl(config.apiUrl)) {
            throw new Error('Invalid API URL provided in configuration');
        }
        const langCode = config.lang ? config.lang.split(/[-_]/)[0].toLowerCase() : this.DEFAULT_LANGUAGE;
        if (!this.AVAILABLE_LANGUAGES.includes(langCode)) {
            throw new Error(`Unsupported language provided in configuration: ${config.lang}`);
        }
    }

    private buildFormData(rawAudio: Blob): FormData {
        const formData = new FormData();
        formData.append('file', rawAudio, 'audio.webm');
        formData.append('model', this.DEFAULT_MODEL);
        formData.append('language', this.language);
        formData.append('temperature', this.DEFAULT_TEMPERATURE);
    
        return formData;
    }
}