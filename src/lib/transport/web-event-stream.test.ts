import { describe, expect, it, vi } from "vitest"
import { WebEventStream, type AttachTransportHost } from "./web-event-stream"
import type { AttachHandlers } from "./types"

function makeHandlers(): AttachHandlers {
  return {
    onSnapshot: vi.fn(),
    onReplay: vi.fn(),
    onEvent: vi.fn(),
    onDetached: vi.fn(),
  }
}

function makeHost(sent: object[]): AttachTransportHost {
  return {
    isWsOpen: () => true,
    sendFrame: (frame) => {
      sent.push(frame)
      return true
    },
    onWsReady: () => () => {},
  }
}

describe("WebEventStream attach wire boundary", () => {
  it("always sends a string connection_id for a detailed result accidentally passed by an old caller", () => {
    const sent: object[] = []
    const stream = new WebEventStream(makeHost(sent))

    stream.attach(
      { connectionId: "shared-conn", reused: true } as unknown as string,
      { sinceSeq: undefined },
      makeHandlers()
    )

    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual(
      expect.objectContaining({
        action: "attach",
        connection_id: "shared-conn",
      })
    )
    expect(typeof (sent[0] as { connection_id: unknown }).connection_id).toBe(
      "string"
    )
  })

  it("fails before sending when the connection id is invalid", () => {
    const sent: object[] = []
    const stream = new WebEventStream(makeHost(sent))

    expect(() =>
      stream.attach({ reused: true } as unknown as string, {}, makeHandlers())
    ).toThrow("attach requires a non-empty string connection id")
    expect(sent).toHaveLength(0)
  })
})
