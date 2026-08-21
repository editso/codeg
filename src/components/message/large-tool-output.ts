/**
 * Large tool output needs a line-virtualized viewer instead of the compact
 * Shiki preview. Keep this intentionally cheap: it runs before any full-text
 * syntax tokenization or JSON pretty-printing.
 */
export const LARGE_TOOL_OUTPUT_CHARACTER_LIMIT = 256 * 1024
export const LARGE_TOOL_OUTPUT_LINE_LIMIT = 2_000
export const LARGE_TOOL_OUTPUT_LINE_CHARACTER_LIMIT = 20_000

export function shouldUseLargeToolOutputViewer(text: string): boolean {
  if (text.length >= LARGE_TOOL_OUTPUT_CHARACTER_LIMIT) return true

  let lineCount = 1
  let lineLength = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      if (lineLength >= LARGE_TOOL_OUTPUT_LINE_CHARACTER_LIMIT) return true
      lineCount += 1
      if (lineCount >= LARGE_TOOL_OUTPUT_LINE_LIMIT) return true
      lineLength = 0
    } else {
      lineLength += 1
    }
  }

  return lineLength >= LARGE_TOOL_OUTPUT_LINE_CHARACTER_LIMIT
}
