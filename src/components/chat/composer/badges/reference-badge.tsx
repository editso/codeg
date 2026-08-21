import {
  Bot,
  Command,
  FileText,
  Folder,
  GitCommit,
  Hash,
  MessageSquare,
} from "lucide-react"
import type { ReactNode } from "react"

import { AgentIcon } from "@/components/agent-icon"
import { type AgentType } from "@/lib/types"
import { cn } from "@/lib/utils"

import type { ReferenceAttrs } from "../types"

const ICON_CLASS = "size-3.5 shrink-0"

export function ReferenceIcon({
  data,
  variant = "badge",
}: {
  data: ReferenceAttrs
  /**
   * Where the icon is shown. `"badge"` (default) is the inline reference chip in
   * the composer and the message transcript; `"option"` is a row in the `@`
   * panel. They differ only for sessions (see the `session` case).
   */
  variant?: "badge" | "option"
}) {
  const meta = data.meta
  let icon: ReactNode = null
  switch (data.refType) {
    case "file":
      icon =
        meta?.fileKind === "dir" ? (
          <Folder className={ICON_CLASS} />
        ) : (
          <FileText className={ICON_CLASS} />
        )
      break
    case "agent": {
      const agentType = meta?.agentType ?? (data.id as AgentType)
      icon = agentType ? (
        <AgentIcon agentType={agentType} className={ICON_CLASS} />
      ) : (
        <Bot className={ICON_CLASS} />
      )
      break
    }
    case "session":
      // The inline badge (composer + transcript) shows a neutral conversation
      // glyph: a session reference reads as "a conversation", not as the agent
      // that owns it, and it carries no live status. The `@`-panel option row
      // (`variant="option"`) instead shows the owning agent's icon so sessions
      // stay distinguishable while picking one (falling back to `Hash` for a
      // legacy id with no recoverable agent type).
      icon =
        variant === "option" ? (
          meta?.agentType ? (
            <AgentIcon agentType={meta.agentType} className={ICON_CLASS} />
          ) : (
            <Hash className={ICON_CLASS} />
          )
        ) : (
          <MessageSquare className={ICON_CLASS} />
        )
      break
    case "commit":
      icon = <GitCommit className={ICON_CLASS} />
      break
    case "skill":
      // Commands, skills and experts all use the command glyph — they aren't
      // visually distinguished (the `meta.scope` distinction is kept only for
      // the editor's expert-replace logic, not the icon).
      icon = <Command className={ICON_CLASS} />
      break
    default:
      return null
  }
  // Decorative wherever it appears (popup option, badge): the accessible name
  // comes from the adjacent label (or the badge's own role="img" name), so hide
  // it — otherwise AgentIcon's titled <svg> leaks into the option name (e.g.
  // "Codex Codex Helper").
  return (
    <span aria-hidden="true" className="inline-flex shrink-0">
      {icon}
    </span>
  )
}

/**
 * A reference is an inline object, not an in-prose hyperlink. Keep its label
 * in the reading color and use a restrained accent on the glyph alone: the
 * type is still scannable without a run of blue / violet / green text pulling
 * focus away from the message itself.
 */
function badgeIconToneClass(data: ReferenceAttrs): string {
  switch (data.refType) {
    case "file":
      return "text-sky-700/80 dark:text-sky-300/80"
    case "agent":
      return "text-violet-700/80 dark:text-violet-300/80"
    case "session":
      return "text-emerald-700/80 dark:text-emerald-300/80"
    case "commit":
      return "text-amber-700/80 dark:text-amber-300/80"
    case "skill":
      return "text-rose-700/80 dark:text-rose-300/80"
  }
}

export interface ReferenceBadgeProps {
  data: ReferenceAttrs
  className?: string
}

/**
 * Presentational inline chip for a reference. Shared by the editor node view and
 * the message-transcript rendering (markdown-link → here). Purely visual — no
 * editor coupling.
 */
export function ReferenceBadge({ data, className }: ReferenceBadgeProps) {
  return (
    <span
      data-reference-badge=""
      data-ref-type={data.refType}
      title={data.uri ?? data.label}
      // The badge is an inline contentEditable=false atom. `role="img"` makes it
      // a single named unit so `aria-label` is a reliable accessible name (a
      // bare span's aria-label is not), and collapses the decorative icon —
      // including AgentIcon's titled <svg> — into that one name.
      role="img"
      aria-label={`${data.refType}: ${data.label || data.id}`}
      className={cn(
        "inline-flex max-w-[18rem] items-center gap-1 rounded-md border border-border/55 bg-muted/45 px-1.5 py-0.5 align-middle text-[0.8em] font-medium leading-none text-foreground/80 transition-[background-color,border-color,color] duration-150 group-hover/file-reference:border-border/80 group-hover/file-reference:bg-muted/75 group-hover/file-reference:text-foreground group-focus-visible/file-reference:border-ring/60 group-focus-visible/file-reference:bg-muted/75",
        className
      )}
    >
      <span className={badgeIconToneClass(data)}>
        <ReferenceIcon data={data} />
      </span>
      <span className="truncate">{data.label || data.id}</span>
    </span>
  )
}
