import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

import en from './locales/en.json';
import fr from './locales/fr.json';
import es from './locales/es.json';
import tw from './locales/tw.json';

const LANG_KEY = 'eyego_language';

const languageDetector = {
  type: 'languageDetector' as const,
  async: true,
  detect: async (callback: (lang: string) => void) => {
    const saved = await AsyncStorage.getItem(LANG_KEY);
    callback(saved ?? Localization.getLocales()[0]?.languageCode ?? 'en');
  },
  init: () => {},
  cacheUserLanguage: async (lang: string) => {
    await AsyncStorage.setItem(LANG_KEY, lang);
  },
};

i18n
  .use(languageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, fr: { translation: fr }, es: { translation: es }, tw: { translation: tw } },
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

export default i18n;
export { LANG_KEY };
