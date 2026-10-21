import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useState } from 'react';
import { Counter } from './Counter';

const HOLD_MS = 150;
/** WCAG 2.5.5 (AAA) and the iOS HIG both floor at 44 CSS px. */
const MIN_TOUCH_TARGET_PX = 44;

function pointerDown(el: Element) {
  // jsdom has no PointerEvent; React's onPointerDown listens for the native name.
  el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
}

const spin = () => screen.getByRole('spinbutton');
const dec = () => screen.getByRole('button', { name: 'Decrease Quantity' });
const inc = () => screen.getByRole('button', { name: 'Increase Quantity' });
const value = () => spin().textContent;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Counter', () => {
  it('renders the default value', () => {
    render(<Counter defaultValue={1} />);
    expect(value()).toBe('1');
  });

  it('increments and decrements by step on pointerdown', () => {
    render(<Counter defaultValue={1} step={2} />);
    act(() => pointerDown(inc()));
    expect(value()).toBe('3');
    act(() => pointerDown(dec()));
    expect(value()).toBe('1');
  });

  it('repeats while held and stops on pointerup', () => {
    render(<Counter defaultValue={0} max={99} />);
    act(() => pointerDown(inc()));
    expect(value()).toBe('1');

    act(() => void vi.advanceTimersByTime(HOLD_MS * 3));
    expect(value()).toBe('4');

    act(() => void window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })));
    act(() => void vi.advanceTimersByTime(HOLD_MS * 5));
    expect(value()).toBe('4');
  });

  it('stops repeating when it reaches the bound', () => {
    render(<Counter defaultValue={0} min={0} max={3} />);
    act(() => pointerDown(inc()));
    act(() => void vi.advanceTimersByTime(HOLD_MS * 10));
    expect(value()).toBe('3');
  });

  it('calls onChange only when the value actually changes', () => {
    const onChange = vi.fn();
    render(<Counter defaultValue={0} min={0} max={1} onChange={onChange} />);
    act(() => pointerDown(inc()));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(1);

    act(() => pointerDown(inc())); // already at max
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('respects a controlled value and does not self-update', () => {
    const onChange = vi.fn();
    render(<Counter value={7} onChange={onChange} />);
    act(() => pointerDown(inc()));
    expect(onChange).toHaveBeenCalledWith(8);
    expect(value()).toBe('7');
  });

  it('updates when a controlled parent moves the value', () => {
    function Host() {
      const [v, setV] = useState(2);
      return <Counter value={v} onChange={setV} />;
    }
    render(<Host />);
    act(() => pointerDown(inc()));
    expect(value()).toBe('3');
  });

  it('clamps an out-of-range defaultValue', () => {
    render(<Counter defaultValue={500} max={99} />);
    expect(value()).toBe('99');
  });

  it('pops the value after a change and clears it', () => {
    render(<Counter defaultValue={1} />);
    act(() => pointerDown(inc()));
    expect(spin().getAttribute('data-pop')).toBe('true');
    act(() => void vi.advanceTimersByTime(POP_MS));
    expect(spin().getAttribute('data-pop')).toBe('false');
  });

  it('does not leave a repeat timer running after unmount', () => {
    const onChange = vi.fn();
    const { unmount } = render(<Counter defaultValue={0} onChange={onChange} />);
    act(() => pointerDown(inc()));
    onChange.mockClear();
    unmount();
    act(() => void vi.advanceTimersByTime(HOLD_MS * 5));
    expect(onChange).not.toHaveBeenCalled();
  });

  /* ----------------------------------------------------------- semantics */

  describe('accessibility', () => {
    it('composes button names from the field name', () => {
      render(<Counter defaultValue={1} label="Quantity" />);
      // A bare "Decrease" is ambiguous once a page has two Counters.
      expect(screen.getByRole('button', { name: 'Decrease Quantity' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Increase Quantity' })).toBeTruthy();
    });

    it('carries a specific field name through to the buttons', () => {
      render(<Counter defaultValue={1} label="Quantity, Blue T-shirt" />);
      expect(screen.getByRole('spinbutton', { name: 'Quantity, Blue T-shirt' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Decrease Quantity, Blue T-shirt' })).toBeTruthy();
    });

    it('lets callers override either button name outright', () => {
      render(<Counter defaultValue={1} decrementLabel="Remove one" incrementLabel="Add one" />);
      expect(screen.getByRole('button', { name: 'Remove one' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Add one' })).toBeTruthy();
    });

    it('names the spinbutton from visible text via labelledBy', () => {
      render(
        <>
          <span id="qty-label">Tickets</span>
          <Counter defaultValue={1} labelledBy="qty-label" />
        </>,
      );
      const el = screen.getByRole('spinbutton', { name: 'Tickets' });
      // aria-label must not co-exist, or it would win and silently shadow the visible text.
      expect(el.hasAttribute('aria-label')).toBe(false);
      expect(el.getAttribute('aria-labelledby')).toBe('qty-label');
    });

    it('falls back to bare action names when there is no label string to compose', () => {
      render(
        <>
          <span id="qty-label">Tickets</span>
          <Counter defaultValue={1} labelledBy="qty-label" />
        </>,
      );
      expect(screen.getByRole('button', { name: 'Decrease' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Increase' })).toBeTruthy();
    });

    it('associates supporting text with the value', () => {
      render(
        <>
          <span id="qty-help">Maximum 10 per order</span>
          <Counter defaultValue={1} describedBy="qty-help" />
        </>,
      );
      expect(spin().getAttribute('aria-describedby')).toBe('qty-help');
    });

    it('omits labelling hooks that were not asked for', () => {
      render(<Counter defaultValue={1} />);
      expect(spin().hasAttribute('aria-labelledby')).toBe(false);
      expect(spin().hasAttribute('aria-describedby')).toBe(false);
    });

    it('gives each instance a distinct id so ids never collide', () => {
      render(
        <>
          <Counter defaultValue={1} label="First" />
          <Counter defaultValue={1} label="Second" />
        </>,
      );
      const [a, b] = screen.getAllByRole('spinbutton');
      expect(a!.id).toBeTruthy();
      expect(b!.id).toBeTruthy();
      expect(a!.id).not.toBe(b!.id);
    });

    it('exposes the value as a spinbutton with its range', () => {
      render(<Counter defaultValue={3} min={1} max={9} label="Quantity" />);
      const el = screen.getByRole('spinbutton', { name: 'Quantity' });
      expect(el.getAttribute('aria-valuenow')).toBe('3');
      expect(el.getAttribute('aria-valuemin')).toBe('1');
      expect(el.getAttribute('aria-valuemax')).toBe('9');
    });

    it('keeps aria-valuenow in step with the rendered value', () => {
      render(<Counter defaultValue={1} />);
      act(() => pointerDown(inc()));
      expect(spin().getAttribute('aria-valuenow')).toBe('2');
      expect(value()).toBe('2');
    });

    it('supports aria-valuetext for values that need context', () => {
      render(<Counter defaultValue={2} formatValueText={(n) => `${n} items`} />);
      expect(spin().getAttribute('aria-valuetext')).toBe('2 items');
    });

    it('omits aria-valuetext when no formatter is given', () => {
      render(<Counter defaultValue={2} />);
      expect(spin().hasAttribute('aria-valuetext')).toBe(false);
    });

    it('is reachable by keyboard as a single tab stop', () => {
      render(<Counter defaultValue={1} />);
      expect(spin().getAttribute('tabindex')).toBe('0');
      expect(inc().getAttribute('tabindex')).toBe('-1');
      expect(dec().getAttribute('tabindex')).toBe('-1');
    });

    it.each([
      ['ArrowUp', 6],
      ['ArrowRight', 6],
      ['ArrowDown', 4],
      ['ArrowLeft', 4],
      ['PageUp', 15],
      ['PageDown', 0],
      ['Home', 0],
      ['End', 99],
    ])('steps on %s', (key, expected) => {
      render(<Counter defaultValue={5} min={0} max={99} />);
      fireEvent.keyDown(spin(), { key });
      expect(value()).toBe(String(expected));
    });

    it('ignores unrelated keys', () => {
      render(<Counter defaultValue={5} />);
      fireEvent.keyDown(spin(), { key: 'a' });
      expect(value()).toBe('5');
    });

    it('marks a bound button aria-disabled rather than natively disabled', () => {
      render(<Counter defaultValue={0} min={0} max={2} />);
      // aria-disabled keeps it focusable, so hitting a bound cannot drop focus.
      expect(dec().getAttribute('aria-disabled')).toBe('true');
      expect((dec() as HTMLButtonElement).disabled).toBe(false);
      expect(inc().hasAttribute('aria-disabled')).toBe(false);
    });

    it('does not act on an aria-disabled button', () => {
      const onChange = vi.fn();
      render(<Counter defaultValue={0} min={0} onChange={onChange} />);
      act(() => pointerDown(dec()));
      expect(onChange).not.toHaveBeenCalled();
      expect(value()).toBe('0');
    });

    it('frozen is read-only, not absent: value stays focusable and readable', () => {
      render(<Counter defaultValue={3} frozen />);
      expect(spin().getAttribute('aria-readonly')).toBe('true');
      expect(spin().getAttribute('tabindex')).toBe('0');
      expect(spin().getAttribute('aria-valuenow')).toBe('3');
      expect(inc().getAttribute('aria-disabled')).toBe('true');
      expect(dec().getAttribute('aria-disabled')).toBe('true');
    });

    it('frozen ignores both pointer and keyboard input', () => {
      render(<Counter defaultValue={3} frozen />);
      act(() => pointerDown(inc()));
      fireEvent.keyDown(spin(), { key: 'ArrowUp' });
      expect(value()).toBe('3');
    });
  });

  /* --------------------------------------------------------- touch target */

  describe('touch target', () => {
    const css = readFileSync(join(__dirname, 'counter.css'), 'utf8');

    function resolveToken(name: string): string {
      const dir = join(__dirname, '../tokens');
      const all = ['base.css', 'semantic.css'].map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
      const map = new Map<string, string>();
      for (const m of all.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+);/g)) {
        if (!map.has(m[1]!)) map.set(m[1]!, m[2]!.trim());
      }
      const walk = (n: string, d = 0): string => {
        if (d > 12) return '';
        const v = map.get(n);
        if (!v) return '';
        const alias = v.match(/^var\(\s*(--[a-z0-9-]+)\s*\)$/);
        return alias ? walk(alias[1]!, d + 1) : v;
      };
      return walk(name);
    }

    it('declares a hit-area overlay bound to --ds-counter-touch-target', () => {
      expect(css).toMatch(/\.ds-counter__button::after\s*\{[^}]*min-width:\s*var\(--ds-counter-touch-target\)/s);
      expect(css).toMatch(/\.ds-counter__button::after\s*\{[^}]*min-height:\s*var\(--ds-counter-touch-target\)/s);
    });

    it('resolves the touch target to at least 44px', () => {
      const declared = css.match(/--ds-counter-touch-target:\s*var\((--[a-z0-9-]+)\)/)?.[1];
      expect(declared, 'touch target should be a token reference').toBeTruthy();
      const resolved = resolveToken(declared!);
      expect(resolved).toMatch(/px$/);
      expect(Number.parseFloat(resolved)).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
    });

    it('drops the overlay on an unavailable button', () => {
      expect(css).toMatch(/\.ds-counter__button\[aria-disabled='true'\]::after\s*\{\s*content:\s*none/);
    });

    it('does not clip the overlay — the container must not hide overflow', () => {
      // Strip comments first; the source explains *why* overflow:hidden is absent.
      const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
      const container = code.match(/\.ds-counter\s*\{[^}]*\}/s)?.[0] ?? '';
      expect(container).toMatch(/--ds-counter-touch-target/);
      expect(container).not.toMatch(/overflow:\s*hidden/);
    });
  });
});

const POP_MS = 100;
