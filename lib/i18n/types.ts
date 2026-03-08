export type Locale = 'en' | 'ja';

export type TranslationDict = Record<string, string>;

/**
 * Simple string interpolation for translation strings.
 * Replaces {key} placeholders with values from the vars object.
 *
 * Usage: t(dict, 'import.loading', { user: 'zakamutt' })
 */
export function t(
  dict: TranslationDict,
  key: string,
  vars?: Record<string, string | number>,
): string {
  let str = dict[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}
