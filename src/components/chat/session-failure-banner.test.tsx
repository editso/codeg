import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"

import { SessionFailureBanner } from "./session-failure-banner"
import enMessages from "@/i18n/messages/en.json"
import type { SessionFailureRecord } from "@/lib/types"

function record(
  overrides: Partial<SessionFailureRecord> = {}
): SessionFailureRecord {
  return {
    id: "t1:error",
    revision: 1,
    category: "access",
    severity: "error",
    title: "Authentication required.",
    actions: ["login"],
    resolved: false,
    ...overrides,
  }
}

function renderBanner(
  failures: SessionFailureRecord[],
  onAction?: (action: string, failure: SessionFailureRecord) => void,
  onDismiss?: (ids: string[]) => void
) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SessionFailureBanner
        failures={failures}
        onAction={onAction}
        onDismiss={onDismiss}
      />
    </NextIntlClientProvider>
  )
}

describe("SessionFailureBanner", () => {
  it("renders an active error strip with its suggested action wired", () => {
    const onAction = vi.fn()
    renderBanner([record()], onAction)
    expect(screen.getByRole("alert")).toBeInTheDocument()
    expect(screen.getByText("Authentication required.")).toBeInTheDocument()
    // Only the record's suggested (and known) actions render.
    expect(screen.queryByText("Retry")).not.toBeInTheDocument()
    fireEvent.click(screen.getByText("Sign in"))
    expect(onAction).toHaveBeenCalledWith(
      "login",
      expect.objectContaining({ id: "t1:error" })
    )
  })

  it("hides action buttons without a handler (read-only surfaces)", () => {
    renderBanner([record()])
    expect(screen.getByText("Authentication required.")).toBeInTheDocument()
    expect(screen.queryByText("Sign in")).not.toBeInTheDocument()
  })

  it("never renders action buttons on warning strips (adapter is mid-recovery)", () => {
    const onAction = vi.fn()
    renderBanner(
      [
        record({
          severity: "warning",
          title: "retrying request",
          actions: ["retry", "login", "new_session"],
        }),
      ],
      onAction
    )
    expect(screen.getByText("retrying request")).toBeInTheDocument()
    expect(screen.queryByText("Retry")).not.toBeInTheDocument()
    expect(screen.queryByText("Sign in")).not.toBeInTheDocument()
    expect(screen.queryByText("New session")).not.toBeInTheDocument()
  })

  it("falls back to the category label for a blank title and expands details", () => {
    renderBanner([
      record({
        category: "limit",
        title: "  ",
        details: "usage resets at 3pm",
        actions: [],
      }),
    ])
    expect(screen.getByText("Limit reached")).toBeInTheDocument()
    expect(screen.queryByText("usage resets at 3pm")).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText("Toggle details"))
    expect(screen.getByText("usage resets at 3pm")).toBeInTheDocument()
  })

  it("maps unknown categories and actions onto safe fallbacks", () => {
    const onAction = vi.fn()
    renderBanner(
      [record({ category: "quantum", title: "", actions: ["sing", "retry"] })],
      onAction
    )
    // Unknown category → the generic label; unknown action → not rendered.
    expect(screen.getByText("Session issue")).toBeInTheDocument()
    expect(screen.queryByText("sing")).not.toBeInTheDocument()
    fireEvent.click(screen.getByText("Retry"))
    expect(onAction).toHaveBeenCalledWith("retry", expect.anything())
  })

  it("hides every resolved record immediately", () => {
    const resolvedWarning = (id: string, title: string) =>
      record({ id, severity: "warning", title, resolved: true, actions: [] })
    const { container } = renderBanner([
      resolvedWarning("w1", "first retry incident"),
      resolvedWarning("w2", "second retry incident"),
      record({ id: "e1", resolved: true, title: "old auth error" }),
    ])
    expect(container).toBeEmptyDOMElement()
  })

  it("shows active failures without reviving older resolved records", () => {
    renderBanner([
      record({
        id: "w1",
        severity: "warning",
        title: "already recovered",
        resolved: true,
        actions: [],
      }),
      record({ id: "e2", title: "still failing" }),
    ])
    expect(screen.getByText("still failing")).toBeInTheDocument()
    expect(screen.queryByText("already recovered")).not.toBeInTheDocument()
  })

  it("renders nothing for a fully settled table", () => {
    const { container } = renderBanner([record({ resolved: true })])
    expect(container).toBeEmptyDOMElement()
  })

  it("collapses stacked warnings to the latest one plus a count (#496)", () => {
    const incident = (id: string, title: string) =>
      record({ id, severity: "warning", category: "connection", title })
    renderBanner([
      incident("i1", "Reconnecting... 1/5"),
      incident("i2", "Reconnecting... 1/5"),
      incident("i3", "Reconnecting... 1/5"),
    ])
    // One strip, not three — the older incidents become a count.
    expect(screen.getAllByRole("alert")).toHaveLength(1)
    expect(screen.getByText("+2 more")).toBeInTheDocument()
  })

  it("renders every active error, with no count", () => {
    renderBanner([
      record({ id: "e1", title: "first failure" }),
      record({ id: "e2", title: "second failure" }),
    ])
    expect(screen.getAllByRole("alert")).toHaveLength(2)
    expect(screen.queryByText(/more$/)).not.toBeInTheDocument()
  })

  it("wires a close button on warnings and errors, opt-in via onDismiss", () => {
    const onDismiss = vi.fn()
    renderBanner([record({ id: "e1" })], undefined, onDismiss)
    fireEvent.click(screen.getByLabelText("Dismiss"))
    expect(onDismiss).toHaveBeenCalledWith(["e1"])

    onDismiss.mockClear()
    renderBanner(
      [record({ id: "w1", severity: "warning", title: "retrying" })],
      undefined,
      onDismiss
    )
    // Warnings get no recovery actions but must still be closable.
    fireEvent.click(screen.getAllByLabelText("Dismiss")[1])
    expect(onDismiss).toHaveBeenCalledWith(["w1"])
  })

  it("closes every warning the collapsed strip stands for, not just the visible one", () => {
    const onDismiss = vi.fn()
    const incident = (id: string) =>
      record({ id, severity: "warning", category: "connection", title: id })
    renderBanner(
      [incident("i1"), incident("i2"), incident("i3")],
      undefined,
      onDismiss
    )
    fireEvent.click(screen.getByLabelText("Dismiss"))
    expect(onDismiss).toHaveBeenCalledWith(["i1", "i2", "i3"])
  })

  it("omits the close button when no handler is wired", () => {
    renderBanner([record()])
    expect(screen.queryByLabelText("Dismiss")).not.toBeInTheDocument()
  })

  it("shows nothing after a dismissal", () => {
    const { container } = renderBanner([
      record({
        id: "w1",
        severity: "warning",
        title: "Reconnecting... 1/5",
        resolved: true,
        dismissed: true,
      }),
    ])
    expect(container).toBeEmptyDOMElement()
  })
})
