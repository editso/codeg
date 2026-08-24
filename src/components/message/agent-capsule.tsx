"use client"

/**
 * Shared visual shell for sub-agent capsules. Both the history "Agent" capsule
 * (`agent-tool-call.tsx`, reconstructed from the on-disk rollout) and the live
 * codex collab capsule (`collab-agent-card.tsx`, streamed) render through this
 * same chrome so the two are visually consistent: a collapsible pill trigger
 * (chevron + shimmering title while running + an optional right-aligned suffix)
 * with either the legacy bordered body or a direct activity-timeline expansion.
 * Each caller supplies its own body for the data it actually has.
 */

import { Children, useState, type ReactNode } from "react"
import { ChevronRightIcon } from "lucide-react"

import { Shimmer } from "@/components/ai-elements/shimmer"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/instant-collapsible"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

interface AgentCapsuleProps {
  /** Trigger label. Shimmers while `isRunning`; CSS-truncated to one line. */
  title: string
  isRunning: boolean
  isError: boolean
  /** Optional content pinned to the right of the title (duration, status icon). */
  rightSuffix?: ReactNode
  /**
   * Optional identifier (e.g. the sub-agent UUID) shown between the title and
   * the right suffix. Stays visible while collapsed and does not truncate (the
   * title truncates first), so the capsule is identifiable at a glance.
   */
  idBadge?: ReactNode
  /** Accessible label for the trigger. */
  statusLabel?: string
  /** Initial open state; defaults to open on error so failures are visible. */
  defaultOpen?: boolean
  /**
   * Opens the disclosure when this changes from false to true unless the user
   * has already chosen a state. This lets a live child transcript reveal itself
   * when its session id arrives after the Agent card first mounted.
   */
  autoOpen?: boolean
  /**
   * A timeline capsule expands directly into the surrounding activity rail.
   * The default card surface keeps the legacy bounded, bordered body for
   * standalone agent cards.
   */
  presentation?: "card" | "timeline"
  /**
   * Optional layout compensation supplied by the parent activity row. An
   * Agent header starts after the rail icon; its expanded work can therefore
   * return to the parent rail's full available width without a nested card.
   */
  timelineBodyClassName?: string
  /**
   * Lets a caller with conditional, wrapper-based children keep a genuinely
   * empty Agent node as a static row rather than an expandable blank body.
   */
  hasBody?: boolean
  children: ReactNode
}

export function AgentCapsule({
  title,
  isRunning,
  isError,
  rightSuffix,
  idBadge,
  statusLabel,
  defaultOpen,
  autoOpen = false,
  presentation = "card",
  timelineBodyClassName,
  hasBody: hasBodyProp,
  children,
}: AgentCapsuleProps) {
  // Whether there's any real body content. `Children.toArray` flattens the
  // caller's conditional children (`{cond && <…/>}`, `.map(a => … ? <…/> : null)`)
  // and drops the `false`/`null` entries, so an all-absent body yields length 0.
  // A bodyless capsule then renders as a bare pill rather than an empty bordered
  // frame — the long-standing sub-agent "white box", which the newer codex now
  // triggers on every `wait_agent` (its wait carries no per-agent result).
  const hasBody = hasBodyProp ?? Children.toArray(children).length > 0

  const [bodyOpen, setBodyOpen] = useState(defaultOpen ?? (autoOpen || isError))
  const [userSetBodyOpen, setUserSetBodyOpen] = useState(false)

  // Respond to prop transitions with the canonical React tracked-previous-state
  // pattern (render-phase setState) — see
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders.
  // The capsule's key is stable by tool-call id, so it does NOT remount when a
  // streaming tool call changes state; these transitions are how it reacts:
  //   - non-error → error: auto-OPEN so a failure that arrives mid-stream is
  //     visible without a click (the initial `isError` seed only covers calls
  //     that mount already-failed).
  //   - running → completed (non-error): auto-COLLAPSE only when the user did
  //     not choose a disclosure state during this run.
  const [prevIsRunning, setPrevIsRunning] = useState(isRunning)
  const [prevIsError, setPrevIsError] = useState(isError)
  const [prevAutoOpen, setPrevAutoOpen] = useState(autoOpen)
  let userChoiceForTransition = userSetBodyOpen
  if (prevIsRunning !== isRunning || prevIsError !== isError) {
    setPrevIsRunning(isRunning)
    setPrevIsError(isError)
    if (!prevIsRunning && isRunning) {
      // A subsequent run gets a fresh automatic disclosure lifecycle.
      userChoiceForTransition = false
      setUserSetBodyOpen(false)
    }
    if (!prevIsError && isError) {
      setBodyOpen(true)
    } else if (
      prevIsRunning &&
      !isRunning &&
      !isError &&
      !userChoiceForTransition
    ) {
      setBodyOpen(false)
    }
  }
  if (prevAutoOpen !== autoOpen) {
    setPrevAutoOpen(autoOpen)
    if (autoOpen && !userChoiceForTransition) {
      setBodyOpen(true)
    }
  }

  const handleBodyOpenChange = (nextOpen: boolean) => {
    setUserSetBodyOpen(true)
    setBodyOpen(nextOpen)
  }

  const pillClass = cn(
    presentation === "timeline"
      ? "group/agent inline-flex min-h-6 max-w-full items-center gap-2 rounded-md px-1.5 py-0.5 text-left text-[13px] leading-5 text-muted-foreground outline-none transition-colors hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-ring/50"
      : "group inline-flex max-w-full items-center gap-1.5 rounded-full bg-primary/10 px-3.5 py-2 text-xs font-medium text-foreground transition-colors ws-msg-chip",
    presentation === "card" && hasBody && "hover:bg-primary/15",
    isError && "text-destructive"
  )

  const titleNode = (
    <span
      className={cn(
        "min-w-0 truncate",
        presentation === "timeline" && "font-semibold",
        presentation === "card" && "font-medium"
      )}
    >
      {isRunning ? (
        <Shimmer as="span" duration={1} shineColor="var(--primary)">
          {title}
        </Shimmer>
      ) : (
        title
      )}
    </span>
  )
  const idBadgeNode =
    idBadge != null ? (
      <span className="shrink-0 font-mono text-[10px] font-normal text-muted-foreground/70">
        {idBadge}
      </span>
    ) : null
  const rightSuffixNode =
    rightSuffix != null ? (
      <span className="flex shrink-0 items-center text-muted-foreground/60">
        {rightSuffix}
      </span>
    ) : null
  const chevron = hasBody ? (
    <ChevronRightIcon
      aria-hidden="true"
      className={cn(
        presentation === "timeline"
          ? "size-3.5 shrink-0 text-muted-foreground/55 opacity-0 transition-[color,opacity,transform] group-hover/agent:opacity-100 group-focus-within/agent:opacity-100"
          : "size-3 shrink-0 opacity-60 transition-transform",
        bodyOpen && "rotate-90"
      )}
    />
  ) : null

  const pillInner =
    presentation === "timeline" ? (
      <>
        {titleNode}
        {idBadgeNode}
        {rightSuffixNode}
        {chevron}
      </>
    ) : (
      <>
        {chevron}
        {titleNode}
        {idBadgeNode}
        {rightSuffixNode}
      </>
    )

  // Nothing to expand → a bare, non-interactive pill (no chevron, no bordered
  // frame). This is the fix for the empty sub-agent "white box".
  if (!hasBody) {
    return (
      <div className={pillClass} aria-label={statusLabel}>
        {pillInner}
      </div>
    )
  }

  return (
    <Collapsible
      open={bodyOpen}
      onOpenChange={handleBodyOpenChange}
      className="w-full"
      data-agent-capsule-presentation={presentation}
    >
      {/* Pill trigger — matches ToolGroupPart structure with themed emphasis. */}
      <CollapsibleTrigger className={pillClass} aria-label={statusLabel}>
        {pillInner}
      </CollapsibleTrigger>

      {/* A timeline expansion deliberately has no card chrome or independent
          scroll area: its children are activity rows in the parent flow. */}
      <CollapsibleContent
        className={cn(
          "w-full outline-none",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "data-[state=closed]:slide-out-to-top-1 data-[state=open]:slide-in-from-top-1"
        )}
      >
        {presentation === "timeline" ? (
          <div
            data-agent-capsule-body="timeline"
            className={cn("mt-1 min-w-0", timelineBodyClassName)}
          >
            {children}
          </div>
        ) : (
          <div
            data-agent-capsule-body="card"
            className="mt-3 w-full overflow-hidden rounded-md border border-border/60"
          >
            <ScrollArea className="max-h-72">
              <div className="space-y-3 px-3.5 py-2">{children}</div>
            </ScrollArea>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
