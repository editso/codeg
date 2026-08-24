/**
 * The invariant the host exists for: a delegated-session drawer must outlive
 * the card that opened it.
 *
 * The cards live in virtua's rows, so scrolling far enough unmounts them. When
 * each card owned its own `open` state and rendered its own drawer, that
 * unmount closed the viewer out from under the user mid-read. These tests
 * unmount the opener directly — the same thing virtualization does, without
 * having to drive a scroll container in jsdom.
 */
import { act, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { SessionViewerHost, useSessionViewerHost } from "./session-viewer-host"

// The delegated viewer reaches the runtime provider tree / the conversation
// API. Stub it to a sentinel that reports what it was pointed at — this file is
// about ownership and lifetime, not about what a transcript renders.
vi.mock("./sub-agent-session-dialog", () => ({
  SubAgentSessionDialog: ({
    open,
    childConversationId,
  }: {
    open: boolean
    childConversationId: number
  }) =>
    open ? (
      <div
        data-testid="delegation-viewer"
        data-conversation-id={childConversationId}
      />
    ) : null,
}))
// The delegation branch re-derives its model from the raw source; drive that
// resolution directly rather than booting the connection/binding stores.
vi.mock("@/hooks/use-delegation-card-model", () => ({
  useDelegationCardModel: (source: { parentToolUseId: string }) => ({
    agentType: "codex",
    task: "do the thing",
    taskId: null,
    status: "running",
    errorCode: undefined,
    // Derived from the source, so the assertion below proves the viewer is
    // still resolving from it after the opener is gone.
    childConversationId: Number(source.parentToolUseId.replace("tool-", "")),
    childConnectionId: "child-1",
    hasModel: true,
  }),
}))

/** A stand-in for a delegation card: opens the viewer, then can be unmounted
 *  the way virtua unmounts a row that scrolled out of the buffer. */
function OpenerCard({ toolUseId }: { toolUseId: string }) {
  const host = useSessionViewerHost()
  return (
    <button
      type="button"
      onClick={() =>
        host?.open({
          kind: "delegation",
          source: { parentToolUseId: toolUseId },
        })
      }
    >
      open {toolUseId}
    </button>
  )
}

function Harness({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(true)
  return (
    <SessionViewerHost>
      <button type="button" onClick={() => setMounted(false)}>
        scroll away
      </button>
      {mounted ? children : null}
    </SessionViewerHost>
  )
}

describe("SessionViewerHost", () => {
  it("keeps the viewer open after the card that opened it unmounts", () => {
    render(
      <Harness>
        <OpenerCard toolUseId="tool-42" />
      </Harness>
    )

    act(() => {
      screen.getByText("open tool-42").click()
    })
    expect(screen.getByTestId("delegation-viewer")).toHaveAttribute(
      "data-conversation-id",
      "42"
    )

    // Virtualization, simulated: the row goes away.
    act(() => {
      screen.getByText("scroll away").click()
    })

    expect(screen.queryByText("open tool-42")).not.toBeInTheDocument()
    // Still open, and still resolving from the source it was handed.
    expect(screen.getByTestId("delegation-viewer")).toHaveAttribute(
      "data-conversation-id",
      "42"
    )
  })

  it("renders nothing until something asks for a viewer", () => {
    render(
      <Harness>
        <OpenerCard toolUseId="tool-1" />
      </Harness>
    )
    expect(screen.queryByTestId("delegation-viewer")).not.toBeInTheDocument()
  })

  it("reports no host outside a provider", () => {
    function Probe() {
      const host = useSessionViewerHost()
      return <span data-testid="probe">{host === null ? "none" : "host"}</span>
    }
    render(<Probe />)
    expect(screen.getByTestId("probe")).toHaveTextContent("none")
  })
})
