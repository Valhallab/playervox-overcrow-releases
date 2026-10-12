// Characters a widget name never holds, as the widget schema refuses them
// (crates/overcrow-widget-schema/src/text.rs, kept equal by a test):
// invisible, blank and text-direction characters, so that a name cannot
// read otherwise than it is written.

/** Inclusive ranges of code points. */
export const INVISIBLE_CHARACTERS: ReadonlyArray<readonly [number, number]> = [
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180b, 0x180f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0x2800, 0x2800],
  [0x3164, 0x3164],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff9, 0xfffb],
  [0x1bca0, 0x1bca3],
  [0x1d173, 0x1d17a],
  [0xe0000, 0xe0fff],
];

const isSelector = (code: number) => code >= 0xfe00 && code <= 0xfe0f;

/**
 * The first hidden character of `text`, its position counted in characters
 * from 1: an invisible character, or a variation selector that starts the
 * text or follows another one (an emoji keeps its presentation selector).
 */
export function hiddenCharacter(text: string): { position: number; code: number } | undefined {
  let previous: number | undefined;
  let position = 0;
  for (const character of text) {
    position += 1;
    const code = character.codePointAt(0) ?? 0;
    const misplacedSelector = isSelector(code) && (previous === undefined || isSelector(previous));
    if (
      misplacedSelector ||
      INVISIBLE_CHARACTERS.some(([start, end]) => code >= start && code <= end)
    ) {
      return { position, code };
    }
    previous = code;
  }
  return undefined;
}

/** `U+202E`. */
export const codePoint = (code: number) => `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
