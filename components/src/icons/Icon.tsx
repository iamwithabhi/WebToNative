import type { ReactNode, SVGProps } from 'react';
import './icon.css';

export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/**
 * Maps to Semantic.Color.Icon.* (plus status icon tokens).
 * `inherit` takes the colour from the surrounding `color`, which is what you want
 * inside a component that already sets its own semantic icon colour.
 */
export type IconTone =
  | 'inherit'
  | 'brand'
  | 'bold'
  | 'rich'
  | 'emphasis'
  | 'muted'
  | 'soft'
  | 'inverse'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children' | 'color'> {
  size?: IconSize;
  tone?: IconTone;
  /**
   * Accessible name. Omit for decorative icons — the icon is then hidden from
   * assistive technology, which is correct when adjacent text conveys the meaning.
   */
  title?: string;
}

interface InternalIconProps extends IconProps {
  viewBox: string;
  children: ReactNode;
}

export function Icon({
  size = 'md',
  tone = 'inherit',
  title,
  viewBox,
  children,
  className,
  ...rest
}: InternalIconProps) {
  const decorative = title === undefined;

  return (
    <svg
      className={className ? `ds-icon ${className}` : 'ds-icon'}
      data-size={size}
      data-tone={tone}
      viewBox={viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}
