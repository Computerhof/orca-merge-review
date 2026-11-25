// Language of every text the plugin shows or writes (German and English). Orca-free: the core,
// the worker, the panel and the review tab each import it and keep their own current language.
//
// The panel and the review tab know Orca's UI language (`env.locale`, `orca.locale`); the worker
// does not, so the panel reports it (`ui.locale`) and the worker remembers it for status bar
// texts, notifications and refusals before any panel opened.
//
// Texts live next to their code: `const m = messages({ de: {...}, en: {...} })`, where `en` must
// have every key of `de` with the same shape (a missing translation fails the typecheck). Reading
// `m.someKey` gives the text in the current language at that moment.

export type Locale = 'de' | 'en'

export const LOCALES: readonly Locale[] = ['de', 'en']

let current: Locale = 'de'

/** A BCP-47 tag (`de-DE`, `en-US`, `fr`) to a language the plugin speaks; anything not German is English. */
export function localeOf(tag: string | null | undefined): Locale {
  return /^de(-|_|$)/i.test((tag ?? '').trim()) ? 'de' : 'en'
}

export function setLocale(locale: Locale): void {
  current = locale
}

export function getLocale(): Locale {
  return current
}

type Entry = string | ((...args: never[]) => string)
type Catalog = Record<string, Entry>

/** Same keys, same parameter lists; the texts differ. */
export type Translation<T extends Catalog> = { [K in keyof T]: T[K] }

/**
 * Texts in both languages; the returned object answers in the current language whenever a key
 * is read. Functions take the values to put in (`m.merged(source)`).
 */
export function messages<T extends Catalog>(texts: { de: T; en: NoInfer<Translation<T>> }): T {
  return new Proxy({} as T, {
    get: (_, k) => (current === 'en' ? texts.en : texts.de)[k as keyof T]
  })
}

/** A count with its noun, e.g. `plural(n, 'Datei', 'Dateien')`; each catalog passes its own words. */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}
