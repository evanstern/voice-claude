/**
 * Filters Claude's response text before TTS synthesis.
 *
 * Strips code blocks, inline code, and raw file paths so that only
 * the conversational / spoken portion is sent to the TTS engine.
 * This saves cost and produces much better audio output.
 */

/** Matches fenced code blocks (``` optionally with a language tag). */
const FENCED_CODE_BLOCK = /```[\s\S]*?```/g

/**
 * Matches inline code wrapped in single backticks.
 * Uses a negative look-behind/ahead so we don't accidentally match
 * inside a fenced block (those are stripped first anyway).
 */
const INLINE_CODE = /`[^`\n]+`/g

/**
 * Matches lines that look like raw file paths or shell output, e.g.
 *   /home/user/project/src/index.ts
 *   ./src/index.ts
 *   ~/projects/foo/bar.js
 * Only matches when the path is on its own line (possibly with leading whitespace).
 */
const RAW_FILE_PATH = /^[ \t]*[~.]?\/[\w./_-]+$/gm

/**
 * Matches indented code blocks (4+ spaces or 1+ tab at line start)
 * that span one or more consecutive lines.
 */
const INDENTED_CODE_BLOCK = /(?:^(?:[ ]{4,}|\t+)\S.*$\n?)+/gm

/**
 * Filter text intended for TTS by removing code and raw output.
 *
 * Returns the filtered string. If the entire response was code (i.e.
 * nothing meaningful remains), returns a brief spoken placeholder.
 */
export function filterForTTS(text: string): string {
  const original = text.trim()
  if (!original) return ''

  let filtered = original

  // 1. Strip fenced code blocks, replacing with a brief spoken marker
  filtered = filtered.replace(FENCED_CODE_BLOCK, '\n[code omitted]\n')

  // 2. Strip indented code blocks
  filtered = filtered.replace(INDENTED_CODE_BLOCK, '\n[code omitted]\n')

  // 3. Strip inline code — just remove the backticks and keep the token
  //    name so the sentence still makes sense ("the `main` function" ->
  //    "the main function").
  filtered = filtered.replace(INLINE_CODE, (match) =>
    match.slice(1, -1),
  )

  // 4. Strip raw file-path lines
  filtered = filtered.replace(RAW_FILE_PATH, '')

  // 5. Collapse duplicate [code omitted] markers that can appear when
  //    multiple code blocks were adjacent.
  filtered = filtered.replace(
    /(\[code omitted\]\s*){2,}/g,
    '[code omitted]\n',
  )

  // 6. Collapse excessive blank lines into a single blank line
  filtered = filtered.replace(/\n{3,}/g, '\n\n')

  filtered = filtered.trim()

  // If almost nothing is left, the response was entirely code / paths.
  if (isEffectivelyEmpty(filtered)) {
    return "Here's the code you asked for."
  }

  return filtered
}

/**
 * Returns true when the remaining text has no real spoken content — only
 * whitespace and/or [code omitted] markers.
 */
function isEffectivelyEmpty(text: string): boolean {
  const stripped = text.replace(/\[code omitted\]/g, '').trim()
  return stripped.length === 0
}
