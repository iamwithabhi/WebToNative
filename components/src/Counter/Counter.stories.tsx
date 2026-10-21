import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Counter } from './Counter';

const meta = {
  title: 'Components/Counter',
  component: Counter,
  tags: ['autodocs'],
  argTypes: {
    value: {
      control: false,
      description: 'Controlled value. Pair with `onChange`. Omit to let the counter manage its own state.',
      table: { type: { summary: 'number' } },
    },
    defaultValue: { control: { type: 'number' } },
    min: { control: { type: 'number' } },
    max: { control: { type: 'number' } },
    step: { control: { type: 'number' } },
    onChange: {
      action: 'changed',
      control: false,
      description:
        'Callback fired with the clamped next value on every increment/decrement. Not called when already at `min`/`max`. Calls are logged in the **Actions** panel.',
      table: {
        category: 'Events',
        type: { summary: '(value: number) => void' },
      },
    },
  },
  args: {
    defaultValue: 1,
    min: 0,
    max: 99,
    step: 1,
    label: 'Quantity',
  },
} satisfies Meta<typeof Counter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** At `min` the decrement button is disabled and takes the disabled icon token. */
export const AtMinimum: Story = { args: { defaultValue: 0 } };

/** At `max` the increment button is disabled. */
export const AtMaximum: Story = { args: { defaultValue: 99 } };

/** Two digits confirm the tabular-figure alignment holds as the value widens. */
export const TwoDigits: Story = { args: { defaultValue: 42 } };

/** Read-only: buttons are disabled and press-and-hold is never bound. */
export const Frozen: Story = { args: { frozen: true, defaultValue: 3 } };

export const FullWidth: Story = {
  args: { fullWidth: true },
  decorators: [
    (Story) => (
      <div style={{ width: 280 }}>
        <Story />
      </div>
    ),
  ],
};

export const CustomRange: Story = { args: { min: 1, max: 5, defaultValue: 1, step: 1 } };

/** Driving the value from outside — the parent owns state. */
export const Controlled: Story = {
  args: { value: 2 },
  render: function ControlledCounter(args) {
    const [value, setValue] = useState(2);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--semantic-spacing-16)' }}>
        <Counter {...args} value={value} onChange={setValue} />
        <span
          style={{
            fontFamily: 'var(--semantic-typography-body-m-font-family)',
            fontSize: 'var(--semantic-typography-body-m-font-size)',
            color: 'var(--semantic-color-text-secondary)',
          }}
        >
          parent state: {value}
        </span>
      </div>
    );
  },
};

/** `aria-valuetext` gives assistive tech a phrase when the bare number is ambiguous. */
export const WithValueText: Story = {
  args: { defaultValue: 2, formatValueText: (n) => `${n} ${n === 1 ? 'item' : 'items'}` },
};

/**
 * Touch targets, visualised. The dashed box is the pointer hit area (48×48);
 * the control itself is 104×32 by spec. Each overlay overhangs ~4px outward and
 * ~4px into the number — the centre of the number stays inert.
 */
export const TouchTargets: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <>
      <style>{`.tt-probe .ds-counter__button::after { outline: 1px dashed var(--semantic-color-border-brand); }`}</style>
      <div className="tt-probe" style={{ padding: 'var(--semantic-spacing-24)' }}>
        <Counter defaultValue={1} />
      </div>
    </>
  ),
};

/**
 * Button names are composed from `label`, so they say what they act on.
 * Inspect the Accessibility panel: the buttons read "Decrease Quantity, Blue
 * T-shirt" rather than a bare "Decrease" that would be identical on every row.
 */
export const NamedForContext: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--semantic-spacing-12)' }}>
      <Counter defaultValue={1} label="Quantity, Blue T-shirt" />
      <Counter defaultValue={2} label="Quantity, Grey Hoodie" />
    </div>
  ),
};

/**
 * When the name is already on screen, reference it with `labelledBy` instead of
 * repeating the string in `label` — the two can never drift apart. `describedBy`
 * attaches supporting text to the value.
 */
export const LabelledByVisibleText: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div
      style={{
        display: 'grid',
        gap: 'var(--semantic-spacing-8)',
        fontFamily: 'var(--semantic-typography-body-m-font-family)',
        fontSize: 'var(--semantic-typography-body-m-font-size)',
        color: 'var(--semantic-color-text-primary)',
      }}
    >
      <span id="ticket-label">Tickets</span>
      <Counter defaultValue={1} max={10} labelledBy="ticket-label" describedBy="ticket-help" />
      <span id="ticket-help" style={{ color: 'var(--semantic-color-text-muted)' }}>
        Maximum 10 per order
      </span>
    </div>
  ),
};

/** Fully custom button names, for flows where "Decrease" is the wrong verb. */
export const CustomButtonNames: Story = {
  args: { defaultValue: 1, decrementLabel: 'Remove one ticket', incrementLabel: 'Add one ticket' },
};
