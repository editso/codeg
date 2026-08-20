"use client"

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { AlertCircle, Loader2 } from "lucide-react"

import {
  hasVisibleSessionFailure,
  SessionFailureBanner,
} from "@/components/chat/session-failure-banner"
import type { ClaudeApiRetryState } from "@/contexts/acp-connections-context"
import type { SessionFailureAction } from "@/lib/session-failures"
import type { SessionFailureRecord } from "@/lib/types"

interface ConversationStatusTailProps {
  sessionFailures?: SessionFailureRecord[]
  onSessionFailureAction?: (
    action: SessionFailureAction,
    failure: SessionFailureRecord
  ) => void
  onSessionFailureDismiss?: (ids: string[]) => void
  claudeApiRetry?: ClaudeApiRetryState | null
  connectionError?: string | null
}

/**
 * Connection incidents belong to their turn, not to the composer dock. This
 * predicate lets the virtualized thread omit the tail row entirely when all
 * stored failure records are merely resolved watermarks.
 */
export function hasVisibleConversationStatus({
  sessionFailures = [],
  claudeApiRetry = null,
  connectionError = null,
}: ConversationStatusTailProps): boolean {
  return (
    hasVisibleSessionFailure(sessionFailures) ||
    claudeApiRetry !== null ||
    Boolean(connectionError)
  )
}

export function ConversationStatusTail({
  sessionFailures = [],
  onSessionFailureAction,
  onSessionFailureDismiss,
  claudeApiRetry = null,
  connectionError = null,
}: ConversationStatusTailProps) {
  const tAcp = useTranslations("Folder.chat.acpConnections")
  const retryLineText = useMemo(() => {
    if (!claudeApiRetry) return null

    const retryAttempt =
      claudeApiRetry.attempt !== null && claudeApiRetry.attempt !== undefined
        ? Math.trunc(claudeApiRetry.attempt)
        : null
    const retryMax =
      claudeApiRetry.maxRetries !== null &&
      claudeApiRetry.maxRetries !== undefined
        ? Math.trunc(claudeApiRetry.maxRetries)
        : null
    const retryDelaySeconds =
      claudeApiRetry.retryDelayMs !== null &&
      claudeApiRetry.retryDelayMs !== undefined
        ? (claudeApiRetry.retryDelayMs / 1000).toFixed(1)
        : null
    const errorLabel =
      claudeApiRetry.error ?? tAcp("claudeApiRetry.fallbackError")
    const statusLabel =
      claudeApiRetry.errorStatus !== null &&
      claudeApiRetry.errorStatus !== undefined
        ? tAcp("claudeApiRetry.httpStatus", {
            status: Math.trunc(claudeApiRetry.errorStatus),
          })
        : ""
    const retryLabel =
      retryAttempt !== null && retryMax !== null
        ? tAcp("claudeApiRetry.retryingWithMax", {
            attempt: retryAttempt,
            max: retryMax,
          })
        : retryAttempt !== null
          ? tAcp("claudeApiRetry.retryingAttempt", {
              attempt: retryAttempt,
            })
          : tAcp("claudeApiRetry.retrying")
    const delayLabel =
      retryDelaySeconds !== null
        ? tAcp("claudeApiRetry.nextRetryIn", {
            seconds: retryDelaySeconds,
          })
        : null

    return delayLabel !== null
      ? tAcp("claudeApiRetry.lineWithDelay", {
          error: errorLabel,
          status: statusLabel,
          retry: retryLabel,
          delay: delayLabel,
        })
      : tAcp("claudeApiRetry.line", {
          error: errorLabel,
          status: statusLabel,
          retry: retryLabel,
        })
  }, [claudeApiRetry, tAcp])

  return (
    <div className="space-y-1" aria-live="polite">
      {sessionFailures.length > 0 && (
        <SessionFailureBanner
          failures={sessionFailures}
          onAction={onSessionFailureAction}
          onDismiss={onSessionFailureDismiss}
        />
      )}
      {retryLineText && (
        <div className="flex min-w-0 items-center gap-2 px-1 py-1.5 text-xs text-destructive">
          <Loader2
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0 animate-spin"
          />
          <span className="min-w-0 truncate font-medium">{retryLineText}</span>
        </div>
      )}
      {connectionError && (
        <div
          role="alert"
          className="flex min-w-0 items-center gap-2 px-1 py-1.5 text-xs text-destructive"
        >
          <AlertCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">{connectionError}</span>
        </div>
      )}
    </div>
  )
}
