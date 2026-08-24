"use client"

/**
 * Owns delegation-session drawers for one transcript, ABOVE the virtual list.
 *
 * The `DelegatedSubThread` card for a `delegate_to_agent` call renders inside
 * `VirtualizedMessageThread`'s rows. It used to hold the
 * viewer's open state and render the drawer itself, which meant scrolling
 * the card out of virtua's buffer unmounted the row and took the open drawer
 * down with it. Hoisting the state and the drawer to `MessageListView` (which
 * renders the virtualizer, not a row inside it) is what decouples the two.
 *
 * Standalone rollout sub-agents do not use this host: their transcript is
 * rendered inline in the launching Agent activity card.
 *
 * ONE request slot, not one per kind. Two viewers open at the same level would
 * be same-width siblings with no stacking relationship between them — one
 * flatly covering the other, which reads as a glitch. Opening a second viewer
 * therefore replaces the first.
 */

import * as React from "react"

import { SubAgentSessionDialog } from "@/components/message/sub-agent-session-dialog"
import {
  useDelegationCardModel,
  type DelegationCardSource,
} from "@/hooks/use-delegation-card-model"

/** A sub-agent delegated with `delegate_to_agent`, viewed through its child
 *  conversation. Carries the card's raw SOURCE rather than the resolved ids —
 *  see `DelegationViewer` below. */
interface DelegationRequest {
  kind: "delegation"
  source: DelegationCardSource
}

export type SessionViewerRequest = DelegationRequest

interface SessionViewerHostValue {
  open: (request: SessionViewerRequest) => void
}

const SessionViewerHostContext =
  React.createContext<SessionViewerHostValue | null>(null)

/**
 * The host for the current transcript, or `null` when there is none.
 *
 * Null is a supported answer, not a failure: `ContentPartsRenderer` also
 * renders outside a `MessageListView`, where no delegated-session drawer is
 * needed.
 */
export function useSessionViewerHost(): SessionViewerHostValue | null {
  return React.useContext(SessionViewerHostContext)
}

export function SessionViewerHost({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = React.useState<SessionViewerRequest | null>(
    null
  )
  const [open, setOpen] = React.useState(false)

  const value = React.useMemo<SessionViewerHostValue>(
    () => ({
      open: (next) => {
        setRequest(next)
        setOpen(true)
      },
    }),
    []
  )

  // Closing only lowers the flag; the request stays so the drawer has content
  // to draw through its exit transition. The delegated viewer gates its body
  // and fetches on `open`.
  return (
    <SessionViewerHostContext.Provider value={value}>
      {children}
      {request?.kind === "delegation" && (
        <DelegationViewer
          // A different delegation is a different child conversation, and the
          // viewer's whole live bridge is keyed to that. Remount rather than
          // re-point.
          key={request.source.parentToolUseId}
          source={request.source}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </SessionViewerHostContext.Provider>
  )
}

/**
 * Re-derives the delegation's live model here rather than taking the card's
 * word for it.
 *
 * `DelegationCardSource` is nothing but the tool call's own serializable
 * fields, and `useDelegationCardModel` turns those plus the live connection /
 * binding stores into the agent type, status and child ids. Running it here
 * means the viewer keeps tracking the child — a late binding, a reconnect that
 * moves `childConnectionId` — long after the card that opened it was scrolled
 * away and unmounted. A snapshot of the resolved ids would have frozen at
 * whatever was known at click time.
 */
function DelegationViewer({
  source,
  open,
  onOpenChange,
}: {
  source: DelegationCardSource
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { agentType, task, childConversationId, childConnectionId } =
    useDelegationCardModel(source)

  if (childConversationId == null) return null

  return (
    <SubAgentSessionDialog
      open={open}
      onOpenChange={onOpenChange}
      childConversationId={childConversationId}
      childConnectionId={childConnectionId}
      agentType={agentType}
      kickoffTask={task}
    />
  )
}
