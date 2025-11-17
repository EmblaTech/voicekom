import { LanguageConfig } from '../types';

export const LANGUAGE_CONFIGS: Record<string, LanguageConfig> = {
  'en-US': {
    wake: ['hello', 'hi', 'start'],
    sleep: ['stop listening', 'stop']
  },
  'es-ES': {
    wake: ['hola', 'oye', 'graba'],
    sleep: ['para', 'alto', 'detente']
  },
  'ta-IN': {
    wake: ['வணக்கம்', 'ஹலோ', 'தொடங்கு', 'ஸ்டார்ட் பண்ணு'],
    sleep: ['நிறுத்தவும்', 'நிறுத்து', 'நிப்பாட்டு', 'நிற்பாட்டு', 'ஸ்டாப் பண்ணு']
  },
  'si-LK': {
    wake: ['හෙලෝ', 'ආයුබෝවන්', 'පටංගන්න'],
    sleep: ['නවත්තන්න', 'නවත']
  },
  'zh-CN': {
    wake: ['你好', '嗨', '录音'],
    sleep: ['停', '停止', '别录了']
  },
  'nb-NO': {
    wake: ['hallo', 'hei', 'start'],
    sleep: ['stopp å lytte', 'stopp', 'stans']
  }

  // Add more languages as needed
};