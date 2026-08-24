import { type ReactNode } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { StickToBottom } from "use-stick-to-bottom"
import { describe, expect, it } from "vitest"

import {
  AssistantActivityGroup,
  type AssistantActivityItem,
  type ActivityItemRenderOptions,
} from "./assistant-activity-group"
import enMessages from "@/i18n/messages/en.json"

function agentItem(id: string, label: string): AssistantActivityItem {
  return {
    id,
    type: "tool-call",
    part: {
      type: "tool-call",
      toolCallId: id,
      toolName: "agent",
      input: JSON.stringify({ subagent_type: label }),
      state: "output-available",
    },
  }
}

function ordinaryToolItem(): AssistantActivityItem {
  return {
    id: "ordinary-tool",
    type: "tool-call",
    part: {
      type: "tool-call",
      toolCallId: "ordinary-tool",
      toolName: "bash",
      input: '{"command":"pwd"}',
      state: "output-available",
    },
  }
}

function renderGroup(items: AssistantActivityItem[]) {
  const renderItem = (
    item: AssistantActivityItem,
    options?: ActivityItemRenderOptions
  ): ReactNode => {
    if (item.type !== "tool-call") return null
    const content =
      options?.agentDisplay === "dialog"
        ? `Dialog detail: ${item.part.toolCallId}`
        : `Inline detail: ${item.part.toolCallId}`
    return <div>{content}</div>
  }

  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <StickToBottom>
        <AssistantActivityGroup
          items={items}
          renderItem={renderItem}
          getAgentLabel={(item) =>
            item.part.toolCallId === "agent-a"
              ? "Repository scout"
              : "Test runner"
          }
          streaming={false}
        />
      </StickToBottom>
    </NextIntlClientProvider>
  )
}

describe("AssistantActivityGroup sub-agent activity", () => {
  it("shows the child-agent count in the parent header and switches agents in the dialog", () => {
    renderGroup([agentItem("agent-a", "scout"), agentItem("agent-b", "test")])

    const count = screen.getByRole("button", { name: "Open 2 sub-agents" })
    expect(count).toHaveTextContent("2 sub-agents")
    fireEvent.click(count)

    expect(screen.getByTestId("agent-activity-dialog")).toBeInTheDocument()
    expect(screen.getByText("Dialog detail: agent-a")).toBeInTheDocument()

    fireEvent.click(screen.getByText("Test runner").closest("button")!)
    expect(screen.getByText("Dialog detail: agent-b")).toBeInTheDocument()
    expect(screen.queryByText("Dialog detail: agent-a")).not.toBeInTheDocument()
  })

  it("opens the specific agent from its hover-only maximize action", () => {
    renderGroup([agentItem("agent-a", "scout"), agentItem("agent-b", "test")])

    fireEvent.click(screen.getByRole("button", { name: "Completed" }))
    expect(screen.getByText("Inline detail: agent-a")).toBeInTheDocument()

    fireEvent.click(
      screen.getAllByRole("button", { name: "Open sub-agent session" })[1]
    )

    expect(screen.getByText("Dialog detail: agent-b")).toBeInTheDocument()
  })

  it("does not add a child-agent count affordance when there are no Agent calls", () => {
    renderGroup([ordinaryToolItem()])

    expect(
      screen.queryByRole("button", { name: /sub-agent/i })
    ).not.toBeInTheDocument()
  })
})
