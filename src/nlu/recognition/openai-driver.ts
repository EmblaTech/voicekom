import { RecognitionConfig, IntentResult, IntentTypes } from "../../types";
import { Logger } from "../../utils/logger";
import { RecognitionDriver } from "./driver";

interface CommandConfig {
    // description: string;
    negative_utterances: string[];
    utterances: string[];
    entities: string[];
    inferenceGuide?: string;
}

interface CommandRegistry {
    [key: string]: CommandConfig;
}

export class OpenAIRecognitionDriver implements RecognitionDriver {
    private readonly logger = Logger.getInstance();
    private language: string;
    private commandRegistry: CommandRegistry;
    private availableIntents: IntentTypes[] = [IntentTypes.UNKNOWN];
    private apiKey: string;
    private apiEndpoint: string = 'https://api.openai.com/v1/chat/completions';
    private model: string = 'gpt-4o';

    private static readonly DEFAULT_TEMPERATURE = 0.3;
    private static readonly DEFAULT_LANGUAGE = 'en';
 
    private static readonly LANGUAGE_NAMES: Record<string, string> = {
            'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German', 'it': 'Italian',
            'pt': 'Portuguese', 'ru': 'Russian', 'zh': 'Chinese', 'ja': 'Japanese', 'ko': 'Korean',
            'ar': 'Arabic', 'hi': 'Hindi', 'nl': 'Dutch', 'sv': 'Swedish', 'da': 'Danish',
            'no': 'Norwegian', 'fi': 'Finnish', 'pl': 'Polish', 'cs': 'Czech', 'hu': 'Hungarian',
            'ro': 'Romanian', 'bg': 'Bulgarian', 'hr': 'Croatian', 'sk': 'Slovak', 'sl': 'Slovenian',
            'et': 'Estonian', 'lv': 'Latvian', 'lt': 'Lithuanian', 'mt': 'Maltese', 'ga': 'Irish',
            'cy': 'Welsh', 'eu': 'Basque', 'ca': 'Catalan', 'gl': 'Galician', 'tr': 'Turkish',
            'he': 'Hebrew', 'th': 'Thai', 'vi': 'Vietnamese', 'id': 'Indonesian', 'ms': 'Malay',
            'tl': 'Filipino', 'sw': 'Swahili', 'am': 'Amharic', 'yo': 'Yoruba', 'zu': 'Zulu',
            'xh': 'Xhosa', 'af': 'Afrikaans', 'sq': 'Albanian', 'az': 'Azerbaijani', 'be': 'Belarusian',
            'bn': 'Bengali', 'bs': 'Bosnian', 'my': 'Burmese', 'km': 'Khmer', 'ka': 'Georgian',
            'gu': 'Gujarati', 'kk': 'Kazakh', 'ky': 'Kyrgyz', 'lo': 'Lao', 'mk': 'Macedonian',
            'ml': 'Malayalam', 'mn': 'Mongolian', 'ne': 'Nepali', 'ps': 'Pashto', 'fa': 'Persian',
            'pa': 'Punjabi', 'si': 'Sinhala', 'ta': 'Tamil', 'te': 'Telugu', 'uk': 'Ukrainian',
            'ur': 'Urdu', 'uz': 'Uzbek'
        };

    constructor(config: RecognitionConfig) {
        this.logger.info('Initializing OpenAI Recognition Driver', { config });
        
        this.validateConfig(config);
        
        this.language = config.lang || OpenAIRecognitionDriver.DEFAULT_LANGUAGE;
        this.apiKey = config.apiKey!;
        this.apiEndpoint = config.apiUrl || this.apiEndpoint;
        this.model = config.model || this.model;
        
        this.commandRegistry = this.createDefaultCommandRegistry();
        this.availableIntents = this.extractAvailableIntents();
        
        this.logger.info('OpenAI Recognition Driver initialized successfully', {
            language: this.language,
            model: this.model,
            intentCount: this.availableIntents.length
        });
    }

    /**
     * Detect intent from input text using OpenAI LLM
     */
    async detectIntent(text: string): Promise<IntentResult[]> {
        this.logger.info('Starting intent detection', { text, language: this.language });
        
        this.validateInput(text);
        
        try {
            const response = await this.makeApiRequest(text);
            const results = await this.parseApiResponse(response);
            
            this.logger.info('Intent detection completed successfully', { 
                resultsCount: results.length,
                intents: results.map(r => r.intent)
            });
            
            return results;
        } catch (error) {
            this.logger.error('Intent detection failed', { error, text });
       
            throw error;
        }
    }

    /**
     * Get available intent types
     */
    getAvailableIntents(): IntentTypes[] {
        return [...this.availableIntents];
    }

    /**
     * Update the command registry
     */
    setCommandRegistry(registry: CommandRegistry): void {
        this.logger.info('Updating command registry', { 
            oldIntentCount: this.availableIntents.length,
            newIntentCount: Object.keys(registry).length
        });
        
        this.commandRegistry = { ...registry };
        this.availableIntents = this.extractAvailableIntents();
    }

    /**
     * Update API endpoint
     */
    setApiEndpoint(endpoint: string): void {
        if (!this.isValidUrl(endpoint)) {
            throw new Error(`Invalid API endpoint: ${endpoint}`);
        }
        
        this.logger.info('Updating API endpoint', { 
            oldEndpoint: this.apiEndpoint, 
            newEndpoint: endpoint 
        });
        
        this.apiEndpoint = endpoint;
    }

    /**
     * Update LLM model
     */
    setModel(modelName: string): void {
        if (!modelName?.trim()) {
            throw new Error('Model name cannot be empty');
        }
        
        this.logger.info('Updating model', { 
            oldModel: this.model, 
            newModel: modelName 
        });
        
        this.model = modelName;
    }

    /**
     * Update language setting
     */
    setLanguage(language: string): void {
        if (!language?.trim()) {
            throw new Error('Language cannot be empty');
        }
        
        this.logger.info('Updating language', { 
            oldLanguage: this.language, 
            newLanguage: language 
        });
        
        this.language = language;
    }

    /**
     * Get current language setting
     */
    getCurrentLanguage(): string {
        return this.language;
    }

    /**
     * Get current model setting
     */
    getCurrentModel(): string {
        return this.model;
    }

    private validateConfig(config: RecognitionConfig): void {        
        if (config.apiUrl && !this.isValidUrl(config.apiUrl)) {
            throw new Error(`Invalid API URL provided: ${config.apiUrl}`);
        }
    }

    private validateInput(text: string): void {
        if (!text?.trim()) {


            
            throw new Error('Input text cannot be empty for intent detection');
        }
    }

    private async makeApiRequest(text: string): Promise<Response> {
        const systemPrompt = this.generateSystemPrompt();
        const userMessage = this.formatUserMessage(text);
        
        const requestBody = {
            model: this.model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage }
            ],
            temperature: OpenAIRecognitionDriver.DEFAULT_TEMPERATURE
        };

        this.logger.debug('Making OpenAI API request', { 
            model: this.model,
            messageLength: userMessage.length
        });

        const response = await fetch(this.apiEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            await this.handleApiError(response);
        }

        return response;
    }

    private async parseApiResponse(response: Response): Promise<IntentResult[]> {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        
        if (!content) {
            throw new Error('Invalid API response: missing content');
        }

        try {
            const cleanedContent = this.cleanJsonResponse(content);
            const results = JSON.parse(cleanedContent);
            
            return this.normalizeResults(results);
        } catch (parseError) {
            this.logger.error('Failed to parse OpenAI response', { 
                error: parseError, 
                rawContent: content 
            });
            throw new Error('Failed to parse intent detection response');
        }
    }

    private async handleApiError(response: Response): Promise<never> {
        try {
            const errorData = await response.json();
            const errorMessage = errorData.error?.message || 'Unknown API error';
            throw new Error(`OpenAI API error (${response.status}): ${errorMessage}`);
        } catch {
            throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
        }
    }

    private normalizeResults(results: any): IntentResult[] {
        console.log('******Normalized results:*******', results);
        if (!Array.isArray(results)) {
            if (results?.intent) {
                return [this.createIntentResult(results)];
            }
            return [this.createUnknownResult()];
        }

        return results.map(result => this.createIntentResult(result));
    }

    private createIntentResult(result: any): IntentResult {
        return {
            intent: result.intent || IntentTypes.UNKNOWN,
            confidence: Math.max(0, Math.min(1, result.confidence || 0)),
            entities: result.entities || {}
        };
    }

    private formatUserMessage(text: string): string {
        return this.language !== OpenAIRecognitionDriver.DEFAULT_LANGUAGE
            ? `Input language: ${this.getLanguageName(this.language)}\nUser command: ${text}`
            : text;
    }

    private generateSystemPrompt(): string {
        if (!this.commandRegistry) return '';

        let systemPrompt = `You are an expert intent classification system for a voice-controlled web UI. Your goal is to analyze user commands and return a structured JSON array of intents and entities.

        The user is speaking in ${this.getLanguageName(this.language)}.

        You must identify intents from the following list..
`;
        Object.entries(this.commandRegistry).forEach(([intentName, config]) => {
        // We skip the UNKNOWN intent as it's not a valid classification target
        if (intentName === IntentTypes.UNKNOWN) return;

        systemPrompt += `
        **Intent: \`${intentName}\`**
        -**Inference guide:** ${config.inferenceGuide}
        -**Example Phrases:** ${config.utterances.map(u => `"${u}"`).join(', ')}
        -**Example Phrases that are mistaken for the intent:** ${config.negative_utterances.map(u => `"${u}"`).join(', ')}
        `;
        });

        const today = new Date().toISOString().split('T')[0];
        systemPrompt += `

        ### Guiding Principle: The Rule of Maximum Specificity ###
        Your most important reasoning task is to select the most specific and descriptive intent that fits the user's command. Do not discard information.

        **Your Rule:** When a user's command could plausibly match more than one intent, you **MUST** choose the intent that accounts for the **most information** provided by the user. An intent that uses more of the user's words to fill its entities is better than one that ignores parts of the command.

        **Example of Applying this Rule:**
        -   **User Command:** "send an email to user Nisal"
        -   **Your Analysis:**
            1.  First, consider a simple intent that only has a 'target' entity. This could match "send an email", but it would have to ignore the crucial phrase "to user Nisal". This is an **error of information loss**.
            2.  Next, look for a more complex intent in your list. Is there an intent that can capture not just the action ("send an email") but also the context it applies to ("user Nisal")?
            3.  You will find an intent with entities for a target (the action), a contextKey (the type of item), and a contextValue (the specific item). This intent accounts for the *entire* user command.
        -   **Your Conclusion:** You must select the more specific intent because it provides a more complete and accurate representation of the user's request.

        -   **Incorrect Output (Loses Information):**
            [{"intent": "click_element", "entities": {"target": "email"}}]  // WRONG - "to user Nisal" is ignored.

        -   **Correct Output (Conserves Information):**
            [{"intent": "CLICK_ELEMENT_IN_CONTEXT", "confidence": 0.95, "entities": {"target": {"english": "send email", ...}, "contextKey": {"english": "user", ...}, "contextValue": "Nisal"}}] // CORRECT - All parts of the command are used.
        `;

        systemPrompt += `
        ### IMPORTANT: Disambiguating Overlapping Intents ###
        Some commands can be ambiguous. Your primary tool for disambiguation is the **main action verb** in the user's command. Prioritize the verb's meaning over the noun's common associations.

        **Example of Disambiguation:**
        -   **Ambiguous User Command:** "go to submit"
        -   **Incorrect Reasoning:** The word "submit" is almost always a button, so the intent must be \`click_element\`. **THIS IS WRONG.**
        -   **Correct Reasoning:** The primary action is "go to". This phrase strongly implies navigation or scrolling. The target of the navigation is "submit". Therefore, the correct intent is \`scroll_to_element\`.

        -   **Your Rule:** When an action verb (like "go to", "scroll to") is present, it defines the intent. The noun that follows is simply the target of that action.

        ### IMPORTANT: Multiple Intent Detection ###
        A single user command can contain MULTIPLE intents. For example:
        - "Fill name with John, email with john@example.com, and phone with 123456" should return 3 separate intents
        - "Click submit and then navigate to home" should return 2 separate intents
        - "My name is Nisal, email is nisal@gmail.com, phone number is 074321, fill those" should return 3 fill intents


        ### IMPORTANT: Implied Intent / Intent Sequence Detection ###
        Sometimes a user's command describes a final goal, not the direct steps to get there. Your task is to infer the logical sequence or a single simple, atomic actions required to achieve that goal.

        ### JSON Response Format Instructions ###
        You MUST respond with a JSON array. Each object in the array represents a detected intent and must contain:
        1. "intent": The identified intent name (e.g., "fill_input").
        2. "confidence": A number from 0 to 1.
        3. "entities": A JSON object of extracted entities.

        ### Entity Extraction Rules ###
        This is the most important rule. How you format entities depends on their type:

        1.  **UI Element Entities (e.g., 'target', 'targetgroup', 'group'):**
            For any entity that represents an element on the webpage (like a button, link, or input field), you MUST return an object with two keys:
            - "english": The English, lowercase, simplified version of the entity. If user speaks it in english, keep it as it is. If not translate it to english.
            - "user_language": The entity translated/expressed in ${this.getLanguageName(this.language)} (the user's configured language). If user speaks it in english, You still need to normalize to  ${this.getLanguageName(this.language)} language. 
            
            IMPORTANT - Mixed Language Handling:
            Even if the user speaks the entity name in mixed-english or similar to english while primarily speaking ${this.getLanguageName(this.language)}, you MUST still provide the proper translation in the user_language field.
            
            Examples:
            - User says "phone number" while speaking Norwegian: 
            {"english": "phone number", "user_language": "telefonnummer"}
            - User says "email" while speaking Spanish:
            {"english": "email", "user_language": "epost"}
            - User says "submit button" while speaking German:
            {"english": "submit", "user_language": "senden"}


        2.  **Value Entities (e.g., 'value', 'direction'):**
            For entities that represent data values:
            - If the value is for typing/entering text: Return exactly as the user said it (preserve original language/form)
            - If the value represents direction, time, or date or other types: Normalize to English and proper format for system processing since I use english word parsing

            Examples:
            - Text to type: "mejor precio" (keep original)
            - Direction: "up", "down", "left", "right", "next", "previous" (normalize to English)
            - Position: "top", "bottom"(normalize to English)
            - Time:  "now", "3pm", "15:30" (normalize to English)
            - Date: "today", "tomorrow", "2025-01-15" (normalize to English and standard format. If only day and month is given, then assume current year from ${today}.)
            - Number: "10", "3.14" (normalize to digit format)
            - Currency: "100 dollars", "50 euros" (normalize to English currency format)
            - Percentage: "20 percent" (normalize to English percentage format)
            - Email: "user@example.com" (normalize to English email format)
            - Phone: "123-456-7890" (normalize to English phone format)
            - URL: "https://example.com" (normalize to English URL format)
            
            IMPORTANT - Contextual Normalization:
            - Consider the context of the command (The related UI element Entity) to determine how to normalize values.
            Example: -"Enter phone number as 1,2 3 note double two"  but since the context is a phone number, normalize it to "12322".
                     - "Fill email as user at user.gmail.com" but since the context is an email, normalize it to "user@example.com".
            IMPORTANT - Mixed Language Handling:
            if value is in mixed languages you MUST normalize the entire value to the appropriate format because those are transcription issues.

        ### Multiple Intent Example ###
        User command: "My name is Nisal, email is nisal@gmail.com, phone number is 074321, fill those"
        (Assuming user's configured language is English)

        Your JSON response should be:
        [
        {
            "intent": "fill_input",
            "confidence": 0.95,
            "entities": {
            "target": {
                "english": "name",
                "user_language": "name"
            },
            "value": "Nisal"
            }
        },
        {
            "intent": "fill_input",
            "confidence": 0.95,
            "entities": {
            "target": {
                "english": "email",
                "user_language": "email"
            },
            "value": "nisal@gmail.com"
            }
        },
        {
            "intent": "fill_input",
            "confidence": 0.95,
            "entities": {
            "target": {
                "english": "phone",
                "user_language": "phone number"
            },
            "value": "074321"
            }
        }
        ]

        ### IMPORTANT: Retaining context for multiple intents ###
        When multiple intents appear in one command, carry forward relevant context instead of treating them as separate, unrelated actions.

        **Your Rule:** Later intents should inherit context (like a target or UI element) from earlier parts of the same command when clearly implied.

        Examples:
        - User says: “Open doctor list and select Doctor Lee.” → The system must understand that “select Doctor Lee” happens within the opened doctor list dropdown, not globally.

        ## IMPORTANT: Interpreting non-specific dates
        Convert natural-language, non-specific date expressions (e.g., "last week", "yesterday", "last month", "set start date to last month") into precise, machine-readable date values or date ranges. If only day and month are provided assume the current year from ${today}.

        **Your Rules:**
        - Use the ${today} as the baseline for all relative calculations.
        - For ambiguous relative expressions, prefer calendar boundaries (week/month) rather than fixed-day offsets. Do NOT treat "last week" as "7 days ago" or "last month" as "30 days ago".
        - Week definitions: The first day of the week
        - Month definitions: Use calendar months (start = first day of the month, end = last day of that month).

        ### IMPORTANT: Interpreting Spelling and Formatting Corrections ###
        The input you receive is a raw Speech-to-Text transcript. The user may see a transcription error on their screen and try to correct it by giving spelling or formatting instructions. Your first job is to correctly interpret these instructions to reconstruct the user's true intended text.

        **Your Rule:** When you detect a spelling or formatting command (e.g., "with a capital letter...", "with an 'N'"), you MUST apply this correction to the immediately preceding word. Then, use the *reconstructed* word for intent and entity extraction.

        **Examples of Spelling/Formatting Corrections to Resolve:**

        - **User Command:** "Enter name as misal with an N"
        - **Your Interpretation:** The user saw "misal" transcribed but meant "Nisal". The phrase "with an N" is a spelling instruction.
        - **Correct Value to Extract:** "Nisal"

        - **User Command:** "The company is realx with a capital X"
        - **Your Interpretation:** The user wants the 'x' and only the 'x' in "realx" to be capitalized.
        - **Correct Value to Extract:** "realX"

        - **User Command:** "Set the password to password one two three with a capital P"
        - **Your Interpretation:** The user is specifying the capitalization of the word "password".
        - **Correct Value to Extract:** "Password123"

        - **User Command:** "The city is londan, replace 'a' with 'o'"
        - **Your Interpretation:** The user is directly correcting a character in the preceding word.
        - **Correct Value to Extract:** "london"

        Essentially, you must mentally "fix" the transcript based on these meta-instructions *before* you proceed with your main task of identifying intents and entities.


        ### Final Instruction ###
        Analyze the user's command carefully, identify ALL intents present in the command, apply these rules, and return ONLY the raw JSON array. Do not include any markdown formatting like \`\`\`json or explanations.`;

        return systemPrompt;
    }

    private buildLanguageInstruction(): string {
        return this.language !== OpenAIRecognitionDriver.DEFAULT_LANGUAGE
            ? `The user input will be in ${this.getLanguageName(this.language)}. You should understand the meaning of the input in that language and match it to the appropriate English command intents listed below. Focus on the semantic meaning rather than exact word matching.\n\n`
            : '';
    }

    private buildIntentCategories(): string {
        const validIntents = this.availableIntents.filter(i => i !== IntentTypes.UNKNOWN);
        return `You have access to the following intent categories: ${validIntents.join(', ')}.`;
    }

    private buildEntityInstructions(): string {
        let instructions = '\nFor each intent category, here are the types of entities you should look for:\n';
        
        Object.entries(this.commandRegistry).forEach(([intentName, config]) => {
            if (intentName === IntentTypes.UNKNOWN) return;
            
            instructions += `\nIntent: ${intentName}
Expected entities: ${config.entities.join(', ')}
Purpose: Use your understanding to determine if the user's input semantically matches this intent type for web UI interaction.`;
        });
        
        return instructions;
    }

    private buildMultilingualInstructions(): string {
        return this.language !== OpenAIRecognitionDriver.DEFAULT_LANGUAGE
            ? `\n\nIMPORTANT MULTILINGUAL PROCESSING:
- The user input is in ${this.getLanguageName(this.language)}
- Use your language understanding capabilities to interpret the semantic meaning
- Match the meaning to the most appropriate English intent categories
- Extract entities based on semantic understanding, not literal translation
- Normalize target/group entities to clear English descriptions
- Normalize directional entities to English cardinal directions (e.g., "left", "right", "up", "down")
- Normalize numeric, date, and time entities to standard English format
- Preserve input values as-is when they represent user data`
            : '';
    }

    private buildClassificationInstructions(): string {
        // MODIFICATION IS HERE
        return `INSTRUCTIONS FOR INTENT CLASSIFICATION:
You have full autonomy to interpret user commands. Use your understanding of:
- Natural language semantics and context
- Web UI interaction patterns
- User intent behind different phrasings
- Command variations and synonyms
- Multi-step or compound commands

Don't rely on exact phrase matching - use your intelligence to understand what the user wants to accomplish on a web interface.

CRITICAL RULE FOR 'target' and 'group' ENTITY EXTRACTION:
When extracting a 'target' or 'group' entity, you MUST use the most complete and descriptive noun phrase from the user's command that identifies the UI element.
The system has its own powerful downstream matching logic. Your role is to provide it with the most accurate and verbose text possible.
Do NOT simplify, generalize, or guess a different name for the target. Extract the text as spoken by the user.
Example for "the preferred date is today":
- GOOD: { "target": "preferred date" }
- BAD: { "target": "date field" }
Example for "click the big red save button":
- GOOD: { "target": "big red save button" }
- BAD: { "target": "save button" }

Respond with a JSON array containing multiple intents in order of likelihood or relevance. Each intent should be a JSON object containing:
1. "intent": The identified intent name (use "unknown" only if genuinely unclear)
2. "confidence": A number between 0 and 1 indicating your confidence level
3. "entities": An object with extracted entity values as key-value pairs

Example response for "click the submit button and then go back":
[
  {
    "intent": "click_element",
    "confidence": 0.95,
    "entities": {
      "target": "submit button"
    }
  },
  {
    "intent": "navigate",
    "confidence": 0.85,
    "entities": {
      "direction": "back"
    }
  }
]

Use your full language understanding capabilities to interpret user intent, even for:
- Colloquial expressions
- Implied actions
- Context-dependent commands
- Creative or unusual phrasings
- Commands with missing explicit targets

IMPORTANT: Return ONLY the raw JSON array without any markdown formatting, code blocks, or backticks. Do not wrap the JSON in \`\`\` or any other formatting.`;
    }

    private getLanguageName(langCode: string): string {
        return OpenAIRecognitionDriver.LANGUAGE_NAMES[langCode] || langCode.toUpperCase();
    }

    private cleanJsonResponse(content: string): string {
        const cleaned = content.trim();
        const codeBlockRegex = /^```(?:json)?\s*([\s\S]*?)```$/;
        const match = cleaned.match(codeBlockRegex);
        
        return match ? match[1].trim() : cleaned;
    }

    private createUnknownResult(): IntentResult {
        return {
            intent: IntentTypes.UNKNOWN,
            confidence: 0,
            entities: {}
        };
    }

    private createDefaultCommandRegistry(): CommandRegistry {
        return {
            [IntentTypes.CLICK_ELEMENT]: {
                // description:"Clicking an element directly. Button can be a simple action(Ex: send, edit, cancel transaction etc:)",
                utterances: ["click (target)", "press (target)", "tap (target)"],
                negative_utterances: ["go to (target)"],
                entities: ["target"]
            },
            [IntentTypes.FILL_INPUT]: {
                // description:"Filling an input with some value, if a value is not specified, then nothing to fill.",
                utterances: [
                    "(target) is (value)",
                    "Fill (target) as (value)",
                    "Enter (target) as (value)",
                    "Enter (target) with (value)",
                    "Fill (target) with (value)"
                ],
                negative_utterances: ["edit (target)"],
                entities: ["target", "value"]
            },
            [IntentTypes.SCROLL]: {
                // description:"Just navigate through the page.",
                utterances: ["scroll (direction)", "scroll to (direction)", "go (direction)"],
                negative_utterances: [],
                entities: ["direction"]
            },
            [IntentTypes.SCROLL_TO_ELEMENT]: {
                // description:"Navigate to a certain element.",
                utterances: ["scroll to (target)", "go to (target) section"],
                negative_utterances: [],
                entities: ["target"]
            },

            [IntentTypes.CHECK_CHECKBOX]: {
                // description:"Check check boxes.",
                utterances: [
                    "check (target)",
                    "select (target) checkbox",
                    "tick (target)",
                    "enable (target) option"
                ],
                negative_utterances: [],
                entities: ["target"]
            },

            [IntentTypes.UNCHECK_CHECKBOX]: {
                // description:"Unheck check boxes.",
                utterances: [
                    "uncheck (target)",
                    "deselect (target) checkbox",
                    "untick (target)",
                    "disable (target) option"
                ],
                negative_utterances: [],
                entities: ["target"]
            },

            [IntentTypes.CHECK_ALL]: {
                // description:"Check all check boxes under a group.",
                utterances: [
                    "check all (targetGroup)",
                    "select all (targetGroup)"
                ],
                negative_utterances: [],
                entities: ["targetGroup"]
            },

            [IntentTypes.UNCHECK_ALL]: {
                // description:"Uncheck all check boxes under a group.",
                utterances: [
                    "uncheck all (targetGroup)",
                    "deselect all (targetGroup)",
                    "uncheck (target) in (group)",
                    "deselect (target) in (group)"
                ],
                negative_utterances: [],
                entities: ["targetGroup", "target", "group"]
            },

            [IntentTypes.SELECT_RADIO_OR_DROPDOWN]: {
                // description:"Select a certain option from a dropdown or a radiobutton",
                utterances: [
                    //"select (group) in (target)",
                    "select (target) in (group)",
                    "choose (target) in (group)",
                    "pick (target) in (group)",
                    "select (target)",
                    "choose (target)",
                    "pick (target)"
                ],
                negative_utterances: [],
                entities: ["target", "group"]
            },

            [IntentTypes.OPEN_DROPDOWN]: {
                // description:"Open a dropdown list",
                utterances: [
                    "Open (target)",
                    "Drop down (target)",
                    "Open (target) drop down",
                ],
                negative_utterances: [],
                entities: ["target"]
            },

            [IntentTypes.GO_BACK]: {                
                // description:"Go back to previous page",
                utterances: [
                    "Go Back"
                ],
                negative_utterances: [],
                entities: []
            },

            [IntentTypes.ZOOM]: {
                // description:"Zoom in to/out of the current area of the page",
                utterances: [
                    "Zoom (direction)",
                    "Go (direction)"
                ],
                negative_utterances: [],
                entities: ["direction"]
            },

            [IntentTypes.UNDO]: {
                // description:"Undo the previous action carried out by the system"
                utterances: [
                    "Undo action"
                ],
                negative_utterances: [],
                entities: []
            },

            [IntentTypes.UNDO_TARGET]: {
                // description:"Undo the previous action carried out by the system"
                utterances: [
                    "Undo (target)",
                    "Undo (target) in (group)"
                ],
                negative_utterances: [],
                entities: ["target", "group"]
            },

            [IntentTypes.CLICK_ELEMENT_IN_CONTEXT]: {
            // description:"Clicking on an element under a context, probably in a table. The target button is most probably an action(verb).",
            utterances: [
                "(target) for (contextKey) (contextValue)",
                "(target) the (contextKey) (contextValue)",
                "Click the (target) for the (contextValue) (contextKey)",
            ],
            negative_utterances: [],
            entities: ["target", "contextKey", "contextValue"],
            inferenceGuide:`
            Example : "Edit name Nisal"
            Edit is an action verb that does not match any other intent so there should be a button for it (if it's not completetly unhinged). And the type of action (modification, retrieval, etc.) does not matter. And since they mention Nisal is a name, that means Nisal is one of many names in the page, so there is a context`
        },
        };
    }

    private extractAvailableIntents(): IntentTypes[] {
        const intents = Object.keys(this.commandRegistry) as IntentTypes[];
        
        if (!intents.includes(IntentTypes.UNKNOWN)) {
            intents.push(IntentTypes.UNKNOWN);
        }
        
        return intents;
    }

    private isValidUrl(url: string): boolean {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }
}