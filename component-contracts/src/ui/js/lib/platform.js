/**
 * How a platform is named to a person: iOS and Android, not the lowercase ids the data is keyed by.
 *
 * The ids stay exactly as they are in contracts, platform files and paths, because they are data;
 * only what is shown changes. `platformName` is for an id, and `withPlatformNames` is for a sentence
 * the tool wrote, which it fixes while leaving anything shaped like a path or a dotted key alone.
 *
 * Examples of what is left alone: `platform-specs/counter/ios.json` and `adaptable.ring.platforms.ios`.
 *
 * Pure: no DOM, so it is tested in Node with the rest of the logic.
 */

const NAMES = { ios: 'iOS', android: 'Android', web: 'Web' };

/** `ios` -> `iOS`. An id with no display name is shown as it is. */
export const platformName = (id) => NAMES[id] ?? id;

// A word on its own: not part of a longer word, a path (`/ios`, `ios.json`) or a dotted key (`.ios.`).
const WORD = /(?<![\w./-])(ios|android)(?![\w-]|\.\w|\/)/g;

/** The platform words in a sentence, as a person writes them. Only `ios` and `android`: "web" is an ordinary word. */
export const withPlatformNames = (text) => text.replace(WORD, (word) => NAMES[word]);
