/**
 * The human-readable summary.
 *
 * Not a platform artifact — iOS and Android consume their own single spec
 * file. This is the reviewable view: what was read from the component, what it
 * resolves to on each platform, and what the component does not state.
 */

import { pascal } from './emit/util.js';
import { platformRole } from './resolve.js';
import { describeRef, logicIndex } from './semantics.js';

const swatch = (value) =>
  typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value) ? ` ${value}` : '';

/** A token reference shown by name, with its value when one is known. */
function shown(value, tokenValues = {}) {
  if (value == null || value === '') return '—';
  if (typeof value !== 'string') return `\`${JSON.stringify(value)}\``;
  const resolved = tokenValues[value];
  return `\`${value}\`${resolved ? swatch(resolved) : ''}`;
}

/**
 * A value read from the markup, in words. A prop that a local declaration of the
 * same name shadows is reported as the local, as the platform spec does.
 */
function refText(src, index) {
  const r = describeRef(src, index);
  if (!r) return '—';
  if (r.prop) return `the \`${r.prop}\` prop`;
  if (r.derived) return `\`${r.derived}\`, computed in the component`;
  if (r.expression) return `\`${r.expression}\``;
  return `"${r.literal}"`;
}

/** Depth-first walk of the element tree. */
function walkTree(node, depth, out, index = new Map()) {
  if (!node) return out;
  const indent = '  '.repeat(depth);
  const bits = [];
  if (node.role) bits.push(`role \`${node.role}\``);
  if (node.content) bits.push(`renders ${refText(node.content, index)}`);
  if (node.a11y?.label) bits.push(`announced as ${refText(node.a11y.label, index)}`);
  if (node.component) bits.push(`\`<${node.component}>\``);
  else if (node.element) bits.push(`\`<${node.element}>\``);

  out.push(`${indent}- **${node.name}** — ${bits.join(' · ') || 'container'}`);
  for (const child of node.children || []) walkTree(child, depth + 1, out, index);
  return out;
}

export function emitDocs(contract, artifacts, validation) {
  const md = [];
  const platforms = artifacts.map((a) => a.platform);
  const first = artifacts[0]?.artifact;
  const tokenValues = first?.tokenValues || {};

  md.push(`# ${contract.name}`);
  md.push('');
  if (contract.description) {
    md.push(`> ${contract.description}`);
    md.push('');
  }
  md.push(`**Contract** \`${contract.id}@${contract.contractVersion}\` · **Platforms** ${platforms.join(', ')}`);
  md.push('');
  md.push(`Everything below was read from the component. Nothing is inferred.`);
  md.push('');

  /* ---- structure ---- */
  if (contract.composition?.tree) {
    md.push('## Structure');
    md.push('');
    md.push('The element tree as the markup states it. **renders** is what a node');
    md.push('draws; **announced as** is an accessible name, which is spoken but never');
    md.push('displayed.');
    md.push('');
    walkTree(contract.composition.tree, 0, md, logicIndex(first?.logic));
    md.push('');

    // Per-node styling, taken from the resolved artifact so the table shows
    // the same values the platform files carry.
    const ns = first?.nodeStyles || [];
    const nsFields = first?.nodeStyleFields || [];
    if (ns.length) {
      md.push('### Styling each node applies to itself');
      md.push('');
      md.push('Sparse on purpose — a blank cell means the node does not set that');
      md.push('property, not that a value is missing.');
      md.push('');
      md.push(`| Node | State | ${nsFields.join(' | ')} |`);
      md.push(`| --- | --- | ${nsFields.map(() => '---').join(' | ')} |`);
      for (const r of ns) {
        const cells = nsFields.map((f) => (r[f] == null ? '' : shown(r[f])));
        md.push(`| \`${r.node}\` | ${r.state} | ${cells.join(' | ')} |`);
      }
      md.push('');
    }

    // The text token each node's text comes from, stated as one token the way colour is.
    // The table above is the flat per-state view and cannot show a token that changes with
    // a size or variant, so this lists it per node and per condition.
    const styled = [];
    for (const n of first?.nodes || []) {
      if (n.appearance?.typography) styled.push({ node: n.name, when: 'always', token: n.appearance.typography });
      for (const c of n.conditional || []) {
        if (!c.appearance?.typography) continue;
        const when = c.when
          .map((w) => (w.attribute ? `${w.attribute} ${w.negate ? '≠' : '='} ${w.equals}` : `${w.negate ? 'not ' : ''}${w.state}`))
          .join(' and ');
        styled.push({ node: n.name, when, token: c.appearance.typography });
      }
    }
    if (styled.length) {
      md.push('### Text token');
      md.push('');
      md.push('The text on each node comes from one typography token, which stands for its font family,');
      md.push('size, weight, line height and letter spacing. Resolve it like any other token.');
      md.push('');
      md.push('| Node | Applies when | Token |');
      md.push('|---|---|---|');
      for (const s of styled) md.push(`| \`${s.node}\` | ${s.when} | \`${s.token}\` |`);
      md.push('');
    }

    const l = contract.layout || {};
    if (l.direction || l.align) {
      md.push(
        `Laid out ${l.direction || 'horizontally'}${l.align ? `, ${l.align}-aligned` : ''}` +
          `${l.justify ? `, ${l.justify} along the main axis` : ''}.`
      );
      md.push('');
    }
  }

  /* ---- api ---- */
  md.push('## API');
  md.push('');
  md.push('| Prop | Kind | Required | Default | Notes |');
  md.push('|---|---|---|---|---|');
  for (const [name, def] of Object.entries(contract.props || {})) {
    const notes = [];
    if (def.axis) notes.push('axis');
    if (def.inheritedFrom) notes.push(`from \`${def.inheritedFrom}\``);
    if (def.values) notes.push(def.values.join(' \\| '));
    md.push(
      `| \`${name}\` | ${def.kind} | ${def.required ? 'yes' : 'no'} | ` +
        `${def.default ?? '—'} | ${notes.join('; ') || '—'} |`
    );
  }
  md.push('');

  /* ---- appearance ---- */
  if (first?.styles?.length) {
    const roles = contract.appearance?.roles || [];
    if (roles.length) {
      md.push('## Applied tokens');
      md.push('');
      md.push(`Resolved for \`${first.platform}\`. Other platforms differ only where a state does not apply.`);
      md.push('');
      md.push(`| Variant | Size | State | ${roles.join(' | ')} |`);
      md.push(`|---|---|---|${roles.map(() => '---').join('|')}|`);
      for (const row of first.styles) {
        md.push(
          `| ${row.variant} | ${row.size} | ${row.state} | ` +
            roles.map((r) => shown(row[r], tokenValues)).join(' | ') +
            ' |'
        );
      }
      md.push('');
    }

    const sizes = contract.props?.size?.values || [];
    const metricKeys = [...new Set(sizes.flatMap((s) => Object.keys(contract.appearance?.bySize?.[s] || {})))];
    if (metricKeys.length) {
      md.push('## Metrics');
      md.push('');
      md.push(`| Size | ${metricKeys.join(' | ')} |`);
      md.push(`|---|${metricKeys.map(() => '---').join('|')}|`);
      for (const size of sizes) {
        md.push(
          `| ${size} | ` +
            metricKeys.map((k) => shown(contract.appearance.bySize?.[size]?.[k], tokenValues)).join(' | ') +
            ' |'
        );
      }
      md.push('');
    }
  }

  /* ---- animation ---- */
  const animations = first?.animations || [];
  if (animations.length) {
    const valueText = (v) => {
      if (v == null || typeof v !== 'object') return v == null ? '—' : String(v);
      return Object.entries(v).filter(([k]) => k !== 'order').map(([k, x]) => `${k} ${typeof x === 'object' ? JSON.stringify(x) : x}`).join(', ') || '—';
    };
    const whenText = (w) => {
      const what = w.state ? `${w.negate ? 'not ' : ''}${w.state}` : `${w.attribute} ${w.negate ? '≠' : '='} ${w.equals}`;
      const d = w.driver;
      const why = d?.prop ? ` (prop \`${d.prop}\`)`
        : d?.derived ? ` (\`${d.derived}\`, computed in the component)`
        : d?.state ? ` (state \`${d.state}\`, set in ${d.activatedIn.join(', ') || 'the component'})`
        : d?.spread ? ` (set by \`${d.spread}\`, see Behaviour)`
        : d?.expression ? ` (from \`${d.expression}\`)`
        : d?.literal != null ? ` (always ${d.literal})`
        : w.attribute ? ' (set inside the component)' : '';
      return `${w.node}: ${what}${why}`;
    };
    const curveText = (t) => t?.curve?.named || (t?.curve?.value ? `cubic-bezier(${t.curve.value.join(', ')})` : t?.curve?.type || '—');
    const reducedText = (r) => (!r ? 'not stated' : r.enabled === false ? 'off' : r.mode ? r.mode : `${r.durationMs}ms${r.effectivelyInstant ? ' (effectively instant)' : ''}`);

    md.push('## Animation');
    md.push('');
    md.push('Each animation names the node it acts on, what it starts from, what it goes to and');
    md.push('when. Nothing here is a bare "transform": the function and the target are stated.');
    md.push('');
    md.push('| Animation | Starts from | Goes to | When | Timing | Reduced motion |');
    md.push('|---|---|---|---|---|---|');
    for (const a of animations) {
      const name = `\`${a.node ?? a.on ?? 'component'}\` · ${a.property}${a.kind === 'loop' ? ' · loop' : ''}`;
      const t = a.timing || {};
      const timing = `${t.durationMs ?? '—'}ms ${curveText(t)}${a.kind === 'loop' ? ` ${t.iterations}` : ''}`;
      let from, to, when;
      if (a.kind === 'loop') {
        from = valueText(a.keyframes?.[0]?.value);
        to = valueText(a.keyframes?.at(-1)?.value);
        when = 'while the node is rendered';
      } else if (a.changes?.length) {
        from = valueText(a.rest?.value);
        to = a.changes.map((c) => valueText(c.to)).join('; ');
        when = a.changes.map((c) => c.when.map(whenText).join(' and ')).join('; ');
      } else {
        from = 'the style table';
        to = 'the style table';
        when = 'whenever the state changes';
      }
      md.push(`| ${name} | ${from} | ${to} | ${when} | ${timing} | ${reducedText(a.reducedMotion)} |`);
    }
    md.push('');

    // Only worth a section when the platforms genuinely differ (springs).
    const differ = artifacts.some(({ artifact }) => JSON.stringify((artifact.animations || []).map((a) => a.timing)) !== JSON.stringify(animations.map((a) => a.timing)));
    if (differ) {
      md.push('### As each platform expresses it');
      md.push('');
      md.push('| Animation | ' + platforms.join(' | ') + ' |');
      md.push('|---|' + platforms.map(() => '---').join('|') + '|');
      animations.forEach((a, i) => {
        const cells = artifacts.map(({ artifact }) => {
          const e = (artifact.animations || [])[i];
          return e ? `${e.timing?.durationMs ?? '—'}ms ${curveText(e.timing)}` : 'not applicable';
        });
        md.push(`| \`${a.node ?? a.on}\` · ${a.property} | ${cells.join(' | ')} |`);
      });
      md.push('');
    }
  }

  /* ---- behaviour that is logic, quoted for translation ---- */
  const behaviour = first?.logic || [];
  const sourceEvents = first?.sourceEvents || [];
  if (behaviour.length || sourceEvents.length) {
    md.push('## Behaviour (source)');
    md.push('');
    md.push('A stylesheet cannot say when a control is disabled, what holding it does or which keys act on it.');
    md.push('That is logic, quoted here exactly as written for the platform team to translate. Nothing is');
    md.push('evaluated or summarised, and only statements the markup reaches are included.');
    md.push('');
    if (sourceEvents.length) {
      md.push('| Event or feedback | Name in the source | Found in |');
      md.push('|---|---|---|');
      for (const e of sourceEvents) md.push(`| \`${e.concept}\` | ${e.names.map((n) => `\`${n}\``).join(', ')} | ${e.foundIn.map((f) => `\`${f}\``).join(', ')} |`);
      md.push('');
    }
    for (const b of behaviour) {
      md.push(`### \`${b.name}\` · ${b.kind}${b.hook ? ` (${b.hook})` : ''}${b.also ? ` (also ${b.also.map((a) => `\`${a}\``).join(', ')})` : ''}`);
      md.push('');
      md.push('```ts');
      md.push(b.source);
      md.push('```');
      if (b.uses?.length) md.push(`Uses ${b.uses.map((u) => `\`${u}\``).join(', ')}.`);
      if (b.truncated) md.push('_Cut at the length limit: read the source file for the rest._');
      md.push('');
    }
  }

  /* ---- accessibility ---- */
  md.push('## Accessibility');
  md.push('');
  md.push('| | ' + platforms.join(' | ') + ' |');
  md.push('|---|' + platforms.map(() => '---').join('|') + '|');

  const describe = (a) => {
    if (a.traits?.length) return a.traits.map((t) => `\`.${t}\``).join(', ');
    if (a.role) return `\`Role.${a.role}\``;
    if (a.container) return `container (\`${a.container}\`)`;
    return '—';
  };
  md.push('| Root role | ' + artifacts.map(({ artifact }) => describe(artifact.a11y)).join(' | ') + ' |');
  md.push(
    '| Minimum target | ' +
      artifacts.map(({ artifact }) => `${artifact.a11y.minTarget}${artifact.a11y.minTargetUnit}`).join(' | ') +
      ' |'
  );
  for (const state of Object.keys(first?.a11y?.states || {})) {
    md.push(
      `| Announces "${state}" | ` +
        artifacts
          .map(({ artifact }) => {
            const m = artifact.a11y.states[state];
            return m ? `\`${m.attribute || m.trait || m.semantics || m.property}\`` : '—';
          })
          .join(' | ') +
        ' |'
    );
  }
  md.push('');

  /* Roles carried by inner nodes — a root with no role is common when the
     interactive parts are children. */
  const inner = [];
  const collect = (n) => {
    if (!n) return;
    if (n.role || n.a11y?.label) {
      const perPlatform = platforms
        .map((p) => {
          const r = platformRole(n.role, p);
          return r?.text ? `${p} ${r.text}` : r?.unmapped ? `${p} **no equivalent**` : null;
        })
        .filter(Boolean)
        .join(' · ');
      inner.push(
        `| ${n.name} | ${n.role ? `\`${n.role}\`` : '—'} | ${perPlatform || '—'} | ` +
          `${n.a11y?.label ? refText(n.a11y.label, logicIndex(first?.logic)) : '—'} |`
      );
    }
    (n.children || []).forEach(collect);
  };
  (contract.composition?.tree?.children || []).forEach(collect);
  if (inner.length) {
    md.push('### Inner nodes');
    md.push('');
    md.push('A root with no role is normal when the interactive parts are children.');
    md.push('Source roles are ARIA; each platform column shows what it becomes there.');
    md.push('');
    md.push('| Node | Source role | Translates to | Named by |');
    md.push('|---|---|---|---|');
    md.push(...inner);
    md.push('');
  }

  /* ---- what the component does not state ---- */
  const notes = (validation?.findings || []).filter((f) => f.severity !== 'info');
  if (notes.length) {
    md.push('## Not stated by the component');
    md.push('');
    md.push('These are absent from the source rather than wrong. They are recorded');
    md.push('here so a reviewer can decide whether they should be.');
    md.push('');
    for (const f of notes) md.push(`- ${f.question || f.message}`);
    md.push('');
  }

  /* ---- files ---- */
  md.push('## Platform specs');
  md.push('');
  md.push('| Platform | File |');
  md.push('|---|---|');
  for (const { platform, files } of artifacts) {
    md.push(`| ${platform} | ${files.map((f) => `\`${f}\``).join(', ') || '—'} |`);
  }
  md.push('');
  md.push('---');
  md.push('');
  md.push(`*Generated from \`${contract.id}.contract.json\`. Edit the component, not this file.*`);
  md.push('');

  void pascal;
  return md.join('\n');
}
