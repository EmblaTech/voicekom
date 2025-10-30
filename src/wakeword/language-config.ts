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
    wake: ['வணக்கம்', 'ஹலோ', 'தொடங்கு'],
    sleep: ['நிறுத்தவும்', 'நிறுத்து']
  },
  'si-LK': {
    wake: ['හෙලෝ', 'ආයුබෝවන්', 'පටංගන්න'],
    sleep: ['නවත්තන්න', 'නවත']
  },
  'zh-CN': {
    wake: ['你好', '嗨', '录音'],
    sleep: ['停', '停止', '别录了']
  }
  
  // Add more languages as needed
};