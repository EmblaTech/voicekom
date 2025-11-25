import { EventBus, SpeechEvents } from '../common/eventbus';
import { IntentResult, Entities, Action, IntentTypes, IVoiceActuator,isVoiceEntity, VoiceEntity, EntityValue } from '../types';
import * as chrono from 'chrono-node';
import { Logger } from '../utils/logger';
import { unsubscribe } from 'diagnostics_channel';

// Interface for processed entities with resolved DOM elements
export interface ProcessedEntities {
  rawentities: Entities;
  targetElement?: HTMLElement | HTMLInputElement | HTMLTextAreaElement | undefined;
  targetElements?: HTMLElement[];
  groupElement?: HTMLElement | undefined;
  targetName?: string | undefined; // Normalized value for input actions
}

// Interface for element processing strategies
interface ElementProcessor {
  canProcess(intent: string, entities: Entities): boolean;
  process(entities: Entities): Partial<ProcessedEntities>;
}

// Interface for value normalizers
interface ValueNormalizer {
  canNormalize(element: HTMLElement, value: string): boolean;
  normalize(element: HTMLElement, value: string): string;
}

// Added by me - to keep a record of action history and target
interface HistoryEntry {
  target: any,
  undoFn: () => void;
}

export class VoiceActuator implements IVoiceActuator {
  // Added by me - to keep a record of action history
  // private historyStack: (() => void)[] = [];
  private historyStack: HistoryEntry[] = [];

  private actionMap!: Map<IntentTypes, Action>;
  private elementProcessors: ElementProcessor[] = [];
  private valueNormalizers: ValueNormalizer[] = [];
  private logger = Logger.getInstance();

  // Added by me - variable for current zoom level
  private currentZoom = 1;

  constructor(private eventBus: EventBus) {
    this.initializeProcessors();
    this.initializeNormalizers();
    this.initializeActionMap();
  }

  private initializeProcessors(): void {
    // Register element processors in order of priority
    this.elementProcessors = [
      new ContextualElementProcessor(this, this.logger),
      new GroupedTargetProcessor(this),
      new MultipleTargetProcessor(this),
      new SingleTargetProcessor(this),
    ];
  }

  private initializeNormalizers(): void {
    this.valueNormalizers = [
      new EmailNormalizer(),
      new DateNormalizer(),
      new TimeNormalizer(),
      new NumericNormalizer()
    ];
  }

  private initializeActionMap(): void {
    this.actionMap = new Map<IntentTypes, Action>();
    this.registerAction(IntentTypes.CLICK_ELEMENT, { execute: (entities) => this.executeElementAction(entities, 'click')});
    this.registerAction(IntentTypes.FILL_INPUT, { execute: (entities) => this.executeInputAction(entities)});
    this.registerAction(IntentTypes.SCROLL_TO_ELEMENT, { execute: (entities) => this.executeScrollToElementAction(entities)});
    this.registerAction(IntentTypes.SCROLL, { execute: (entities) => this.executeScrollAction(entities)});
    this.registerAction(IntentTypes.CHECK_CHECKBOX, { execute: (entities) => this.executeCheckboxAction(entities, true)});
    this.registerAction(IntentTypes.UNCHECK_CHECKBOX, { execute: (entities) => this.executeCheckboxAction(entities, false)});
    this.registerAction(IntentTypes.CHECK_ALL, { execute: (entities) => this.executeMultipleCheckboxAction(entities, true)});
    this.registerAction(IntentTypes.UNCHECK_ALL, { execute: (entities) => this.executeMultipleCheckboxAction(entities, false)});
    this.registerAction(IntentTypes.SELECT_RADIO_OR_DROPDOWN, { execute: (entities) => this.executeSelectionAction(entities)});
    this.registerAction(IntentTypes.OPEN_DROPDOWN, { execute: (entities) => this.executeOpenDropdownAction(entities)});
    this.registerAction(IntentTypes.GO_BACK, { execute: (entities) => this.executeGoBackAction(entities)});
    this.registerAction(IntentTypes.TYPE_TEXT, { execute: (entities) => this.executeInputAction(entities) });
    this.registerAction(IntentTypes.CLICK_ELEMENT_IN_CONTEXT, { execute: (entities) => this.executeTableClickAction(entities) });

    // Add zoom in and zoom out actions (see if it can be handled in the same function as scroll)
    this.registerAction(IntentTypes.ZOOM, { execute: (entities) => this.executeZoomAction(entities)});
    this.registerAction(IntentTypes.UNDO, { execute: () => this.executeUndoAction()});
    this.registerAction(IntentTypes.UNDO_TARGET, { execute: (entities) => { const target = entities.rawentities?.target as any; return this.executeUndoTargetAction(target)}});
    this.registerAction(IntentTypes.SEARCH_ELEMENT, { execute: (entities) => this.executeSearchELementAction(entities)}); // using the fill function
  }
  
  private registerAction(intentName: IntentTypes, action: Action): void {
    this.actionMap.set(intentName, action);
  }

  private processEntities(intent: string, entities: Entities): ProcessedEntities {
    let processedEntities: ProcessedEntities =  {
        rawentities: { ...entities } // Create a shallow copy to avoid mutating the original input
      };
    // Apply element processors
    for (const processor of this.elementProcessors) {
      if (processor.canProcess(intent, entities)) {
        const processed = processor.process(entities);
        processedEntities = { ...processedEntities, ...processed };
        break; // Use first matching processor
      }
      
    }
    
    // Apply value normalization if needed
    if (entities.value && processedEntities.targetElement && intent === IntentTypes.FILL_INPUT) {
      for (const normalizer of this.valueNormalizers) {
        if (normalizer.canNormalize(processedEntities.targetElement, entities.value as string)) {
          processedEntities.rawentities.value = normalizer.normalize(processedEntities.targetElement, entities.value as string);
          break;
        }
      }
    }

    return processedEntities;
  }

  /**
   * Process an array of intents sequentially
   */
  public async performAction(intents: IntentResult[]): Promise<boolean> {
    if (!intents || intents.length === 0) {
      console.log('VoiceActuator: No intents provided');
      return false;
    }

    let allSuccessful = true;
    
    for (const intent of intents) {
      const success = await this.executeIntent(intent);
      if (!success) {
        allSuccessful = false;
      }
    }
    
    return allSuccessful;
  }

  private async executeIntent(intent: IntentResult): Promise<boolean> {
    const action = this.actionMap.get(intent.intent);

    if (!action) {
      this.logger.debug(`[VoiceActuator] : No action registered for intent ${intent.intent}`);
      this.eventBus.emit(SpeechEvents.ACTION_PAUSED);
      return false;
    }
    
    const processedEntities = this.processEntities(intent.intent, intent.entities || {});
    const result = action.execute(processedEntities);
    
    if (result) {
      this.eventBus.emit(SpeechEvents.ACTION_PERFORMED, {
        intent: intent.intent,
        entities: intent.entities
      });
    } else {
      this.eventBus.emit(SpeechEvents.ACTION_PAUSED);
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
    return result;
  }

  // public findElement(targetName: string, context?: HTMLElement): HTMLElement | null {
  //   const selector = context ?
  //     context.querySelectorAll('[voice\\.name]') :
  //     document.querySelectorAll('[voice\\.name]');
  //   if (selector.length === 0) return null;
  //   const scoredElements = Array.from(selector)
  //     .filter(element => element instanceof HTMLElement)
  //     .map(element => ({
  //       element: element as HTMLElement,
  //       score: this.calculateMatchScore(
  //         element.getAttribute('voice.name') || '',
  //         targetName.toLowerCase()
  //       ),
  //       voiceName: element.getAttribute('voice.name') || ''
  //     }))
  //     .filter(item => item.score > 0)
  //     .sort((a, b) => b.score - a.score);
  //   if (scoredElements.length > 0) {
  //     const bestMatch = scoredElements[0];
  //     return bestMatch.element;
  //   }
  //   return null;


public findElement(
  targetName: string,
  context?: HTMLElement
): { element: HTMLElement; score: number } | null {

  // List of targets that should use the entire document
  const globalTargets = ["reports", "billing", "research", "appointments", "help", "delete", "discard"];

  //const root = context || document // Added by me to find tab
  const root = globalTargets.includes(targetName.toLowerCase()) ? document : (context || document);
  const selector = root.querySelectorAll('[voice\\.name]');

  // const selector = context
  //   ? context.querySelectorAll('[voice\\.name]')
  //   : document.querySelectorAll('[voice\\.name]');

  this.logger.debug(`[VoiceActuator] : Found ${selector.length} elements with voice.name attributes`);

  if (selector.length === 0) return null;

  const scoredElements = Array.from(selector)
    .filter(element => element instanceof HTMLElement)
    .map(element => ({
      element: element as HTMLElement,
      score: this.calculateMatchScore(
        element.getAttribute('voice.name')?.toLowerCase() || '',
        targetName.toLowerCase()
      ),
      voiceName: element.getAttribute('voice.name') || ''
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scoredElements.length > 0) {
    const bestMatch = scoredElements[0];
    this.logger.info(`[VoiceActuator]  Selected best match "${bestMatch.voiceName}" with score ${bestMatch.score}`);
    return { element: bestMatch.element, score: bestMatch.score };
  }

  return null;
}

public findFinalTarget(entity: VoiceEntity, context?: HTMLElement): HTMLElement | undefined {
    const candidates = [entity.english, entity.user_language];
    const bestResult = candidates
        .map(candidate => this.findElement(candidate, context))
        .filter(result => result !== null)
        .reduce((best, current) => 
          current && current.score > best.score ? current : best
        );

    this.logger.info(`[VoiceActuator]  Best match for "${entity.english}" is "${bestResult?.element.getAttribute('voice.name')}" with score ${bestResult?.score}`);
    return bestResult?.element || undefined;
}

  public findElementsInGroup(groupName: string): HTMLElement[] {
    return Array.from(document.querySelectorAll(`[name="${groupName}"]`));
  }

  /**
   * Calculates the Longest Common Subsequence of tokens.
   */
  private calculateTokenLCS(tokens1: string[], tokens2: string[]): number {
    const m = tokens1.length;
    const n = tokens2.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (tokens1[i - 1] === tokens2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }
    return dp[m][n];
  }

  public calculateMatchScore(voiceName: string, targetName: string): number {
    const normalize = (str: string) =>
      str.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);

    const voiceNameNormalized = voiceName.toLowerCase();
    const targetNameNormalized = targetName.toLowerCase();

    const voiceTokens = normalize(voiceName);
    const targetTokens = normalize(targetName);

    if (voiceTokens.length === 0 || targetTokens.length === 0) return 0;

    let score = 0;

    // 1. Exact match bonus (highest weight)
    if (voiceNameNormalized === targetNameNormalized) {
      score += 100;
    }

    // 2. Contained Phrase Bonus (addresses substring bias)
    // Matches "save" within "save as" but not as a partial word
    if ((' ' + voiceNameNormalized + ' ').includes(' ' + targetNameNormalized + ' ')) {
      score += 40;
    }

    // 3. Token Overlap Score (Jaccard-like, order-agnostic)
    const matchingTokens = voiceTokens.filter(vToken => targetTokens.includes(vToken));
    const unionSize = new Set([...voiceTokens, ...targetTokens]).size;
    if (unionSize > 0) {
      score += (matchingTokens.length / unionSize) * 30;
    }

    // 4. Token Order Score (LCS) - crucial for multi-word commands
    const lcsLength = this.calculateTokenLCS(voiceTokens, targetTokens);
    const maxLen = Math.max(voiceTokens.length, targetTokens.length);
    if (maxLen > 0) {
      score += (lcsLength / maxLen) * 50;
    }

    // 5. Proximity/Typo Score (Levenshtein on full strings)
    score += this.getLevenshteinSimilarity(voiceNameNormalized, targetNameNormalized) * 20;

    return score;
  }
  
  private getLevenshteinSimilarity(str1: string, str2: string): number {
    const track = Array(str2.length + 1).fill(null).map(() =>
      Array(str1.length + 1).fill(null));
    
    for (let i = 0; i <= str1.length; i += 1) track[0][i] = i;
    for (let j = 0; j <= str2.length; j += 1) track[j][0] = j;
    
    for (let j = 1; j <= str2.length; j += 1) {
      for (let i = 1; i <= str1.length; i += 1) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        track[j][i] = Math.min(
          track[j][i - 1] + 1,
          track[j - 1][i] + 1,
          track[j - 1][i - 1] + indicator,
        );
      }
    }
    
    const distance = track[str2.length][str1.length];
    const maxLength = Math.max(str1.length, str2.length);
    return maxLength > 0 ? 1 - (distance / maxLength) : 1;
  }

  /* GENERALIZED ACTION EXECUTORS */

  private executeElementAction(entities: ProcessedEntities, actionType: string): boolean {
    if (!entities.rawentities.target || !entities.targetElement) {
      this.logger.warn(`[VoiceActuator]  No valid target for ${actionType} action`);
      return false;
    }

    switch (actionType) {
      case 'click':
        entities.targetElement.click();
        this.logger.info(`[VoiceActuator]  Clicked element:`, entities.targetElement);
        break;
      case 'scroll':
        entities.targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        this.logger.info(`[VoiceActuator]  Scrolled to element:`, entities.targetElement);
        break;
    }
    return true;
  }

  private executeInputAction(entities: ProcessedEntities): boolean {
    if (!entities.rawentities.value || !entities.targetElement) {
      this.logger.warn(`[VoiceActuator]  Missing required parameters for input action`);
      return false;
    }
  
    const el = entities.targetElement;
    if (entities.targetElement instanceof HTMLInputElement || 
        entities.targetElement instanceof HTMLTextAreaElement) {
      const inputEl = el as HTMLInputElement | HTMLTextAreaElement
      const previousValue = inputEl.value;
      const newValue = entities.rawentities.value as string;

      inputEl.value = newValue;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      // entities.targetElement.value = entities.rawentities.value as string;
      // entities.targetElement.dispatchEvent(new Event('input', { bubbles: true }));
      // entities.targetElement.dispatchEvent(new Event('change', { bubbles: true }));

      this.historyStack.push({
        target: entities.rawentities.target as string,
        undoFn: () => {
          // Defensive: check element still in DOM and is still an input/textarea
          inputEl.value = previousValue;
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });

      this.logger.info(`[VoiceActuator]  Filled input "${entities.rawentities.target}" with value "${entities.rawentities.value as string}"`);
      return true;
    }

    this.logger.warn(`[VoiceActuator]  Target element is not an input or textarea`);
    return false;
  }

  private executeSearchELementAction(entities: ProcessedEntities): boolean {
    if (!entities.rawentities.value || !entities.targetElement) {
      this.logger.warn(`[VoiceActuator]  Missing required parameters for input action`);
      return false;
    }
  
    const el = entities.targetElement;
    if (entities.targetElement instanceof HTMLInputElement || 
        entities.targetElement instanceof HTMLTextAreaElement) {
      const inputEl = el as HTMLInputElement | HTMLTextAreaElement
      const previousValue = inputEl.value;
      const newValue = entities.rawentities.value as string;

      inputEl.value = newValue;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));

      this.historyStack.push({
        target: entities.rawentities.target as string,
        undoFn: () => {
          // Defensive: check element still in DOM and is still an input/textarea
          inputEl.value = previousValue;
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });

      this.logger.info(`[VoiceActuator]  Filled input "${entities.rawentities.target}" with value "${entities.rawentities.value as string}"`);
      return true;
    }

    this.logger.warn(`[VoiceActuator]  Target element is not an input or textarea`);
    return false;
  }

  private executeCheckboxAction(entities: ProcessedEntities, check: boolean): boolean {
    if (!entities.rawentities.target || !entities.targetElement) {
      this.logger.warn(`[VoiceActuator]  No valid target for checkbox action`);
      return false;
    }
    
    const el = entities.targetElement;
    if (entities.targetElement instanceof HTMLInputElement && entities.targetElement.type === 'checkbox') {
      const inputState = el as HTMLInputElement
      const previousState = inputState.checked;
      
      // if (entities.targetElement.checked !== check) {
      //   entities.targetElement.checked = check;
      //   entities.targetElement.dispatchEvent(new Event('change', { bubbles: true }));
      // }
      if (inputState.checked !== check) {
        inputState.checked = check;
        inputState.dispatchEvent(new Event('change', { bubbles: true }));
      }

      this.historyStack.push({
        target: entities.rawentities.target as string,
        undoFn: () => {
          inputState.checked = previousState;
          inputState.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });

      this.logger.info(`[VoiceActuator]  ${check ? 'Checked' : 'Unchecked'} checkbox "${entities.rawentities.target}"`);
      return true;
    }

    this.logger.warn(`[VoiceActuator]  Target element is not a checkbox`);
    return false;
  }

  private executeMultipleCheckboxAction(entities: ProcessedEntities, check: boolean): boolean {
    if (!entities.targetElements || entities.targetElements.length === 0) {
      this.logger.warn(`[VoiceActuator]  No targets for multiple checkbox action`);
      return false;
    }
    
    let success = false;
    for (const element of entities.targetElements) {
      if (element instanceof HTMLInputElement && element.type === 'checkbox') {
        if (element.checked !== check) {
          element.checked = check;
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }
        success = true;
      }
    }
    
    return success;
  }

  private executeSelectionAction(entities: ProcessedEntities): boolean {
    if (!entities.targetElement) {
      this.logger.warn(`[VoiceActuator]  No valid target for selection action`);
      return false;
    } else if (!entities.targetName) { //replaced entities.targetName with rawentities.target
      this.logger.warn(`[VoiceActuator]  No valid option for selection action`);
      return false;
    }

    // Handle dropdown
    if (entities.groupElement instanceof HTMLSelectElement ) {
      return this.selectInDropdown(entities.groupElement, entities.targetName);
    }
    
    // Handle radio button
    if (entities.targetElement instanceof HTMLInputElement && entities.targetElement.type === 'radio') {
      if (!entities.targetElement.checked) {
        entities.targetElement.checked = true;
        entities.targetElement.dispatchEvent(new Event('change', { bubbles: true }));
      }
      this.logger.info(`[VoiceActuator]  Selected radio button "${entities.targetName}"`);
      return true;
    }

    this.logger.warn(`[VoiceActuator]  Invalid selection context`);
    return false;
  }

  private executeOpenDropdownAction(entities: ProcessedEntities): boolean {
    if (!entities.rawentities.target || !entities.targetElement) {
      this.logger.warn(`[VoiceActuator]  No valid target for open dropdown action`);
      return false;
    }

    const element = entities.targetElement;

    // Handle native select
    if (element instanceof HTMLSelectElement) {
      element.focus();
      element.click();
      // Force open with size attribute
      element.size = element.options.length;
      setTimeout(() => element.size = 1, 5000);
      return true;
    }

    // Handle custom dropdowns - look for trigger within element
    const trigger = element.querySelector('[aria-expanded], button, [role="button"]') || element;
    
    (trigger as HTMLElement).focus();
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    this.logger.info(`[VoiceActuator]  Opened dropdown "${entities.rawentities.target}"`);
    return true;
  }

  private selectInDropdown(selectElement: HTMLSelectElement, targetName: string): boolean {
    const options = Array.from(selectElement.options);
    const targetLower = targetName.toLowerCase();
    
    for (const option of options) {
      const optionText = option.textContent?.toLowerCase() || '';
      const optionValue = option.value.toLowerCase();
      
      if (optionText === targetLower || 
          optionValue === targetLower ||
          optionText.includes(targetLower) || 
          this.calculateMatchScore(optionText, targetLower) > 60) { // original=50
        
        selectElement.value = option.value;
        selectElement.dispatchEvent(new Event('change', { bubbles: true }));
        this.logger.info(`[VoiceActuator]  Selected dropdown option "${option.textContent}"`);
        return true;
      }
    }

    this.logger.warn(`[VoiceActuator]  No matching option found for "${targetName}"`);
    return false;
  }

  private executeZoomAction(entities: ProcessedEntities): boolean {
  if (!entities.rawentities.direction) {
    this.logger.warn(`[VoiceActuator]  Missing direction parameter for zoom action`);
    return false;
  }

  const zoomStep = 0.1; // zoom increment (10%)
  const direction = (isVoiceEntity(entities.rawentities.direction) 
    ? entities.rawentities.direction.english
    : entities.rawentities.direction).toLowerCase();

  try {
    switch (direction) {
      case 'in':
        this.currentZoom += zoomStep;
        break;
      case 'out':
        this.currentZoom = Math.max(0.5, this.currentZoom - zoomStep); // limit zoom out to 50%
        break;
      default:
        this.logger.warn(`[VoiceActuator]  Unknown zoom direction "${direction}"`);
        return false;
    }

    // Apply zoom using CSS zoom property (compatible with most browsers)
    document.body.style.zoom = this.currentZoom.toString();

    this.logger.info(`[VoiceActuator]  Zoomed ${direction} by ${Math.round(this.currentZoom * 100)}%`);
    return true;
    } catch (error) {
    this.logger.error(`[VoiceActuator]  Error during zoom action: ${error}`);
    return false;
  }
}

  private executeUndoAction(): boolean {
    const entry = this.historyStack.pop();

    if (!entry) {
      this.logger.warn("No undo actions available")
          return false;
    }

    entry.undoFn();
    return true;
  }

  private executeUndoTargetAction(target: any): boolean {
    const index = this.historyStack.map(e => e.target.english).lastIndexOf(target.english);
    if (index === -1) {
      this.logger.warn(`No undo actions available for target: ${target}`);
      return false;
    }

    const entry = this.historyStack.splice(index, 1)[0];
    entry.undoFn();
    return true;
  }


  private executeScrollAction(entities: ProcessedEntities): boolean {
  if (!entities.rawentities.direction) {
    this.logger.warn(`[VoiceActuator]  Missing direction parameter for scroll action`);
    return false;
  }

  const scrollAmount = 300; // pixels to scroll
  const direction = (isVoiceEntity(entities.rawentities.direction) 
    ? entities.rawentities.direction.english
    : entities.rawentities.direction).toLowerCase();

  try {
    switch (direction) {
      case 'up':
        window.scrollBy(0, -scrollAmount);
        break;
      case 'down':
        window.scrollBy(0, scrollAmount);
        break;
      case 'left':
        window.scrollBy(-scrollAmount, 0);
        break;
      case 'right':
        window.scrollBy(scrollAmount, 0);
        break;
      case 'top':
        window.scrollTo(0, 0);
        break;
      case 'bottom':
        window.scrollTo(0, document.body.scrollHeight);
        break;
      default:
        console.log(`VoiceActuator: Unknown scroll direction "${direction}"`);
        return false;
    }

    this.logger.info(`[VoiceActuator]  Scrolled ${direction}`);
    return true;
  } catch (error) {
    this.logger.error(`[VoiceActuator]  Error during scroll action: ${error}`);
    return false;
  }
}

private executeScrollToElementAction(entities: ProcessedEntities): boolean {
  if (!entities.rawentities.target || !entities.targetElement) {
    this.logger.warn(`[VoiceActuator]  Missing target parameter for scroll to element action`);
    return false;
  }

  try {
    // Check if element is already in view
    const rect = entities.targetElement.getBoundingClientRect();
    const isInView = rect.top >= 0 && 
                     rect.left >= 0 && 
                     rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) && 
                     rect.right <= (window.innerWidth || document.documentElement.clientWidth);

    if (isInView) {
      // Element is already in view - focus and click it
      if (entities.targetElement instanceof HTMLElement) {
        // Focus the element if it's focusable
        if (entities.targetElement.tabIndex >= 0 || 
            entities.targetElement instanceof HTMLInputElement ||
            entities.targetElement instanceof HTMLTextAreaElement ||
            entities.targetElement instanceof HTMLSelectElement ||
            entities.targetElement instanceof HTMLButtonElement ||
            entities.targetElement instanceof HTMLAnchorElement) {
          entities.targetElement.focus();
        }
        
        // Click the element
        entities.targetElement.click();
        this.logger.info(`[VoiceActuator]  Element "${entities.rawentities.target}" was in view - focused and clicked`);
      }
    } else {
      // Element not in view - scroll to it
      entities.targetElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest'
      });

      // Focus the element if it's focusable
      if (entities.targetElement instanceof HTMLElement && 
          (entities.targetElement.tabIndex >= 0 || 
           entities.targetElement instanceof HTMLInputElement ||
           entities.targetElement instanceof HTMLTextAreaElement ||
           entities.targetElement instanceof HTMLSelectElement ||
           entities.targetElement instanceof HTMLButtonElement ||
           entities.targetElement instanceof HTMLAnchorElement)) {
        entities.targetElement.focus();
      }

      this.logger.info(`[VoiceActuator]  Scrolled to and focused element "${entities.rawentities.target}"`);
    }

    return true;
  } catch (error) {
    this.logger.error(`[VoiceActuator]  Error processing element "${entities.rawentities.target}": ${error}`);
    return false;
  }
}

private executeGoBackAction(entities: ProcessedEntities): boolean {
  try {
    window.history.back();
    console.log('VoiceActuator: Navigated back to previous page');
    return true;
  } catch (error) {
    console.log(`VoiceActuator: Error going back: ${error}`);
    return false;
  }
}

// This is a new private method to be added to your VoiceActuator class.

/**
 * Executes a click action on a target element identified within a specific row context.
 * This function is the designated executor for the CLICK_ELEMENT_IN_CONTEXT intent.
 * It assumes a processor (like ContextualElementProcessor) has already resolved the
 * precise targetElement to be clicked.
 *
 * @param {ProcessedEntities} entities The processed entities object, which must contain the `targetElement`.
 * @returns {boolean} True if the click was successful, false otherwise.
 */
private executeTableClickAction(entities: ProcessedEntities): boolean {
  // 1. Core Validation: Ensure the processor has found our target button.
  if (!entities.targetElement) {
    this.logger.warn(`[VoiceActuator][executeTableClickAction] Action failed: No targetElement was resolved by the processor. The contextual item or the action button within it could not be found on the page.`);
    // No action is possible, so we fail early.
    return false;
  }

  // 2. Perform the Action with Error Handling
  try {
    const elementToClick = entities.targetElement;
    
    // For a better user experience, we first ensure the element is visible.
    // The optional groupElement (the <tr>) can be used for logging or highlighting later if needed.
    elementToClick.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest'
    });

    // Perform the click.
    elementToClick.click();

    // 3. Log Success
    // Logging the original entities provides a complete trace from voice command to action.
    this.logger.info(
      `[VoiceActuator][executeTableClickAction] Successfully clicked element:`,
      elementToClick,
      `from original intent:`,
      entities.rawentities
    );

    // The action was successful.
    return true;

  } catch (error) {
    // 4. Handle Unexpected Errors
    // This could happen if the element becomes detached from the DOM after being found.
    this.logger.error(
      `[VoiceActuator][executeTableClickAction] An error occurred while trying to click the target element.`,
      {
        target: entities.targetElement,
        error: error
      }
    );
    return false;
  }
}

}



/* ELEMENT PROCESSORS */
class SingleTargetProcessor implements ElementProcessor {
  constructor(private actuator: VoiceActuator) {}

  canProcess(intent: string, entities: Entities): boolean {
    return !!entities.target && !entities.group && !entities.targetGroup;
  }

  process(entities: Entities): Partial<ProcessedEntities> {
    let targetElement: HTMLElement | undefined;
    const targetValue = entities.target!;

    // Get active tab context
    const activeTab = document.querySelector('.card:not(.hidden)') as HTMLElement | undefined;

    if (isVoiceEntity(targetValue)) {
        targetElement = this.actuator.findFinalTarget(targetValue, activeTab || undefined);
    } else {
        const findResult = this.actuator.findElement(targetValue as string, activeTab || undefined);
        targetElement = findResult?.element; 
    }

    if (!targetElement) {
      console.warn(`Processor: Could not find a matching element for single target: ${targetValue}`);
    }

    return { targetElement };
  }
}

class MultipleTargetProcessor implements ElementProcessor {
  constructor(private actuator: VoiceActuator) {}

  canProcess(intent: string, entities: Entities): boolean {
    return !!entities.targetGroup;
  }

  process(entities: Entities): Partial<ProcessedEntities> {
    let groupElement: HTMLElement | undefined;
    const targetGroupValue = entities.targetGroup!;

    if (isVoiceEntity(targetGroupValue)) {
        groupElement = this.actuator.findFinalTarget(targetGroupValue);
    } else {
        const findResult = this.actuator.findElement(targetGroupValue as string);
        groupElement = findResult?.element;
    }
    if (!groupElement) {
      //console.log(`Processor: Could not find a group element matching "${entities.targetGroup}".`);
      return { targetElements: [] };
    }

    const targetElements = Array.from(
      groupElement.querySelectorAll('[voice\\.name]')
        ).filter(
          (element): element is HTMLElement => element instanceof HTMLElement
        );

    if (targetElements.length === 0) {
        //console.warn(`Processor: Found the group "${entities.targetGroup}", but it contains no elements with a 'voice.name' attribute.`);
    }

    return { targetElements };
  }
}

class GroupedTargetProcessor implements ElementProcessor {
  constructor(private actuator: VoiceActuator) {}

  canProcess(intent: string, entities: Entities): boolean {
    return !!entities.target && (!!entities.group || this.shouldAutoDetectGroup(intent, entities));
  }

  process(entities: Entities): Partial<ProcessedEntities> {
    let groupElement: HTMLElement | undefined = undefined;
    let targetElement: HTMLElement | undefined = undefined;
    let targetName: string | undefined = undefined;

    // --- 1. FIND THE GROUP ELEMENT ---
    if (entities.group) {
        const groupValue = entities.group;
        //console.log(`Processor: Finding explicit group: ${JSON.stringify(groupValue)}`);
        
        // Get active tab context
        const activeTab = document.querySelector('.card:not(.hidden)') as HTMLElement | undefined;

        // Handle both string and VoiceEntity for the group
        if (isVoiceEntity(groupValue)) {
            groupElement = this.actuator.findFinalTarget(groupValue, activeTab || undefined);
        } else {
            const findResult = this.actuator.findElement(groupValue as string, activeTab || undefined);
            groupElement = findResult?.element;
        }

        if (!groupElement) {
            //console.warn(`VoiceActuator: No matching group element found for group "${JSON.stringify(groupValue)}"`);
            return { groupElement: undefined, targetElement: undefined };
        }
    } else {
        // Auto-detect a single group on the page if none was specified
        groupElement = this.detectSingleGroup();

        // Get active tab context
        const activeTab = document.querySelector('.card:not(.hidden)') as HTMLElement | undefined;

        if (!groupElement) {
            //console.log('VoiceActuator: Could not auto-detect a unique group. Falling back to single target search.');
            
            // Fallback: Treat it like a SingleTargetProcessor if no group is found/specified
            // This now correctly handles string and VoiceEntity
            const targetValue = entities.target!;
            if (isVoiceEntity(targetValue)) {
                targetElement = this.actuator.findFinalTarget(targetValue, activeTab || undefined);
                // Added by me - to get some targetName returned
                if (targetElement) {
                  targetName = targetElement.getAttribute('voice.name') || targetElement.textContent || '';
                }
            } else {
                const findResult = this.actuator.findElement(targetValue as string, activeTab || undefined);
                targetElement = findResult?.element;
                // Added by me - to get some targetName returned
                if (targetElement) {
                  targetName = targetElement.getAttribute('voice.name') || targetElement.textContent || '';
                }
            }
            return { targetElement, targetName };
        }
    }

    // --- 2. FIND THE TARGET ELEMENT WITHIN THE GROUP ---
    if (groupElement && entities.target) {
        let foundItem: HTMLElement | undefined;
        const targetValue = entities.target; // Can be string or VoiceEntity
        
        //console.log(`Processor: Finding target "${JSON.stringify(targetValue)}" within group.`);
        
        // Handle both string and VoiceEntity for the target, searching within the groupElement context
        if (isVoiceEntity(targetValue)) {
            foundItem = this.actuator.findFinalTarget(targetValue, groupElement);
        } else {
            const findResult = this.actuator.findElement(targetValue as string, groupElement);
            foundItem = findResult?.element;
        }

        if (!foundItem) {
            //console.warn(`VoiceActuator: Target "${JSON.stringify(targetValue)}" not found in the specified group.`);
            return { groupElement, targetElement: undefined };
        }
        
        // --- 3. ASSIGN FINAL ELEMENTS AND NAMES ---
        // This logic remains the same, as it operates on the successfully found DOM elements.
        if (groupElement instanceof HTMLSelectElement) {
            targetElement = groupElement; // For a dropdown, the 'actionable' element is the <select> itself
            targetName = foundItem.getAttribute('voice.name') || foundItem.textContent || '';
            //console.log(`VoiceActuator: Found option for "${targetName}" in dropdown.`);
        } else {
            targetElement = foundItem; // For radio buttons, the 'actionable' element is the <input>
            targetName = foundItem.getAttribute('voice.name') || foundItem.textContent || '';
            //console.log(`VoiceActuator: Found radio button for "${targetName}".`);
        }
    }
    
    return { groupElement, targetElement, targetName };
}

  private shouldAutoDetectGroup(intent: string, entities: Entities): boolean {
    return intent === IntentTypes.SELECT_RADIO_OR_DROPDOWN;
  }

  private detectSingleGroup(): HTMLElement | undefined {
    const dropdowns = document.querySelectorAll('select[voice\\.name]');
    const radioGroups = this.getUniqueRadioGroups();
    
    if (dropdowns.length === 1 && radioGroups.length === 0) {
      return dropdowns[0] as HTMLElement;
    } else if (dropdowns.length === 0 && radioGroups.length === 1) {
      // Return first radio button of the group as representative
      const firstRadio = document.querySelector(`input[type="radio"][name="${radioGroups[0]}"]`);
      return firstRadio as HTMLElement;
    }
    
    return undefined;
  }

  private getUniqueRadioGroups(): string[] {
    const radioButtons = document.querySelectorAll('input[type="radio"][voice\\.name]');
    const groups = new Set<string>();
    
    radioButtons.forEach(radio => {
      const name = (radio as HTMLInputElement).name;
      if (name) groups.add(name);
    });
    
    return Array.from(groups);
  }

}

// This is a new, separate class file or section in your code.

class ContextualElementProcessor implements ElementProcessor {
  constructor(private actuator: VoiceActuator, private logger: Logger) {
    logger.debug("CONTEXTUAL ELEMENT PROCESSOR SELECTED")
  }

  canProcess(intent: string, entities: Entities): boolean {
    // This logic remains the same.
    return intent === IntentTypes.CLICK_ELEMENT_IN_CONTEXT &&
           !!entities.target &&
           !!entities.contextKey &&
           !!entities.contextValue;
  }

  process(entities: Entities): Partial<ProcessedEntities> {
    this.logger.debug(`[ContextualProcessor] Starting to process:`, entities);
    const targetEntity = entities.target!;
    const contextKey = entities.contextKey!;
    const contextValue = entities.contextValue!;

    // Step 1: Discover the specific table row that matches our context.
    const targetRow = this.findRowByContext(contextKey, contextValue);

    if (!targetRow) {
      this.logger.warn(`[ContextualProcessor] Could not find a row context for key "${this.getEntityText(contextKey)}" with value "${this.getEntityText(contextValue)}"`);
      return {};
    }

    this.logger.debug(`[ContextualProcessor] Found target row for context:`, targetRow);

    // Step 2: Find the final target element within that row.
    let targetElement: HTMLElement | undefined;
    if (isVoiceEntity(targetEntity)) {
      targetElement = this.actuator.findFinalTarget(targetEntity, targetRow);
    } else {
      const findResult = this.actuator.findElement(targetEntity as string, targetRow);
      targetElement = findResult?.element;
    }

    if (!targetElement) {
      this.logger.warn(`[ContextualProcessor] Found the row, but could not find target "${this.getEntityText(targetEntity)}" within it.`);
    }

    // ==================== MODIFICATION ====================
    // Return BOTH the final button (targetElement) and its container row (groupElement).
    // This provides richer context to the action executor.
    return { 
        targetElement, 
        groupElement: targetRow 
    };
    // ======================================================
  }

  /**
   * Discovers a table row by finding the column header and then matching the cell value.
   * This is a robust way to find a row without relying on fragile selectors.
   */
  private findRowByContext(contextKey: EntityValue, contextValue: EntityValue): HTMLElement | undefined {
    // ==================== MODIFICATION (IMPROVED ROBUSTNESS) ====================
    // Get both language possibilities to check against.
    const keyCandidates = isVoiceEntity(contextKey) ? [contextKey.english, contextKey.user_language] : [contextKey as string];
    const valueCandidates = isVoiceEntity(contextValue) ? [contextValue.english, contextValue.user_language] : [contextValue as string];
    //=============================================================================

    const allHeaders = document.querySelectorAll('th');
    let columnIndex = -1;
    let bestScore = 0;

    allHeaders.forEach((header, index) => {
      const headerText = header.textContent || '';
      // Score against all candidates and take the best score.
      const score = Math.max(...keyCandidates.map(key => this.actuator.calculateMatchScore(headerText, key)));
      if (score > bestScore) {
        bestScore = score;
        columnIndex = index;
      }
    });

    if (bestScore < 50) {
      this.logger.warn(`[ContextualProcessor] Could not find a table header that sufficiently matches "${this.getEntityText(contextKey)}".`);
      return undefined;
    }
    this.logger.debug(`[ContextualProcessor] Found best match for header "${this.getEntityText(contextKey)}" at index ${columnIndex}.`);

    const table = allHeaders[columnIndex].closest('table');
    if (!table) {
      this.logger.warn(`[ContextualProcessor] Header at index ${columnIndex} was not inside a <table>.`);
      return undefined;
    }

    const allRows = table.querySelectorAll('tbody tr');
    let targetRow: HTMLElement | undefined;
    let bestRowScore = 0;
    
    allRows.forEach(row => {
      const cell = (row as HTMLElement).querySelectorAll('td')[columnIndex];
      if (cell) {
        const cellText = cell.textContent || '';
        // Score against all value candidates and take the best score.
        const rowScore = Math.max(...valueCandidates.map(val => this.actuator.calculateMatchScore(cellText, val)));
        if (rowScore > bestRowScore) {
          bestRowScore = rowScore;
          targetRow = row as HTMLElement;
        }
      }
    });

    if (bestRowScore < 50) {
      this.logger.warn(`[ContextualProcessor] Could not find a row where column "${this.getEntityText(contextKey)}" sufficiently matches "${this.getEntityText(contextValue)}".`);
      return undefined;
    }

    return targetRow;
  }
  
  private getEntityText(entity: EntityValue): string {
    // Return the English version for logging consistency, as it's the normalized form.
    return isVoiceEntity(entity) ? entity.english : (entity as string);
  }
}


/* VALUE NORMALIZERS */

class EmailNormalizer implements ValueNormalizer {
  canNormalize(element: HTMLElement, value: string): boolean {
    return element instanceof HTMLInputElement && element.type === 'email';
  }

  normalize(element: HTMLElement, value: string): string {
    return value
      .replace(/\bat\b/gi, '@')
      .replace(/\bdot\b/gi, '.')
      .replace(/\bunderscore\b/gi, '_')
      .replace(/\bdash\b/gi, '-')
      .replace(/\bplus\b/gi, '+')
      .replace(/\s+/g, '')
      .trim();
  }
}

class NumericNormalizer implements ValueNormalizer {
  canNormalize(element: HTMLElement, value: string): boolean {
    return element instanceof HTMLInputElement && element.type === 'number';
  }

  normalize(element: HTMLElement, value: string): string {
    try {
      // Remove commas and connecting words
      const cleanValue = value
        .replace(/,/g, '') // Remove commas
        .replace(/\band\b/gi, '') // Remove 'and'
        .replace(/\s+/g, ''); // Remove extra spaces

      // Extract the first floating point number from the string
      const match = cleanValue.match(/-?\d+(?:\.\d+)?/);
      
      if (match) {
        return parseFloat(match[0]).toString();
      }
      
      return value; // Return original if no number found
    } catch (error) {
      console.error('Error normalizing numeric value:', error);
      return value;
    }
  }
}

class DateNormalizer implements ValueNormalizer {
  canNormalize(element: HTMLElement, value: string): boolean {
    return element instanceof HTMLInputElement && element.type === 'date';
  }

  normalize(element: HTMLElement, value: string): string {
    try {
      const lowerSpoken = value.toLowerCase();
      
      if (lowerSpoken === 'today' || lowerSpoken === 'now') {
        return new Date().toISOString().split('T')[0];
      }
      
      if (lowerSpoken === 'tomorrow') {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow.toISOString().split('T')[0];
      }
      
      if (lowerSpoken === 'yesterday') {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        return yesterday.toISOString().split('T')[0];
      }
      
      const results = chrono.parse(value);
      if (results.length > 0) {
        const formattedDate = results[0].start.date().toISOString().split('T')[0];
        
        // Validate against min/max if available
        if (element instanceof HTMLInputElement) {
          const { min, max } = element;
          if (min && formattedDate < min) return min;
          if (max && formattedDate > max) return max;
        }
        
        return formattedDate;
      }
      
      return value;
    } catch (error) {
      console.error('Error normalizing date value:', error);
      return value;
    }
  }
}

class TimeNormalizer implements ValueNormalizer {
  canNormalize(element: HTMLElement, value: string): boolean {
    return element instanceof HTMLInputElement && element.type === 'time';
  }

  normalize(element: HTMLElement, value: string): string {
    try {
      const lowerSpoken = value.toLowerCase();
      
      if (lowerSpoken === 'now') {
        const now = new Date();
        return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      }
      
      const results = chrono.parse(value);
      if (results.length > 0) {
        const parsedTime = results[0].start.date();
        const formattedTime = `${String(parsedTime.getHours()).padStart(2, '0')}:${String(parsedTime.getMinutes()).padStart(2, '0')}`;
        
        // Validate against min/max if available
        if (element instanceof HTMLInputElement) {
          const { min, max } = element;
          if (min && formattedTime < min) return min;
          if (max && formattedTime > max) return max;
        }
        
        return formattedTime;
      }
      
      return value;
    } catch (error) {
      console.error('Error normalizing time value:', error);
      return value;
    }
  }
}