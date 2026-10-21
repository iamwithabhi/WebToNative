# Counter

**Contract** `counter@0.1.0` · **Platforms** ios, android

Everything below was read from the component. Nothing is inferred.

## Structure

The element tree as the markup states it. **renders** is what a node
draws; **announced as** is an accessible name, which is spoken but never
displayed.

- **root** — `<div>`
  - **button** — role `button` · announced as `decrementName`, computed in the component · `<button>`
    - **icon** — `<RemoveSmallIcon>`
  - **value** — role `spinbutton` · renders `value`, computed in the component · announced as `labelledBy ? undefined : label` · `<div>`
  - **button2** — role `button` · announced as `incrementName`, computed in the component · `<button>`
    - **icon2** — `<AddSmallIcon>`

### Styling each node applies to itself

Sparse on purpose — a blank cell means the node does not set that
property, not that a value is missing.

| Node | State | display | alignItems | boxSizing | width | height | borderStyle | borderWidth | borderColor | radius | fill | position | flexGrow | flexShrink | flexBasis | alignSelf | justifyContent | padTop | padRight | padBottom | padLeft | labelColor | typography | fontVariantNumeric |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `root` | idle | `inline-flex` | `center` | `border-box` | `{"expression":"2 * {semantic.size.40} + {semantic.size.24}","syntax":"arithmetic"}` | `{semantic.size.32}` | `solid` | `{semantic.border.width.default}` | `{semantic.color.border.moderate}` | `{semantic.border.radius.8}` | `{semantic.color.background.default}` |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `button` | idle | `flex` | `center` |  |  |  |  | `0` |  |  | `none` | `relative` | `1` | `1` | `0` | `stretch` | `center` | `{semantic.spacing.0}` | `{semantic.spacing.0}` | `{semantic.spacing.0}` | `{semantic.spacing.0}` | `{semantic.color.icon.brand.primary}` |  |  |
| `icon` | idle | `block` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `value` | idle | `flex` | `center` |  | `{semantic.size.24}` |  |  |  |  |  |  |  | `0` | `0` | `{semantic.size.24}` | `stretch` | `center` |  |  |  |  | `{semantic.color.text.primary}` | `{semantic.typography.label.l}` | `tabular-nums` |
| `button2` | idle | `flex` | `center` |  |  |  |  | `0` |  |  | `none` | `relative` | `1` | `1` | `0` | `stretch` | `center` | `{semantic.spacing.0}` | `{semantic.spacing.0}` | `{semantic.spacing.0}` | `{semantic.spacing.0}` | `{semantic.color.icon.brand.primary}` |  |  |
| `icon2` | idle | `block` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

### Text token

The text on each node comes from one typography token, which stands for its font family,
size, weight, line height and letter spacing. Resolve it like any other token.

| Node | Applies when | Token |
|---|---|---|
| `value` | always | `{semantic.typography.label.l}` |

Laid out horizontal, center-aligned.

## API

| Prop | Kind | Required | Default | Notes |
|---|---|---|---|---|
| `value` | number | no | — | — |
| `defaultValue` | number | no | 0 | — |
| `min` | number | no | 0 | — |
| `max` | number | no | 99 | — |
| `step` | number | no | 1 | — |
| `onChange` | event | no | — | — |
| `frozen` | boolean | no | false | — |
| `fullWidth` | boolean | no | false | — |
| `label` | string | no | Quantity | — |
| `labelledBy` | string | no | — | — |
| `describedBy` | string | no | — | — |
| `formatValueText` | function | no | — | — |
| `decrementLabel` | string | no | — | — |
| `incrementLabel` | string | no | — | — |
| `className` | string | no | — | — |

## Applied tokens

Resolved for `ios`. Other platforms differ only where a state does not apply.

| Variant | Size | State | display | alignItems | boxSizing | width | height | borderStyle | borderWidth | borderColor | radius | fill |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| default | default | idle | `inline-flex` | `center` | `border-box` | `{"expression":"2 * {semantic.size.40} + {semantic.size.24}","syntax":"arithmetic"}` | `{semantic.size.32}` | `solid` | `{semantic.border.width.default}` | `{semantic.color.border.moderate}` | `{semantic.border.radius.8}` | `{semantic.color.background.default}` |
| default | default | focused | `inline-flex` | `center` | `border-box` | `{"expression":"2 * {semantic.size.40} + {semantic.size.24}","syntax":"arithmetic"}` | `{semantic.size.32}` | `solid` | `{semantic.border.width.default}` | `{semantic.color.border.moderate}` | `{semantic.border.radius.8}` | `{semantic.color.background.default}` |
| default | default | pressed | `inline-flex` | `center` | `border-box` | `{"expression":"2 * {semantic.size.40} + {semantic.size.24}","syntax":"arithmetic"}` | `{semantic.size.32}` | `solid` | `{semantic.border.width.default}` | `{semantic.color.border.moderate}` | `{semantic.border.radius.8}` | `{semantic.color.background.default}` |

## Animation

Each animation names the node it acts on, what it starts from, what it goes to and
when. Nothing here is a bare "transform": the function and the target are stated.

| Animation | Starts from | Goes to | When | Timing | Reduced motion |
|---|---|---|---|---|---|
| `icon` · transform | scale 1 | scale 0.9 | button: aria-disabled ≠ true (set by `buttonProps(-step, atMin)`, see Behaviour) and button: pressed | 100ms linear | 0.01ms (effectively instant) |
| `icon2` · transform | scale 1 | scale 0.9 | button2: aria-disabled ≠ true (set by `buttonProps(step, atMax)`, see Behaviour) and button2: pressed | 100ms linear | 0.01ms (effectively instant) |
| `value` · transform | scale 1 | scale 1.1 | value: data-pop = true (state `pop`, set in setValue) | 100ms linear | 0.01ms (effectively instant) |

## Behaviour (source)

A stylesheet cannot say when a control is disabled, what holding it does or which keys act on it.
That is logic, quoted here exactly as written for the platform team to translate. Nothing is
evaluated or summarised, and only statements the markup reaches are included.

| Event or feedback | Name in the source | Found in |
|---|---|---|
| `event.pointerDown` | `onPointerDown` | `buttonProps` |
| `event.pointerUp` | `pointerup` | `useEffect#2` |
| `event.pointerCancel` | `pointercancel` | `useEffect#2` |
| `event.pointerLeave` | `onPointerLeave` | `buttonProps` |
| `event.keyDown` | `onKeyDown` | `onKeyDown`, `node:value` |
| `event.click` | `onClick` | `buttonProps` |
| `feedback.haptic` | `vibrate` | `setValue` |

### `clamp` · function

```ts
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
```

### `isControlled` · value

```ts
const isControlled = controlledValue !== undefined;
```

### `uncontrolled` · state (useState) (also `setUncontrolled`)

```ts
const [uncontrolled, setUncontrolled] = useState(() => clamp(defaultValue, min, max));
```
Uses `clamp`.

### `value` · value

```ts
const value = clamp(isControlled ? controlledValue : uncontrolled, min, max);
```
Uses `clamp`, `isControlled`, `uncontrolled`.

### `pop` · state (useState) (also `setPop`)

```ts
const [pop, setPop] = useState(false);
```

### `popTimer` · state (useRef)

```ts
const popTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
```

### `holdTimer` · state (useRef)

```ts
const holdTimer = useRef<ReturnType<typeof setInterval>>(undefined);
```

### `spinRef` · state (useRef)

```ts
const spinRef = useRef<HTMLDivElement>(null);
```

### `valueRef` · state (useRef)

```ts
const valueRef = useRef(value);
```
Uses `value`.

### `valueRef.current` · assignment

```ts
valueRef.current = value;
```
Uses `value`, `valueRef`.

### `stopHold` · function

```ts
const stopHold = useCallback(() => {
    clearInterval(holdTimer.current);
    holdTimer.current = undefined;
  }, []);
```
Uses `holdTimer`.

### `useEffect#1` · effect

```ts
useEffect(
    () => () => {
      clearInterval(holdTimer.current);
      clearTimeout(popTimer.current);
    },
    [],
  );
```
Uses `holdTimer`, `popTimer`.

### `useEffect#2` · effect

```ts
useEffect(() => {
    if (frozen) return;
    window.addEventListener('pointerup', stopHold);
    window.addEventListener('pointercancel', stopHold);
    return () => {
      window.removeEventListener('pointerup', stopHold);
      window.removeEventListener('pointercancel', stopHold);
    };
  }, [frozen, stopHold]);
```
Uses `stopHold`.

### `setValue` · function

```ts
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
```
Uses `clamp`, `isControlled`, `pop`, `popTimer`, `stopHold`, `uncontrolled`, `valueRef`.

### `nudge` · function

```ts
const nudge = useCallback((delta: number) => setValue(valueRef.current + delta), [setValue]);
```
Uses `setValue`, `valueRef`.

### `startHold` · function

```ts
const startHold = useCallback(
    (delta: number) => {
      nudge(delta);
      stopHold();
      holdTimer.current = setInterval(() => nudge(delta), HOLD_INTERVAL_MS);
    },
    [nudge, stopHold],
  );
```
Uses `holdTimer`, `nudge`, `stopHold`.

### `focusSpin` · function

```ts
const focusSpin = () => spinRef.current?.focus();
```
Uses `spinRef`.

### `onKeyDown` · function

```ts
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
```
Uses `nudge`, `setValue`.

### `atMin` · value

```ts
const atMin = value <= min;
```
Uses `value`.

### `atMax` · value

```ts
const atMax = value >= max;
```
Uses `value`.

### `spinId` · state (useId)

```ts
const spinId = useId();
```

### `nameForActions` · value

```ts
const nameForActions = labelledBy ? null : label;
```

### `decrementName` · value

```ts
const decrementName = decrementLabel ?? (nameForActions ? `Decrease ${nameForActions}` : 'Decrease');
```
Uses `nameForActions`.

### `incrementName` · value

```ts
const incrementName = incrementLabel ?? (nameForActions ? `Increase ${nameForActions}` : 'Increase');
```
Uses `nameForActions`.

### `buttonProps` · function

```ts
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
```
Uses `focusSpin`, `nudge`, `startHold`, `stopHold`.

## Accessibility

| | ios | android |
|---|---|---|
| Root role | — | — |
| Minimum target | 44pt | 48dp |

### Inner nodes

A root with no role is normal when the interactive parts are children.
Source roles are ARIA; each platform column shows what it becomes there.

| Node | Source role | Translates to | Named by |
|---|---|---|---|
| button | `button` | ios .isButton · android Role.Button | `decrementName`, computed in the component |
| value | `spinbutton` | ios .adjustable · android stateDescription | `labelledBy ? undefined : label` |
| button2 | `button` | ios .isButton · android Role.Button | `incrementName`, computed in the component |

## Not stated by the component

These are absent from the source rather than wrong. They are recorded
here so a reviewer can decide whether they should be.

- What is this component for, in one sentence?
- What visual variants does this component have?
- What sizes does this component come in?
- What is this, to a screen reader?

## Platform specs

| Platform | File |
|---|---|
| ios | `platform-specs/counter/ios.json` |
| android | `platform-specs/counter/android.json` |

---

*Generated from `counter.contract.json`. Edit the component, not this file.*
