"use client"

import type {
  AgentType,
  ConversationMcpRef,
  DraftConversationConfig,
} from "@/lib/types"

interface PersistedDraftConversationConfig extends DraftConversationConfig {
  agent_type: AgentType
}

const STORAGE_PREFIX = "codeg:conversation-config-draft:v1"

export function emptyDraftConversationConfig(): DraftConversationConfig {
  return { model_provider_id: null, additional_mcp_refs: [] }
}

function storageKey(tabId: string): string {
  return `${STORAGE_PREFIX}:${tabId}`
}

function isMcpRef(value: unknown): value is ConversationMcpRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  const ref = value as Partial<ConversationMcpRef>
  return typeof ref.id === "string" && typeof ref.fingerprint === "string"
}

export function loadDraftConversationConfig(
  tabId: string,
  agentType: AgentType
): DraftConversationConfig {
  if (typeof window === "undefined") return emptyDraftConversationConfig()
  try {
    const raw = localStorage.getItem(storageKey(tabId))
    if (!raw) return emptyDraftConversationConfig()
    const parsed = JSON.parse(raw) as Partial<PersistedDraftConversationConfig>
    const providerId = parsed.model_provider_id
    if (
      parsed.agent_type !== agentType ||
      !(
        providerId === null ||
        (typeof providerId === "number" && Number.isInteger(providerId))
      ) ||
      !Array.isArray(parsed.additional_mcp_refs) ||
      !parsed.additional_mcp_refs.every(isMcpRef)
    ) {
      return emptyDraftConversationConfig()
    }
    return {
      model_provider_id: providerId,
      additional_mcp_refs: parsed.additional_mcp_refs,
    }
  } catch {
    return emptyDraftConversationConfig()
  }
}

export function saveDraftConversationConfig(
  tabId: string,
  agentType: AgentType,
  config: DraftConversationConfig
): void {
  if (typeof window === "undefined") return
  localStorage.setItem(
    storageKey(tabId),
    JSON.stringify({ agent_type: agentType, ...config })
  )
}

export function clearDraftConversationConfig(tabId: string): void {
  if (typeof window === "undefined") return
  localStorage.removeItem(storageKey(tabId))
}

export function hasDraftConversationOverrides(
  config: DraftConversationConfig
): boolean {
  return (
    config.model_provider_id != null || config.additional_mcp_refs.length > 0
  )
}
