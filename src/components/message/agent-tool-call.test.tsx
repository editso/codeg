import { type ReactElement, type ReactNode } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { StickToBottom } from "use-stick-to-bottom"
import { describe, expect, it, vi } from "vitest"

import { AgentToolCallPart } from "./agent-tool-call"
import { ContentPartsRenderer } from "./content-parts-renderer"
import {
  adaptMessageTurn,
  type AdaptedContentPart,
} from "@/lib/adapters/ai-elements-adapter"
import { buildStreamingTurnsFromLiveMessage } from "@/contexts/conversation-runtime-context"
import type { LiveMessage } from "@/contexts/acp-connections-context"
import enMessages from "@/i18n/messages/en.json"

type ToolCallPart = Extract<AdaptedContentPart, { type: "tool-call" }>

vi.mock("./subagent-session-transcript", () => ({
  SubagentSessionTranscript: ({
    sessionId,
    agentType,
    live,
    alignToParentRail,
  }: {
    sessionId: string
    agentType: string
    live: boolean
    alignToParentRail?: boolean
  }) => (
    <div
      data-testid="agent-session-transcript"
      data-agent-type={agentType}
      data-live={String(live)}
      data-session-id={sessionId}
      data-parent-rail={String(Boolean(alignToParentRail))}
    />
  ),
}))

vi.mock("@/components/ai-elements/link-safety", () => ({
  FilePathLink: ({ children }: { children: ReactNode }) => (
    <span>{children}</span>
  ),
}))

function renderCard(part: ToolCallPart) {
  const ui: ReactElement = (
    <AgentToolCallPart part={part} renderToolCall={() => null} />
  )
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>
  )
}

function basePart(
  input: string | null,
  state: ToolCallPart["state"]
): ToolCallPart {
  return {
    type: "tool-call",
    toolCallId: "call-agent",
    toolName: "agent",
    input,
    state,
  }
}

describe("AgentToolCallPart title", () => {
  it("renders the subagent_type prefix in front of the description", () => {
    renderCard(
      basePart(
        JSON.stringify({
          subagent_type: "Explore",
          description: "map the repo",
        }),
        "input-available"
      )
    )
    expect(screen.getByText("Explore: map the repo")).toBeInTheDocument()
    expect(screen.queryByText(/Sub-agent starting/)).not.toBeInTheDocument()
  })

  it("shows the description alone when subagent_type hasn't streamed in yet", () => {
    // Partial / out-of-order streamed input: the description is present but the
    // sub-agent type isn't. The placeholder must NOT be prepended to it.
    renderCard(
      basePart(
        '{"description":"map the repo"', // truncated, no subagent_type yet
        "input-streaming"
      )
    )
    expect(screen.getByText("map the repo")).toBeInTheDocument()
    expect(screen.queryByText(/Sub-agent starting/)).not.toBeInTheDocument()
  })

  it("falls back to the placeholder only when nothing has arrived", () => {
    renderCard(basePart(null, "input-available"))
    expect(screen.getByText("Sub-agent starting…")).toBeInTheDocument()
  })

  it("reads Codex's agent_type field as the prefix", () => {
    // Codex's live spawn_agent payload labels the agent with `agent_type`.
    renderCard(
      basePart(
        JSON.stringify({ agent_type: "codex", description: "do the thing" }),
        "input-available"
      )
    )
    expect(screen.getByText("codex: do the thing")).toBeInTheDocument()
  })

  it("ignores non-string subagent_type / description (no React-child crash)", () => {
    // Some hosts (e.g. CodeBuddy) can hand us a tool input where these fields
    // are objects, not strings. Rendering them directly would throw "Objects
    // are not valid as a React child"; they must be treated as absent.
    expect(() =>
      renderCard(
        basePart(
          JSON.stringify({ subagent_type: {}, description: {} }),
          "input-available"
        )
      )
    ).not.toThrow()
    expect(screen.getByText("Sub-agent starting…")).toBeInTheDocument()
  })

  it("keeps a string description when subagent_type is a non-string object", () => {
    renderCard(
      basePart(
        JSON.stringify({
          subagent_type: { nested: true },
          description: "build",
        }),
        "input-available"
      )
    )
    expect(screen.getByText("build")).toBeInTheDocument()
  })

  it("badges the codex agent_id (shortened to first UUID segment) when present", () => {
    renderCard(
      basePart(
        JSON.stringify({
          subagent_type: "worker",
          description: "build",
          agent_id: "abcd1234-uuid-9",
        }),
        "output-available"
      )
    )
    expect(screen.getByText("abcd1234")).toBeInTheDocument()
    expect(screen.queryByText("abcd1234-uuid-9")).not.toBeInTheDocument()
  })

  it("shows no agent_id badge for non-codex agents (e.g. Claude Task)", () => {
    renderCard(
      basePart(
        JSON.stringify({ subagent_type: "Explore", description: "map" }),
        "output-available"
      )
    )
    expect(screen.queryByText("abcd1234")).not.toBeInTheDocument()
  })

  it("renders a codex native sub-agent by name alone, with no prompt panel", () => {
    // codex 0.147's team-of-agents encrypts the hand-off message, so neither
    // the live signal (`classify_codex_subagent_activity`) nor the rollout can
    // supply a prompt or description — the capsule is name + thread badge.
    renderCard(
      basePart(
        JSON.stringify({
          subagent_type: "pnpm_build",
          prompt: "",
          description: "",
          agent_id: "01a0098a-7e8a-72d3-b7c0-2df130c84063",
          __codegCodexSubagentLaunch: true,
        }),
        "output-available"
      )
    )
    expect(screen.getByText("pnpm_build")).toBeInTheDocument()
    expect(screen.getByText("01a0098a")).toBeInTheDocument()
    // No empty "Prompt" disclosure, and above all no base64 anywhere.
    expect(screen.queryByText("Prompt")).not.toBeInTheDocument()
    // The launch opens its own timeline. The old caveat claimed the result
    // would only arrive in the parent, which is no longer true once we read
    // the native child rollout directly.
    expect(
      screen.queryByText(/reports no further progress/)
    ).not.toBeInTheDocument()
  })

  it("does not claim launch-only semantics for an ordinary sub-agent card", () => {
    // Claude's Task, the legacy codex collab spawn, … all settle when the
    // sub-agent really is done, and must not carry the caveat.
    renderCard({
      ...basePart(
        JSON.stringify({ subagent_type: "Explore", description: "map" }),
        "output-available"
      ),
      output: "Mapped 12 files.",
    })
    fireEvent.click(screen.getByRole("button", { name: "Completed" }))
    expect(screen.getByText("Mapped 12 files.")).toBeInTheDocument()
    expect(
      screen.queryByText(/reports no further progress/)
    ).not.toBeInTheDocument()
  })

  it("holds the launch caveat back while the spawn is still in flight", () => {
    renderCard(
      basePart(
        JSON.stringify({
          subagent_type: "pnpm_build",
          __codegCodexSubagentLaunch: true,
        }),
        "input-available"
      )
    )
    expect(
      screen.queryByText(/reports no further progress/)
    ).not.toBeInTheDocument()
  })
})

describe("AgentToolCallPart cursor task outcome envelope", () => {
  it("folds the success envelope into a duration suffix instead of a JSON body", () => {
    renderCard({
      ...basePart(
        JSON.stringify({ _toolName: "task", description: "run the build" }),
        "output-available"
      ),
      output: '{"durationMs":39894,"isBackground":false}',
    })
    expect(screen.getByText("39.9s")).toBeInTheDocument()
    // The folded duration has no body, so the capsule is a static "Completed"
    // chip (not an expandable button) and the raw envelope never renders.
    expect(screen.getByLabelText("Completed")).toBeInTheDocument()
    expect(screen.queryByText(/durationMs/)).not.toBeInTheDocument()
    expect(screen.queryByText(/isBackground/)).not.toBeInTheDocument()
  })

  it("renders the error envelope as an error box (wire status stays completed)", () => {
    renderCard({
      ...basePart(JSON.stringify({ _toolName: "task" }), "output-available"),
      output: '{"error":"Invalid arguments:\\nsubagent_type mismatch"}',
    })
    expect(screen.getByText(/Invalid arguments:/)).toBeInTheDocument()
    expect(screen.queryByText(/{"error"/)).not.toBeInTheDocument()
    // The capsule reports Error, not Completed.
    expect(screen.getByLabelText("Error")).toBeInTheDocument()
  })

  it("shows a background launch as still running instead of Completed", () => {
    renderCard({
      ...basePart(JSON.stringify({ _toolName: "task" }), "output-available"),
      output: '{"isBackground":true}',
    })
    // The completion envelope only acknowledges the launch: the pill carries
    // the running label…
    const trigger = screen.getByLabelText("Running in background")
    // …and the body shows the visible running indicator, not raw JSON.
    fireEvent.click(trigger)
    expect(screen.getByText("Running in background")).toBeInTheDocument()
    expect(screen.queryByText(/isBackground/)).not.toBeInTheDocument()
  })

  it("never folds outputs of non-cursor sub-agents (no _toolName stamp)", () => {
    // Another agent's sub-agent legitimately returning JSON error text: the
    // envelope must NOT repaint the card as failed — the text renders as-is.
    renderCard({
      ...basePart(
        JSON.stringify({ subagent_type: "Explore", description: "map" }),
        "output-available"
      ),
      output: '{"error":"not an envelope"}',
    })
    expect(screen.queryByLabelText("Error")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Completed" }))
    expect(screen.getByText(/not an envelope/)).toBeInTheDocument()
  })

  it("keeps rendering genuine report text as the body", () => {
    renderCard({
      ...basePart(
        JSON.stringify({ subagent_type: "Explore", description: "map" }),
        "output-available"
      ),
      output: "All 3 checks passed.",
    })
    // Completed non-error capsules mount collapsed; expand to see the body.
    fireEvent.click(screen.getByRole("button", { name: "Completed" }))
    expect(screen.getByText("All 3 checks passed.")).toBeInTheDocument()
  })

  it("reads cursor's subagentType oneof case as the title prefix", () => {
    renderCard(
      basePart(
        JSON.stringify({
          _toolName: "task",
          description: "run the build",
          subagentType: { case: "generalPurpose", value: {} },
        }),
        "input-available"
      )
    )
    expect(
      screen.getByText("generalPurpose: run the build")
    ).toBeInTheDocument()
  })
})

describe("AgentToolCallPart live subagent transcript", () => {
  const withTranscript = (
    state: ToolCallPart["state"],
    entries: NonNullable<ToolCallPart["agentTranscript"]>
  ): ToolCallPart => ({
    ...basePart(
      JSON.stringify({ subagent_type: "Explore", description: "scan" }),
      state
    ),
    agentTranscript: entries,
  })

  /** A card with no meaningful live child rows keeps the ordinary disclosure
   * behavior, so it can still be expanded to inspect its other content. */
  const expandRunningCapsule = () =>
    fireEvent.click(screen.getByRole("button", { name: "Running" }))

  it("renders text and thinking entries while running", () => {
    const { container } = renderCard(
      withTranscript("input-available", [
        { type: "thinking", text: "planning the sweep" },
        { type: "text", text: "found three matches" },
      ])
    )
    const capsule = container.querySelector(
      '[data-agent-capsule-presentation="timeline"]'
    )
    expect(capsule).not.toBeNull()
    expect(
      capsule?.querySelector('[data-agent-capsule-body="card"]')
    ).toBeNull()
    expect(screen.queryByText("Live activity")).not.toBeInTheDocument()
    expect(screen.getByText("planning the sweep")).toBeInTheDocument()
    expect(screen.getByText("found three matches")).toBeInTheDocument()
  })

  it("skips empty thinking entries and renders nothing when settled", () => {
    renderCard(
      withTranscript("input-available", [{ type: "thinking", text: "   " }])
    )
    expandRunningCapsule()
    expect(screen.queryByText("Live activity")).not.toBeInTheDocument()

    // A settled card never shows the transcript section — the store stops
    // attaching it, and even a stale prop must not render.
    const settled = withTranscript("output-available", [
      { type: "text", text: "stale transcript" },
    ])
    renderCard({ ...settled, output: "final result" })
    fireEvent.click(screen.getByRole("button", { name: "Completed" }))
    expect(screen.queryByText("stale transcript")).not.toBeInTheDocument()
    expect(screen.getByText("final result")).toBeInTheDocument()
  })

  it("bounds the rendered tail to the newest entries", () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({
      type: "text" as const,
      text: `entry-${i}`,
    }))
    renderCard(withTranscript("input-available", entries))
    // 25 entries, tail bound 20 → the first five never mount.
    expect(screen.queryByText("entry-0")).not.toBeInTheDocument()
    expect(screen.queryByText("entry-4")).not.toBeInTheDocument()
    expect(screen.getByText("entry-5")).toBeInTheDocument()
    expect(screen.getByText("entry-24")).toBeInTheDocument()
  })
})

describe("AgentToolCallPart grok live progress", () => {
  const runningPart = (meta: Record<string, unknown> | null): ToolCallPart => ({
    ...basePart(
      JSON.stringify({ subagent_type: "explore", description: "map repo" }),
      "input-available"
    ),
    meta,
  })

  it("renders the subagent_progress ticker while running", () => {
    renderCard(
      runningPart({
        grokSubagentProgress: {
          durationMs: 4200,
          turnCount: 1,
          toolCallCount: 7,
          contextUsagePct: 12.4,
        },
      })
    )
    fireEvent.click(screen.getByRole("button", { name: "Running" }))
    expect(
      screen.getByText("7 tool calls · 1 turns · 4.2s · context 12%")
    ).toBeInTheDocument()
  })

  it("skips absent fields and non-numeric shapes", () => {
    renderCard(
      runningPart({
        grokSubagentProgress: { toolCallCount: 3, contextUsagePct: "nope" },
      })
    )
    fireEvent.click(screen.getByRole("button", { name: "Running" }))
    expect(screen.getByText("3 tool calls")).toBeInTheDocument()
  })

  it("hides the ticker once the card settles", () => {
    const part: ToolCallPart = {
      ...basePart(
        JSON.stringify({ subagent_type: "explore", description: "map repo" }),
        "output-available"
      ),
      output: "final result",
      meta: { grokSubagentProgress: { toolCallCount: 9 } },
    }
    renderCard(part)
    fireEvent.click(screen.getByRole("button", { name: "Completed" }))
    expect(screen.queryByText(/9 tool calls/)).not.toBeInTheDocument()
    expect(screen.getByText("final result")).toBeInTheDocument()
  })

  it("shows the ticker alongside a background launch ack", () => {
    // A background spawn: the call is settled (ack output), the child still
    // runs — the ticker keeps updating in-turn next to "running in background".
    const part: ToolCallPart = {
      ...basePart(
        JSON.stringify({ subagent_type: "explore", description: "map repo" }),
        "output-available"
      ),
      output: "Subagent started in background.\nsubagent_id: sub-1",
      meta: { grokSubagentProgress: { toolCallCount: 5 } },
    }
    renderCard(part)
    fireEvent.click(
      screen.getByRole("button", { name: /running in background/i })
    )
    expect(screen.getByText("5 tool calls")).toBeInTheDocument()
    // The raw ack text is never dumped as the result body.
    expect(
      screen.queryByText(/Subagent started in background/)
    ).not.toBeInTheDocument()
  })
})

describe("AgentToolCallPart live child edits", () => {
  it("renders the complete live old/new payload as a compact diff", () => {
    const oldSource = Array.from(
      { length: 4_400 },
      (_, index) => `export const sourceLine${index} = ${index}`
    ).join("\n")
    const newSource = oldSource.replace(
      "export const sourceLine4200 = 4200",
      "export const sourceLine4200 = 4201"
    )
    const editInput = JSON.stringify({
      file_path:
        "/workspace/github/codeg/src/components/message/content-parts-renderer.tsx",
      // Match the live payload that exposed the bug: the huge new side occurs
      // before old_string, so a 500-character preview can never form a diff.
      new_string: newSource,
      old_string: oldSource,
    })
    const liveMessage: LiveMessage = {
      id: "live-parent-agent-edit",
      role: "assistant",
      startedAt: 0,
      content: [
        {
          type: "tool_call",
          info: {
            tool_call_id: "parent-agent",
            title: "agent",
            kind: "other",
            status: "in_progress",
            content: null,
            raw_input: JSON.stringify({
              subagent_type: "worker",
              description: "edit the renderer",
            }),
            raw_output_chunks: [],
            raw_output_total_bytes: 0,
            locations: null,
            meta: null,
            images: [],
          },
        },
        {
          type: "tool_call",
          info: {
            tool_call_id: "child-edit",
            title: "Edit content-parts-renderer.tsx",
            kind: "edit",
            status: "completed",
            content: null,
            raw_input: editInput,
            raw_output_chunks: [],
            raw_output_total_bytes: 0,
            locations: null,
            meta: { claudeCode: { parentToolUseId: "parent-agent" } },
            images: [],
          },
        },
        // The parent remains active after the child Edit has completed.
        { type: "thinking", text: "continue checking the result" },
      ],
    }

    const live = buildStreamingTurnsFromLiveMessage(1, liveMessage)
    const parentMessage = adaptMessageTurn(
      live.turns[0],
      { attachedResources: "", toolCallFailed: "Tool call failed" },
      true,
      live.inProgressToolCallIds
    )
    const parentPart = parentMessage.content.find(
      (part): part is ToolCallPart =>
        part.type === "tool-call" && part.toolName === "agent"
    )
    expect(parentPart).toBeDefined()
    expect(parentPart?.agentStats?.tool_calls?.[0]?.input_preview).toBe(
      editInput
    )

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <StickToBottom>
          <AgentToolCallPart
            part={parentPart as ToolCallPart}
            renderToolCall={(childPart, key) => (
              <ContentPartsRenderer key={key} parts={[childPart]} role="user" />
            )}
          />
        </StickToBottom>
      </NextIntlClientProvider>
    )

    fireEvent.click(screen.getByRole("button", { name: "Running" }))
    fireEvent.click(
      screen.getByRole("button", { name: /content-parts-renderer\.tsx/ })
    )

    expect(
      screen.getByText("export const sourceLine4200 = 4201")
    ).toBeInTheDocument()
    expect(
      screen.getByText("export const sourceLine4200 = 4200")
    ).toBeInTheDocument()
    expect(screen.queryByTestId("large-tool-output")).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('"new_string"')
    expect(document.body.textContent).not.toContain('"old_string"')
  })

  it("uses a complete large result-side edit while the parent is still live", () => {
    const oldSource = Array.from(
      { length: 4_400 },
      (_, index) => `export const sourceLine${index} = ${index}`
    ).join("\n")
    const newSource = oldSource.replace(
      "export const sourceLine4200 = 4200",
      "export const sourceLine4200 = 4201"
    )
    const editOutput = JSON.stringify({
      file_path:
        "/workspace/github/codeg/src/components/message/content-parts-renderer.tsx",
      new_string: newSource,
      old_string: oldSource,
    })
    const pathOnlyInput = JSON.stringify({
      file_path:
        "/workspace/github/codeg/src/components/message/content-parts-renderer.tsx",
    })
    const liveMessage: LiveMessage = {
      id: "live-parent-agent-result-edit",
      role: "assistant",
      startedAt: 0,
      content: [
        {
          type: "tool_call",
          info: {
            tool_call_id: "parent-agent",
            title: "agent",
            kind: "other",
            status: "in_progress",
            content: null,
            raw_input: JSON.stringify({
              subagent_type: "worker",
              description: "edit the renderer",
            }),
            raw_output_chunks: [],
            raw_output_total_bytes: 0,
            locations: null,
            meta: null,
            images: [],
          },
        },
        {
          type: "tool_call",
          info: {
            tool_call_id: "child-edit-result",
            title: "Edit content-parts-renderer.tsx",
            kind: "edit",
            status: "completed",
            content: null,
            raw_input: pathOnlyInput,
            raw_output_chunks: [editOutput],
            raw_output_total_bytes: editOutput.length,
            locations: null,
            meta: { claudeCode: { parentToolUseId: "parent-agent" } },
            images: [],
          },
        },
        { type: "thinking", text: "continue checking the result" },
      ],
    }

    const live = buildStreamingTurnsFromLiveMessage(1, liveMessage)
    const parentMessage = adaptMessageTurn(
      live.turns[0],
      { attachedResources: "", toolCallFailed: "Tool call failed" },
      true,
      live.inProgressToolCallIds
    )
    const parentPart = parentMessage.content.find(
      (part): part is ToolCallPart =>
        part.type === "tool-call" && part.toolName === "agent"
    )
    const child = parentPart?.agentStats?.tool_calls?.[0]
    expect(child?.input_preview).toBe(pathOnlyInput)
    expect(child?.output_preview).toBe(editOutput)

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <StickToBottom>
          <AgentToolCallPart
            part={parentPart as ToolCallPart}
            renderToolCall={(childPart, key) => (
              <ContentPartsRenderer key={key} parts={[childPart]} role="user" />
            )}
          />
        </StickToBottom>
      </NextIntlClientProvider>
    )

    fireEvent.click(screen.getByRole("button", { name: "Running" }))
    fireEvent.click(
      screen.getByRole("button", { name: /content-parts-renderer\.tsx/ })
    )

    expect(
      screen.getByText("export const sourceLine4200 = 4201")
    ).toBeInTheDocument()
    expect(
      screen.getByText("export const sourceLine4200 = 4200")
    ).toBeInTheDocument()
    expect(screen.queryByTestId("large-tool-output")).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('"new_string"')
    expect(document.body.textContent).not.toContain('"old_string"')
  })

  it("renders every file from a large live changes-map edit", () => {
    const oldFirst = Array.from(
      { length: 4_400 },
      (_, index) => `export const firstLine${index} = ${index}`
    ).join("\n")
    const newFirst = oldFirst.replace(
      "export const firstLine4200 = 4200",
      "export const firstLine4200 = 4201"
    )
    const oldSecond = Array.from(
      { length: 4_400 },
      (_, index) => `export const secondLine${index} = ${index}`
    ).join("\n")
    const newSecond = oldSecond.replace(
      "export const secondLine4200 = 4200",
      "export const secondLine4200 = 4201"
    )
    // This is the Codex ACP multi-Diff shape from x.json: a map keyed by
    // absolute file path, not a single root-level old/new pair.
    const multiEditInput = JSON.stringify({
      changes: {
        "/workspace/github/codeg/src/components/message/content-parts-renderer.tsx":
          {
            new_text: newFirst,
            old_text: oldFirst,
          },
        "/workspace/github/codeg/src/stores/conversation-runtime-store.ts": {
          new_text: newSecond,
          old_text: oldSecond,
        },
      },
    })
    const liveMessage: LiveMessage = {
      id: "live-parent-agent-multi-edit",
      role: "assistant",
      startedAt: 0,
      content: [
        {
          type: "tool_call",
          info: {
            tool_call_id: "parent-agent",
            title: "agent",
            kind: "other",
            status: "in_progress",
            content: null,
            raw_input: JSON.stringify({
              subagent_type: "worker",
              description: "edit both render paths",
            }),
            raw_output_chunks: [],
            raw_output_total_bytes: 0,
            locations: null,
            meta: null,
            images: [],
          },
        },
        {
          type: "tool_call",
          info: {
            tool_call_id: "child-multi-edit",
            title: "Edit two files",
            kind: "edit",
            status: "completed",
            content: null,
            raw_input: multiEditInput,
            raw_output_chunks: [],
            raw_output_total_bytes: 0,
            locations: null,
            meta: { claudeCode: { parentToolUseId: "parent-agent" } },
            images: [],
          },
        },
        { type: "thinking", text: "continue checking the result" },
      ],
    }

    const live = buildStreamingTurnsFromLiveMessage(1, liveMessage)
    const parentMessage = adaptMessageTurn(
      live.turns[0],
      { attachedResources: "", toolCallFailed: "Tool call failed" },
      true,
      live.inProgressToolCallIds
    )
    const parentPart = parentMessage.content.find(
      (part): part is ToolCallPart =>
        part.type === "tool-call" && part.toolName === "agent"
    )
    expect(parentPart?.agentStats?.tool_calls?.[0]?.input_preview).toBe(
      multiEditInput
    )

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <StickToBottom>
          <AgentToolCallPart
            part={parentPart as ToolCallPart}
            renderToolCall={(childPart, key) => (
              <ContentPartsRenderer key={key} parts={[childPart]} role="user" />
            )}
          />
        </StickToBottom>
      </NextIntlClientProvider>
    )

    fireEvent.click(screen.getByRole("button", { name: "Running" }))
    fireEvent.click(screen.getByRole("button", { name: /Edit \(2 files\)/ }))

    expect(
      screen.getByText("export const firstLine4200 = 4201")
    ).toBeInTheDocument()
    expect(
      screen.getByText("export const firstLine4200 = 4200")
    ).toBeInTheDocument()
    expect(
      screen.getByText("export const secondLine4200 = 4201")
    ).toBeInTheDocument()
    expect(
      screen.getByText("export const secondLine4200 = 4200")
    ).toBeInTheDocument()
    expect(screen.queryByTestId("large-tool-output")).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('"changes"')
  })

  it("uses a complete result-side changes map while the parent remains live", () => {
    const oldFirst = Array.from(
      { length: 1_200 },
      (_, index) => `export const resultFirst${index} = ${index}`
    ).join("\n")
    const newFirst = oldFirst.replace(
      "export const resultFirst1100 = 1100",
      "export const resultFirst1100 = 1101"
    )
    const oldSecond = Array.from(
      { length: 1_200 },
      (_, index) => `export const resultSecond${index} = ${index}`
    ).join("\n")
    const newSecond = oldSecond.replace(
      "export const resultSecond1100 = 1100",
      "export const resultSecond1100 = 1101"
    )
    const output = JSON.stringify({
      changes: {
        "/workspace/github/codeg/src/result-first.ts": {
          old_text: oldFirst,
          new_text: newFirst,
        },
        "/workspace/github/codeg/src/result-second.ts": {
          old_text: oldSecond,
          new_text: newSecond,
        },
      },
    })
    const liveMessage: LiveMessage = {
      id: "live-parent-agent-result-multi-edit",
      role: "assistant",
      startedAt: 0,
      content: [
        {
          type: "tool_call",
          info: {
            tool_call_id: "parent-agent",
            title: "agent",
            kind: "other",
            status: "in_progress",
            content: null,
            raw_input: JSON.stringify({
              subagent_type: "worker",
              description: "edit both result-side files",
            }),
            raw_output_chunks: [],
            raw_output_total_bytes: 0,
            locations: null,
            meta: null,
            images: [],
          },
        },
        {
          type: "tool_call",
          info: {
            tool_call_id: "child-result-multi-edit",
            title: "Edit result-side files",
            kind: "edit",
            status: "completed",
            content: null,
            raw_input: JSON.stringify({
              file_path: "/workspace/github/codeg/src/result-first.ts",
            }),
            raw_output_chunks: [output],
            raw_output_total_bytes: output.length,
            locations: null,
            meta: { claudeCode: { parentToolUseId: "parent-agent" } },
            images: [],
          },
        },
        { type: "thinking", text: "continue checking the result" },
      ],
    }

    const live = buildStreamingTurnsFromLiveMessage(1, liveMessage)
    const parentMessage = adaptMessageTurn(
      live.turns[0],
      { attachedResources: "", toolCallFailed: "Tool call failed" },
      true,
      live.inProgressToolCallIds
    )
    const parentPart = parentMessage.content.find(
      (part): part is ToolCallPart =>
        part.type === "tool-call" && part.toolName === "agent"
    )
    const child = parentPart?.agentStats?.tool_calls?.[0]
    expect(child?.output_preview).toBe(output)

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <StickToBottom>
          <AgentToolCallPart
            part={parentPart as ToolCallPart}
            renderToolCall={(childPart, key) => (
              <ContentPartsRenderer key={key} parts={[childPart]} role="user" />
            )}
          />
        </StickToBottom>
      </NextIntlClientProvider>
    )

    fireEvent.click(screen.getByRole("button", { name: "Running" }))
    // The live input only names the first target, while the complete result
    // carries the multi-file descriptor. The card title therefore keeps the
    // known first path; its expanded body must still show both diffs.
    fireEvent.click(
      screen.getByRole("button", { name: /Edit src\/result-first\.ts/ })
    )

    expect(
      screen.getByText("export const resultFirst1100 = 1100")
    ).toBeInTheDocument()
    expect(
      screen.getByText("export const resultFirst1100 = 1101")
    ).toBeInTheDocument()
    expect(
      screen.getByText("export const resultSecond1100 = 1100")
    ).toBeInTheDocument()
    expect(
      screen.getByText("export const resultSecond1100 = 1101")
    ).toBeInTheDocument()
    expect(screen.queryByTestId("large-tool-output")).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('"changes"')
  })

  it("renders a mixed multi-file event with an added-file diff", () => {
    const addedLines = Array.from(
      { length: 800 },
      (_, index) => `export const addedLine${index} = ${index}`
    )
    const addedFileDiff = [
      "--- /dev/null",
      "+++ b/src/generated/added-file.ts",
      `@@ -0,0 +1,${addedLines.length} @@`,
      ...addedLines.map((line) => `+${line}`),
    ].join("\n")
    const multiEditInput = JSON.stringify({
      changes: {
        "/workspace/github/codeg/src/existing.ts": {
          old_text: "export const version = 1",
          new_text: "export const version = 2",
        },
        "/workspace/github/codeg/src/generated/added-file.ts": {
          diff: addedFileDiff,
        },
      },
    })
    const liveMessage: LiveMessage = {
      id: "live-parent-agent-mixed-multi-edit",
      role: "assistant",
      startedAt: 0,
      content: [
        {
          type: "tool_call",
          info: {
            tool_call_id: "parent-agent",
            title: "agent",
            kind: "other",
            status: "in_progress",
            content: null,
            raw_input: JSON.stringify({
              subagent_type: "worker",
              description: "edit an existing file and create another",
            }),
            raw_output_chunks: [],
            raw_output_total_bytes: 0,
            locations: null,
            meta: null,
            images: [],
          },
        },
        {
          type: "tool_call",
          info: {
            tool_call_id: "child-mixed-multi-edit",
            title: "Edit two files",
            kind: "edit",
            status: "completed",
            content: null,
            raw_input: multiEditInput,
            raw_output_chunks: [],
            raw_output_total_bytes: 0,
            locations: null,
            meta: { claudeCode: { parentToolUseId: "parent-agent" } },
            images: [],
          },
        },
        { type: "thinking", text: "continue checking the result" },
      ],
    }

    const live = buildStreamingTurnsFromLiveMessage(1, liveMessage)
    const parentMessage = adaptMessageTurn(
      live.turns[0],
      { attachedResources: "", toolCallFailed: "Tool call failed" },
      true,
      live.inProgressToolCallIds
    )
    const parentPart = parentMessage.content.find(
      (part): part is ToolCallPart =>
        part.type === "tool-call" && part.toolName === "agent"
    )
    expect(parentPart?.agentStats?.tool_calls?.[0]?.input_preview).toBe(
      multiEditInput
    )

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <StickToBottom>
          <AgentToolCallPart
            part={parentPart as ToolCallPart}
            renderToolCall={(childPart, key) => (
              <ContentPartsRenderer key={key} parts={[childPart]} role="user" />
            )}
          />
        </StickToBottom>
      </NextIntlClientProvider>
    )

    fireEvent.click(screen.getByRole("button", { name: "Running" }))
    fireEvent.click(screen.getByRole("button", { name: /Edit \(2 files\)/ }))

    expect(screen.getByText("export const version = 1")).toBeInTheDocument()
    expect(screen.getByText("export const version = 2")).toBeInTheDocument()
    // The diff preview caps an oversized new file until the reader asks for
    // the rest; this must be a diff-specific disclosure, never Monaco/raw JSON.
    fireEvent.click(screen.getByRole("button", { name: /Show \d+ more lines/ }))
    expect(
      screen.getByText("export const addedLine799 = 799")
    ).toBeInTheDocument()
    expect(screen.queryByTestId("large-tool-output")).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('"diff"')
  })

  it("renders a large live new-file write instead of truncating its content", () => {
    const newFileContent = Array.from(
      { length: 4_400 },
      (_, index) => `export const generatedLine${index} = ${index}`
    ).join("\n")
    const writeInput = JSON.stringify({
      file_path: "/workspace/github/codeg/src/generated/new-file.ts",
      content: newFileContent,
    })
    const liveMessage: LiveMessage = {
      id: "live-parent-agent-write",
      role: "assistant",
      startedAt: 0,
      content: [
        {
          type: "tool_call",
          info: {
            tool_call_id: "parent-agent",
            title: "agent",
            kind: "other",
            status: "in_progress",
            content: null,
            raw_input: JSON.stringify({
              subagent_type: "worker",
              description: "create the generated file",
            }),
            raw_output_chunks: [],
            raw_output_total_bytes: 0,
            locations: null,
            meta: null,
            images: [],
          },
        },
        {
          type: "tool_call",
          info: {
            tool_call_id: "child-write",
            title: "Write new-file.ts",
            // ACP groups writes under the Edit kind; input shape determines the
            // frontend's canonical `write` route.
            kind: "edit",
            status: "completed",
            content: null,
            raw_input: writeInput,
            raw_output_chunks: [],
            raw_output_total_bytes: 0,
            locations: null,
            meta: { claudeCode: { parentToolUseId: "parent-agent" } },
            images: [],
          },
        },
        { type: "thinking", text: "continue checking the result" },
      ],
    }

    const live = buildStreamingTurnsFromLiveMessage(1, liveMessage)
    const parentMessage = adaptMessageTurn(
      live.turns[0],
      { attachedResources: "", toolCallFailed: "Tool call failed" },
      true,
      live.inProgressToolCallIds
    )
    const parentPart = parentMessage.content.find(
      (part): part is ToolCallPart =>
        part.type === "tool-call" && part.toolName === "agent"
    )
    const child = parentPart?.agentStats?.tool_calls?.[0]
    expect(child?.tool_name).toBe("write")
    expect(child?.input_preview).toBe(writeInput)

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <StickToBottom>
          <AgentToolCallPart
            part={parentPart as ToolCallPart}
            renderToolCall={(childPart, key) => (
              <ContentPartsRenderer key={key} parts={[childPart]} role="user" />
            )}
          />
        </StickToBottom>
      </NextIntlClientProvider>
    )

    fireEvent.click(screen.getByRole("button", { name: "Running" }))
    fireEvent.click(screen.getByRole("button", { name: /new-file\.ts/ }))

    expect(
      screen.getByText("export const generatedLine4200 = 4200")
    ).toBeInTheDocument()
    expect(screen.queryByTestId("large-tool-output")).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('"content"')
  })
})

describe("inline subagent read activity", () => {
  it("keeps a settled Agent read call visible without its parameters", () => {
    const filePath =
      "/workspace/github/codeg/src-tauri/src/acp/delegation/spawner.rs"
    const part: ToolCallPart = {
      ...basePart(
        JSON.stringify({
          subagent_type: "worker",
          description: "inspect the connection spawner",
        }),
        "output-available"
      ),
      agentStats: {
        tool_calls: [
          {
            tool_name: "read_file",
            input_preview: JSON.stringify({
              file_path: filePath,
              offset: 1,
              limit: 20,
            }),
            output_preview: JSON.stringify({
              start_line: 1,
              content: "//! ConnectionSpawner\npub trait ConnectionSpawner {}",
            }),
            is_error: false,
          },
        ],
      },
    }

    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <StickToBottom>
          <AgentToolCallPart
            part={part}
            renderToolCall={(childPart, key) => (
              <ContentPartsRenderer
                key={key}
                parts={[childPart]}
                role="assistant"
              />
            )}
          />
        </StickToBottom>
      </NextIntlClientProvider>
    )

    fireEvent.click(screen.getByRole("button", { name: "Completed" }))
    fireEvent.click(screen.getAllByRole("button", { name: "Completed" })[1])
    fireEvent.click(
      screen.getByRole("button", { name: /delegation\/spawner\.rs/ })
    )

    expect(screen.getByText("//! ConnectionSpawner")).toBeInTheDocument()
    expect(screen.queryByText("Parameters")).not.toBeInTheDocument()
    expect(screen.queryByText(/"offset"/)).not.toBeInTheDocument()
    expect(screen.queryByText(/"limit"/)).not.toBeInTheDocument()
    expect(screen.queryByText(/"file_path"/)).not.toBeInTheDocument()
    expect(container.querySelector("svg.lucide-eye")).not.toBeNull()
  })

  it("shows the file content without rendering read parameters", () => {
    const filePath =
      "/workspace/github/codeg/src-tauri/src/acp/delegation/spawner.rs"
    const readInput = JSON.stringify({ file_path: filePath })
    const readOutput = JSON.stringify({
      start_line: 1,
      content: "//! ConnectionSpawner\npub trait ConnectionSpawner {}",
    })

    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <StickToBottom>
          <ContentPartsRenderer
            parts={[
              {
                type: "tool-call",
                toolCallId: "subagent-read-file",
                toolName: "read_file",
                input: readInput,
                output: readOutput,
                state: "output-available",
              },
            ]}
            role="assistant"
            inlineActivity
          />
        </StickToBottom>
      </NextIntlClientProvider>
    )

    fireEvent.click(
      screen.getByRole("button", { name: "delegation/spawner.rs" })
    )
    expect(screen.getByText("delegation/spawner.rs")).toBeInTheDocument()
    expect(screen.getByText("//! ConnectionSpawner")).toBeInTheDocument()
    expect(screen.queryByText("Parameters")).not.toBeInTheDocument()
    expect(screen.queryByText(/\"file_path\"/)).not.toBeInTheDocument()
    expect(container.querySelector("svg.lucide-eye")).not.toBeNull()
  })

  it("keeps the read file row visible when no result was captured", () => {
    const filePath =
      "/workspace/github/codeg/src-tauri/src/acp/delegation/spawner.rs"

    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <StickToBottom>
          <ContentPartsRenderer
            parts={[
              {
                type: "tool-call",
                toolCallId: "subagent-read-file-without-output",
                toolName: "read_file",
                input: JSON.stringify({ file_path: filePath }),
                output: null,
                state: "output-available",
              },
            ]}
            role="assistant"
            inlineActivity
          />
        </StickToBottom>
      </NextIntlClientProvider>
    )

    expect(
      screen.getByRole("button", { name: "delegation/spawner.rs" })
    ).toBeInTheDocument()
    expect(container.querySelector("svg.lucide-eye")).not.toBeNull()
    expect(screen.queryByText("Parameters")).not.toBeInTheDocument()
  })
})

describe("inline subagent edit activity", () => {
  it("renders a large complete edit as a diff instead of its JSON envelope", () => {
    const oldSource = Array.from(
      { length: 4_400 },
      (_, index) => `export const sourceLine${index} = ${index}`
    ).join("\n")
    const newSource = oldSource.replace(
      "export const sourceLine4200 = 4200",
      "export const sourceLine4200 = 4201"
    )
    const input = JSON.stringify({
      file_path:
        "/workspace/github/codeg/src/components/message/content-parts-renderer.tsx",
      // The large new side deliberately precedes old_string, matching the
      // child-session payload that used to fall back to raw JSON.
      new_string: newSource,
      old_string: oldSource,
    })

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <StickToBottom>
          <ContentPartsRenderer
            parts={[
              {
                type: "tool-call",
                toolCallId: "inline-large-edit",
                toolName: "edit",
                input,
                output: "{}",
                state: "output-available",
              },
            ]}
            role="assistant"
            inlineActivity
          />
        </StickToBottom>
      </NextIntlClientProvider>
    )

    fireEvent.click(
      screen.getByRole("button", { name: /content-parts-renderer\.tsx/ })
    )

    expect(
      screen.getByText("export const sourceLine4200 = 4201")
    ).toBeInTheDocument()
    expect(
      screen.getByText("export const sourceLine4200 = 4200")
    ).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('"new_string"')
    expect(document.body.textContent).not.toContain('"old_string"')
  })

  it("uses a large edit descriptor reported on the live result side", () => {
    const oldSource = Array.from(
      { length: 4_400 },
      (_, index) => `export const sourceLine${index} = ${index}`
    ).join("\n")
    const newSource = oldSource.replace(
      "export const sourceLine4200 = 4200",
      "export const sourceLine4200 = 4201"
    )
    const output = JSON.stringify({
      file_path:
        "/workspace/github/codeg/src/components/message/content-parts-renderer.tsx",
      new_string: newSource,
      old_string: oldSource,
    })

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <StickToBottom>
          <ContentPartsRenderer
            parts={[
              {
                type: "tool-call",
                toolCallId: "inline-large-result-edit",
                toolName: "edit",
                input: JSON.stringify({
                  file_path:
                    "/workspace/github/codeg/src/components/message/content-parts-renderer.tsx",
                }),
                output,
                state: "output-available",
              },
            ]}
            role="assistant"
            inlineActivity
          />
        </StickToBottom>
      </NextIntlClientProvider>
    )

    fireEvent.click(
      screen.getByRole("button", { name: /content-parts-renderer\.tsx/ })
    )

    expect(
      screen.getByText("export const sourceLine4200 = 4201")
    ).toBeInTheDocument()
    expect(
      screen.getByText("export const sourceLine4200 = 4200")
    ).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('"new_string"')
    expect(document.body.textContent).not.toContain('"old_string"')
  })

  it("uses a complete result-side write descriptor as a file view", () => {
    const content = Array.from(
      { length: 800 },
      (_, index) => `export const resultWriteLine${index} = ${index}`
    ).join("\n")
    const filePath = "/workspace/github/codeg/src/generated/result-write.ts"
    const output = JSON.stringify({ file_path: filePath, content })

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <StickToBottom>
          <ContentPartsRenderer
            parts={[
              {
                type: "tool-call",
                toolCallId: "inline-large-result-write",
                toolName: "write",
                input: JSON.stringify({ file_path: filePath }),
                output,
                state: "output-available",
              },
            ]}
            role="assistant"
            inlineActivity
          />
        </StickToBottom>
      </NextIntlClientProvider>
    )

    fireEvent.click(screen.getByRole("button", { name: /result-write\.ts/ }))

    expect(
      screen.getByText("export const resultWriteLine799 = 799")
    ).toBeInTheDocument()
    expect(screen.queryByText("Parameters")).not.toBeInTheDocument()
    expect(screen.queryByTestId("large-tool-output")).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('"content"')
  })
})

describe("ContentPartsRenderer edit activity output", () => {
  it("does not show an empty successful result below a rendered diff", () => {
    const editPart: ToolCallPart = {
      type: "tool-call",
      toolCallId: "completed-edit-with-empty-result",
      toolName: "edit",
      input: JSON.stringify({
        file_path: "/workspace/github/codeg/src/example.ts",
        old_string: "export const value = 1",
        new_string: "export const value = 2",
      }),
      output: "{}",
      state: "output-available",
    }

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <StickToBottom>
          <ContentPartsRenderer parts={[editPart]} role="assistant" />
        </StickToBottom>
      </NextIntlClientProvider>
    )

    fireEvent.click(screen.getByRole("button", { name: "Completed" }))
    fireEvent.click(screen.getByRole("button", { name: "src/example.ts" }))

    expect(screen.getByText("export const value = 1")).toBeInTheDocument()
    expect(screen.getByText("export const value = 2")).toBeInTheDocument()
    expect(screen.queryByText("Result")).not.toBeInTheDocument()
    expect(screen.queryByText("{}")).not.toBeInTheDocument()
  })
})

describe("AgentToolCallPart inline child session transcript", () => {
  it("uses a flat activity node and returns child rows to the parent rail", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AgentToolCallPart
          part={basePart(
            JSON.stringify({
              subagent_type: "codeg_event_cursor_review",
              agent_id: "01a031ee-b090-7e21-8034-37aee6627f8c",
              __codegCodexSubagentLaunch: true,
            }),
            "output-available"
          )}
          display="inline"
          alignTimelineToParent
          renderToolCall={() => null}
        />
      </NextIntlClientProvider>
    )

    const capsule = container.querySelector(
      '[data-agent-capsule-presentation="timeline"]'
    )
    const trigger = capsule?.querySelector('[data-slot="collapsible-trigger"]')
    const timelineBody = capsule?.querySelector(
      '[data-agent-capsule-body="timeline"]'
    )

    // Inline Agents are timeline nodes, not the rounded primary capsule used
    // for standalone cards. The body cancels the header/icon inset so child
    // rows share the parent activity rail.
    expect(trigger).toHaveClass("rounded-md")
    expect(trigger).not.toHaveClass("rounded-full")
    expect(timelineBody).toHaveClass("-ms-[34px]")
    expect(screen.getByTestId("agent-session-transcript")).toHaveAttribute(
      "data-parent-rail",
      "true"
    )
  })

  it("renders a Codex native child directly from its launch marker and agent id", () => {
    const { container } = renderCard(
      basePart(
        JSON.stringify({
          subagent_type: "codeg_event_cursor_review",
          agent_id: "01a031ee-b090-7e21-8034-37aee6627f8c",
          __codegCodexSubagentLaunch: true,
        }),
        "output-available"
      )
    )

    const capsule = container.querySelector(
      '[data-agent-capsule-presentation="timeline"]'
    )
    expect(capsule).not.toBeNull()
    expect(
      capsule?.querySelector('[data-agent-capsule-body="timeline"]')
    ).not.toBeNull()
    expect(
      capsule?.querySelector('[data-agent-capsule-body="card"]')
    ).toBeNull()

    const transcript = screen.getByTestId("agent-session-transcript")
    expect(transcript).toHaveAttribute("data-agent-type", "codex")
    expect(transcript).toHaveAttribute(
      "data-session-id",
      "01a031ee-b090-7e21-8034-37aee6627f8c"
    )
    // A Codex native launch settles as soon as the child starts, so the inline
    // transcript keeps polling even though the launch card says completed.
    expect(transcript).toHaveAttribute("data-live", "true")
    expect(
      screen.queryByRole("button", { name: "View sub-agent session" })
    ).not.toBeInTheDocument()
  })

  it("keeps a Codex Agent card inside the parent activity flow", () => {
    const part = basePart(
      JSON.stringify({
        subagent_type: "codeg_event_cursor_review",
        agent_id: "01a031ee-b090-7e21-8034-37aee6627f8c",
        __codegCodexSubagentLaunch: true,
      }),
      "output-available"
    )
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <StickToBottom>
          <ContentPartsRenderer parts={[part]} role="assistant" />
        </StickToBottom>
      </NextIntlClientProvider>
    )

    // The settled parent activity is compact. Its single disclosure reveals
    // the real Agent capsule and inline child transcript, not a generic JSON
    // tool preview and not a side-panel action.
    fireEvent.click(screen.getByRole("button", { name: "Completed" }))
    expect(screen.getByTestId("agent-session-transcript")).toHaveAttribute(
      "data-session-id",
      "01a031ee-b090-7e21-8034-37aee6627f8c"
    )
  })

  it("does not treat an arbitrary agent_id as a Codex child session", () => {
    renderCard(
      basePart(
        JSON.stringify({
          subagent_type: "worker",
          agent_id: "not-a-codex-native-child",
        }),
        "output-available"
      )
    )
    expect(
      screen.queryByTestId("agent-session-transcript")
    ).not.toBeInTheDocument()
  })

  it("renders the child's session from live Grok spawn metadata", () => {
    renderCard({
      ...basePart(
        JSON.stringify({ subagent_type: "explore", description: "map repo" }),
        "input-available"
      ),
      meta: {
        grokSubagentSession: {
          subagentId: "sub-1",
          childSessionId: "019fe6bf-0bcb-70c2-a02d-e5c006dfc32a",
        },
      },
    })

    const transcript = screen.getByTestId("agent-session-transcript")
    expect(transcript).toHaveAttribute("data-agent-type", "grok")
    expect(transcript).toHaveAttribute(
      "data-session-id",
      "019fe6bf-0bcb-70c2-a02d-e5c006dfc32a"
    )
    expect(transcript).toHaveAttribute("data-live", "true")
  })

  it("renders a settled historical child session when the capsule expands", () => {
    renderCard({
      ...basePart(
        JSON.stringify({ subagent_type: "explore", description: "map repo" }),
        "output-available"
      ),
      output: "final result",
      agentStats: {
        agent_type: "explore",
        status: "completed",
        child_session_id: "019fe6bf-0bcb-70c2-a02d-e5c006dfc32a",
      },
    })
    fireEvent.click(screen.getByRole("button", { name: "Completed" }))

    const transcript = screen.getByTestId("agent-session-transcript")
    expect(transcript).toHaveAttribute(
      "data-session-id",
      "019fe6bf-0bcb-70c2-a02d-e5c006dfc32a"
    )
    expect(transcript).toHaveAttribute("data-live", "false")
  })

  it("does not render a transcript for a sub-agent with no session of its own", () => {
    renderCard({
      ...basePart(
        JSON.stringify({ subagent_type: "Explore", description: "map repo" }),
        "output-available"
      ),
      output: "final result",
    })
    fireEvent.click(screen.getByRole("button", { name: "Completed" }))
    expect(
      screen.queryByTestId("agent-session-transcript")
    ).not.toBeInTheDocument()
  })
})
