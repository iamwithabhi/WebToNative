import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { icons, iconNames } from './generated/registry';

// Not bound to `component: Icon` — Icon requires viewBox/children that only the
// generated wrappers supply, so these stories document the set, not the primitive.
const meta: Meta = {
  title: 'Foundations/Icons',
  parameters: { controls: { disable: true } },
};

export default meta;
type Story = StoryObj;

/** All {@link iconNames} icons. Colour comes from Semantic.Color.Icon.* via the `tone` prop. */
export const Gallery: Story = {
  render: () => {
    const [query, setQuery] = useState('');
    const matches = iconNames.filter((n) => n.toLowerCase().includes(query.toLowerCase()));

    return (
      <div style={{ fontFamily: 'var(--semantic-font-family-default)' }}>
        <label style={{ display: 'block', marginBottom: 'var(--semantic-spacing-16)' }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Filter ${iconNames.length} icons…`}
            style={{
              padding: 'var(--semantic-spacing-8) var(--semantic-spacing-12)',
              width: 280,
              border: 'var(--semantic-border-width-default) solid var(--semantic-color-border-muted)',
              borderRadius: 'var(--semantic-border-radius-8)',
              background: 'var(--semantic-color-background-default)',
              color: 'var(--semantic-color-text-primary)',
              font: 'inherit',
            }}
          />
        </label>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))',
            gap: 'var(--semantic-spacing-8)',
          }}
        >
          {matches.map((name) => {
            const IconComponent = icons[name];
            return (
              <div
                key={name}
                title={name}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 'var(--semantic-spacing-8)',
                  padding: 'var(--semantic-spacing-12)',
                  borderRadius: 'var(--semantic-border-radius-8)',
                  background: 'var(--semantic-color-background-subtle)',
                }}
              >
                <IconComponent size="lg" tone="bold" />
                <span
                  style={{
                    fontSize: 'var(--semantic-font-size-10)',
                    color: 'var(--semantic-color-text-muted)',
                    textAlign: 'center',
                    wordBreak: 'break-word',
                  }}
                >
                  {name}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  },
};

/** Tones resolve to semantic icon tokens and flip automatically with the theme. */
export const Tones: Story = {
  render: () => {
    const First = icons[iconNames[0]!]!;
    return (
      <div style={{ display: 'flex', gap: 'var(--semantic-spacing-16)', alignItems: 'center' }}>
        {(['bold', 'rich', 'emphasis', 'muted', 'soft', 'brand', 'success', 'warning', 'danger', 'info'] as const).map(
          (tone) => (
            <First key={tone} size="lg" tone={tone} title={tone} />
          ),
        )}
      </div>
    );
  },
};

/** Sizes resolve to Semantic.Size.* — 12 / 16 / 20 / 24 / 32. */
export const Sizes: Story = {
  render: () => {
    const First = icons[iconNames[0]!]!;
    return (
      <div style={{ display: 'flex', gap: 'var(--semantic-spacing-16)', alignItems: 'center' }}>
        {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((size) => (
          <First key={size} size={size} tone="bold" title={size} />
        ))}
      </div>
    );
  },
};
