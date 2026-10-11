// Languages with an OpenSubtitles frequency list in hermitdave/FrequencyWords.
// `tag` is the BCP 47 tag used for speech synthesis and word segmentation.

export interface Language {
  code: string;
  name: string;
  tag: string;
}

export const LANGUAGES: Language[] = [
  ["ar", "Arabic", "ar"],
  ["bg", "Bulgarian", "bg-BG"],
  ["ca", "Catalan", "ca-ES"],
  ["zh_cn", "Chinese (Simplified)", "zh-CN"],
  ["zh_tw", "Chinese (Traditional)", "zh-TW"],
  ["hr", "Croatian", "hr-HR"],
  ["cs", "Czech", "cs-CZ"],
  ["da", "Danish", "da-DK"],
  ["nl", "Dutch", "nl-NL"],
  ["en", "English", "en-US"],
  ["eo", "Esperanto", "eo"],
  ["et", "Estonian", "et-EE"],
  ["fi", "Finnish", "fi-FI"],
  ["fr", "French", "fr-FR"],
  ["de", "German", "de-DE"],
  ["el", "Greek", "el-GR"],
  ["he", "Hebrew", "he-IL"],
  ["hi", "Hindi", "hi-IN"],
  ["hu", "Hungarian", "hu-HU"],
  ["is", "Icelandic", "is-IS"],
  ["id", "Indonesian", "id-ID"],
  ["it", "Italian", "it-IT"],
  ["ja", "Japanese", "ja-JP"],
  ["ko", "Korean", "ko-KR"],
  ["lv", "Latvian", "lv-LV"],
  ["lt", "Lithuanian", "lt-LT"],
  ["ms", "Malay", "ms-MY"],
  ["no", "Norwegian", "nb-NO"],
  ["fa", "Persian", "fa-IR"],
  ["pl", "Polish", "pl-PL"],
  ["pt", "Portuguese (Portugal)", "pt-PT"],
  ["pt_br", "Portuguese (Brazil)", "pt-BR"],
  ["ro", "Romanian", "ro-RO"],
  ["ru", "Russian", "ru-RU"],
  ["sr", "Serbian", "sr-RS"],
  ["sk", "Slovak", "sk-SK"],
  ["sl", "Slovenian", "sl-SI"],
  ["es", "Spanish", "es-ES"],
  ["sv", "Swedish", "sv-SE"],
  ["tl", "Tagalog", "fil-PH"],
  ["th", "Thai", "th-TH"],
  ["tr", "Turkish", "tr-TR"],
  ["uk", "Ukrainian", "uk-UA"],
  ["vi", "Vietnamese", "vi-VN"],
].map(([code, name, tag]) => ({ code, name, tag }));

/**
 * MVP scope: courses are taught from English, in these languages only. The
 * table above stays for speech and segmentation of any text.
 */
export const NATIVE_LANGUAGE = "English";
export const COURSE_LANGUAGES: { code: string; name: string; blurb: string }[] = [
  { code: "es", name: "Spanish", blurb: "Spain and Latin America" },
  { code: "de", name: "German", blurb: "Germany, Austria and Switzerland" },
];

export const language = (code: string): Language =>
  LANGUAGES.find((l) => l.code === code) ?? { code, name: code, tag: code };
