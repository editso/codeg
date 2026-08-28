import { describe, expect, it } from "vitest"
import {
  shouldConnectOnFocus,
  shouldDisconnectOnUnmount,
} from "@/hooks/use-connection-lifecycle"

describe("shouldConnectOnFocus", () => {
  it("connects an initial or cleanly disconnected composer", () => {
    expect(shouldConnectOnFocus(null, null)).toBe(true)
    expect(shouldConnectOnFocus("disconnected", null)).toBe(true)
  })

  it("never reconnects implicitly after a terminal ACP error", () => {
    // Terminal backend failures emit Error → StatusChanged(error) →
    // StatusChanged(disconnected). The retained error must block both states
    // so programmatic focus cannot make the failure flash away.
    expect(shouldConnectOnFocus("error", "ACP protocol error")).toBe(false)
    expect(shouldConnectOnFocus("disconnected", "ACP protocol error")).toBe(
      false
    )
  })

  it("does not connect while an existing connection is active", () => {
    expect(shouldConnectOnFocus("connecting", null)).toBe(false)
    expect(shouldConnectOnFocus("connected", null)).toBe(false)
    expect(shouldConnectOnFocus("prompting", null)).toBe(false)
  })
})

// Unmount cleanup (tab closed) must not kill an owner whose agent still has
// work in flight: disconnecting kills the agent CLI, and any launched
// background tasks with it. Busy owners are reclaimed by the idle sweeps —
// which exempt them only while outstanding > 0 — so once the work settles the
// connection becomes sweep-eligible again through the SAME predicate flipping
// to true on the next idle pass.
describe("shouldDisconnectOnUnmount", () => {
  it("keeps an owner alive while background work is outstanding", () => {
    expect(
      shouldDisconnectOnUnmount({
        status: "connected",
        isViewer: false,
        backgroundOutstanding: 2,
      })
    ).toBe(false)
  })

  it("keeps a prompting owner alive (existing behavior)", () => {
    expect(
      shouldDisconnectOnUnmount({
        status: "prompting",
        isViewer: false,
        backgroundOutstanding: 0,
      })
    ).toBe(false)
  })

  it("disconnects an idle owner once outstanding has settled to zero", () => {
    expect(
      shouldDisconnectOnUnmount({
        status: "connected",
        isViewer: false,
        backgroundOutstanding: 0,
      })
    ).toBe(true)
  })

  it("always tears down viewers — their disconnect only detaches", () => {
    expect(
      shouldDisconnectOnUnmount({
        status: "prompting",
        isViewer: true,
        backgroundOutstanding: 5,
      })
    ).toBe(true)
  })

  // A transient unmount (the tab was REPARENTED across split groups, not
  // closed) never disconnects: the remounted view re-attaches to the same
  // connection under the same contextKey.
  it("keeps an idle owner alive across a transient (reparent) unmount", () => {
    expect(
      shouldDisconnectOnUnmount({
        status: "connected",
        isViewer: false,
        backgroundOutstanding: 0,
        transientUnmount: true,
      })
    ).toBe(false)
  })

  it("keeps a viewer attached across a transient (reparent) unmount", () => {
    expect(
      shouldDisconnectOnUnmount({
        status: "connected",
        isViewer: true,
        backgroundOutstanding: 0,
        transientUnmount: true,
      })
    ).toBe(false)
  })

  it("explicit transientUnmount=false preserves the close-path behavior", () => {
    expect(
      shouldDisconnectOnUnmount({
        status: "connected",
        isViewer: false,
        backgroundOutstanding: 0,
        transientUnmount: false,
      })
    ).toBe(true)
  })
})
