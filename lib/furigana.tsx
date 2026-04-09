/**
 * Utilities for parsing and rendering jiten.moe bracket furigana notation.
 *
 * jiten.moe returns readings like "御[ご]座[ざ]る" where brackets contain
 * the furigana for the preceding kanji character(s).
 */

import React from 'react';

interface FuriganaPart {
  text: string;
  reading?: string;
}

/**
 * Parse bracket notation into structured parts.
 * "御[ご]座[ざ]る" → [{ text: "御", reading: "ご" }, { text: "座", reading: "ざ" }, { text: "る" }]
 * "がめ煮[に]" → [{ text: "がめ" }, { text: "煮", reading: "に" }]
 */
export function parseFurigana(input: string): FuriganaPart[] {
  const parts: FuriganaPart[] = [];
  let remaining = input;

  while (remaining.length > 0) {
    const bracketIdx = remaining.indexOf('[');
    if (bracketIdx === -1) {
      // No more brackets, rest is plain text
      parts.push({ text: remaining });
      break;
    }

    if (bracketIdx === 0) {
      // Malformed: bracket at start, skip it
      const closeIdx = remaining.indexOf(']');
      remaining = closeIdx >= 0 ? remaining.slice(closeIdx + 1) : '';
      continue;
    }

    // Everything before the last kanji character(s) is plain text
    // Find where the kanji starts (the character(s) right before [)
    // Walk backwards from bracketIdx to find the kanji block
    let kanjiStart = bracketIdx - 1;
    while (kanjiStart > 0 && isKanji(remaining[kanjiStart - 1])) {
      kanjiStart--;
    }

    // Plain text before the kanji
    if (kanjiStart > 0) {
      parts.push({ text: remaining.slice(0, kanjiStart) });
    }

    // Extract reading from brackets
    const closeIdx = remaining.indexOf(']', bracketIdx);
    if (closeIdx === -1) {
      // Malformed: no closing bracket
      parts.push({ text: remaining.slice(kanjiStart) });
      break;
    }

    const kanjiText = remaining.slice(kanjiStart, bracketIdx);
    const reading = remaining.slice(bracketIdx + 1, closeIdx);
    parts.push({ text: kanjiText, reading });
    remaining = remaining.slice(closeIdx + 1);
  }

  return parts;
}

function isKanji(ch: string): boolean {
  const code = ch.codePointAt(0) || 0;
  return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf);
}

/**
 * Strip bracket notation to get plain kanji text.
 * "御[ご]座[ざ]る" → "御座る"
 */
export function stripFurigana(input: string): string {
  return input.replace(/\[[^\]]*\]/g, '');
}

/**
 * Convert bracket notation to pure hiragana reading.
 * "御[ご]座[ざ]る" → "ござる"
 */
export function toHiragana(input: string): string {
  const parts = parseFurigana(input);
  return parts.map((p) => p.reading || p.text).join('');
}

/**
 * Render bracket notation as <ruby> elements for proper furigana display.
 */
export function FuriganaText({
  text,
  className,
  rubyClassName,
}: {
  text: string;
  className?: string;
  rubyClassName?: string;
}) {
  const parts = parseFurigana(text);

  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.reading ? (
          <ruby key={i} style={{ rubyAlign: 'center' }}>
            {part.text}
            <rp>(</rp>
            <rt className={rubyClassName} style={{ textAlign: 'center' }}>{part.reading}</rt>
            <rp>)</rp>
          </ruby>
        ) : (
          <React.Fragment key={i}>{part.text}</React.Fragment>
        )
      )}
    </span>
  );
}
