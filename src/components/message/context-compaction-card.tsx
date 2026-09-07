"use client"

/**
 * codex-acp #288 (v1.1.3+): the context-compaction lifecycle arrives as an ACP
 * `tool_call` tagged with `_meta.contextCompaction` — NOT under the `codex`
 * namespace, unlike codex's other `_meta` extensions. Through 1.2.x the tag is
 * the boolean `true`; 1.3.0 (#396) replaces it with the versioned object
 * `{version: 1, …}` on a claude-aligned lifecycle (kind "think", title
 * "Compact conversation", in_progress → completed sharing one `toolCallId`)
 * whose schema reserves optional `trigger`/`preTokens`/`postTokens`/
 * `durationMs`/`error` fields — 1.3.0 emits none of them yet. Grok's
 * `auto_compact_completed` bridge keeps synthesizing the boolean shape with
 * top-level `tokensBefore`/`tokensAfter`, so the delta label reads both
 * namings.
 *
 * claude-agent-acp 0.75.0 (#991) adopted the same versioned shape and is the
 * first adapter to fill every reserved field, so this card's full label —
 * counts, duration and trigger together — is only reachable there today.
 *
 * Rendered as a compact system marker so it reads as a conversation checkpoint
 * — "context was compacted here" — not a real tool call. Recognition is by
 * `_meta`, so it works for the live stream and DB/snapshot reloads. In history
 * the compaction is hoisted to a dedicated standalone timeline item (see
 * `message-list-view`'s `"compaction"` render kind) so it sits BETWEEN turns
 * rather than folding into the preceding assistant reply.
 */

import { useTranslations } from "next-intl"
import { Archive } from "lucide-react"

import type { ToolCallState } from "@/lib/adapters/ai-elements-adapter"
import { contextCompactionPayload } from "@/lib/context-compaction"

// `isContextCompactionMeta` now lives in the dependency-free
// `@/lib/context-compaction` module (shared with the grouping pass); re-exported
// here so existing importers keep resolving it from this file.
export { isContextCompactionMeta } from "@/lib/context-compaction"

/** Read a finite numeric field off an opaque record. */
function readNumber(
  source: Record<string, unknown> | null | undefined,
  key: string
): number | null {
  if (!source) return null
  const value = source[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** Read a non-blank string field off an opaque record. */
function readText(
  source: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  if (!source) return null
  const value = source[key]
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

/**
 * The two triggers every adapter agrees on, mapped to their message key.
 *
 * Deliberately not exhaustive: `trigger` is adapter-defined vocabulary, and an
 * unrecognized value falls back to its raw string rather than being dropped or
 * mislabelled. The automatic case has two spellings in the wild — claude
 * renames the SDK's `auto` to `automatic` on the wire (and `parsers/claude.rs`
 * mirrors that rename for history), while deepseek's parser passes `auto`
 * through — so both map to the same key.
 */
const TRIGGER_KEYS: Record<string, "triggerManual" | "triggerAutomatic"> = {
  manual: "triggerManual",
  auto: "triggerAutomatic",
  automatic: "triggerAutomatic",
}

/** `durationMs` as a compact human label ("3.2s" / "45s"), or null. */
function formatDuration(durationMs: number | null): string | null {
  if (durationMs === null || durationMs <= 0) return null
  const seconds = durationMs / 1000
  return `${seconds >= 10 ? Math.round(seconds) : seconds.toFixed(1)}s`
}

interface Props {
  state?: ToolCallState
  /** Consecutive persisted compaction events share one compact marker. */
  count?: number
  /**
   * ACP tool-call `_meta`. grok stamps top-level `tokensBefore`/`tokensAfter`
   * next to its boolean marker; codex 1.3.0+ nests reserved fields inside the
   * versioned `contextCompaction` object (`preTokens`/`postTokens`/
   * `durationMs`/`trigger`/`error`). Every field may be absent — 1.3.0 sends
   * the bare `{version: 1}` — and the card then renders exactly as before.
   */
  meta?: Record<string, unknown> | null
}

export function ContextCompactionCard({ state, meta, count = 1 }: Props) {
  const t = useTranslations("Folder.chat.contextCompaction")
  const isRunning = state === "input-streaming" || state === "input-available"
  const payload = contextCompactionPayload(meta)
  const before =
    readNumber(meta, "tokensBefore") ?? readNumber(payload, "preTokens")
  const after =
    readNumber(meta, "tokensAfter") ?? readNumber(payload, "postTokens")
  const errorText = readText(payload, "error")
  const failed = errorText !== null || state === "output-error"
  const duration = formatDuration(readNumber(payload, "durationMs"))
  // Trigger and error ride in the tooltip rather than inline prose — they
  // answer "why did this happen", which is a second-order question next to the
  // delta. Only the two shared triggers are translated; anything else is an
  // adapter's own word and is surfaced verbatim.
  const trigger = readText(payload, "trigger")
  const triggerKey = trigger ? TRIGGER_KEYS[trigger.toLowerCase()] : undefined
  const tooltip =
    errorText ?? (triggerKey ? t(triggerKey) : trigger) ?? undefined
  // Only show the delta when it's a real reduction — a no-op (before === after)
  // would read as a bug, so fall back to the plain label there and for codex
  // (which sends no counts).
  const label = failed
    ? t("failed")
    : isRunning
      ? t("compacting")
      : before !== null && after !== null && before !== after
        ? t("compactedTokens", {
            before: before.toLocaleString(),
            after: after.toLocaleString(),
          })
        : t("compacted")
  return (
    <div
      aria-label={count > 1 ? `${label} (${count})` : undefined}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] leading-4 text-muted-foreground/80 select-none${
        failed
          ? " border-destructive/25 bg-destructive/5 text-destructive/85"
          : " border-border/55 bg-muted/35"
      }`}
      title={tooltip}
    >
      <Archive
        aria-hidden="true"
        className={`size-3 shrink-0${failed ? " text-destructive/85" : ""}`}
      />
      <span
        className={
          isRunning ? "min-w-0 animate-pulse truncate" : "min-w-0 truncate"
        }
      >
        {label}
      </span>
      {!failed && !isRunning && duration ? (
        <span className="shrink-0 text-muted-foreground/60">· {duration}</span>
      ) : null}
      {count > 1 ? (
        <span
          aria-hidden="true"
          className="inline-flex min-w-4 shrink-0 items-center justify-center rounded-sm bg-background/70 px-1 text-[10px] font-medium tabular-nums text-muted-foreground/75"
        >
          {count}
        </span>
      ) : null}
    </div>
  )
}
