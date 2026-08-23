import { describe, expect, it } from "vitest"
import { normalizeAcpConnectResult } from "./acp-connect-result"

describe("normalizeAcpConnectResult", () => {
  it("keeps the historical bare connection id compatible", () => {
    expect(normalizeAcpConnectResult("conn-1")).toEqual({
      connectionId: "conn-1",
      reused: false,
    })
  })

  it("normalizes the detailed response", () => {
    expect(
      normalizeAcpConnectResult({ connectionId: "conn-2", reused: true })
    ).toEqual({ connectionId: "conn-2", reused: true })
  })

  it("accepts the snake_case bridge spelling", () => {
    expect(
      normalizeAcpConnectResult({ connection_id: "conn-3", reused: false })
    ).toEqual({ connectionId: "conn-3", reused: false })
  })

  it("rejects a response without a usable connection id", () => {
    expect(() => normalizeAcpConnectResult({ reused: true })).toThrow(
      "acp_connect returned no connection id"
    )
  })
})
