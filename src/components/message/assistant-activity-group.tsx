"use client"

import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { Virtualizer } from "virtua"
import {
  ChevronRightIcon,
  FileTextIcon,
  ListTodoIcon,
  LoaderCircleIcon,
  TerminalIcon,
  TimerIcon,
  TriangleAlertIcon,
  UsersIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"
import type { AdaptedContentPart } from "@/lib/adapters/ai-elements-adapter"
import { normalizeToolName } from "@/lib/tool-call-normalization"
import { cn } from "@/lib/utils"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/instant-collapsible"
import { Shimmer } from "@/components/ai-elements/shimmer"
import { MessageResponse } from "@/components/ai-elements/message"

/**
 * The operational parts of one assistant reply. Each keeps its existing card
 * renderer after the group is expanded; this type only adds a thread-level
 * disclosure around the complete activity stream.
 */
export type AssistantActivityItem =
  | {
      id: string
      type: "reasoning"
      part: Extract<AdaptedContentPart, { type: "reasoning" }>
    }
  | {
      id: string
      type: "message"
      text: string
    }
  | {
      id: string
      type: "tool-call"
      part: Extract<AdaptedContentPart, { type: "tool-call" }>
    }
  | {
      id: string
      type: "tool-result"
      part: Extract<AdaptedContentPart, { type: "tool-result" }>
    }
  | {
      id: string
      type: "plan"
      part: Extract<AdaptedContentPart, { type: "plan" }>
    }
  | {
      id: string
      type: "goal-run"
      part: Extract<AdaptedContentPart, { type: "goal-run" }>
    }
  | {
      id: string
      type: "delegation-status-group"
      part: Extract<AdaptedContentPart, { type: "delegation-status-group" }>
    }
  | {
      id: string
      type: "background-task-group"
      part: Extract<AdaptedContentPart, { type: "background-task-group" }>
    }

interface AssistantActivityGroupProps {
  items: AssistantActivityItem[]
  renderItem: (item: AssistantActivityItem) => ReactNode
  durationMs?: number | null
  streaming?: boolean
}

// A group is one outer virtual-thread row. Once expanded, virtualise a long
// inner run as well so hundreds of compact tool rows never materialise together.
const ACTIVITY_VIRTUALIZE_AT = 24
const ACTIVITY_ESTIMATED_ROW_HEIGHT = 32
const ACTIVITY_BUFFER_SIZE = 720

const FILE_TOOL_NAMES = new Set([
  "read",
  "write",
  "edit",
  "apply_patch",
  "notebookedit",
])

const COMMAND_TOOL_NAMES = new Set([
  "bash",
  "exec_command",
  "write_stdin",
  "wait",
])

function isStreaming(item: AssistantActivityItem): boolean {
  if (item.type === "message") return false
  if (item.type === "reasoning" || item.type === "plan") {
    return item.part.isStreaming
  }
  if (item.type === "goal-run") return item.part.isRunning
  if (item.type === "delegation-status-group") {
    return item.part.polls.some(
      (poll) =>
        poll.state === "input-available" || poll.state === "input-streaming"
    )
  }
  if (item.type === "background-task-group") {
    return item.part.polls.some(
      (poll) =>
        poll.state === "input-available" || poll.state === "input-streaming"
    )
  }
  return (
    item.part.state === "input-available" ||
    item.part.state === "input-streaming"
  )
}

function hasError(item: AssistantActivityItem): boolean {
  if (item.type === "tool-call") {
    return item.part.state === "output-error" || Boolean(item.part.errorText)
  }
  if (item.type === "tool-result") {
    return item.part.state === "output-error" || Boolean(item.part.errorText)
  }
  if (item.type === "delegation-status-group") {
    return item.part.polls.some(
      (poll) => poll.state === "output-error" || Boolean(poll.errorText)
    )
  }
  if (item.type === "background-task-group") {
    return item.part.polls.some(
      (poll) => poll.state === "output-error" || Boolean(poll.errorText)
    )
  }
  return false
}

function formatDuration(durationMs?: number | null): string | null {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) {
    return null
  }

  const totalSeconds = Math.max(0, durationMs) / 1000
  if (totalSeconds < 60) {
    const rounded = Math.max(0.1, Math.round(totalSeconds * 10) / 10)
    return `${rounded.toFixed(1).replace(/\.0$/, "")}s`
  }

  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) {
    const seconds = Math.floor(totalSeconds % 60)
    return seconds > 0 ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`
  }

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
}

function extractWallTime(source: unknown): string | null {
  if (typeof source !== "string" || !source) return null

  let normalized = source
  try {
    const parsed: unknown = JSON.parse(source)
    if (typeof parsed === "string") normalized = parsed
  } catch {
    // The persisted CLI envelope is usually raw text, not JSON.
  }

  const match = normalized.match(/^wall time\s*:\s*(.+)$/im)
  if (!match) return null

  const raw = match[1]!.trim()
  const secondsMatch = raw.match(/^([\d.]+)\s*(?:s|seconds?)\b/i)
  if (secondsMatch) {
    const seconds = Number.parseFloat(secondsMatch[1]!)
    return Number.isFinite(seconds) ? formatDuration(seconds * 1000) : raw
  }

  const millisecondsMatch = raw.match(/^([\d.]+)\s*ms\b/i)
  if (millisecondsMatch) {
    const milliseconds = Number.parseFloat(millisecondsMatch[1]!)
    return Number.isFinite(milliseconds) ? formatDuration(milliseconds) : raw
  }

  return raw
}

function detailPresentation(
  item: Exclude<
    AssistantActivityItem,
    { type: "reasoning" } | { type: "message" }
  >,
  resultLabel: string,
  todoLabel: (count: number) => string,
  taskLabel: (count: number) => string
): { label: string; icon: LucideIcon; duration: string | null } {
  if (item.type === "tool-call") {
    const toolName = normalizeToolName(
      typeof item.part.toolName === "string" ? item.part.toolName : "tool"
    )
    if (FILE_TOOL_NAMES.has(toolName)) {
      return {
        label: "File",
        icon: FileTextIcon,
        duration: extractWallTime(item.part.output ?? item.part.errorText),
      }
    }
    if (COMMAND_TOOL_NAMES.has(toolName)) {
      return {
        label: "Command",
        icon: TerminalIcon,
        duration: extractWallTime(item.part.output ?? item.part.errorText),
      }
    }
    if (toolName === "todowrite") {
      return {
        label: todoLabel(1),
        icon: ListTodoIcon,
        duration: extractWallTime(item.part.output ?? item.part.errorText),
      }
    }
    return {
      label: "Tool",
      icon: WrenchIcon,
      duration: extractWallTime(item.part.output ?? item.part.errorText),
    }
  }

  if (item.type === "tool-result") {
    return {
      label: resultLabel,
      icon: WrenchIcon,
      duration: extractWallTime(item.part.output ?? item.part.errorText),
    }
  }

  if (item.type === "plan") {
    return {
      label: todoLabel(Math.max(1, item.part.entries.length)),
      icon: ListTodoIcon,
      duration: null,
    }
  }

  if (item.type === "goal-run") {
    return { label: taskLabel(1), icon: ListTodoIcon, duration: null }
  }

  if (item.type === "delegation-status-group") {
    return {
      label: taskLabel(Math.max(1, item.part.polls.length)),
      icon: UsersIcon,
      duration: null,
    }
  }

  return {
    label: taskLabel(Math.max(1, item.part.polls.length)),
    icon: TimerIcon,
    duration: null,
  }
}

function ActivityReasoningRow({
  item,
}: {
  item: Extract<AssistantActivityItem, { type: "reasoning" }>
}) {
  const reasoningT = useTranslations("Folder.chat.reasoning")
  const active = isStreaming(item)
  const content = item.part.content.trim()
  const dotClass = active ? "bg-foreground/70" : "bg-muted-foreground/55"

  return (
    <div className="relative z-10 flex min-w-0 gap-2 px-1.5 py-1 text-[13px] leading-5 text-muted-foreground">
      <span
        aria-hidden="true"
        className="relative z-10 inline-grid h-5 w-5 shrink-0 place-items-center"
      >
        <span className={cn("size-1.5 rounded-full", dotClass)} />
      </span>
      {content ? (
        <MessageResponse className="codeg-activity-reasoning min-w-0 flex-1">
          {content}
        </MessageResponse>
      ) : (
        <Shimmer as="span" duration={1} shineColor="var(--primary)">
          {reasoningT("thinking")}
        </Shimmer>
      )}
    </div>
  )
}

function ActivityDetailRow({
  item,
  renderItem,
}: {
  item: Exclude<
    AssistantActivityItem,
    { type: "reasoning" } | { type: "message" }
  >
  renderItem: (item: AssistantActivityItem) => ReactNode
}) {
  const t = useTranslations("Folder.chat.contentParts")
  const groupT = useTranslations("Folder.chat.contentParts.toolGroup")
  const active = isStreaming(item)
  const failed = hasError(item)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const {
    label,
    icon: Icon,
    duration,
  } = detailPresentation(
    item,
    t("result"),
    (count) => groupT("todo", { count }),
    (count) => groupT("task", { count })
  )

  const iconClass = failed
    ? "text-destructive/85"
    : active
      ? "text-foreground/80"
      : "text-muted-foreground/75"

  return (
    <Collapsible
      open={detailsOpen}
      onOpenChange={setDetailsOpen}
      className="group/activity-row relative z-10 min-w-0"
    >
      <CollapsibleTrigger
        className={cn(
          "inline-flex min-h-6 max-w-full items-center gap-2 rounded-md px-1.5 py-0.5 text-left text-[13px] leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          failed ? "text-destructive" : "text-muted-foreground"
        )}
      >
        <span className="relative z-10 inline-grid h-5 w-5 shrink-0 place-items-center rounded-sm bg-background">
          {active ? (
            <LoaderCircleIcon
              aria-hidden="true"
              className="size-3.5 animate-spin"
            />
          ) : failed ? (
            <TriangleAlertIcon
              aria-hidden="true"
              className="size-3.5 text-destructive/85"
            />
          ) : (
            <Icon aria-hidden="true" className={cn("size-3.5", iconClass)} />
          )}
        </span>
        <span className="min-w-0 truncate text-muted-foreground/85">
          {label}
        </span>
        {duration ? (
          <span className="shrink-0 text-[12px] text-muted-foreground/60">
            {duration}
          </span>
        ) : null}
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/55 opacity-0 transition-[color,opacity,transform] group-hover/activity-row:opacity-100 group-focus-within/activity-row:opacity-100",
            detailsOpen && "rotate-90"
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="ms-7 mt-1 min-w-0 border-s border-border/45 ps-3">
        <div className="pb-2 pt-1">{renderItem(item)}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function ActivityMessageRow({
  item,
}: {
  item: Extract<AssistantActivityItem, { type: "message" }>
}) {
  return (
    <div className="relative z-10 flex min-w-0 gap-2 px-1.5 py-1 text-[13px] leading-5 text-muted-foreground/85">
      <span
        aria-hidden="true"
        className="relative z-10 inline-grid h-5 w-5 shrink-0 place-items-center"
      >
        <span className="size-1.5 rounded-full bg-muted-foreground/55" />
      </span>
      <MessageResponse className="codeg-activity-reasoning min-w-0 flex-1">
        {item.text}
      </MessageResponse>
    </div>
  )
}

function ActivityRow({
  item,
  renderItem,
}: {
  item: AssistantActivityItem
  renderItem: (item: AssistantActivityItem) => ReactNode
}) {
  if (item.type === "reasoning") return <ActivityReasoningRow item={item} />
  if (item.type === "message") return <ActivityMessageRow item={item} />
  return <ActivityDetailRow item={item} renderItem={renderItem} />
}

function ActivityItemList({
  items,
  renderItem,
}: Pick<AssistantActivityGroupProps, "items" | "renderItem">) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualized = items.length >= ACTIVITY_VIRTUALIZE_AT

  return (
    <div
      ref={scrollRef}
      className="relative mt-1 max-h-[min(34rem,55vh)] overflow-y-auto overscroll-contain pe-1 text-muted-foreground scrollbar-thin [overflow-anchor:none]"
    >
      {virtualized ? (
        <Virtualizer
          scrollRef={scrollRef}
          itemSize={ACTIVITY_ESTIMATED_ROW_HEIGHT}
          bufferSize={ACTIVITY_BUFFER_SIZE}
        >
          {items.map((item) => (
            <div key={item.id} className="pb-0.5 pl-[15px] pr-2">
              <ActivityRow item={item} renderItem={renderItem} />
            </div>
          ))}
        </Virtualizer>
      ) : (
        <div className="grid gap-0.5 pl-[15px] pr-2">
          {items.map((item) => (
            <ActivityRow key={item.id} item={item} renderItem={renderItem} />
          ))}
        </div>
      )}
    </div>
  )
}

export const AssistantActivityGroup = memo(function AssistantActivityGroup({
  items,
  renderItem,
  durationMs,
  streaming,
}: AssistantActivityGroupProps) {
  const t = useTranslations("Folder.chat.contentParts.toolGroup")
  const statusT = useTranslations("Folder.chat.tool.status")
  // The parent assistant turn is the stable lifecycle boundary. Individual
  // tool-call states can briefly settle while another part is still streaming;
  // deriving disclosure state from the last item makes the whole group flap.
  const active = streaming ?? items.some(isStreaming)
  const failed = items.some(hasError)
  const [open, setOpen] = useState(() => active || failed)
  const previousActiveRef = useRef(active)

  // Live activity stays visible while it progresses, then returns to a compact
  // historical summary after the terminal stream update.
  useEffect(() => {
    const wasActive = previousActiveRef.current
    previousActiveRef.current = active

    if (failed) {
      setOpen(true)
    } else if (!wasActive && active) {
      setOpen(true)
    } else if (wasActive && !active) {
      setOpen(false)
    }
  }, [active, failed])

  const summary = useMemo(() => {
    let errors = 0
    let thoughts = 0
    let tools = 0
    let todos = 0

    for (const item of items) {
      if (item.type === "reasoning") {
        thoughts += 1
      } else if (item.type === "plan") {
        todos += Math.max(1, item.part.entries.length)
      } else if (item.type === "delegation-status-group") {
        tools += Math.max(1, item.part.polls.length)
      } else if (item.type === "background-task-group") {
        tools += Math.max(1, item.part.polls.length)
      } else {
        tools += 1
      }

      if (hasError(item)) errors += 1
    }

    const summaryParts = [
      tools > 0 ? t("other", { count: tools }) : null,
      todos > 0 ? t("todo", { count: todos }) : null,
      thoughts > 0 ? t("think", { count: thoughts }) : null,
      errors > 0 ? t("errorSuffix", { count: errors }) : null,
      formatDuration(durationMs),
    ].filter((part): part is string => Boolean(part))

    return summaryParts.join(t("joiner"))
  }, [durationMs, items, t])

  const statusLabel = failed
    ? statusT("outputError")
    : active
      ? statusT("inputAvailable")
      : statusT("outputAvailable")
  const toneClass = failed
    ? "text-destructive"
    : active
      ? "text-foreground/85"
      : "text-muted-foreground/85"

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(
        "group/activity relative mr-auto w-full max-w-full py-1 text-sm text-muted-foreground",
        open &&
          "before:absolute before:bottom-1 before:left-[31px] before:top-[34px] before:w-px before:-translate-x-1/2 before:bg-border/35 before:content-[''] after:absolute after:left-[13px] after:top-[22px] after:h-3 after:w-[18px] after:rounded-bl-md after:border-b after:border-l after:border-border/35 after:content-['']"
      )}
    >
      <div className="relative z-10 flex max-w-full items-center gap-2 py-1">
        <CollapsibleTrigger className="-ms-1.5 inline-flex min-h-6 shrink-0 items-center gap-2 rounded-md px-1.5 py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <span className={cn("text-[13px] font-medium", toneClass)}>
            {statusLabel}
          </span>
          <ChevronRightIcon
            aria-hidden="true"
            className={cn(
              "ms-1.5 size-3.5 shrink-0 text-muted-foreground/60 opacity-0 transition-[color,opacity,transform] group-hover/activity:opacity-100 group-focus-within/activity:opacity-100",
              open && "rotate-90"
            )}
          />
        </CollapsibleTrigger>
        {summary ? (
          <span
            className={cn(
              "min-w-0 truncate text-[13px] font-medium",
              toneClass
            )}
          >
            {summary}
          </span>
        ) : null}
      </div>
      <CollapsibleContent className="w-full outline-none">
        <ActivityItemList items={items} renderItem={renderItem} />
      </CollapsibleContent>
    </Collapsible>
  )
})
