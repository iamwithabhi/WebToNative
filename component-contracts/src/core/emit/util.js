/** Shared helpers for the emitters. */

export const pascal = (s) =>
  String(s)
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');

export const camel = (s) => {
  const p = pascal(s);
  return p.charAt(0).toLowerCase() + p.slice(1);
};

export const screamingSnake = (s) =>
  String(s)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-.\s]+/g, '_')
    .toUpperCase();

/** Numeric value from a token value like 16, "16px", "1.5rem". */
export function numeric(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return null;
  const m = v.match(/^(-?[\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

export const isColorValue = (v) => typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v);

/** Map a numeric font weight onto SwiftUI's Font.Weight cases. */
export function weightName(n) {
  const w = n ?? 400;
  if (w <= 100) return 'ultraLight';
  if (w <= 200) return 'thin';
  if (w <= 300) return 'light';
  if (w <= 400) return 'regular';
  if (w <= 500) return 'medium';
  if (w <= 600) return 'semibold';
  if (w <= 700) return 'bold';
  if (w <= 800) return 'heavy';
  return 'black';
}

/** Hex -> Compose 0xAARRGGBB literal. */
export function composeColorLiteral(hex) {
  if (!isColorValue(hex)) return null;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 6) h = 'ff' + h;
  else if (h.length === 8) h = h.slice(6, 8) + h.slice(0, 6); // RRGGBBAA -> AARRGGBB
  return `0x${h.toUpperCase()}`;
}

/** Indent every line of a block. */
export const indent = (text, spaces) =>
  text
    .split('\n')
    .map((l) => (l.trim() ? ' '.repeat(spaces) + l : l))
    .join('\n');
