import { render, screen, fireEvent } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { AgentCapsule } from "./agent-capsule"

describe("AgentCapsule", () => {
  it("shows the title and keeps the body collapsed until the trigger is clicked", () => {
    render(
      <AgentCapsule title="Run the build" isRunning={false} isError={false}>
        <div>BODY CONTENT</div>
      </AgentCapsule>
    )
    expect(screen.getByText("Run the build")).toBeInTheDocument()
    expect(screen.queryByText("BODY CONTENT")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button"))
    expect(screen.getByText("BODY CONTENT")).toBeInTheDocument()
  })

  it("opens by default on error", () => {
    render(
      <AgentCapsule title="Failed op" isRunning={false} isError>
        <div>ERROR BODY</div>
      </AgentCapsule>
    )
    expect(screen.getByText("ERROR BODY")).toBeInTheDocument()
  })

  it("honors defaultOpen over the error default", () => {
    render(
      <AgentCapsule
        title="Open me"
        isRunning={false}
        isError={false}
        defaultOpen
      >
        <div>EAGER BODY</div>
      </AgentCapsule>
    )
    expect(screen.getByText("EAGER BODY")).toBeInTheDocument()
  })

  it("opens when live timeline activity arrives unless the user chose a state", () => {
    const { rerender } = render(
      <AgentCapsule title="Child" isRunning isError={false}>
        <div>CHILD ACTIVITY</div>
      </AgentCapsule>
    )
    expect(screen.queryByText("CHILD ACTIVITY")).not.toBeInTheDocument()

    rerender(
      <AgentCapsule title="Child" isRunning isError={false} autoOpen>
        <div>CHILD ACTIVITY</div>
      </AgentCapsule>
    )
    expect(screen.getByText("CHILD ACTIVITY")).toBeInTheDocument()
  })

  it("uses a direct timeline body without the card surface", () => {
    const { container } = render(
      <AgentCapsule
        title="Child"
        isRunning={false}
        isError={false}
        presentation="timeline"
        defaultOpen
      >
        <div>CHILD ROW</div>
      </AgentCapsule>
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
  })

  it("renders the right suffix", () => {
    render(
      <AgentCapsule
        title="With suffix"
        isRunning={false}
        isError={false}
        rightSuffix={<span>12.3s</span>}
      >
        <div>body</div>
      </AgentCapsule>
    )
    expect(screen.getByText("12.3s")).toBeInTheDocument()
  })

  it("renders the idBadge in the (collapsed) pill", () => {
    render(
      <AgentCapsule
        title="Task"
        isRunning={false}
        isError={false}
        idBadge="agent-uuid-xyz"
      >
        <div>BODY</div>
      </AgentCapsule>
    )
    // Visible without expanding the body.
    expect(screen.getByText("agent-uuid-xyz")).toBeInTheDocument()
    expect(screen.queryByText("BODY")).not.toBeInTheDocument()
  })

  it("auto-opens when it transitions into an error state (no remount)", () => {
    const { rerender } = render(
      <AgentCapsule title="Working" isRunning isError={false}>
        <div>ERR BODY</div>
      </AgentCapsule>
    )
    // Running, non-error → collapsed.
    expect(screen.queryByText("ERR BODY")).not.toBeInTheDocument()

    // A failure arrives mid-stream (same instance) → auto-open.
    rerender(
      <AgentCapsule title="Working" isRunning={false} isError>
        <div>ERR BODY</div>
      </AgentCapsule>
    )
    expect(screen.getByText("ERR BODY")).toBeInTheDocument()
  })

  it("preserves a user-expanded body when running transitions to completed", () => {
    const { rerender } = render(
      <AgentCapsule title="Working" isRunning isError={false}>
        <div>LIVE BODY</div>
      </AgentCapsule>
    )
    // User expands during streaming.
    fireEvent.click(screen.getByRole("button"))
    expect(screen.getByText("LIVE BODY")).toBeInTheDocument()

    // Completion must not override the user's explicit disclosure choice.
    rerender(
      <AgentCapsule title="Working" isRunning={false} isError={false}>
        <div>LIVE BODY</div>
      </AgentCapsule>
    )
    expect(screen.getByText("LIVE BODY")).toBeInTheDocument()
  })
})
