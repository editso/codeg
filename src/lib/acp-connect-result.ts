import type { AcpConnectResult } from "./types"

/**
 * Normalize the wire result of `acp_connect`.
 *
 * The command historically returned a bare connection id. Newer servers can
 * return the detailed `{ connectionId, reused }` result, while a rolling
 * upgrade may briefly expose the snake_case spelling from an older bridge.
 * Keep that compatibility handling at the transport boundary so a result
 * object can never accidentally become a WebSocket `connection_id` value.
 */
export function normalizeAcpConnectResult(raw: unknown): AcpConnectResult {
  if (typeof raw === "string") {
    assertConnectionId(raw)
    return { connectionId: raw, reused: false }
  }

  if (!raw || typeof raw !== "object") {
    throw new Error("acp_connect returned an invalid connection result")
  }

  const record = raw as Record<string, unknown>
  const connectionId =
    typeof record.connectionId === "string"
      ? record.connectionId
      : typeof record.connection_id === "string"
        ? record.connection_id
        : null

  if (connectionId === null) {
    throw new Error("acp_connect returned no connection id")
  }
  assertConnectionId(connectionId)

  return {
    connectionId,
    reused: record.reused === true,
  }
}

function assertConnectionId(connectionId: string): void {
  if (connectionId.trim().length === 0) {
    throw new Error("acp_connect returned an empty connection id")
  }
}
