"use client"

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { Virtualizer } from "virtua"
import { useStickToBottomContext } from "use-stick-to-bottom"
import {
  ChevronRightIcon,
  CodeIcon,
  FilePenLineIcon,
  FilePlusIcon,
  FileTextIcon,
  GlobeIcon,
  ListTodoIcon,
  LoaderCircleIcon,
  SearchIcon,
  TerminalIcon,
  TimerIcon,
  TriangleAlertIcon,
  UsersIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"
import type { AdaptedContentPart } from "@/lib/adapters/ai-elements-adapter"
import { cn } from "@/lib/utils"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/instant-collapsible"
import { Shimmer } from "@/components/ai-elements/shimmer"
import { MessageResponse } from "@/components/ai-elements/message"
import {
  describeToolActivity,
  type ToolActivityKind,
} from "./tool-activity-presentation"

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
      type: "context-compaction"
      part: Extract<AdaptedContentPart, { type: "tool-call" }>
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
const ACTIVITY_FOLLOW_THRESHOLD_PX = 28
const ACTIVITY_SCROLL_REPIN_FRAMES = 2

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
    { type: "reasoning" } | { type: "message" } | { type: "context-compaction" }
  >
): {
  subject: string | null
  context: string | null
  icon: LucideIcon
  duration: string | null
  monospace: boolean
} {
  if (item.type === "tool-call") {
    const presentation = describeToolActivity(item.part)
    const iconByKind: Record<ToolActivityKind, LucideIcon> = {
      command: TerminalIcon,
      script: CodeIcon,
      session: TimerIcon,
      read: FileTextIcon,
      edit: FilePenLineIcon,
      write: FilePlusIcon,
      search: SearchIcon,
      web: GlobeIcon,
      todo: ListTodoIcon,
      task: UsersIcon,
      tool: WrenchIcon,
    }
    return {
      subject: presentation.subject,
      context: presentation.context,
      icon: iconByKind[presentation.kind],
      duration: extractWallTime(item.part.output ?? item.part.errorText),
      monospace: presentation.monospace,
    }
  }

  if (item.type === "tool-result") {
    return {
      subject: null,
      context: null,
      icon: WrenchIcon,
      duration: extractWallTime(item.part.output ?? item.part.errorText),
      monospace: false,
    }
  }

  if (item.type === "plan") {
    return {
      subject: null,
      context: null,
      icon: ListTodoIcon,
      duration: null,
      monospace: false,
    }
  }

  if (item.type === "goal-run") {
    return {
      subject: null,
      context: null,
      icon: ListTodoIcon,
      duration: null,
      monospace: false,
    }
  }

  if (item.type === "delegation-status-group") {
    return {
      subject: null,
      context: null,
      icon: UsersIcon,
      duration: null,
      monospace: false,
    }
  }

  return {
    subject: null,
    context: null,
    icon: TimerIcon,
    duration: null,
    monospace: false,
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

function ActivityContextCompactionRow({
  item,
  renderItem,
}: {
  item: Extract<AssistantActivityItem, { type: "context-compaction" }>
  renderItem: (item: AssistantActivityItem) => ReactNode
}) {
  const active = isStreaming(item)

  return (
    <div className="relative z-10 flex min-w-0 gap-2 px-1.5 py-1 text-[13px] leading-5 text-muted-foreground">
      <span
        aria-hidden="true"
        className="relative z-10 inline-grid h-5 w-5 shrink-0 place-items-center"
      >
        <span
          className={cn(
            "size-1.5 rounded-full",
            active ? "bg-foreground/70" : "bg-muted-foreground/55"
          )}
        />
      </span>
      {renderItem(item)}
    </div>
  )
}

function ActivityDetailRow({
  item,
  renderItem,
}: {
  item: Exclude<
    AssistantActivityItem,
    { type: "reasoning" } | { type: "message" } | { type: "context-compaction" }
  >
  renderItem: (item: AssistantActivityItem) => ReactNode
}) {
  const t = useTranslations("Folder.chat.contentParts")
  const active = isStreaming(item)
  const failed = hasError(item)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const { stopScroll } = useStickToBottomContext()
  const {
    subject,
    context,
    icon: Icon,
    duration,
    monospace,
  } = detailPresentation(item)

  const iconClass = failed
    ? "text-destructive/85"
    : active
      ? "text-foreground/70"
      : "text-muted-foreground/75"

  const handleDetailsOpenChange = useCallback(
    (nextOpen: boolean) => {
      // A manual disclosure is reader navigation, not new assistant output.
      // Stop the transcript's stick-to-bottom ResizeObserver before the body
      // changes size so the clicked row stays at its current screen position.
      stopScroll()
      setDetailsOpen(nextOpen)
    },
    [stopScroll]
  )

  return (
    <div>
      <Collapsible
        open={detailsOpen}
        onOpenChange={handleDetailsOpenChange}
        className="group/activity-row relative z-10 min-w-0"
      >
        <CollapsibleTrigger
          aria-label={subject ?? context ?? t("result")}
          className={cn(
            "inline-flex min-h-7 max-w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] leading-5 outline-none transition-colors hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-ring/50",
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
          {subject ? (
            <span
              className={cn(
                "min-w-0 truncate",
                failed
                  ? "text-destructive/85"
                  : active
                    ? "text-foreground/70"
                    : "text-muted-foreground/85",
                monospace && "font-mono text-[12px]"
              )}
            >
              {subject}
            </span>
          ) : null}
          {context ? (
            <span className="hidden max-w-40 shrink truncate text-[11px] text-muted-foreground/60 sm:inline">
              {context}
            </span>
          ) : null}
          {duration ? (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60 tabular-nums">
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
    </div>
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
  if (item.type === "context-compaction") {
    return <ActivityContextCompactionRow item={item} renderItem={renderItem} />
  }
  return <ActivityDetailRow item={item} renderItem={renderItem} />
}

/**
 * Keep a live activity run pinned to its newest row until the reader scrolls
 * away. Growing content can emit a scroll event without user input, so retain
 * the previous geometry and only let an actual scroll position change alter
 * the follow decision.
 */
function usePinnedActivityScroll(enabled: boolean, dependency: unknown) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const shouldFollowRef = useRef(true)
  const previousScrollTopRef = useRef(0)
  const previousScrollHeightRef = useRef(0)

  const handleScroll = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    const scrollTopChanged =
      Math.abs(scroller.scrollTop - previousScrollTopRef.current) > 1
    const scrollHeightChanged =
      Math.abs(scroller.scrollHeight - previousScrollHeightRef.current) > 1

    previousScrollTopRef.current = scroller.scrollTop
    previousScrollHeightRef.current = scroller.scrollHeight

    // Content growth must not make a reader who was following the tail look
    // as though they deliberately scrolled away from it.
    if (scrollHeightChanged && !scrollTopChanged) return

    shouldFollowRef.current =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <=
      ACTIVITY_FOLLOW_THRESHOLD_PX
  }, [])

  useEffect(() => {
    if (!enabled) {
      shouldFollowRef.current = true
      return
    }
    if (!shouldFollowRef.current) return

    let frameId = 0
    let frameCount = 0
    const pinToLatest = () => {
      const scroller = scrollerRef.current
      if (!scroller || !shouldFollowRef.current) return

      // Directly driving the physical scroll container is more reliable than
      // a virtualizer index while measured row heights are still settling.
      scroller.scrollTop = scroller.scrollHeight
      previousScrollTopRef.current = scroller.scrollTop
      previousScrollHeightRef.current = scroller.scrollHeight

      frameCount += 1
      if (frameCount < ACTIVITY_SCROLL_REPIN_FRAMES) {
        frameId = requestAnimationFrame(pinToLatest)
      }
    }

    frameId = requestAnimationFrame(pinToLatest)
    return () => cancelAnimationFrame(frameId)
  }, [dependency, enabled])

  return { scrollerRef, handleScroll }
}

function ActivityItemList({
  items,
  renderItem,
  streaming,
}: Pick<AssistantActivityGroupProps, "items" | "renderItem"> & {
  streaming: boolean
}) {
  const { scrollerRef, handleScroll } = usePinnedActivityScroll(
    streaming,
    items
  )
  const virtualized = items.length >= ACTIVITY_VIRTUALIZE_AT

  return (
    <div
      ref={scrollerRef}
      onScroll={handleScroll}
      data-codeg-scrollbar="true"
      className="codeg-scrollbar-hover @container/tool-activity relative mt-1 max-h-[min(34rem,55vh)] overflow-y-auto pe-1 text-muted-foreground [overflow-anchor:none]"
    >
      {virtualized ? (
        <Virtualizer
          scrollRef={scrollerRef}
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
  const { stopScroll } = useStickToBottomContext()
  // The parent assistant turn is the stable lifecycle boundary. Individual
  // tool-call states can briefly settle while another part is still streaming;
  // deriving disclosure state from the last item makes the whole group flap.
  const active = streaming ?? items.some(isStreaming)
  const [open, setOpen] = useState(() => active)
  const previousActiveRef = useRef(active)
  const userSetOpenRef = useRef(false)

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      // Expanding/collapsing this activity run is an explicit reader action;
      // it must not be treated as an incoming message that pins the transcript.
      stopScroll()
      userSetOpenRef.current = true
      setOpen(nextOpen)
    },
    [stopScroll]
  )

  // Live activity stays visible while it progresses, then returns to a compact
  // historical summary after the terminal stream update. A failed tool is a
  // row-level result, not a failed assistant reply, so it must not pin or tint
  // the entire activity group.
  useEffect(() => {
    const wasActive = previousActiveRef.current
    previousActiveRef.current = active

    if (!wasActive && active) {
      // A subsequent run gets a fresh automatic disclosure lifecycle.
      userSetOpenRef.current = false
      setOpen(true)
    } else if (wasActive && !active && !userSetOpenRef.current) {
      setOpen(false)
    }
  }, [active])

  const summary = useMemo(() => {
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
      } else if (item.type !== "context-compaction") {
        tools += 1
      }
    }

    const summaryParts = [
      tools > 0 ? t("other", { count: tools }) : null,
      todos > 0 ? t("todo", { count: todos }) : null,
      thoughts > 0 ? t("think", { count: thoughts }) : null,
      formatDuration(durationMs),
    ].filter((part): part is string => Boolean(part))

    return summaryParts.join(t("joiner"))
  }, [durationMs, items, t])

  const statusLabel = active
    ? statusT("inputAvailable")
    : statusT("outputAvailable")
  const toneClass = active ? "text-foreground/85" : "text-muted-foreground/85"

  return (
    <Collapsible
      open={open}
      onOpenChange={handleOpenChange}
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
      <CollapsibleContent drawer={!active} className="w-full outline-none">
        <ActivityItemList
          items={items}
          renderItem={renderItem}
          streaming={active}
        />
      </CollapsibleContent>
    </Collapsible>
  )
})
