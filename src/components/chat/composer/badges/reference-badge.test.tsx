import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ReferenceBadge } from "./reference-badge"
import type { ReferenceAttrs } from "../types"

function ref(partial: Partial<ReferenceAttrs>): ReferenceAttrs {
  return {
    refType: "file",
    id: "",
    label: "",
    uri: null,
    meta: null,
    ...partial,
  }
}

/** The badge root carries `data-reference-badge` and `data-ref-type`. */
function badgeOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>("[data-reference-badge]")
  if (!el) throw new Error("no reference badge rendered")
  return el
}

describe("ReferenceBadge", () => {
  it("renders the label and is vertically centered (align-middle)", () => {
    const { container } = render(
      <ReferenceBadge data={ref({ refType: "file", label: "app.ts" })} />
    )
    const badge = badgeOf(container)
    expect(badge).toHaveTextContent("app.ts")
    // Task 3: badges sit on the text's middle, not its baseline.
    expect(badge).toHaveClass("align-middle")
    expect(badge).not.toHaveClass("align-baseline")
  })

  it("renders a file reference as a neutral compact chip", () => {
    const { container } = render(
      <ReferenceBadge data={ref({ refType: "file", label: "app.ts" })} />
    )
    const badge = badgeOf(container)
    expect(badge).toHaveAttribute("data-ref-type", "file")
    // Reference objects read as compact entities, not browser-blue links.
    expect(badge).toHaveClass("bg-muted/45")
    expect(badge).toHaveClass("border")
    expect(badge).toHaveClass("rounded-md")
    expect(badge).toHaveClass("text-foreground/80")
    expect(badge.firstElementChild).toHaveClass("text-muted-foreground/70")
    expect(container.querySelector(".lucide-file-text")).not.toBeNull()
  })

  it("uses an emerald icon accent for a session reference", () => {
    const { container } = render(
      <ReferenceBadge data={ref({ refType: "session", label: "#42" })} />
    )
    const badge = badgeOf(container)
    expect(badge).toHaveAttribute("data-ref-type", "session")
    expect(badge.firstElementChild).toHaveClass("text-emerald-700/80")
    // A session badge always shows the neutral conversation glyph (not the
    // owning agent's icon, not Hash) — see the `session` case in ReferenceIcon.
    expect(container.querySelector(".lucide-message-square")).not.toBeNull()
    expect(container.querySelector(".lucide-hash")).toBeNull()
  })

  it("shows the conversation glyph and no status dot even with agent/status meta", () => {
    // The inline badge ignores the owning agent and the live status: it never
    // shows an agent icon and never paints the trailing status dot (those belong
    // to the `@`-panel option row and the sidebar, not the inline chip).
    const { container } = render(
      <ReferenceBadge
        data={ref({
          refType: "session",
          label: "Login refactor",
          meta: { agentType: "codex", status: "in_progress" },
        })}
      />
    )
    expect(container.querySelector(".lucide-message-square")).not.toBeNull()
    // No agent icon: AgentIcon for codex renders an <svg> with <title>Codex</title>;
    // the conversation glyph carries no <title>, so none should be present.
    expect(container.querySelector("title")).toBeNull()
    // No trailing status dot (the removed `rounded-full` indicator).
    expect(container.querySelector(".rounded-full")).toBeNull()
  })

  it("renders a command/skill with the command glyph and rose icon accent", () => {
    const { container } = render(
      <ReferenceBadge
        data={ref({
          refType: "skill",
          id: "build",
          label: "build",
          meta: { invocationPrefix: "/" },
        })}
      />
    )
    const badge = badgeOf(container)
    expect(badge).toHaveAttribute("data-ref-type", "skill")
    expect(badge.firstElementChild).toHaveClass("text-rose-700/80")
    expect(container.querySelector(".lucide-command")).not.toBeNull()
  })

  it("renders an expert with the SAME command glyph + color (unified, no star)", () => {
    const { container } = render(
      <ReferenceBadge
        data={ref({
          refType: "skill",
          id: "reviewer",
          label: "Reviewer",
          meta: { scope: "expert", invocationPrefix: "/" },
        })}
      />
    )
    const badge = badgeOf(container)
    expect(badge).toHaveAttribute("data-ref-type", "skill")
    // Experts are no longer distinguished — same rose accent and command glyph.
    expect(badge.firstElementChild).toHaveClass("text-rose-700/80")
    expect(container.querySelector(".lucide-command")).not.toBeNull()
    expect(container.querySelector(".lucide-sparkles")).toBeNull()
  })
})
