#!/usr/bin/env node
/**
 * Find Tailwind utilities that cannot take effect.
 *
 * The design system's primitives live unlayered in app/globals.css, and Tailwind's utilities sit
 * in `@layer utilities`. Unlayered CSS wins over every layer, so a utility written beside a
 * primitive that already sets the same property does nothing at all: it looks applied, it lints
 * clean, and it is silently ignored. That is how a mobile-only control ends up visible on
 * desktop, and how a clamp stops clamping.
 *
 * This reads the properties each primitive declares, then reports any className that pairs a
 * primitive with a utility for one of those properties. It is deliberately conservative: it only
 * knows the utility families listed below, and it only flags a pair it can attribute to a
 * specific declaration.
 *
 * Exits non-zero when anything is found, so it can gate a change.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const CSS = join(ROOT, 'app', 'globals.css');
const SCAN_DIRS = ['app', 'components'];

/**
 * Utility prefix to the property it sets. A prefix matches a whole class or the part after a
 * variant, so `lg:hidden` is tested as `hidden`.
 */
const UTILITY_PROPERTY = [
  [/^(hidden|block|inline-block|inline|flex|inline-flex|grid|inline-grid|table|contents)$/, 'display'],
  [/^(uppercase|lowercase|capitalize|normal-case)$/, 'text-transform'],
  [/^tracking-/, 'letter-spacing'],
  [/^(text-(xs|sm|base|lg|xl|[2-9]xl))$/, 'font-size'],
  [/^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/, 'font-weight'],
  [/^font-(sans|serif|mono|display|jp)$/, 'font-family'],
  [/^(italic|not-italic)$/, 'font-style'],
  [/^leading-/, 'line-height'],
  [/^rounded/, 'border-radius'],
  [/^m-/, 'margin'],
  [/^mt-/, 'margin-top'],
  [/^mb-/, 'margin-bottom'],
  [/^ml-/, 'margin-left'],
  [/^mr-/, 'margin-right'],
  [/^mx-/, 'margin-x'],
  [/^my-/, 'margin-y'],
  [/^p-/, 'padding'],
  [/^pt-/, 'padding-top'],
  [/^pb-/, 'padding-bottom'],
  [/^pl-/, 'padding-left'],
  [/^pr-/, 'padding-right'],
  [/^px-/, 'padding-x'],
  [/^py-/, 'padding-y'],
  [/^gap-/, 'gap'],
  [/^items-/, 'align-items'],
  [/^justify-/, 'justify-content'],
  [/^(w|min-w|max-w)-/, 'width'],
  [/^(h|min-h|max-h)-/, 'height'],
  [/^opacity-/, 'opacity'],
  [/^(static|fixed|absolute|relative|sticky)$/, 'position'],
  [/^overflow-/, 'overflow'],
  [/^(underline|no-underline|line-through)$/, 'text-decoration-line'],
  [/^whitespace-/, 'white-space'],
];

/**
 * The declarations a utility actually collides with.
 *
 * A side-specific utility only collides with that side or with a shorthand covering it, so
 * `mt-2` beside a primitive that sets only `margin-bottom` is not dead.
 */
const FAMILY = {
  margin: ['margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'margin-inline', 'margin-block'],
  'margin-top': ['margin', 'margin-top', 'margin-block'],
  'margin-bottom': ['margin', 'margin-bottom', 'margin-block'],
  'margin-left': ['margin', 'margin-left', 'margin-inline'],
  'margin-right': ['margin', 'margin-right', 'margin-inline'],
  'margin-x': ['margin', 'margin-left', 'margin-right', 'margin-inline'],
  'margin-y': ['margin', 'margin-top', 'margin-bottom', 'margin-block'],
  padding: ['padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'padding-inline', 'padding-block'],
  'padding-top': ['padding', 'padding-top', 'padding-block'],
  'padding-bottom': ['padding', 'padding-bottom', 'padding-block'],
  'padding-left': ['padding', 'padding-left', 'padding-inline'],
  'padding-right': ['padding', 'padding-right', 'padding-inline'],
  'padding-x': ['padding', 'padding-left', 'padding-right', 'padding-inline'],
  'padding-y': ['padding', 'padding-top', 'padding-bottom', 'padding-block'],
  width: ['width', 'min-width', 'max-width'],
  height: ['height', 'min-height', 'max-height'],
  overflow: ['overflow', 'overflow-x', 'overflow-y'],
  gap: ['gap', 'row-gap', 'column-gap'],
};

function propertyFor(cls) {
  const bare = cls.includes(':') ? cls.slice(cls.lastIndexOf(':') + 1) : cls;
  if (bare.startsWith('!')) return null; // important beats the layer, so it is not dead
  for (const [pattern, prop] of UTILITY_PROPERTY) {
    if (pattern.test(bare)) return prop;
  }
  return null;
}

/**
 * Properties declared by each unlayered class selector in globals.css.
 *
 * Only simple single-class selectors are collected. A rule with a descendant or a pseudo-class
 * is skipped: its specificity or its state means a utility beside it may still apply.
 */
function readPrimitives() {
  const css = readFileSync(CSS, 'utf8');
  const map = new Map();
  // Strip comments so a selector inside one is not collected.
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // Multiline, or a rule that follows a stripped comment is never seen: `^` would otherwise
  // only match the start of the file, and most rules here are introduced by a comment.
  const rule = /(^|[};])\s*((?:\.[A-Za-z][\w-]*\s*,\s*)*\.[A-Za-z][\w-]*)\s*\{([^{}]*)\}/gm;
  let m;
  while ((m = rule.exec(clean)) !== null) {
    const selectors = m[2].split(',').map((x) => x.trim());
    const props = [...m[3].matchAll(/(^|;)\s*([a-z-]+)\s*:/g)].map((x) => x[2]);
    for (const sel of selectors) {
      if (!/^\.[A-Za-z][\w-]*$/.test(sel)) continue;
      const name = sel.slice(1);
      if (!map.has(name)) map.set(name, new Set());
      for (const p of props) map.get(name).add(p);
    }
  }
  return map;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const primitives = readPrimitives();
const findings = [];

for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      for (const quoted of line.matchAll(/["'`]([^"'`\n]*?)["'`]/g)) {
        const classes = quoted[1].trim().split(/\s+/).filter(Boolean);
        if (classes.length < 2) continue;
        const present = classes.filter((c) => primitives.has(c));
        if (present.length === 0) continue;

        const declared = new Set();
        for (const p of present) for (const prop of primitives.get(p)) declared.add(prop);

        for (const cls of classes) {
          if (primitives.has(cls)) continue;
          const prop = propertyFor(cls);
          if (!prop) continue;
          const candidates = FAMILY[prop] ?? [prop];
          const hit = candidates.find((c) => declared.has(c));
          if (hit) {
            findings.push({
              file: relative(ROOT, file).replace(/\\/g, '/'),
              line: i + 1,
              utility: cls,
              primitive: present.join(' '),
              property: hit,
            });
          }
        }
      }
    });
  }
}

if (findings.length === 0) {
  console.log(`dead utilities: none (${primitives.size} primitives checked)`);
  process.exit(0);
}

console.log(`dead utilities: ${findings.length} across ${new Set(findings.map((f) => f.file)).size} files\n`);
for (const f of findings) {
  console.log(`  ${f.file}:${f.line}`);
  console.log(`    "${f.utility}" cannot apply: .${f.primitive} already sets ${f.property}`);
}
process.exit(1);
