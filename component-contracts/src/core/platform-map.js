/*
 * Every web -> iOS / Android mapping.
 *
 * The data lives in platform-map.json so it can be read by anything — a
 * reviewer, a Swift or Kotlin tool, an agent — without running JavaScript.
 * This file holds only what JSON cannot express: the derived lookups and the
 * three functions that interpret the tables.
 *
 * If you are changing a mapping, change the JSON.
 */

import { readFileSync } from 'node:fs';

const DATA = JSON.parse(readFileSync(new URL('./platform-map.json', import.meta.url), 'utf8'));

/* ================================================================== *
 * 1. Accessibility roles
 * ================================================================== */

export const A11Y_ROLE_MAP = DATA.accessibilityRoles;

/** The accepted roles are exactly the ones the table maps. */
export const A11Y_ROLES = Object.keys(A11Y_ROLE_MAP);

/**
 * How a platform expresses a role.
 *
 * `plain` means the native control already carries the semantics and nothing
 * needs adding. `hidden` means deliberately not exposed. Neither is the same
 * as `unmapped`, which means no equivalent exists and a decision is owed.
 */
/**
 * How a platform expresses a role.
 *
 * The precedence and the text formats are data — see `roleExpression` in the
 * JSON — so a reader in any language can reproduce this exactly rather than
 * inferring that `traits: ["isButton"]` means `.isButton`. What is left here
 * is a generic interpreter that knows nothing about accessibility.
 */
export function platformRole(role, platform) {
  if (!role) return null;
  const mapping = A11Y_ROLE_MAP[role]?.[platform];
  const { order, forms, unmapped } = DATA.roleExpression;
  const actions = mapping?.actions || [];
  const nothing = { ...unmapped, source: role, actions: [] };
  if (!mapping) return nothing;

  for (const field of order) {
    const value = mapping[field];
    if (value == null || value === false || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;

    const form = forms[field];
    const text = Array.isArray(value)
      ? value.map((v) => form.template.replace('{item}', v)).join(form.join ?? '')
      : form.template.replace('{value}', value);

    /*
     * `text` renders the platform's own spelling — `.adjustable`, `Role.Button`
     * — which is Swift and Compose syntax. `kind` and `concept` are the same
     * mapping without the punctuation, for consumers that write it themselves.
     */
    return {
      text,
      kind: field,
      concept: Array.isArray(value) ? value : value === true ? field : value,
      ...(form.flag ? { [form.flag]: true } : {}),
      actions,
      source: role,
    };
  }

  return nothing;
}

/* ================================================================== *
 * 2. Accessibility states
 * ================================================================== */

export const A11Y_STATE_MAP = DATA.accessibilityStates;

/* ================================================================== *
 * 3. Touch targets
 * ================================================================== */

export const TARGET_FLOOR = DATA.touchTargets.floor;
export const TARGET_UNIT = DATA.touchTargets.unit;

/* ================================================================== *
 * 4. Animatable properties
 * ================================================================== */

export const ANIMATABLE_PROPERTY = DATA.animatableProperties;

/** Safe to animate is, by definition, what the table has a mapping for. */
export const SAFE_ANIMATABLE = new Set(Object.keys(ANIMATABLE_PROPERTY));

/** Rejected, with the reason kept so the refusal stays reviewable. */
export const UNSAFE_ANIMATABLE = DATA.refusedForMotion;

/** The platform's name for an animated property. */
export const platformProperty = (prop, platform) => ANIMATABLE_PROPERTY[prop]?.[platform] || prop;

/* ================================================================== *
 * 5. States
 * ================================================================== */

export const POINTER_ONLY_STATES = new Set(DATA.pointerOnlyStates);

/* ================================================================== *
 * 6. Adaptable mechanisms
 * ================================================================== */

export const MECHANISM_PLATFORMS = DATA.mechanismPlatforms;

/* ================================================================== *
 * 7. Values
 *
 * There is no Swift-or-Kotlin type table here any more. The spec is data and
 * carries each token's declared type, so the consuming team picks CGFloat, Dp,
 * or whatever their codebase uses. Keeping that mapping would have described a
 * translation this tool no longer performs.
 * ================================================================== */

/** CSS-wide keywords that are values in their own right, not tokens. */
export const CSS_KEYWORDS = new Set(DATA.cssKeywords);

/* ================================================================== *
 * 8. Reading the web source
 *
 * Not a platform mapping, but the other half of the translation: how a web
 * component's CSS and markup become contract concepts.
 * ================================================================== */

export const CSS_PROP_ROLE = DATA.source.cssPropertyRole;
export const VISUAL_PROPERTY = { ...CSS_PROP_ROLE, ...DATA.source.visualProperties };
export const PSEUDO_STATE = DATA.source.pseudoState;
export const UTILITY_ROLES = DATA.source.utilityRoles;
export const NATIVE_ACTIVATION = DATA.source.nativeActivation;

/** Infer what kind of token this is from the role it fills. */
export function typeForRole(role) {
  return DATA.tokenTypeByRole[role] || DATA.tokenTypeDefault;
}

/* ================================================================== *
 * 9. Animation
 *
 * Timing curves and springs. The physics that converts between them is
 * maths, not a mapping, and lives in animation.js.
 * ================================================================== */

export const NAMED_CURVES = DATA.namedCurves;
export const CURVE_API = DATA.curveApi;
export const SPRING_API = DATA.springApi;

/* ================================================================== *
 * 10. Layout, animation and idioms
 *
 * What a component's CSS means in platform-neutral terms, and how the two
 * frameworks the teams use spell it. All of it is data in the JSON; nothing
 * here decides anything.
 * ================================================================== */

/** CSS properties that exist only in a browser. Dropped by design, and recorded. */
export const WEB_ONLY_PROPERTIES = DATA.source.webOnlyProperties;

/** CSS role -> where it lands in the spec, and which value table reads it. */
export const SEMANTIC_FIELDS = DATA.semantics.fields;
export const SEMANTIC_VALUES = DATA.semantics.values;
export const HIT_AREA_PATTERN = DATA.semantics.hitArea;

/** How the text properties of a node are recognised as one typography token. */
export const TYPOGRAPHY = DATA.semantics.typography;

/** Web event and feedback names -> the concept each stands for. See the table's own note. */
export const SOURCE_EVENTS = Object.fromEntries(Object.entries(DATA.semantics.events).filter(([k]) => k !== '$note'));

export const ANIMATION = DATA.animation;

/** Per-concept SwiftUI and Compose idioms. Advisory, never authoritative. */
export const IDIOMS = DATA.idioms;
