"use client"

/**
 * JetBrains AIR typed session-failure rows, rendered at the active
 * conversation's trailing edge beside the streaming state. One row per record:
 *
 * - ACTIVE severity-"error" records use the destructive palette (matching the
 *   shell's error strip) and carry the record's suggested action buttons
 *   (`retry` / `login` / `new_session` — the vocabulary the adapters emit;
 *   unknown actions are simply not rendered). Terminal errors stay until the
 *   user acts: sending a new prompt settles them (reducer), and a recurrence
 *   re-arms via a higher revision. Every error renders its own strip.
 * - ACTIVE severity-"warning" records use the amber palette (matching the
 *   config-stale banner) and collapse to the LATEST one plus a hidden count:
 *   they are in-flight retry incidents that settle as soon as the turn makes
 *   progress, and on advertising connections codex routes what used to be the
 *   single-slot `turn_retrying` channel here — one strip per record stacked a
 *   fresh row for every reconnect of a long turn (issue #496).
 *
 * - RESOLVED records render nothing. They remain in the reducer table only as
 *   revision watermarks, so a recovered reconnect disappears immediately
 *   instead of leaving a redundant "Recovered · Reconnecting…" status row
 *   under the conversation.
 *
 * Every ACTIVE strip carries a close button. Retry actions stay off warnings
 * (re-prompting mid-recovery would enqueue a second turn), but dismissing is
 * always the user's to do — and unlike the settle passes it is available to
 * viewers, since it only touches their own client's projection.
 *
 * Adapter-authored `title`/`details` are shown verbatim (already user-facing
 * prose); a blank title falls back to the localized category label.
 */

import { useState } from "react"
import { useTranslations } from "next-intl"
import {
  AlertCircle,
  Ban,
  ChevronDown,
  ChevronRight,
  Gauge,
  KeyRound,
  LogIn,
  Plus,
  RefreshCw,
  ServerCrash,
  WifiOff,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { SessionFailureRecord } from "@/lib/types"
import {
  activeSessionFailureView,
  knownSessionFailureActions,
  type SessionFailureAction,
} from "@/lib/session-failures"

const CATEGORY_ICONS: Record<string, typeof AlertCircle> = {
  connection: WifiOff,
  access: KeyRound,
  limit: Gauge,
  request: Ban,
  service: ServerCrash,
  unknown: AlertCircle,
}

const ACTION_ICONS: Record<SessionFailureAction, typeof RefreshCw> = {
  retry: RefreshCw,
  login: LogIn,
  new_session: Plus,
}

/** i18n key per action (the wire vocabulary is snake_case). */
const ACTION_LABEL_KEYS = {
  retry: "action.retry",
  login: "action.login",
  new_session: "action.newSession",
} as const

/** i18n label key per rendered category (title fallback). */
const CATEGORY_LABEL_KEYS = {
  connection: "category.connection",
  access: "category.access",
  limit: "category.limit",
  request: "category.request",
  service: "category.service",
  unknown: "category.unknown",
} as const

type KnownCategory = keyof typeof CATEGORY_LABEL_KEYS

/** Fold an arbitrary wire category onto the rendered vocabulary. */
function knownCategory(category: string): KnownCategory {
  return category in CATEGORY_LABEL_KEYS
    ? (category as KnownCategory)
    : "unknown"
}

interface Props {
  failures: SessionFailureRecord[]
  /** Wires the suggested actions; when omitted the buttons are hidden (e.g.
   *  viewers, who don't own the session). */
  onAction?: (
    action: SessionFailureAction,
    failure: SessionFailureRecord
  ) => void
  /** Closes a strip (client-local), taking every id that strip stands for —
   *  the collapsed warning bar closes its hidden siblings too. Omitted only
   *  where there is no store to write back to; unlike `onAction` this is NOT
   *  gated on session ownership. */
  onDismiss?: (ids: string[]) => void
}

export function SessionFailureBanner({ failures, onAction, onDismiss }: Props) {
  const { errors, warning, hiddenWarnings, warningIds } =
    activeSessionFailureView(failures)
  const hasActive = errors.length > 0 || warning !== null
  if (!hasActive) return null
  return (
    <>
      {errors.map((failure) => (
        <ActiveFailureStrip
          key={failure.id}
          failure={failure}
          dismissIds={[failure.id]}
          onAction={onAction}
          onDismiss={onDismiss}
        />
      ))}
      {warning && (
        <ActiveFailureStrip
          key={warning.id}
          failure={warning}
          hiddenCount={hiddenWarnings}
          dismissIds={warningIds}
          onAction={onAction}
          onDismiss={onDismiss}
        />
      )}
    </>
  )
}

/** Whether this connection has a failure worth reserving a transcript row for. */
export function hasVisibleSessionFailure(failures: SessionFailureRecord[]) {
  const { errors, warning } = activeSessionFailureView(failures)
  return (
    errors.length > 0 ||
    warning !== null
  )
}

function ActiveFailureStrip({
  failure,
  hiddenCount = 0,
  dismissIds,
  onAction,
  onDismiss,
}: {
  failure: SessionFailureRecord
  /** Older active warnings folded behind this one, shown as a count. */
  hiddenCount?: number
  /** Every record this strip stands for — what its close button dismisses. */
  dismissIds: string[]
  onAction?: Props["onAction"]
  onDismiss?: Props["onDismiss"]
}) {
  const t = useTranslations("Folder.chat.sessionFailure")
  const [expanded, setExpanded] = useState(false)
  const warning = failure.severity === "warning"
  const category = knownCategory(failure.category)
  const Icon = CATEGORY_ICONS[category]
  const title = failure.title.trim() || t(CATEGORY_LABEL_KEYS[category])
  const details = failure.details?.trim() || null
  // Warnings are in-flight retry incidents the adapter is already handling —
  // offering `retry` there would enqueue a second prompt mid-recovery, so
  // buttons render for terminal (non-warning) records only.
  const actions =
    onAction && !warning ? knownSessionFailureActions(failure) : []
  const DetailsChevron = expanded ? ChevronDown : ChevronRight
  return (
    <div
      role="alert"
      className={cn(
        "px-1 py-1.5 text-xs",
        warning ? "text-amber-700 dark:text-amber-300" : "text-destructive"
      )}
    >
      <div className="flex items-center gap-2">
        <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span
          className="min-w-0 flex-1 truncate font-medium"
          title={details ?? title}
        >
          {title}
        </span>
        {hiddenCount > 0 && (
          <span className="shrink-0 text-[10px] font-medium opacity-70">
            {t("moreIncidents", { count: hiddenCount })}
          </span>
        )}
        {actions.map((action) => {
          const ActionIcon = ACTION_ICONS[action]
          return (
            <Button
              key={action}
              size="sm"
              variant="ghost"
              className="h-6 shrink-0 px-2 text-xs"
              onClick={() => onAction?.(action, failure)}
            >
              <ActionIcon aria-hidden="true" className="me-1 h-3 w-3" />
              {t(ACTION_LABEL_KEYS[action])}
            </Button>
          )
        })}
        {details && (
          <button
            type="button"
            aria-label={t("toggleDetails")}
            aria-expanded={expanded}
            className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
            onClick={() => setExpanded((v) => !v)}
          >
            <DetailsChevron aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        )}
        {onDismiss && (
          <Button
            size="icon"
            variant="ghost"
            className={cn(
              "h-6 w-6 shrink-0",
              warning
                ? "text-amber-700/70 hover:bg-amber-500/20 hover:text-amber-800 dark:text-amber-300/70 dark:hover:text-amber-200"
                : "text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
            )}
            onClick={() => onDismiss(dismissIds)}
            aria-label={t("dismiss")}
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {expanded && details && (
        <p className="mt-1.5 ps-[22px] text-[11px] whitespace-pre-wrap break-words opacity-80">
          {details}
        </p>
      )}
    </div>
  )
}
