import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import type {
  ConversationConfigView,
  ConversationProxyMode,
  DraftConversationConfig,
} from "@/lib/types"

import { ConversationConfigPopover } from "./conversation-config-popover"

const mocks = vi.hoisted(() => ({
  getConversationConfig: vi.fn(),
  getDraftConversationMcpCatalog: vi.fn(),
  listModelProviders: vi.fn(),
  updateConversationConfig: vi.fn(),
  restart: vi.fn(),
  reapplyConfig: vi.fn(),
  subscribe: vi.fn(),
}))

vi.mock("@/lib/api", () => ({
  getConversationConfig: mocks.getConversationConfig,
  getDraftConversationMcpCatalog: mocks.getDraftConversationMcpCatalog,
  listModelProviders: mocks.listModelProviders,
  updateConversationConfig: mocks.updateConversationConfig,
}))

vi.mock("@/contexts/acp-connections-context", () => ({
  useAcpActions: () => ({
    restart: mocks.restart,
    reapplyConfig: mocks.reapplyConfig,
  }),
}))

vi.mock("@/lib/platform", () => ({
  subscribe: mocks.subscribe,
}))

function configView(
  proxyMode: ConversationProxyMode = "follow_global",
  proxyUrl: string | null = null,
  version = 0
): ConversationConfigView {
  return {
    config: {
      conversation_id: 42,
      model_provider_id: null,
      additional_mcp_refs: [],
      session_config_values: {},
      proxy_mode: proxyMode,
      proxy_url: proxyUrl,
      version,
      updated_at: "2026-08-24T00:00:00Z",
    },
    mcp_catalog: {
      candidates: [],
      supports_session_additions: true,
    },
  }
}

function renderPopover(
  props: Partial<React.ComponentProps<typeof ConversationConfigPopover>> = {}
) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ConversationConfigPopover
        conversationId={42}
        agentType="codex"
        connectionKey="conversation-42"
        {...props}
      />
    </NextIntlClientProvider>
  )
}

describe("ConversationConfigPopover proxy settings", () => {
  beforeEach(() => {
    mocks.getConversationConfig.mockReset()
    mocks.getDraftConversationMcpCatalog.mockReset()
    mocks.listModelProviders.mockReset()
    mocks.updateConversationConfig.mockReset()
    mocks.restart.mockReset()
    mocks.reapplyConfig.mockReset()
    mocks.subscribe.mockReset()

    mocks.getConversationConfig.mockResolvedValue(configView())
    mocks.getDraftConversationMcpCatalog.mockResolvedValue({
      candidates: [],
      supports_session_additions: true,
    })
    mocks.listModelProviders.mockResolvedValue([])
    mocks.restart.mockResolvedValue(true)
    mocks.reapplyConfig.mockResolvedValue(true)
    mocks.subscribe.mockResolvedValue(() => {})
  })

  afterEach(() => cleanup())

  it("persists a custom proxy and restarts the idle conversation", async () => {
    const user = userEvent.setup()
    mocks.updateConversationConfig.mockResolvedValue(
      configView("custom", "http://127.0.0.1:7890", 1)
    )
    renderPopover()

    await user.click(
      screen.getByRole("button", { name: "Conversation settings" })
    )
    await user.click(
      await screen.findByRole("button", { name: /Network proxy/ })
    )

    const input = screen.getByLabelText("Custom proxy")
    await user.type(input, "127.0.0.1:7890")
    await user.click(screen.getByRole("button", { name: "Apply proxy" }))

    await waitFor(() =>
      expect(mocks.updateConversationConfig).toHaveBeenCalledWith(42, {
        model_provider_id: null,
        additional_mcp_refs: [],
        session_config_values: {},
        proxy_mode: "custom",
        proxy_url: "127.0.0.1:7890",
        expected_version: 0,
      })
    )
    expect(mocks.restart).toHaveBeenCalledWith("conversation-42")
  })

  it("keeps a draft proxy choice in the draft config before first send", async () => {
    const user = userEvent.setup()
    const onDraftConfigChange = vi.fn()
    const draftConfig: DraftConversationConfig = {
      model_provider_id: null,
      additional_mcp_refs: [],
      session_config_values: {},
      proxy_mode: "follow_global",
      proxy_url: null,
    }
    renderPopover({
      conversationId: null,
      draftConfig,
      onDraftConfigChange,
      connectionKey: "draft-tab",
    })

    await user.click(
      screen.getByRole("button", { name: "Conversation settings" })
    )
    await user.click(
      await screen.findByRole("button", { name: /Network proxy/ })
    )
    await user.click(screen.getByRole("button", { name: /Direct connection/ }))

    await waitFor(() =>
      expect(onDraftConfigChange).toHaveBeenCalledWith({
        ...draftConfig,
        proxy_mode: "direct",
      })
    )
    expect(mocks.reapplyConfig).toHaveBeenCalledWith("draft-tab", {
      ...draftConfig,
      proxy_mode: "direct",
    })
  })

  it("shows an accessible validation error for an empty custom proxy", async () => {
    const user = userEvent.setup()
    renderPopover()

    await user.click(
      screen.getByRole("button", { name: "Conversation settings" })
    )
    await user.click(
      await screen.findByRole("button", { name: /Network proxy/ })
    )
    await user.click(screen.getByRole("button", { name: "Apply proxy" }))

    const input = screen.getByLabelText("Custom proxy")
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByText("Enter a proxy address.")).toBeInTheDocument()
    expect(mocks.updateConversationConfig).not.toHaveBeenCalled()
  })
})
