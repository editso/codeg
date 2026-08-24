import { beforeEach, describe, expect, it } from "vitest"

import {
  emptyDraftConversationConfig,
  hasDraftConversationOverrides,
  loadDraftConversationConfig,
  saveDraftConversationConfig,
} from "./conversation-config-draft"

describe("conversation config draft proxy persistence", () => {
  beforeEach(() => localStorage.clear())

  it("round-trips a custom proxy in the draft tab storage", () => {
    const draft = {
      ...emptyDraftConversationConfig(),
      proxy_mode: "custom" as const,
      proxy_url: "socks5://127.0.0.1:1080",
    }

    saveDraftConversationConfig("tab-proxy", "codex", draft)

    expect(loadDraftConversationConfig("tab-proxy", "codex")).toEqual(draft)
    expect(hasDraftConversationOverrides(draft)).toBe(true)
  })

  it("loads drafts written before proxy fields as follow-global", () => {
    localStorage.setItem(
      "codeg:conversation-config-draft:v1:legacy-tab",
      JSON.stringify({
        agent_type: "codex",
        model_provider_id: null,
        additional_mcp_refs: [],
        session_config_values: {},
      })
    )

    expect(loadDraftConversationConfig("legacy-tab", "codex")).toEqual(
      emptyDraftConversationConfig()
    )
  })
})
