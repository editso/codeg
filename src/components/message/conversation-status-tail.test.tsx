import { render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import type { ClaudeApiRetryState } from "@/contexts/acp-connections-context"
import { ConversationStatusTail } from "./conversation-status-tail"

function renderRetry(retry: ClaudeApiRetryState) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ConversationStatusTail claudeApiRetry={retry} />
    </NextIntlClientProvider>
  )
}

describe("ConversationStatusTail retry causes", () => {
  it("renders Pi's counter-only retry without inventing an auth failure", () => {
    renderRetry({
      sessionId: "pi-session",
      attempt: 2,
      maxRetries: 3,
      error: null,
      errorStatus: null,
      retryDelayMs: 4000,
      reportsError: false,
    })

    expect(screen.getByText("retrying 2/3, next in 4.0s")).toBeInTheDocument()
    expect(screen.queryByText(/authentication_failed/)).toBeNull()
  })

  it("keeps the fallback for sources that normally report an error", () => {
    renderRetry({
      sessionId: "codex-session",
      attempt: null,
      maxRetries: null,
      error: null,
      errorStatus: null,
      retryDelayMs: null,
      reportsError: true,
    })

    expect(
      screen.getByText("authentication_failed · retrying")
    ).toBeInTheDocument()
  })
})
