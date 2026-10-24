export const LANGUAGES = [
  { code: "en", label: "English", speech: "en-US" },
  { code: "es", label: "Español", speech: "es-ES" },
  { code: "zh", label: "中文", speech: "zh-CN" },
  { code: "hi", label: "हिन्दी", speech: "hi-IN" },
  { code: "ko", label: "한국어", speech: "ko-KR" },
  { code: "ar", label: "العربية", speech: "ar-SA" },
  { code: "fr", label: "Français", speech: "fr-FR" },
] as const;

export type LangCode = (typeof LANGUAGES)[number]["code"];
export const isLang = (s: string): s is LangCode => LANGUAGES.some(l => l.code === s);
export const speechLang = (code: string) => LANGUAGES.find(l => l.code === code)?.speech ?? "en-US";
export const languageName = (code: string) => LANGUAGES.find(l => l.code === code)?.label ?? "English";

// Bump when the server voice or model changes so CDN-cached clips are not reused.
export const VOICE_VERSION = "1";
