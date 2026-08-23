"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import {
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAcpActions } from "@/contexts/acp-connections-context"
import {
  getDraftConversationMcpCatalog,
  getConversationConfig,
  listModelProviders,
  updateConversationConfig,
} from "@/lib/api"
import { toErrorMessage } from "@/lib/app-error"
import { subscribe } from "@/lib/platform"
import { cn } from "@/lib/utils"
import {
  CONVERSATION_CONFIG_CHANGED_EVENT,
  type AgentType,
  type ConversationConfigChanged,
  type ConversationConfigView,
  type ConversationMcpCatalog,
  type ConversationMcpCandidate,
  type ConversationMcpRef,
  type DraftConversationConfig,
  type ModelProviderInfo,
} from "@/lib/types"

type Panel = "overview" | "provider" | "mcp"

interface ConversationConfigPopoverProps {
  conversationId: number | null | undefined
  agentType: AgentType | null | undefined
  draftConfig?: DraftConversationConfig | null
  onDraftConfigChange?: (config: DraftConversationConfig) => void
  /** Input's ACP context key. Required to immediately restart the idle
   *  session after a Provider switch and obtain that Provider's real selector
   *  defaults. */
  connectionKey?: string | null
  /** Provider and MCP overrides apply only when a session starts. Lock this
   *  surface while a turn is running so the saved launch config never implies
   *  it changed the already-running agent process. */
  isPrompting?: boolean
}

function refKey(ref: ConversationMcpRef): string {
  return `${ref.id}\u0000${ref.fingerprint}`
}

/**
 * A provider switch must refresh the model selector, but it must not reset
 * unrelated conversation selectors such as Codex's approval mode or reasoning
 * effort. Their ids are part of the same ACP config map, so drop only the
 * provider-dependent model value before the next launch.
 */
function preserveNonModelSessionConfigValues(
  values: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).filter(([configId]) => configId !== "model")
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
      className="group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
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

function McpListItem({
  candidate,
  checked,
  disabled,
  description,
  onCheckedChange,
}: {
  candidate: ConversationMcpCandidate
  checked: boolean
  disabled: boolean
  description: string
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
        disabled
          ? "cursor-not-allowed opacity-65"
          : "cursor-pointer hover:bg-muted/65"
      )}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onCheckedChange(next === true)}
        className="mt-0.5"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">
          {candidate.id}
        </span>
        <span className="mt-0.5 block line-clamp-2 text-[11px] leading-snug text-muted-foreground">
          {description}
        </span>
      </span>
    </label>
  )
}

/**
 * Session launch overrides. Persisted conversations save them in the database;
 * a new-conversation tab keeps them in its draft until first send. The surface
 * never edits an agent's native config: a provider becomes a one-launch
 * environment override and MCP selections become ACP session additions.
 */
export function ConversationConfigPopover({
  conversationId,
  agentType,
  draftConfig,
  onDraftConfigChange,
  connectionKey,
  isPrompting = false,
}: ConversationConfigPopoverProps) {
  const t = useTranslations("Folder.chat.messageInput")
  const { reapplyConfig, restart } = useAcpActions()
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState<Panel>("overview")
  const [configView, setConfigView] = useState<ConversationConfigView | null>(
    null
  )
  const [draftCatalog, setDraftCatalog] =
    useState<ConversationMcpCatalog | null>(null)
  const [providers, setProviders] = useState<ModelProviderInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (conversationId == null && agentType == null) return
    setLoading(true)
    setError(null)
    try {
      if (conversationId == null) {
        const [nextDraftCatalog, nextProviders] = await Promise.all([
          getDraftConversationMcpCatalog(agentType!),
          listModelProviders(),
        ])
        setDraftCatalog(nextDraftCatalog)
        setProviders(nextProviders)
      } else {
        const [nextConfigView, nextProviders] = await Promise.all([
          getConversationConfig(conversationId),
          listModelProviders(),
        ])
        setConfigView(nextConfigView)
        setProviders(nextProviders)
      }
    } catch (loadError) {
      setError(toErrorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [agentType, conversationId])

  useEffect(() => {
    if (!open) return
    void load()
  }, [conversationId, load, open])

  useEffect(() => {
    if (!open || conversationId == null) return
    let active = true
    let unsubscribe: (() => void) | undefined
    void subscribe<ConversationConfigChanged>(
      CONVERSATION_CONFIG_CHANGED_EVENT,
      (changed) => {
        if (
          changed.conversation_id === conversationId &&
          changed.version !== configView?.config.version
        ) {
          void load()
        }
      }
    )
      .then((nextUnsubscribe) => {
        if (active) unsubscribe = nextUnsubscribe
        else nextUnsubscribe()
      })
      .catch((subscribeError) => {
        if (active) setError(toErrorMessage(subscribeError))
      })
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [configView?.config.version, conversationId, load, open])

  // A turn may begin in another client while this panel is open. Close it
  // immediately instead of leaving controls visible for a configuration that
  // can only affect the next agent launch.
  useEffect(() => {
    if (!isPrompting || !open) return
    setOpen(false)
    setPanel("overview")
  }, [isPrompting, open])

  const compatibleProviders = useMemo(
    () => providers.filter((provider) => provider.agent_type === agentType),
    [agentType, providers]
  )
  const config =
    conversationId == null
      ? (draftConfig ?? null)
      : (configView?.config ?? null)
  const catalog =
    conversationId == null ? draftCatalog : (configView?.mcp_catalog ?? null)
  const selectedRefKeys = useMemo(
    () => new Set(config?.additional_mcp_refs.map(refKey) ?? []),
    [config?.additional_mcp_refs]
  )
  const provider = compatibleProviders.find(
    (item) => item.id === config?.model_provider_id
  )
  const additionalMcpCount = config?.additional_mcp_refs.length ?? 0
  const overrideCount =
    Number(config?.model_provider_id != null) + additionalMcpCount

  const save = useCallback(
    async (
      nextProviderId: number | null,
      nextMcpRefs: ConversationMcpRef[]
    ) => {
      if (isPrompting || config == null) return
      const providerChanged = nextProviderId !== config.model_provider_id
      const requiresDraftRestart = conversationId == null
      const restartConnectionKey =
        providerChanged || requiresDraftRestart ? connectionKey : null
      if (restartConnectionKey == null && requiresDraftRestart) {
        setError(
          "The conversation connection is unavailable, so the draft configuration cannot be applied."
        )
        return
      }
      setSaving(true)
      setError(null)
      try {
        if (conversationId == null) {
          if (onDraftConfigChange == null) {
            throw new Error(
              "The new conversation does not expose draft configuration storage."
            )
          }
          const nextDraftConfig: DraftConversationConfig = {
            model_provider_id: nextProviderId,
            additional_mcp_refs: nextMcpRefs,
            // Refresh only the provider-dependent model. Approval/reasoning
            // selectors belong to the conversation and must survive a provider
            // switch when the new provider exposes the same ACP ids.
            session_config_values:
              nextProviderId === config.model_provider_id
                ? config.session_config_values
                : preserveNonModelSessionConfigValues(
                    config.session_config_values
                  ),
          }
          onDraftConfigChange(nextDraftConfig)
          const reconnected = await reapplyConfig(
            restartConnectionKey!,
            nextDraftConfig
          )
          if (!reconnected) {
            throw new Error(
              "The draft configuration was saved, but the current session could not be refreshed."
            )
          }
          setOpen(false)
          setPanel("overview")
          return
        }
        const persistedConfig = configView?.config
        if (persistedConfig == null) return
        const nextView = await updateConversationConfig(conversationId, {
          model_provider_id: nextProviderId,
          additional_mcp_refs: nextMcpRefs,
          // Refresh only the provider-dependent model. Approval/reasoning
          // selectors belong to the conversation and must survive a provider
          // switch when the new provider exposes the same ACP ids.
          session_config_values:
            nextProviderId === persistedConfig.model_provider_id
              ? persistedConfig.session_config_values
              : preserveNonModelSessionConfigValues(
                  persistedConfig.session_config_values
                ),
          expected_version: persistedConfig.version,
        })
        setConfigView(nextView)
        if (restartConnectionKey != null) {
          // Provider credentials and model defaults are process-start inputs.
          // The session is idle here (the trigger is frozen while prompting).
          // A browser can be attached as a viewer of a process owned by another
          // client; reapplyConfig intentionally refuses to stop that process,
          // leaving the stored override visibly selected but not active. This
          // is an explicit provider-switch action, so restart is the correct
          // ownership-aware path: it replaces a viewer's old process, then
          // reconnects this conversation with the persisted override.
          const reconnected = await restart(restartConnectionKey)
          if (!reconnected) {
            throw new Error(
              "The provider was saved, but the current conversation could not be refreshed."
            )
          }
          setOpen(false)
          setPanel("overview")
        }
      } catch (saveError) {
        setError(toErrorMessage(saveError))
      } finally {
        setSaving(false)
      }
    },
    [
      config,
      configView?.config,
      connectionKey,
      conversationId,
      isPrompting,
      onDraftConfigChange,
      reapplyConfig,
      restart,
    ]
  )

  const toggleMcp = useCallback(
    (candidate: ConversationMcpCandidate, checked: boolean) => {
      if (
        isPrompting ||
        config == null ||
        candidate.native ||
        !candidate.appendable
      ) {
        return
      }
      const key = refKey(candidate)
      const nextRefs = checked
        ? [
            ...config.additional_mcp_refs,
            { id: candidate.id, fingerprint: candidate.fingerprint },
          ]
        : config.additional_mcp_refs.filter((ref) => refKey(ref) !== key)
      void save(config.model_provider_id, nextRefs)
    },
    [config, isPrompting, save]
  )

  const isLocked = isPrompting || saving

  const renderFollowGlobal = () => {
    const selected = config?.model_provider_id == null
    return (
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        disabled={isLocked || config == null}
        onClick={() => void save(null, config?.additional_mcp_refs ?? [])}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          selected
            ? "border-primary/30 bg-primary/7 text-foreground"
            : "border-transparent bg-muted/50 hover:bg-muted",
          (isLocked || config == null) && "cursor-not-allowed opacity-60"
        )}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-background/75 text-muted-foreground">
          <Globe2 className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium">
            {t("conversationConfigFollowGlobal")}
          </span>
          <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
            {t("conversationConfigFollowGlobalDescription")}
          </span>
        </span>
        {selected ? <Check className="size-3.5 shrink-0 text-primary" /> : null}
      </button>
    )
  }

  const renderPanel = () => {
    if (panel === "provider") {
      return (
        <>
          <DetailHeader
            title={t("conversationConfigModelProvider")}
            onBack={() => setPanel("overview")}
          />
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2">
            {renderFollowGlobal()}
            <div className="px-2 pb-0.5 pt-2 text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              {t("conversationConfigCustom")}
            </div>
            {loading ? (
              <div className="flex items-center gap-2 px-2.5 py-3 text-xs text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin" />
                {t("loadingSettings")}
              </div>
            ) : compatibleProviders.length > 0 ? (
              compatibleProviders.map((item) => {
                const selected = item.id === config?.model_provider_id
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={selected ? "true" : undefined}
                    disabled={isLocked || config == null}
                    onClick={() =>
                      void save(item.id, config?.additional_mcp_refs ?? [])
                    }
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted/65 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      selected && "bg-muted",
                      (isLocked || config == null) &&
                        "cursor-not-allowed opacity-60"
                    )}
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center pt-0.5">
                      {selected ? (
                        <Check className="size-3.5 text-primary" />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">
                        {item.name}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {item.model || item.api_url}
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

    if (panel === "mcp") {
      const candidates = catalog?.candidates ?? []
      return (
        <>
          <DetailHeader
            title={t("conversationConfigMcpServers")}
            onBack={() => setPanel("overview")}
          />
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2">
            {loading ? (
              <div className="flex items-center gap-2 px-2.5 py-3 text-xs text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin" />
                {t("loadingSettings")}
              </div>
            ) : !catalog?.supports_session_additions ? (
              <p className="px-2.5 py-3 text-xs leading-snug text-muted-foreground">
                {t("conversationConfigMcpUnsupported")}
              </p>
            ) : candidates.length > 0 ? (
              candidates.map((candidate) => {
                const checked =
                  candidate.native || selectedRefKeys.has(refKey(candidate))
                const disabled =
                  isLocked ||
                  candidate.native ||
                  !candidate.appendable ||
                  config == null
                const description = candidate.native
                  ? t("conversationConfigMcpNative")
                  : !candidate.appendable
                    ? t("conversationConfigMcpNameConflict")
                    : t("conversationConfigSources", {
                        sources: candidate.source_apps.join(", "),
                      })
                return (
                  <McpListItem
                    key={refKey(candidate)}
                    candidate={candidate}
                    checked={checked}
                    disabled={disabled}
                    description={description}
                    onCheckedChange={(checkedValue) =>
                      toggleMcp(candidate, checkedValue)
                    }
                  />
                )
              })
            ) : (
              <p className="px-2.5 py-3 text-xs leading-snug text-muted-foreground">
                {t("conversationConfigNoMcpServers")}
              </p>
            )}
          </div>
        </>
      )
    }

    const providerLabel =
      config?.model_provider_id == null
        ? t("conversationConfigFollowGlobal")
        : (provider?.name ?? t("conversationConfigProviderUnavailable"))

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
            disabled={isLocked || config == null || overrideCount === 0}
            onClick={() => void save(null, [])}
            title={t("conversationConfigRestoreGlobal")}
            aria-label={t("conversationConfigRestoreGlobal")}
          >
            <RotateCcw className="size-3.5" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
          {loading && config == null ? (
            <div className="flex items-center gap-2 px-2.5 py-3 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" />
              {t("loadingSettings")}
            </div>
          ) : (
            <>
              <OverviewRow
                icon={Sparkles}
                label={t("conversationConfigModelProvider")}
                value={providerLabel}
                overridden={config?.model_provider_id != null}
                onClick={() => setPanel("provider")}
              />
              <OverviewRow
                icon={ServerCog}
                label="MCP"
                value={
                  additionalMcpCount > 0
                    ? t("conversationConfigSelectedCount", {
                        count: additionalMcpCount,
                      })
                    : t("conversationConfigNoMcpAdditions")
                }
                overridden={additionalMcpCount > 0}
                onClick={() => setPanel("mcp")}
              />
            </>
          )}
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
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* A disabled button cannot receive pointer events. Keep the
                wrapper interactive so the reason for the turn-time lock is
                discoverable without letting the Popover open. */}
            <span className="inline-flex">
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={isLocked}
                  className={cn(
                    "relative shrink-0 text-muted-foreground",
                    isLocked && "cursor-not-allowed opacity-45"
                  )}
                  title={t("conversationSettings")}
                  aria-label={t("conversationSettings")}
                >
                  <SlidersHorizontal className="size-3.5" />
                  {overrideCount > 0 ? (
                    <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary ring-1 ring-card" />
                  ) : null}
                </Button>
              </PopoverTrigger>
            </span>
          </TooltipTrigger>
          {isPrompting ? (
            <TooltipContent side="top" sideOffset={8}>
              {t("conversationConfigLockedDuringTurn")}
            </TooltipContent>
          ) : null}
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        side="top"
        align="end"
        className="max-h-[min(31rem,calc(100dvh-1rem))] w-[min(25rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] gap-0 overflow-hidden p-0"
        aria-label={t("conversationSettings")}
      >
        {error ? (
          <p
            role="alert"
            className="mx-2 mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-[11px] leading-snug text-destructive"
          >
            {error}
          </p>
        ) : null}
        {renderPanel()}
      </PopoverContent>
    </Popover>
  )
}
