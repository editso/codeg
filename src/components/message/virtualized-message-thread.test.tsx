import type { ReactNode } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const testState = vi.hoisted(() => ({
  scrollRef: { current: null as HTMLDivElement | null },
}))

vi.mock("use-stick-to-bottom", () => ({
  useStickToBottomContext: () => ({ scrollRef: testState.scrollRef }),
}))

vi.mock("virtua", () => ({
  Virtualizer: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock("@/components/ai-elements/message-thread", () => ({
  MessageThreadContent: ({
    children,
    scrollClassName,
  }: {
    children: ReactNode
    scrollClassName?: string
  }) => (
    <div
      ref={(element) => {
        testState.scrollRef.current = element
      }}
      className={scrollClassName}
      data-testid="viewport"
    >
      {children}
    </div>
  ),
}))

import { VirtualizedMessageThread } from "@/components/message/virtualized-message-thread"

function renderThread(
  content: ReactNode = <div data-testid="content">text</div>
) {
  return render(
    <VirtualizedMessageThread
      items={[{ id: "message-1" }]}
      getItemKey={(item) => item.id}
      renderItem={() => content}
    />
  )
}

function pointerDown(element: HTMLElement, button: number) {
  fireEvent(element, new MouseEvent("pointerdown", { bubbles: true, button }))
}

function keyDown(element: HTMLElement, key: string) {
  fireEvent.keyDown(element, { key })
}

beforeEach(() => {
  testState.scrollRef.current = null
})

describe("VirtualizedMessageThread focus behavior", () => {
  it("focuses the viewport when plain transcript content is clicked", () => {
    renderThread()
    const viewport = screen.getByTestId("viewport")

    pointerDown(screen.getByTestId("content"), 0)

    expect(document.activeElement).toBe(viewport)
  })

  it("keeps focus while keyboard scrolling", () => {
    renderThread()
    const viewport = screen.getByTestId("viewport")

    pointerDown(screen.getByTestId("content"), 0)

    keyDown(viewport, "ArrowDown")
    expect(document.activeElement).toBe(viewport)
  })

  it("keeps keyboard-origin focus without a viewport focus ring", () => {
    renderThread()
    const viewport = screen.getByTestId("viewport")

    viewport.focus()

    expect(document.activeElement).toBe(viewport)
    expect(viewport.className).not.toContain("focus-visible:ring-2")
  })

  it("does not focus the viewport when an interactive control is clicked", () => {
    renderThread(<button data-testid="action">Action</button>)
    const viewport = screen.getByTestId("viewport")

    pointerDown(screen.getByTestId("action"), 0)

    expect(document.activeElement).not.toBe(viewport)
  })

  it("does not focus the viewport for a right click", () => {
    renderThread()
    const viewport = screen.getByTestId("viewport")

    pointerDown(screen.getByTestId("content"), 2)

    expect(document.activeElement).not.toBe(viewport)
  })
})
