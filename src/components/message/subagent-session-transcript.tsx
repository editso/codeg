"use client"

/**
 * Inline transcript for a sub-agent that writes to its own native session.
 *
 * Grok and Codex native teams keep child messages in a separate transcript
 * instead of forwarding them through the parent's ACP response. This component
 * reads that transcript underneath the launching Agent node. Its turns reuse
 * the parent activity rows, so the child stays in the activity flow rather
 * than becoming a card body or a drawer.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"

import { ContentPartsRenderer } from "@/components/message/content-parts-renderer"
import {
  adaptMessageTurns,
  type AdaptedMessage,
} from "@/lib/adapters/ai-elements-adapter"
import { getSubagentConversation } from "@/lib/api"
import { toolStatusUnsettled } from "@/lib/tool-call-lifecycle"
import type { AgentType, MessageTurn } from "@/lib/types"
import { SubagentTranscriptAncestryProvider } from "./subagent-transcript-context"

const LIVE_REFRESH_MS = 2000

function inProgressToolCallsByTurn(
  turns: MessageTurn[]
): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>()

  turns.forEach((turn, index) => {
    const pending = new Set<string>()
    for (const block of turn.blocks) {
      if (
        block.type === "tool_use" &&
        block.tool_use_id &&
        toolStatusUnsettled(block.status)
      ) {
        pending.add(block.tool_use_id)
      }
    }
    if (pending.size > 0) out.set(index, pending)
  })

  return out
}

interface SubagentSessionTranscriptProps {
  /** The child rollout/session id written by the host agent. */
  sessionId: string
  agentType: AgentType
  /** Keep re-reading while the launch card indicates that the child is live. */
  live: boolean
  /**
   * An Agent header is indented after its rail icon. Its nested session rows
   * compensate that offset so they become a flat continuation of the parent
   * activity rail rather than a second, progressively-indented timeline.
   */
  alignToParentRail?: boolean
}

function TranscriptNotice({
  children,
  state,
  alignToParentRail = false,
}: {
  children: string
  state: "loading" | "error" | "empty"
  alignToParentRail?: boolean
}) {
  const loading = state === "loading"
  const error = state === "error"

  return (
    <div
      data-agent-session-parent-rail={alignToParentRail || undefined}
      className={
        "grid gap-0.5 pr-2 " + (alignToParentRail ? "pl-0" : "pl-[15px]")
      }
    >
      <div
        className={
          "relative z-10 flex min-w-0 gap-2 px-1.5 py-1 text-[13px] leading-5 " +
          (error ? "text-destructive" : "text-muted-foreground/85")
        }
        role={loading ? "status" : error ? "alert" : undefined}
      >
        <span
          aria-hidden="true"
          className="relative z-10 inline-grid h-5 w-5 shrink-0 place-items-center"
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <span
              className={
                "size-1.5 rounded-full " +
                (error ? "bg-destructive/80" : "bg-muted-foreground/55")
              }
            />
          )}
        </span>
        <p className="min-w-0">{children}</p>
      </div>
    </div>
  )
}

export function SubagentSessionTranscript({
  sessionId,
  agentType,
  live,
  alignToParentRail = false,
}: SubagentSessionTranscriptProps) {
  const t = useTranslations("Folder.chat.contentParts")
  const sharedT = useTranslations("Folder.chat.shared")
  const [messages, setMessages] = useState<AdaptedMessage[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Only the first read renders a loading state. Refreshes keep the previous
  // activity on screen so an append to the child's file never makes it blink.
  const [loading, setLoading] = useState(false)
  const mountedRef = useRef(true)
  const inFlightRef = useRef(false)
  const seqRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const load = useCallback(
    async (initial: boolean) => {
      if (!initial && inFlightRef.current) return

      const seq = ++seqRef.current
      inFlightRef.current = true
      if (initial) setLoading(true)

      try {
        const detail = await getSubagentConversation(agentType, sessionId)
        if (!mountedRef.current || seq !== seqRef.current) return

        setMessages(
          adaptMessageTurns(
            detail.turns,
            {
              attachedResources: sharedT("attachedResources"),
              toolCallFailed: sharedT("toolCallFailed"),
            },
            undefined,
            live ? inProgressToolCallsByTurn(detail.turns) : undefined
          )
        )
        setError(null)
      } catch (err) {
        if (!mountedRef.current || seq !== seqRef.current) return
        // A child can be read while its process is replacing the transcript.
        // Keep a good previous result and let the next live refresh recover.
        if (initial) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (seq === seqRef.current) inFlightRef.current = false
        if (mountedRef.current && initial) setLoading(false)
      }
    },
    [agentType, live, sessionId, sharedT]
  )

  useEffect(() => {
    void load(true)
  }, [load])

  useEffect(() => {
    if (!live) return

    const timer = window.setInterval(() => void load(false), LIVE_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [live, load])

  // The launch capsule already supplies the child task. Showing its copied
  // kickoff prompt again would make the parent conversation read as though the
  // user wrote it twice; keep the actual work (assistant/system turns) only.
  const activityMessages = messages?.filter(
    (message) => message.role !== "user"
  )

  return (
    <div
      aria-label={t("agentSessionTitle")}
      className="min-w-0"
      data-agent-session-presentation="timeline"
      data-agent-session-parent-rail={alignToParentRail || undefined}
      data-testid="agent-session-transcript"
    >
      {loading && messages == null ? (
        <TranscriptNotice state="loading" alignToParentRail={alignToParentRail}>
          {t("agentSessionLoading")}
        </TranscriptNotice>
      ) : error ? (
        <TranscriptNotice state="error" alignToParentRail={alignToParentRail}>
          {error}
        </TranscriptNotice>
      ) : activityMessages && activityMessages.length > 0 ? (
        <SubagentTranscriptAncestryProvider sessionId={sessionId}>
          <div className="min-w-0">
            {activityMessages.map((message, index) => (
              <ContentPartsRenderer
                key={message.id || "turn-" + index}
                parts={message.content}
                role={message.role}
                activityDurationMs={message.duration_ms}
                inlineActivity
                activityRowsClassName={
                  alignToParentRail ? "pl-0 pr-2" : undefined
                }
              />
            ))}
          </div>
        </SubagentTranscriptAncestryProvider>
      ) : (
        <TranscriptNotice state="empty" alignToParentRail={alignToParentRail}>
          {t("agentSessionEmpty")}
        </TranscriptNotice>
      )}
    </div>
  )
}
