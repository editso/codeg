import { type ReactNode } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { StickToBottom } from "use-stick-to-bottom"
import { describe, expect, it, vi } from "vitest"

/**
 * Antigravity's terminal and MCP tool calls, on both the live and the reload
 * path.
 *
 * Both used to land on the generic tool shell. The terminal card, because
 * neither spelling of its arguments (`command_line` live, PascalCase
 * `CommandLine` in the trajectory and in permission frames) was a command key,
 * and its live *title* is the command string itself — so the card was named
 * "pnpm build" with the `{combinedOutput, exitCode, formatted_output, …}`
 * rawOutput rendered as a JSON tree. The MCP calls, because Antigravity routes
 * every one of them through a `call_mcp_tool` sentinel whose real identity
 * lives inside a PascalCase envelope — five delegation calls all rendered as
 * "call_mcp_tool: codeg-mcp".
 *
 * The wire shapes below are copied from a real session
 * (`tools.py::unwrap_mcp_tool_call`, `server.py::_exec_tool_raw_output`).
 */

vi.mock("@/components/ai-elements/link-safety", () => ({
  FilePathLink: ({
    filePath,
    children,
  }: {
    filePath: string
    children: ReactNode
  }) => <button data-path={filePath}>{children}</button>,
  useStreamdownLinkSafety: () => ({ enabled: false }),
}))

vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children: string }) => (
    <div>{children}</div>
  ),
}))

// The upstream renderer places delegation calls in a dedicated card. This fork
// keeps all operational calls in its grouped assistant-activity flow, so the
// card is not mounted here; normalization and the visible activity detail are
// the integration contract under test.
vi.mock("./delegated-sub-thread", () => ({
  DelegatedSubThread: () => <div data-testid="delegated-sub-thread" />,
}))

import { ContentPartsRenderer } from "./content-parts-renderer"
import enMessages from "@/i18n/messages/en.json"
import type { AdaptedContentPart } from "@/lib/adapters/ai-elements-adapter"
import { parseInput as parseDelegationInput } from "@/lib/delegation-card"
import { normalizeToolName } from "@/lib/tool-call-normalization"

function renderParts(parts: AdaptedContentPart[]) {
  const result = render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {/* Our activity disclosure preserves the real transcript's scroll
          position through this context. Mirror the production message thread
          so these upstream card-routing checks exercise the integrated tree. */}
      <StickToBottom>
        <ContentPartsRenderer parts={parts} role="assistant" />
      </StickToBottom>
    </NextIntlClientProvider>
  )
  // The fork groups tools under an activity disclosure and keeps each row's
  // detail independently collapsible. Open both layers when present; upstream
  // renders the cards directly and therefore only needed one click.
  for (let depth = 0; depth < 2; depth += 1) {
    const toggle = screen
      .queryAllByRole("button")
      .find((button) => button.getAttribute("aria-expanded") === "false")
    if (!toggle) break
    fireEvent.click(toggle)
  }
  return result
}

const BUILD_OUTPUT =
  "$ next build\n⚠ Warning: Next.js inferred your workspace root\n▲ Next.js 16.1.7\n"

describe("Antigravity run_command renders as a terminal", () => {
  it("reads the trajectory's PascalCase arguments", () => {
    // What `parsers/antigravity.rs` stores: the tool's own name plus the
    // model's argument envelope, verbatim.
    const { container } = renderParts([
      {
        type: "tool-call",
        toolCallId: "call_3080861",
        toolName: "run_command",
        input: JSON.stringify({
          CommandLine: "pnpm build",
          Cwd: "/Users/x/work/my-app",
          WaitMsBeforeAsync: 10000,
          toolAction: "Running pnpm build",
          toolSummary: "Build project",
        }),
        state: "output-available",
        output: `$ pnpm build\n${BUILD_OUTPUT}`,
      },
    ])

    expect(container.textContent).toContain("pnpm build")
    expect(container.textContent).toContain("Next.js 16.1.7")
    // The parser already prints the `$ <command>` prompt line; the renderer
    // must not print a second one on top of it.
    expect(container.textContent).not.toContain("$ pnpm build\n$ pnpm build")
    // The argument dump the card used to be.
    expect(container.textContent).not.toContain("WaitMsBeforeAsync")
  })

  it("reads the live snake_case arguments and unwraps the rawOutput", () => {
    // The live shape: `command_line`/`working_dir` in, and the six-key
    // camelCase+snake_case result dict `_exec_tool_raw_output` builds out
    // (the duplicate keys are upstream's, "needed for Jetbrains").
    const { container } = renderParts([
      {
        type: "tool-call",
        toolCallId: "call_3080861",
        toolName: "bash",
        input: JSON.stringify({
          command_line: "pnpm build",
          working_dir: "/Users/x/work/my-app",
        }),
        state: "output-available",
        output: JSON.stringify({
          commandLine: "pnpm build",
          workingDir: "/Users/x/work/my-app",
          exitCode: 0,
          exit_code: 0,
          combinedOutput: BUILD_OUTPUT,
          formatted_output: BUILD_OUTPUT,
        }),
      },
    ])

    expect(container.textContent).toContain("pnpm build")
    expect(container.textContent).toContain("Next.js 16.1.7")
    // The JSON tree this card used to render.
    expect(container.textContent).not.toContain("combinedOutput")
    expect(container.textContent).not.toContain("formatted_output")
  })
})

describe("Antigravity MCP calls reach the grouped activity flow", () => {
  it("reads the delegated task out of the unwrapped envelope", () => {
    // `{arguments: {…}, prompt: …}` is what `unwrap_mcp_tool_call` puts on the
    // live wire and what `parsers/antigravity.rs` now emits for history. The
    // card's argument walker peels `arguments`; the RAW envelope it replaces
    // (`{Arguments, ServerName, ToolName}`) is not a shape it can read, which
    // is why the unwrap has to happen in the parser.
    expect(
      parseDelegationInput(
        JSON.stringify({
          arguments: { agent_type: "codex", task: "run pnpm build" },
          prompt: "Delegating pnpm build to Codex CLI",
        })
      )
    ).toMatchObject({ agentType: "codex", task: "run pnpm build" })

    expect(
      parseDelegationInput(
        JSON.stringify({
          Arguments: { agent_type: "codex", task: "run pnpm build" },
          ServerName: "codeg-mcp",
          ToolName: "delegate_to_agent",
        })
      )
    ).toMatchObject({ agentType: null, task: null })
  })

  it("routes an unwrapped delegate_to_agent to the delegation card", () => {
    // `<server>_<tool>` + `{arguments: {…}}` is what the live stream sends and
    // what the history parser now emits; both must resolve to the same card.
    expect(normalizeToolName("codeg-mcp_delegate_to_agent")).toBe(
      "delegate_to_agent"
    )

    const { container } = renderParts([
      {
        type: "tool-call",
        toolCallId: "call_1199411",
        toolName: "codeg-mcp_delegate_to_agent",
        input: JSON.stringify({
          arguments: { agent_type: "codex", task: "run pnpm build" },
          prompt: "Delegating pnpm build to Codex CLI",
        }),
        state: "output-available",
        output:
          "Delegation successful. task_id=71718410-0e8c-4cb2-ab7e-7ebaddbca928.",
      },
    ])

    // The fork keeps the call inside its grouped activity flow while retaining
    // the concrete delegated task and completion identity.
    expect(container.textContent).toContain(
      "Delegating pnpm build to Codex CLI"
    )
    expect(container.textContent).toContain("run pnpm build")
    expect(container.textContent).toContain("71718410")
    expect(container.textContent).not.toContain("call_mcp_tool")
    expect(container.textContent).not.toContain("ServerName")
  })

  it("routes an unwrapped get_delegation_status poll to the status card", () => {
    const { container } = renderParts([
      {
        type: "tool-call",
        toolCallId: "call_2951639",
        toolName: "codeg-mcp_get_delegation_status",
        input: JSON.stringify({
          arguments: {
            task_ids: ["71718410-0e8c-4cb2-ab7e-7ebaddbca928"],
            wait_ms: 15000,
          },
          prompt: "Waiting for Codex CLI delegation to complete",
        }),
        state: "output-available",
        output: JSON.stringify({
          tasks: [
            {
              agent_type: "codex",
              status: "completed",
              task_id: "71718410-0e8c-4cb2-ab7e-7ebaddbca928",
              message: "Build finished.",
            },
          ],
        }),
      },
    ])

    // The grouped activity detail reads the task id from the peeled arguments
    // and the result message from the normalized output.
    expect(container.textContent).toContain(
      "Waiting for Codex CLI delegation to complete"
    )
    expect(container.textContent).toContain("71718410")
    expect(container.textContent).toContain("Build finished.")
    // The fork intentionally shows the activity parameters (including the
    // poll timeout); only Antigravity's transport wrapper must stay hidden.
    expect(container.textContent).not.toContain("call_mcp_tool")
    expect(container.textContent).not.toContain("ServerName")
  })
})
