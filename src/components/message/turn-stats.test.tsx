import { type ReactNode } from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"

// The create-task action pulls workbench-route + tab-store contexts that this
// unit test doesn't mount; stub it to a no-op handler.
vi.mock("./use-create-task-from-message", () => ({
  useCreateTaskFromMessage: () => () => {},
}))

import { TurnStats } from "./turn-stats"
import { MessageScrollProvider } from "./message-scroll-context"
import enMessages from "@/i18n/messages/en.json"

function renderStats(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <MessageScrollProvider value={{ scrollToIndex: vi.fn() }}>
        {ui}
      </MessageScrollProvider>
    </NextIntlClientProvider>
  )
}

const jumpLabel = enMessages.Folder.chat.messageList.jumpToPreviousUserMessage

describe("TurnStats jump-to-previous-user gating", () => {
  it("shows the jump button for a duration-only turn (no token usage)", () => {
    // Cursor never reports per-turn token usage; a turn that still carries a
    // duration is a substantial reply and must keep the jump affordance.
    renderStats(
      <TurnStats
        copyText="hello"
        duration_ms={42_000}
        previousUserIndex={3}
        usage={null}
      />
    )
    expect(screen.getByLabelText(jumpLabel)).toBeInTheDocument()
  })

  it("keeps the jump button hidden when neither usage nor duration exists", () => {
    renderStats(
      <TurnStats
        copyText="hello"
        duration_ms={null}
        previousUserIndex={3}
        usage={null}
      />
    )
    expect(screen.queryByLabelText(jumpLabel)).not.toBeInTheDocument()
  })
})

const forkLabel = enMessages.Folder.chat.messageList.forkFromHere

describe("TurnStats fork-from-here gating", () => {
  it("hides the fork button when the surface passes no handler", () => {
    // The affordance is the ONLY signal that forking is possible here, so it
    // must not render on a disconnected session, an agent without
    // `session/fork`, or a non-owning embed — all of which pass undefined.
    renderStats(<TurnStats copyText="hello" />)
    expect(screen.queryByLabelText(forkLabel)).not.toBeInTheDocument()
  })

  it("forks from this turn when clicked", async () => {
    const onForkFromHere = vi.fn()
    renderStats(<TurnStats copyText="hello" onForkFromHere={onForkFromHere} />)
    await userEvent.click(screen.getByLabelText(forkLabel))
    expect(onForkFromHere).toHaveBeenCalledTimes(1)
  })

  it("renders for a turn that has nothing else to show", () => {
    // The row early-returns when it would be empty; forkability alone has to
    // keep it open, or a turn with no usage/duration/copy text would silently
    // lose its fork point.
    renderStats(<TurnStats copyText="" onForkFromHere={vi.fn()} />)
    expect(screen.getByLabelText(forkLabel)).toBeInTheDocument()
  })
})
