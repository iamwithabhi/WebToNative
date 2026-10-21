/**
 * Motion curve conversion.
 *
 * The contract stores springs in ONE canonical physical form:
 *   { type: "spring", stiffness, damping, mass }
 *
 * Every platform parameterises springs differently. Doing these conversions
 * here — once — is the only way the three platforms stay visually identical.
 * This is the single highest-risk piece of maths in the resolver, which is why
 * it lives alone in its own module with its own tests.
 */

import { NAMED_CURVES, CURVE_API, SPRING_API } from './platform-map.js';

export { NAMED_CURVES };

const round = (n, dp = 4) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/* ------------------------------------------------------------------ *
 * Spring physics
 * ------------------------------------------------------------------ */

/**
 * Undamped natural frequency (rad/s).
 *   omega_n = sqrt(k / m)
 */
export const naturalFrequency = (stiffness, mass) => Math.sqrt(stiffness / mass);

/**
 * Damping ratio (dimensionless).
 *   zeta = c / (2 * sqrt(k * m))
 *
 * < 1 underdamped (overshoots), = 1 critically damped, > 1 overdamped.
 */
export const dampingRatio = (stiffness, damping, mass) =>
  damping / (2 * Math.sqrt(stiffness * mass));

/**
 * Time for the response to settle inside `threshold` of its final value.
 * Used to check a spring against an envelope's maxDurationMs.
 */
export function settlingTime(stiffness, damping, mass, threshold = 0.01) {
  const wn = naturalFrequency(stiffness, mass);
  const z = dampingRatio(stiffness, damping, mass);

  if (z < 1) {
    // Underdamped: envelope decays as e^(-z*wn*t) / sqrt(1 - z^2)
    const t = -Math.log(threshold * Math.sqrt(1 - z * z)) / (z * wn);
    return Math.max(t, 0);
  }

  if (Math.abs(z - 1) < 1e-9) {
    // Critically damped: solve (1 + wn*t) * e^(-wn*t) = threshold by bisection.
    let lo = 0;
    let hi = 50 / wn;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      const y = (1 + wn * mid) * Math.exp(-wn * mid);
      if (y > threshold) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // Overdamped: the slower of the two real roots dominates.
  const slow = wn * (z - Math.sqrt(z * z - 1));
  return -Math.log(threshold) / slow;
}

/* ------------------------------------------------------------------ *
 * Per-platform conversion
 * ------------------------------------------------------------------ */

/**
 * Convert a canonical spring into every supported platform's parameterisation.
 */
export function convertSpring({ stiffness, damping, mass = 1 }) {
  if (!(stiffness > 0)) throw new Error('spring.stiffness must be > 0');
  if (!(damping >= 0)) throw new Error('spring.damping must be >= 0');
  if (!(mass > 0)) throw new Error('spring.mass must be > 0');

  const wn = naturalFrequency(stiffness, mass);
  const zeta = dampingRatio(stiffness, damping, mass);
  const settleMs = settlingTime(stiffness, damping, mass) * 1000;

  return {
    canonical: { stiffness, damping, mass },
    dampingRatio: round(zeta),
    naturalFrequency: round(wn),
    settlingMs: Math.round(settleMs),
    overshoots: zeta < 1,

    // SwiftUI: `.spring(response:dampingFraction:)` is the idiomatic form.
    // `.interpolatingSpring(mass:stiffness:damping:)` takes the canonical
    // values directly and is emitted as an exact alternative.
    ios: {
      call: SPRING_API.ios.call,
      exact: SPRING_API.ios.exact,
      response: round((2 * Math.PI) / wn),
      dampingFraction: round(zeta),
      interpolating: { mass, stiffness, damping },
    },

    // Compose: `spring(dampingRatio, stiffness)` assumes unit mass, so the
    // stiffness must be normalised by mass.
    android: {
      call: SPRING_API.android.call,
      dampingRatio: round(zeta),
      stiffness: round(stiffness / mass),
    },

    // Web (Framer Motion / Motion One) accepts the canonical form directly.
    web: { call: SPRING_API.web.call, stiffness, damping, mass },
  };
}

/** Express a set of control points through each platform's curve API. */
function curveShape(v, cssOverride = null) {
  return {
    ios: { [CURVE_API.ios.key]: v },
    android: { [CURVE_API.android.key]: v },
    web: { [CURVE_API.web.key]: cssOverride || `cubic-bezier(${v.join(', ')})` },
  };
}

/**
 * Normalise any contract curve into a resolved, per-platform shape.
 */
export function resolveCurve(curve) {
  if (!curve || !curve.type) {
    throw new Error('Motion entry is missing a curve');
  }

  if (curve.type === 'spring') {
    return { type: 'spring', ...convertSpring(curve) };
  }

  if (curve.type === 'cubicBezier') {
    const v = curve.value;
    if (!Array.isArray(v) || v.length !== 4 || v.some((n) => typeof n !== 'number')) {
      throw new Error('cubicBezier curve requires a 4-number `value` array');
    }
    return {
      type: 'cubicBezier',
      value: v,
      ...curveShape(v),
    };
  }

  if (curve.type in NAMED_CURVES) {
    const v = NAMED_CURVES[curve.type];
    return {
      type: 'cubicBezier',
      named: curve.type,
      value: v,
      ...curveShape(v, curve.type === 'linear' ? 'linear' : null),
    };
  }

  throw new Error(`Unknown curve type "${curve.type}"`);
}

/**
 * Effective duration of a motion entry in ms — explicit duration for timing
 * curves, computed settling time for springs. Envelope checks use this.
 */
export function effectiveDurationMs(resolvedCurve, explicitDurationMs) {
  if (resolvedCurve.type === 'spring') return resolvedCurve.settlingMs;
  return explicitDurationMs ?? null;
}
