import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { AddSmallIcon } from '../icons/generated/AddSmallIcon';
import { RemoveSmallIcon } from '../icons/generated/RemoveSmallIcon';
import './counter.css';

/** Repeat interval while a button is held. */
const HOLD_INTERVAL_MS = 150;
/** How long the value stays scaled up after a change. */
const POP_MS = 100;
/** Haptic pulse length on supporting devices. */
const HAPTIC_MS = 8;
/** PageUp/PageDown multiplier. */
const LARGE_STEP_FACTOR = 10;

export interface CounterProps {
  /** Controlled value. Pair with `onChange`. */
  value?: number;
  /** Starting value when uncontrolled. */
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
  /** Fired with the clamped next value on every increment/decrement. */
  onChange?: (value: number) => void;
  /** Read-only. Exposed as `aria-readonly`; the value stays focusable and readable. */
  frozen?: boolean;
  fullWidth?: boolean;
  /**
   * Accessible name for the spinbutton, e.g. "Quantity". Make it specific when a
   * page has more than one Counter — "Quantity, Blue T-shirt" beats "Quantity".
   * Ignored when `labelledBy` is set.
   */
  label?: string;
  /**
   * `id` of existing visible text to name the spinbutton. Prefer this over
   * `label` when the name is already on screen, so the two cannot drift apart.
   */
  labelledBy?: string;
  /** `id` of supporting text (help, limits, errors) to associate with the value. */
  describedBy?: string;
  /**
   * Human-readable rendering of the value for assistive tech, e.g. `(n) => \`${n} items\``.
   * Maps to `aria-valuetext`. Use when the bare number is ambiguous out of context.
   */
  formatValueText?: (value: number) => string;
  /**
   * Overrides the decrement button's name. Defaults to `"Decrease <label>"` so the
   * button says what it acts on rather than a bare "Decrease".
   */
  decrementLabel?: string;
  /** Overrides the increment button's name. Defaults to `"Increase <label>"`. */
  incrementLabel?: string;
  className?: string;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function Counter({
  value: controlledValue,
  defaultValue = 0,
  min = 0,
  max = 99,
  step = 1,
  onChange,
  frozen = false,
  fullWidth = false,
  label = 'Quantity',
  labelledBy,
  describedBy,
  formatValueText,
  decrementLabel,
  incrementLabel,
  className,
}: CounterProps) {
  const isControlled = controlledValue !== undefined;
  const [uncontrolled, setUncontrolled] = useState(() => clamp(defaultValue, min, max));
  const value = clamp(isControlled ? controlledValue : uncontrolled, min, max);

  const [pop, setPop] = useState(false);
  const popTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const holdTimer = useRef<ReturnType<typeof setInterval>>(undefined);
  const spinRef = useRef<HTMLDivElement>(null);
  /** Read inside the repeat interval so it always sees the current value. */
  const valueRef = useRef(value);
  valueRef.current = value;

  const stopHold = useCallback(() => {
    clearInterval(holdTimer.current);
    holdTimer.current = undefined;
  }, []);

  useEffect(
    () => () => {
      clearInterval(holdTimer.current);
      clearTimeout(popTimer.current);
    },
    [],
  );

  // A pointerup anywhere ends the hold — releasing off the button must not keep it running.
  useEffect(() => {
    if (frozen) return;
    window.addEventListener('pointerup', stopHold);
    window.addEventListener('pointercancel', stopHold);
    return () => {
      window.removeEventListener('pointerup', stopHold);
      window.removeEventListener('pointercancel', stopHold);
    };
  }, [frozen, stopHold]);

  const setValue = useCallback(
    (next: number) => {
      const clamped = clamp(next, min, max);
      if (clamped === valueRef.current) {
        stopHold();
        return;
      }

      valueRef.current = clamped;
      if (!isControlled) setUncontrolled(clamped);
      onChange?.(clamped);

      setPop(true);
      clearTimeout(popTimer.current);
      popTimer.current = setTimeout(() => setPop(false), POP_MS);

      navigator.vibrate?.(HAPTIC_MS);
    },
    [isControlled, max, min, onChange, stopHold],
  );

  const nudge = useCallback((delta: number) => setValue(valueRef.current + delta), [setValue]);

  const startHold = useCallback(
    (delta: number) => {
      nudge(delta);
      stopHold();
      holdTimer.current = setInterval(() => nudge(delta), HOLD_INTERVAL_MS);
    },
    [nudge, stopHold],
  );

  /**
   * Buttons sit outside the tab order, so a pointer press moves focus onto the
   * spinbutton. That keeps every change happening on the focused element, which
   * is what makes assistive tech announce the new value — without a live region
   * that would double-speak during keyboard stepping.
   */
  const focusSpin = () => spinRef.current?.focus();

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (frozen) return;
    const large = step * LARGE_STEP_FACTOR;
    const actions: Record<string, () => void> = {
      ArrowUp: () => nudge(step),
      ArrowRight: () => nudge(step),
      ArrowDown: () => nudge(-step),
      ArrowLeft: () => nudge(-step),
      PageUp: () => nudge(large),
      PageDown: () => nudge(-large),
      Home: () => setValue(min),
      End: () => setValue(max),
    };
    const action = actions[e.key];
    if (!action) return;
    e.preventDefault();
    action();
  };

  const atMin = value <= min;
  const atMax = value >= max;

  /*
   * Button names. A bare "Decrease" is ambiguous the moment a page has two
   * Counters, and these buttons are outside the tab order — they are reached by
   * touch exploration, where the surrounding context is not read out. So the
   * action is composed with the field name: "Decrease Quantity".
   *
   * When the name lives in another element (labelledBy) there is no string to
   * compose with, so the action stands alone unless the caller supplies one.
   */
  const spinId = useId();
  const nameForActions = labelledBy ? null : label;
  const decrementName = decrementLabel ?? (nameForActions ? `Decrease ${nameForActions}` : 'Decrease');
  const incrementName = incrementLabel ?? (nameForActions ? `Increase ${nameForActions}` : 'Increase');

  /**
   * `aria-disabled` rather than the native attribute. A natively disabled button
   * is not a focusable area, so hitting a bound while it holds focus drops focus
   * to the document. This keeps it focusable and announced as unavailable.
   */
  const buttonProps = (delta: number, unavailable: boolean) => {
    const blocked = frozen || unavailable;
    return {
      tabIndex: -1,
      'aria-disabled': blocked || undefined,
      ...(blocked
        ? {}
        : {
            onPointerDown: () => {
              focusSpin();
              startHold(delta);
            },
            onPointerLeave: stopHold,
            // detail === 0 means keyboard activation, which emits no pointer events.
            onClick: (e: MouseEvent) => {
              if (e.detail === 0) nudge(delta);
            },
          }),
    };
  };

  return (
    <div
      className={className ? `ds-counter ${className}` : 'ds-counter'}
      data-full-width={fullWidth}
      data-frozen={frozen || undefined}
    >
      <button
        type="button"
        className="ds-counter__button"
        aria-label={decrementName}
        {...buttonProps(-step, atMin)}
      >
        <RemoveSmallIcon className="ds-counter__icon" size="sm" />
      </button>

      <div
        ref={spinRef}
        id={spinId}
        className="ds-counter__value"
        data-pop={pop}
        role="spinbutton"
        tabIndex={0}
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={formatValueText?.(value)}
        aria-readonly={frozen || undefined}
        onKeyDown={onKeyDown}
      >
        {value}
      </div>

      <button
        type="button"
        className="ds-counter__button"
        aria-label={incrementName}
        {...buttonProps(step, atMax)}
      >
        <AddSmallIcon className="ds-counter__icon" size="sm" />
      </button>
    </div>
  );
}
