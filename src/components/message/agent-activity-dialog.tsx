"use client"

import { type ReactNode } from "react"
import { CheckIcon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

export interface AgentActivityDialogEntry<T> {
  id: string
  item: T
  label: string
  active: boolean
  error: boolean
}

function AgentStatusIcon({
  active,
  error,
}: Pick<AgentActivityDialogEntry<unknown>, "active" | "error">) {
  const t = useTranslations("Folder.chat.contentParts")

  if (error) {
    return (
      <span
        aria-label={t("agentStatusFailed")}
        className="inline-grid size-5 shrink-0 place-items-center text-destructive/85"
      >
        <TriangleAlertIcon aria-hidden="true" className="size-3.5" />
      </span>
    )
  }

  if (active) {
    return (
      <span
        aria-label={t("agentStatusRunning")}
        className="inline-grid size-5 shrink-0 place-items-center text-foreground/75"
      >
        <LoaderCircleIcon
          aria-hidden="true"
          className="size-3.5 animate-spin"
        />
      </span>
    )
  }

  return (
    <span
      aria-label={t("agentStatusCompleted")}
      className="inline-grid size-5 shrink-0 place-items-center text-muted-foreground/70"
    >
      <CheckIcon aria-hidden="true" className="size-3.5" />
    </span>
  )
}

/**
 * The focused, full-session view for the Agent nodes in one parent activity
 * group. The parent owns selection so both its count affordance and a node's
 * hover action can land on the same Agent without duplicating transcript
 * readers or creating a second drawer hierarchy.
 */
export function AgentActivityDialog<T>({
  agents,
  selectedAgentId,
  onSelect,
  onClose,
  renderAgent,
}: {
  agents: readonly AgentActivityDialogEntry<T>[]
  selectedAgentId: string | null
  onSelect: (id: string) => void
  onClose: () => void
  renderAgent: (entry: AgentActivityDialogEntry<T>) => ReactNode
}) {
  const t = useTranslations("Folder.chat.contentParts")
  const selectedAgent =
    agents.find((agent) => agent.id === selectedAgentId) ?? agents[0]

  if (!selectedAgent) return null

  const showNavigator = agents.length > 1

  return (
    <Dialog
      open={selectedAgentId != null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        data-testid="agent-activity-dialog"
        className="flex h-[min(48rem,calc(100dvh-2rem))] max-w-[min(66rem,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
      >
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="min-w-0 truncate text-base">
            {selectedAgent.label}
          </DialogTitle>
          <DialogDescription className="min-w-0 truncate text-xs">
            {t("agentActivityDescription")}
          </DialogDescription>
        </DialogHeader>

        <div
          className={cn(
            "grid min-h-0 flex-1",
            showNavigator && "md:grid-cols-[minmax(0,1fr)_13.5rem]"
          )}
        >
          <section
            aria-label={t("agentSessionTitle")}
            className="codeg-scrollbar-hover min-h-0 overflow-x-hidden overflow-y-auto px-4 py-3 sm:px-5"
          >
            <div key={selectedAgent.id} className="min-w-0">
              {renderAgent(selectedAgent)}
            </div>
          </section>

          {showNavigator ? (
            <aside className="min-h-0 border-t border-border/60 bg-muted/20 p-2 md:border-t-0 md:border-l">
              <nav
                aria-label={t("agentActivity")}
                className="codeg-scrollbar-hover max-h-36 overflow-y-auto md:max-h-none md:h-full"
              >
                <div className="grid gap-1">
                  {agents.map((agent) => {
                    const selected = agent.id === selectedAgent.id
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        aria-current={selected ? "true" : undefined}
                        onClick={() => onSelect(agent.id)}
                        className={cn(
                          "flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] outline-none transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50",
                          selected && "bg-background text-foreground shadow-sm"
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {agent.label}
                        </span>
                        <AgentStatusIcon
                          active={agent.active}
                          error={agent.error}
                        />
                      </button>
                    )
                  })}
                </div>
              </nav>
            </aside>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
