"use client"

import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"
import { useTranslations } from "next-intl"
import {
  BookOpenText,
  Check,
  ChevronLeft,
  ChevronRight,
  Globe2,
  LoaderCircle,
  RotateCcw,
  ServerCog,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { listModelProviders, mcpScanLocal } from "@/lib/api"
import { cn } from "@/lib/utils"
import type {
  AgentSkillItem,
  AgentType,
  LocalMcpServer,
  McpAppType,
  ModelProviderInfo,
} from "@/lib/types"

type Panel = "overview" | "provider" | "mcp" | "skills"
type ResourceMode = "global" | "custom"

interface ConversationConfigPopoverProps {
  agentType: AgentType | null | undefined
  skills: AgentSkillItem[]
}

function ResourceListItem({
  checked,
  title,
  description,
  onCheckedChange,
}: {
  checked: boolean
  title: string
  description?: string | null
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted/65">
      <Checkbox
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next === true)}
        className="mt-0.5"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{title}</span>
        {description ? (
          <span className="mt-0.5 block line-clamp-2 text-[11px] leading-snug text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  )
}

function OverviewRow({
  icon: Icon,
  label,
  value,
  overridden = false,
  onClick,
}: {
  icon: LucideIcon
  label: string
  value: string
  overridden?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted/75 text-muted-foreground transition-colors group-hover:bg-background group-hover:text-foreground">
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium">{label}</span>
        <span
          className={cn(
            "mt-0.5 block truncate text-[11px]",
            overridden ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {value}
        </span>
      </span>
      {overridden ? (
        <span
          aria-label=""
          className="size-1.5 shrink-0 rounded-full bg-primary/70"
        />
      ) : null}
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/65 transition-transform group-hover:translate-x-0.5" />
    </button>
  )
}

function DetailHeader({
  title,
  onBack,
}: {
  title: string
  onBack: () => void
}) {
  const t = useTranslations("Folder.chat.messageInput")

  return (
    <div className="flex shrink-0 items-center gap-1 border-b px-2.5 py-2">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onBack}
        title={t("conversationConfigBack")}
        aria-label={t("conversationConfigBack")}
      >
        <ChevronLeft className="size-3.5" />
      </Button>
      <span className="min-w-0 truncate text-xs font-medium">{title}</span>
    </div>
  )
}

/**
 * Visual prototype for the session-level configuration surface. Its choices
 * intentionally live only in component state for now: it reads the existing
 * Provider / MCP / Skill registries so the selection UI is realistic, but it
 * neither persists an override nor changes a live ACP connection.
 */
export function ConversationConfigPopover({
  agentType,
  skills,
}: ConversationConfigPopoverProps) {
  const t = useTranslations("Folder.chat.messageInput")
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState<Panel>("overview")
  const [providers, setProviders] = useState<ModelProviderInfo[]>([])
  const [mcpServers, setMcpServers] = useState<LocalMcpServer[]>([])
  const [resourcesLoading, setResourcesLoading] = useState(false)

  // Every value below is intentionally ephemeral. The next implementation
  // phase replaces these local values with the persisted conversation override.
  const [providerId, setProviderId] = useState<number | null>(null)
  const [mcpMode, setMcpMode] = useState<ResourceMode>("global")
  const [mcpIds, setMcpIds] = useState<Set<string>>(() => new Set())
  const [skillsMode, setSkillsMode] = useState<ResourceMode>("global")
  const [skillRefs, setSkillRefs] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setResourcesLoading(true)
    void Promise.all([listModelProviders(), mcpScanLocal()])
      .then(([nextProviders, nextMcpServers]) => {
        if (cancelled) return
        setProviders(nextProviders)
        setMcpServers(nextMcpServers)
      })
      .catch(() => {
        // This is a preview-only panel: a temporary resource read failure must
        // not prevent the rest of the composer from being used.
        if (cancelled) return
        setProviders([])
        setMcpServers([])
      })
      .finally(() => {
        if (!cancelled) setResourcesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const compatibleProviders = useMemo(
    () => providers.filter((provider) => provider.agent_type === agentType),
    [agentType, providers]
  )
  const availableMcpServers = useMemo(() => {
    if (!agentType || agentType === "pi" || agentType.startsWith("custom:")) {
      return []
    }
    return mcpServers.filter((server) =>
      server.apps.includes(agentType as McpAppType)
    )
  }, [agentType, mcpServers])

  const overrideCount =
    Number(providerId !== null) +
    Number(mcpMode === "custom") +
    Number(skillsMode === "custom")

  const globalLabel = t("conversationConfigFollowGlobal")
  const previewLabel =
    overrideCount === 0
      ? globalLabel
      : t("conversationConfigSelectedCount", { count: overrideCount })

  const resourceSummary = (mode: ResourceMode, count: number) =>
    mode === "global"
      ? globalLabel
      : t("conversationConfigSelectedCount", { count })

  const resetPreview = () => {
    setProviderId(null)
    setMcpMode("global")
    setMcpIds(new Set())
    setSkillsMode("global")
    setSkillRefs(new Set())
    setPanel("overview")
  }

  const updateResourceSelection = (
    value: string,
    checked: boolean,
    setter: Dispatch<SetStateAction<Set<string>>>
  ) => {
    setter((current) => {
      const next = new Set(current)
      if (checked) next.add(value)
      else next.delete(value)
      return next
    })
  }

  const renderFollowGlobal = (selected: boolean, onSelect: () => void) => (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        selected
          ? "border-primary/30 bg-primary/7 text-foreground"
          : "border-transparent bg-muted/50 hover:bg-muted"
      )}
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-background/75 text-muted-foreground">
        <Globe2 className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium">{globalLabel}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
          {t("conversationConfigFollowGlobalDescription")}
        </span>
      </span>
      {selected ? <Check className="size-3.5 shrink-0 text-primary" /> : null}
    </button>
  )

  const renderPanel = () => {
    if (panel === "provider") {
      return (
        <>
          <DetailHeader
            title={t("conversationConfigModelProvider")}
            onBack={() => setPanel("overview")}
          />
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2">
            {renderFollowGlobal(providerId === null, () => setProviderId(null))}
            <div className="px-2 pb-0.5 pt-2 text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              {t("conversationConfigCustom")}
            </div>
            {resourcesLoading ? (
              <div className="flex items-center gap-2 px-2.5 py-3 text-xs text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin" />
                {t("loadingSettings")}
              </div>
            ) : compatibleProviders.length > 0 ? (
              compatibleProviders.map((provider) => {
                const selected = provider.id === providerId
                return (
                  <button
                    key={provider.id}
                    type="button"
                    aria-current={selected ? "true" : undefined}
                    onClick={() => setProviderId(provider.id)}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted/65 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      selected && "bg-muted"
                    )}
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center pt-0.5">
                      {selected ? (
                        <Check className="size-3.5 text-primary" />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">
                        {provider.name}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {provider.model || provider.api_url}
                      </span>
                    </span>
                  </button>
                )
              })
            ) : (
              <p className="px-2.5 py-3 text-xs leading-snug text-muted-foreground">
                {t("conversationConfigNoCompatibleProviders")}
              </p>
            )}
          </div>
        </>
      )
    }

    if (panel === "mcp" || panel === "skills") {
      const isMcp = panel === "mcp"
      const resourceMode = isMcp ? mcpMode : skillsMode
      const selected = isMcp ? mcpIds : skillRefs
      const rows = isMcp ? availableMcpServers : skills
      const title = isMcp
        ? t("conversationConfigMcpServers")
        : t("conversationConfigAvailableSkills")
      const noRowsLabel = isMcp
        ? t("conversationConfigNoMcpServers")
        : t("conversationConfigNoSkills")
      const setMode = isMcp ? setMcpMode : setSkillsMode
      const setSelection = isMcp ? setMcpIds : setSkillRefs

      return (
        <>
          <DetailHeader title={title} onBack={() => setPanel("overview")} />
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2">
            {renderFollowGlobal(resourceMode === "global", () =>
              setMode("global")
            )}
            <div className="px-2 pb-0.5 pt-2 text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              {t("conversationConfigCustom")}
            </div>
            {resourcesLoading && isMcp ? (
              <div className="flex items-center gap-2 px-2.5 py-3 text-xs text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin" />
                {t("loadingSettings")}
              </div>
            ) : rows.length > 0 ? (
              isMcp ? (
                (rows as LocalMcpServer[]).map((server) => (
                  <ResourceListItem
                    key={server.id}
                    checked={
                      resourceMode === "custom" && selected.has(server.id)
                    }
                    title={server.id}
                    description={
                      typeof server.spec.type === "string"
                        ? server.spec.type
                        : null
                    }
                    onCheckedChange={(checked) => {
                      setMode("custom")
                      updateResourceSelection(server.id, checked, setSelection)
                    }}
                  />
                ))
              ) : (
                (rows as AgentSkillItem[]).map((skill) => {
                  const ref = `${skill.scope}:${skill.id}`
                  return (
                    <ResourceListItem
                      key={ref}
                      checked={resourceMode === "custom" && selected.has(ref)}
                      title={skill.name}
                      description={skill.description}
                      onCheckedChange={(checked) => {
                        setMode("custom")
                        updateResourceSelection(ref, checked, setSelection)
                      }}
                    />
                  )
                })
              )
            ) : (
              <p className="px-2.5 py-3 text-xs leading-snug text-muted-foreground">
                {noRowsLabel}
              </p>
            )}
          </div>
        </>
      )
    }

    const providerLabel =
      compatibleProviders.find((provider) => provider.id === providerId)
        ?.name ?? globalLabel

    return (
      <>
        <div className="flex shrink-0 items-start gap-2.5 border-b px-3.5 py-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <SlidersHorizontal className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold">
              {t("conversationSettings")}
            </span>
            <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
              {t("conversationSettingsDescription")}
            </span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={overrideCount === 0}
            onClick={resetPreview}
            title={t("conversationConfigRestoreGlobal")}
            aria-label={t("conversationConfigRestoreGlobal")}
          >
            <RotateCcw className="size-3.5" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
          <OverviewRow
            icon={Sparkles}
            label={t("conversationConfigModelProvider")}
            value={providerLabel}
            overridden={providerId !== null}
            onClick={() => setPanel("provider")}
          />
          <OverviewRow
            icon={ServerCog}
            label="MCP"
            value={resourceSummary(mcpMode, mcpIds.size)}
            overridden={mcpMode === "custom"}
            onClick={() => setPanel("mcp")}
          />
          <OverviewRow
            icon={BookOpenText}
            label="Skills"
            value={resourceSummary(skillsMode, skillRefs.size)}
            overridden={skillsMode === "custom"}
            onClick={() => setPanel("skills")}
          />
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t px-3.5 py-2 text-[11px] text-muted-foreground">
          <span className="min-w-0 truncate">{previewLabel}</span>
          <span className="shrink-0">{t("conversationConfigPreviewOnly")}</span>
        </div>
      </>
    )
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setPanel("overview")
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="relative shrink-0 text-muted-foreground"
          title={t("conversationSettings")}
          aria-label={t("conversationSettings")}
        >
          <SlidersHorizontal className="size-3.5" />
          {overrideCount > 0 ? (
            <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary ring-1 ring-card" />
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="max-h-[min(31rem,calc(100dvh-1rem))] w-[min(25rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] gap-0 overflow-hidden p-0"
        aria-label={t("conversationSettings")}
      >
        {renderPanel()}
      </PopoverContent>
    </Popover>
  )
}
