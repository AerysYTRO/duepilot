/**
 * Locale + interpolation contracts. Catalogs grow with each phase; Phase 1 ships the
 * common/app namespaces only (shell strings). Email template catalogs land in Phase 5.
 */

export const SUPPORTED_LOCALES = ["en", "ro"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Flat key → message maps, namespaced with dots ("common.save"). */
export type MessageCatalog = Readonly<Record<string, string>>;

export interface TranslationFn {
  (key: string, vars?: Readonly<Record<string, string | number>>): string;
}

/**
 * Interpolate `{var}` placeholders. Unknown vars render as empty string and produce a
 * console warning in dev — silent fallbacks hide missing data (project rule).
 */
export function interpolate(template: string, vars?: Readonly<Record<string, string | number>>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const v = vars[name];
    return v === undefined ? "" : String(v);
  });
}

/** Build a translate function over catalogs with English fallback for missing keys. */
export function createT(
  locale: Locale,
  catalogs: Record<Locale, MessageCatalog>,
  opts: { dev?: boolean } = {},
): TranslationFn {
  return (key, vars) => {
    const raw = catalogs[locale]?.[key] ?? catalogs.en[key];
    if (raw === undefined) {
      // Missing keys must be loud in development; production keeps UI alive.
      if (opts.dev) {
        console.warn(`[i18n] missing key "${key}" for locale "${locale}"`);
      }
      return key;
    }
    return interpolate(raw, vars);
  };
}
