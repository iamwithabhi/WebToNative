/*
 * The mapping tables, flattened for display.
 *
 * Every row here is read out of src/core/platform-map.js at call time. Nothing
 * is restated, so the page cannot drift from the code the emitters actually
 * use. If a mapping changes, this changes with it.
 */

import {
  A11Y_ROLE_MAP,
  A11Y_STATE_MAP,
  ANIMATABLE_PROPERTY,
  UNSAFE_ANIMATABLE,
  POINTER_ONLY_STATES,
  MECHANISM_PLATFORMS,
  TARGET_FLOOR,
  TARGET_UNIT,
  CSS_PROP_ROLE,
  VISUAL_PROPERTY,
  PSEUDO_STATE,
  UTILITY_ROLES,
  NATIVE_ACTIVATION,
  NAMED_CURVES,
  CURVE_API,
  SPRING_API,
  SEMANTIC_FIELDS,
  SEMANTIC_VALUES,
  WEB_ONLY_PROPERTIES,
  ANIMATION,
  IDIOMS,
  platformRole,
} from './platform-map.js';

const EM_DASH = '—';

/** How a platform expresses a role, in the words that platform uses. */
function roleCell(role, platform) {
  const r = platformRole(role, platform);
  if (!r?.text) return { text: EM_DASH, kind: 'missing' };

  const kind = r.hidden ? 'hidden' : r.plain ? 'plain' : 'mapped';
  const actions = r.actions?.length ? r.actions : null;
  return { text: r.text, kind, actions };
}

/** How the tables name a platform in a "Platform" column; the row key stays the id. */
const PLATFORM_LABEL = { ios: 'iOS', android: 'Android', web: 'Web' };

/** iOS and Android express a11y states through different primitives. */
function stateCell(entry, platform) {
  const v = entry?.[platform];
  if (!v) return { text: EM_DASH, kind: 'missing' };
  const text = v.trait ? `.${v.trait}` : v.semantics || v.attribute || EM_DASH;
  return { text, kind: text === EM_DASH ? 'missing' : 'mapped' };
}

/** A concept's shared note followed by any framework-specific ones, each named. */
const idiomNote = (c) =>
  [c.note, ...Object.entries(c.notes || {}).map(([fw, text]) => `${fw === 'swiftui' ? 'SwiftUI' : 'Compose'}: ${text}`)]
    .filter(Boolean)
    .join(' ');

export function mappingTables() {
  return [
    {
      id: 'roles',
      title: 'Accessibility roles',
      note:
        'What each ARIA role becomes. “Native” means the platform control already ' +
        'carries the semantics and needs nothing added — which is not the same as ' +
        'having no equivalent.',
      columns: ['Role', 'Web', 'iOS', 'Android'],
      rows: Object.entries(A11Y_ROLE_MAP).map(([role, m]) => ({
        key: role,
        cells: [
          { text: role, kind: 'key' },
          { text: m.web?.role || EM_DASH, kind: m.web?.role ? 'mapped' : 'missing' },
          roleCell(role, 'ios'),
          roleCell(role, 'android'),
        ],
      })),
    },
    {
      id: 'states',
      title: 'Accessibility states',
      note: 'How a state is announced to assistive technology on each platform.',
      columns: ['State', 'Web', 'iOS', 'Android'],
      rows: Object.entries(A11Y_STATE_MAP).map(([state, m]) => ({
        key: state,
        cells: [
          { text: state, kind: 'key' },
          { text: m.web?.attribute || EM_DASH, kind: m.web?.attribute ? 'mapped' : 'missing' },
          stateCell(m, 'ios'),
          stateCell(m, 'android'),
        ],
      })),
    },
    {
      id: 'targets',
      title: 'Touch targets',
      note: 'The smallest interactive size each platform’s guidance asks for.',
      columns: ['Platform', 'Floor', 'Unit'],
      rows: Object.keys(TARGET_FLOOR).map((p) => ({
        key: p,
        cells: [
          { text: PLATFORM_LABEL[p] ?? p, kind: 'key' },
          { text: String(TARGET_FLOOR[p]), kind: 'mapped' },
          { text: TARGET_UNIT[p], kind: 'plain' },
        ],
      })),
    },
    {
      id: 'animatable',
      title: 'Animatable properties',
      note: 'Properties that animate consistently everywhere, and each platform\u2019s name for them.',
      columns: ['Property', 'iOS', 'Android'],
      rows: Object.entries(ANIMATABLE_PROPERTY).map(([prop, m]) => ({
        key: prop,
        cells: [
          { text: prop, kind: 'key' },
          { text: m.ios, kind: 'mapped' },
          { text: m.android, kind: 'mapped' },
        ],
      })),
    },
    {
      id: 'unsafe',
      title: 'Properties refused for motion',
      note:
        'These are not emitted as animation. The reason is recorded so the ' +
        'refusal is reviewable rather than arbitrary.',
      columns: ['Property', 'Why not'],
      rows: Object.entries(UNSAFE_ANIMATABLE).map(([prop, why]) => ({
        key: prop,
        cells: [
          { text: prop, kind: 'key' },
          { text: why, kind: 'warn' },
        ],
      })),
    },
    {
      id: 'animation',
      title: 'Animation',
      note:
        'Timing curves and springs. The physics that converts between them is ' +
        'maths rather than a mapping, so it lives in animation.js.',
      subtables: [
        {
          title: 'Named easing \u2192 cubic-bezier control points',
          columns: ['Name', 'Control points'],
          rows: Object.entries(NAMED_CURVES).map(([name, v]) => ({
            key: name,
            cells: [
              { text: name, kind: 'key' },
              { text: v.join(', '), kind: 'mapped' },
            ],
          })),
        },
        {
          title: 'How each platform takes a curve',
          columns: ['Platform', 'Field', 'Call'],
          rows: Object.entries(CURVE_API).map(([p, v]) => ({
            key: p,
            cells: [
              { text: PLATFORM_LABEL[p] ?? p, kind: 'key' },
              { text: v.key, kind: 'mapped' },
              { text: v.call, kind: 'mapped' },
            ],
          })),
        },
        {
          title: 'How each platform takes a spring',
          columns: ['Platform', 'Call', 'Parameters', 'Note'],
          rows: Object.entries(SPRING_API).map(([p, v]) => ({
            key: p,
            cells: [
              { text: PLATFORM_LABEL[p] ?? p, kind: 'key' },
              { text: v.call, kind: 'mapped' },
              { text: v.params.join(', '), kind: 'mapped' },
              { text: v.exact ? `exact: ${v.exact}` : v.note || '\u2014', kind: v.note ? 'warn' : 'plain' },
            ],
          })),
        },
      ],
    },
    {
      id: 'mechanisms',
      title: 'Adaptable mechanisms',
      note:
        'Feedback mechanisms do not exist everywhere. A mechanism is dropped on ' +
        'platforms that have no equivalent rather than approximated.',
      columns: ['Mechanism', 'Web', 'iOS', 'Android'],
      rows: Object.entries(MECHANISM_PLATFORMS).map(([mech, list]) => ({
        key: mech,
        cells: [
          { text: mech, kind: 'key' },
          ...['web', 'ios', 'android'].map((p) =>
            list.includes(p) ? { text: 'yes', kind: 'mapped' } : { text: EM_DASH, kind: 'missing' },
          ),
        ],
      })),
    },
    {
      id: 'states-dropped',
      title: 'States that do not cross over',
      note: 'These depend on a pointer, so they are stripped from touch platforms.',
      columns: ['State', 'Exists on'],
      rows: [...POINTER_ONLY_STATES].map((s) => ({
        key: s,
        cells: [
          { text: s, kind: 'key' },
          { text: 'web only', kind: 'warn' },
        ],
      })),
    },
    {
      id: 'layout',
      title: 'Layout and appearance',
      note:
        'What a component’s CSS becomes in the spec. These are platform-neutral concepts, not framework ' +
        'syntax: the spec says a node is a horizontal stack that shares the remaining space, and the ' +
        'team picks how their framework expresses it. A role mapped to nothing is consumed elsewhere or ' +
        'has no native effect, and is listed rather than dropped.',
      subtables: [
        {
          title: 'CSS role → field in the spec',
          columns: ['Role read from CSS', 'Becomes', 'Why not'],
          rows: Object.entries(SEMANTIC_FIELDS).map(([role, f]) => ({
            key: role,
            cells: [
              { text: role, kind: 'key' },
              f.to ? { text: f.to + (f.inherited ? ' (inherited)' : ''), kind: 'mapped' } : { text: EM_DASH, kind: 'missing' },
              f.to
                ? { text: EM_DASH, kind: 'missing' }
                : { text: f.consumedBy ? `read into ${f.consumedBy}` : f.reason, kind: 'plain' },
            ],
          })),
        },
        {
          title: 'Keyword → value in the spec',
          columns: ['Table', 'CSS value', 'Becomes'],
          rows: Object.entries(SEMANTIC_VALUES).flatMap(([table, map]) =>
            Object.entries(map).map(([css, out]) => ({
              key: `${table}.${css}`,
              cells: [
                { text: table, kind: 'key' },
                { text: css, kind: 'mapped' },
                out === null ? { text: 'no change', kind: 'plain' } : { text: String(out), kind: 'mapped' },
              ],
            })),
          ),
        },
      ],
    },
    {
      id: 'webonly',
      title: 'Dropped on purpose',
      note:
        'These CSS properties exist only in a browser. They are not applied on iOS or Android, ' +
        'and every spec lists the ones its component used under droppedProperties, so their absence is traceable.',
      columns: ['CSS property', 'Why it does not carry over'],
      rows: Object.entries(WEB_ONLY_PROPERTIES).map(([prop, why]) => ({
        key: prop,
        cells: [
          { text: prop, kind: 'key' },
          { text: why, kind: 'plain' },
        ],
      })),
    },
    {
      id: 'animation-rules',
      title: 'Reading animation',
      note: 'How a transition or keyframe is read into an animation the spec states in full.',
      columns: ['Rule', 'Value', 'Meaning'],
      rows: [
        ...Object.entries(ANIMATION.identity).map(([fn, v]) => ({
          key: fn,
          cells: [
            { text: `identity of ${fn}`, kind: 'key' },
            { text: String(v), kind: 'mapped' },
            { text: 'The start value when no transform is applied, since CSS transform: none is the identity.', kind: 'plain' },
          ],
        })),
        {
          key: 'instantBelowMs',
          cells: [
            { text: 'effectively instant below', kind: 'key' },
            { text: `${ANIMATION.instantBelowMs} ms`, kind: 'mapped' },
            { text: ANIMATION.instantNote, kind: 'plain' },
          ],
        },
        {
          key: 'default-timing',
          cells: [
            { text: 'no timing function stated', kind: 'key' },
            { text: ANIMATION.cssDefaultTimingCurve, kind: 'mapped' },
            { text: 'CSS’s own default. The spec marks it as implied rather than stated.', kind: 'plain' },
          ],
        },
      ],
    },
    {
      id: 'idioms',
      title: 'SwiftUI and Compose idioms',
      note: IDIOMS.$note,
      columns: ['Concept', 'SwiftUI', 'Compose', 'Note'],
      rows: Object.entries(IDIOMS.concepts).map(([id, c]) => ({
        key: id,
        cells: [
          { text: id, kind: 'key' },
          { text: c.swiftui, kind: 'mapped' },
          { text: c.compose, kind: 'mapped' },
          // The shared note, then each framework's own, labelled so the page shows what
          // each platform's file will actually carry.
          idiomNote(c) ? { text: idiomNote(c), kind: 'plain' } : { text: EM_DASH, kind: 'missing' },
        ],
      })),
    },
    {
      id: 'source',
      title: 'Reading the web source',
      note:
        'The other half of the translation: how a component’s CSS and markup ' +
        'become contract concepts in the first place.',
      subtables: [
        {
          title: 'CSS property → appearance role',
          columns: ['CSS property', 'Role'],
          rows: Object.entries(VISUAL_PROPERTY).map(([k, v]) => ({
            key: k,
            cells: [
              { text: k, kind: 'key' },
              { text: v, kind: 'mapped' },
            ],
          })),
        },
        {
          title: 'Pseudo-class → state',
          columns: ['Selector', 'State'],
          rows: Object.entries(PSEUDO_STATE).map(([k, v]) => ({
            key: k,
            cells: [
              { text: k, kind: 'key' },
              { text: v, kind: 'mapped' },
            ],
          })),
        },
        {
          title: 'Utility prefix → role',
          columns: ['Prefix', 'Role'],
          rows: Object.entries(UTILITY_ROLES).map(([k, v]) => ({
            key: k,
            cells: [
              { text: k, kind: 'key' },
              { text: v, kind: 'mapped' },
            ],
          })),
        },
        {
          title: 'Native element → event it already carries',
          columns: ['Element', 'Event', 'Payload'],
          rows: Object.entries(NATIVE_ACTIVATION).map(([k, v]) => ({
            key: k,
            cells: [
              { text: k, kind: 'key' },
              { text: v.event, kind: 'mapped' },
              { text: v.payload, kind: v.payload === 'none' ? 'plain' : 'mapped' },
            ],
          })),
        },
      ],
    },
  ];
}
