import type { Preview, Decorator } from '@storybook/react-vite';
// The tokens name Inter but do not ship it. Load the weights the tokens use
// (regular, medium, semi-bold, bold) so stories do not fall back to system-ui.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '../src/tokens/index.css';

/** Applies the Light/Dark token mode from the toolbar. */
const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme ?? 'light';
  document.documentElement.setAttribute('data-theme', theme);
  document.body.style.background =
    'var(--semantic-color-surface-app-background, var(--semantic-color-background-default))';
  document.body.style.color = 'var(--semantic-color-text-primary)';
  return Story();
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: 'Token theme mode',
      defaultValue: 'light',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'light', title: 'Light', icon: 'sun' },
          { value: 'dark', title: 'Dark', icon: 'moon' },
        ],
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },
    a11y: { test: 'error' },
  },
};

export default preview;
