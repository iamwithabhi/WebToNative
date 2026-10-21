import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { Spinner } from '../Spinner';
import './button.css';

const button = cva('ds-button', {
  variants: {
    variant: {
      primary: 'bg-brand-500 text-text-onBrand border-transparent',
      secondary: 'bg-surface-default text-text-primary border-border-default',
      ghost: 'bg-transparent text-text-primary border-transparent',
      destructive: 'bg-danger-500 text-text-onBrand border-transparent',
    },
    size: {
      sm: 'px-space-sm py-space-xs gap-space-xs rounded-radius-sm text-textSize-sm',
      md: 'px-space-md py-space-sm gap-space-xs rounded-radius-md text-textSize-md',
      lg: 'px-space-lg py-space-md gap-space-sm rounded-radius-md text-textSize-lg',
    },
  },
  defaultVariants: {
    variant: 'primary',
    size: 'md',
  },
});

export interface ButtonProps extends VariantProps<typeof button> {
  /** Visible text. Also used as the accessible name. */
  label: string;
  iconStart?: ReactNode;
  fullWidth?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export function Button({
  label,
  iconStart,
  fullWidth = false,
  loading = false,
  disabled = false,
  onClick,
  variant,
  size,
}: ButtonProps) {
  return (
    <button
      className={button({ variant, size })}
      role="button"
      aria-busy={loading}
      aria-disabled={disabled}
      disabled={disabled || loading}
      data-full-width={fullWidth}
      onClick={onClick}
    >
      {loading ? <Spinner className="ds-button__spinner" /> : iconStart}
      <span className="ds-button__label">{label}</span>
    </button>
  );
}
