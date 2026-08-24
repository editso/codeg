import { act, render, screen, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { StickToBottom } from "use-stick-to-bottom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const api = vi.hoisted(() => ({
  getConversation: vi.fn(),
  getSubagentConversation: vi.fn(),
}))

vi.mock("@/lib/api", () => ({
  getConversation: api.getConversation,
  getSubagentConversation: api.getSubagentConversation,
}))

import { ContentPartsRenderer } from "./content-parts-renderer"
import { SubagentTranscriptAncestryProvider } from "./subagent-transcript-context"
import { SubagentSessionTranscript } from "./subagent-session-transcript"
import type { AdaptedContentPart } from "@/lib/adapters/ai-elements-adapter"
import enMessages from "@/i18n/messages/en.json"

function childDetail() {
  return {
    summary: {},
    turns: [
      {
        id: "kickoff",
        role: "user",
        blocks: [{ type: "text", text: "Do not render this kickoff prompt." }],
        timestamp: "2026-08-24T00:00:00.000Z",
      },
      {
        id: "child-answer",
        role: "assistant",
        blocks: [
          { type: "text", text: "Child completed the repository review." },
        ],
        timestamp: "2026-08-24T00:00:01.000Z",
      },
    ],
  }
}

function unfilteredParentDetail() {
  return {
    summary: {},
    turns: [
      {
        id: "parent-answer",
        role: "assistant",
        blocks: [
          {
            type: "text",
            text: "Parent-only history must not appear in this agent.",
          },
        ],
        timestamp: "2026-08-24T00:00:00.000Z",
      },
    ],
  }
}

function renderTranscript(live = false) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <StickToBottom>
        <SubagentSessionTranscript
          sessionId="child-session-1"
          agentType="codex"
          live={live}
        />
      </StickToBottom>
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  api.getConversation.mockReset()
  api.getSubagentConversation.mockReset()
  // This is deliberately different from the child-only endpoint response.
  // If the component accidentally returns to the generic API, the test will
  // render this copied parent message and fail below.
  api.getConversation.mockResolvedValue(unfilteredParentDetail())
  api.getSubagentConversation.mockResolvedValue(childDetail())
})

afterEach(() => {
  vi.useRealTimers()
})

describe("SubagentSessionTranscript", () => {
  it("uses the child-only API, renders child work inline, and omits its kickoff prompt", async () => {
    renderTranscript()

    await waitFor(() =>
      expect(api.getSubagentConversation).toHaveBeenCalledWith(
        "codex",
        "child-session-1"
      )
    )
    const childMessage = await screen.findByText(
      "Child completed the repository review."
    )
    const transcript = screen.getByTestId("agent-session-transcript")
    expect(transcript).toHaveAttribute(
      "data-agent-session-presentation",
      "timeline"
    )
    // The child answer is a normal activity row, not a formal response inside
    // a child-session card.
    expect(childMessage.closest(".codeg-activity-reasoning")).not.toBeNull()
    expect(transcript.querySelector("section")).toBeNull()
    expect(screen.queryByText("Live activity")).not.toBeInTheDocument()
    expect(
      screen.queryByText("Do not render this kickoff prompt.")
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText("Parent-only history must not appear in this agent.")
    ).not.toBeInTheDocument()
    expect(api.getConversation).not.toHaveBeenCalled()
  })

  it("does not poll a settled child transcript", async () => {
    vi.useFakeTimers()
    renderTranscript(false)

    await act(async () => {
      await Promise.resolve()
    })
    expect(api.getSubagentConversation).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(6000)
      await Promise.resolve()
    })
    expect(api.getSubagentConversation).toHaveBeenCalledTimes(1)
  })

  it("refreshes a live child transcript on its two-second cadence", async () => {
    vi.useFakeTimers()
    renderTranscript(true)

    await act(async () => {
      await Promise.resolve()
    })
    expect(api.getSubagentConversation).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(2000)
      await Promise.resolve()
    })
    expect(api.getSubagentConversation).toHaveBeenCalledTimes(2)
  })

  it("suppresses a copied Codex launch that points back to the current child", () => {
    const copiedLaunch: Extract<AdaptedContentPart, { type: "tool-call" }> = {
      type: "tool-call",
      toolCallId: "copied-launch",
      toolName: "agent",
      input: JSON.stringify({
        subagent_type: "worker",
        agent_id: "child-session-1",
        __codegCodexSubagentLaunch: true,
      }),
      state: "output-available",
    }
    const copiedLaunchGroup: Extract<
      AdaptedContentPart,
      { type: "tool-group" }
    > = {
      type: "tool-group",
      items: [copiedLaunch],
      isStreaming: false,
    }

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <StickToBottom>
          <SubagentTranscriptAncestryProvider sessionId="child-session-1">
            <ContentPartsRenderer
              parts={[copiedLaunch, copiedLaunchGroup]}
              role="assistant"
              inlineActivity
            />
          </SubagentTranscriptAncestryProvider>
        </StickToBottom>
      </NextIntlClientProvider>
    )

    expect(screen.queryByText("worker")).not.toBeInTheDocument()
  })
})
