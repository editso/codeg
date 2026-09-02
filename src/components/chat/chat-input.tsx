"use client"

import type { ConversationFolderPickerOverride } from "@/components/chat/conversation-context-bar"
import { memo } from "react"
import { useTranslations } from "next-intl"
import type {
  AgentType,
  ConnectionStatus,
  DraftConversationConfig,
  PromptCapabilitiesInfo,
  PromptDraft,
  PromptInputBlock,
  SessionConfigOptionInfo,
  SessionModeInfo,
  AvailableCommandInfo,
} from "@/lib/types"
import type { QueuedMessage } from "@/hooks/use-message-queue"
import {
  MessageInput,
  type ComposerInjectContent,
} from "@/components/chat/message-input"
import { MessageQueueDisplay } from "@/components/chat/message-queue-display"
import { cn } from "@/lib/utils"

interface ChatInputProps {
  status: ConnectionStatus | null
  /** Whether a missing connection is expected to be created for this
   *  composer. Drafts without a working directory (or blocked agent setup)
   *  should remain in their normal editable state instead of showing a wait
   *  mask for `status=null`. */
  connectionExpected?: boolean
  promptCapabilities: PromptCapabilitiesInfo
  defaultPath?: string
  agentName?: string
  onFocus?: () => void
  onSend: (draft: PromptDraft, modeId?: string | null) => void
  onCancel: () => void
  modes?: SessionModeInfo[]
  configOptions?: SessionConfigOptionInfo[]
  modeLoading?: boolean
  configOptionsLoading?: boolean
  selectorsLoading?: boolean
  selectedModeId?: string | null
  onModeChange?: (modeId: string) => void
  onConfigOptionChange?: (configId: string, valueId: string) => void
  agentType?: AgentType | null
  conversationId?: number | null
  draftConversationConfig?: DraftConversationConfig | null
  onDraftConversationConfigChange?: (config: DraftConversationConfig) => void
  availableCommands?: AvailableCommandInfo[] | null
  attachmentTabId?: string | null
  /** Pass-through: see `MessageInput`. */
  folderPickerOverride?: ConversationFolderPickerOverride
  draftStorageKey?: string | null
  isActive?: boolean
  /** Show the composer's flowing active-session border. Set only for the active
   *  tab when tiled across multiple sessions; passed through to MessageInput. */
  showActiveFlow?: boolean
  queue?: QueuedMessage[]
  onEnqueue?: (draft: PromptDraft, modeId: string | null) => void
  onQueueReorder?: (items: QueuedMessage[]) => void
  onQueueEdit?: (id: string) => void
  onQueueDelete?: (id: string) => void
  editingItemId?: string | null
  editingDraftText?: string | null
  editingDraftBlocks?: PromptInputBlock[] | null
  isEditingQueueItem?: boolean
  onSaveQueueEdit?: (draft: PromptDraft) => void
  onCancelQueueEdit?: () => void
  onForkSend?: (draft: PromptDraft, modeId?: string | null) => void
  /** Inject the draft's text into the RUNNING turn over the native steering
   *  channel. Present only when the session's live-feedback channel is native
   *  (`useSessionFeedback().channel === "native"`); resolves once recorded,
   *  rejects on any failure (incl. the turn-end race) so MessageInput can run
   *  its own enqueue fallback / draft preservation. */
  onSteer?: (text: string) => Promise<void>
  onAddFeedback?: () => void
  feedbackAddDisabled?: boolean
  /**
   * Keep the composer usable even while disconnected. Set for a folderless chat
   * draft: it has no working dir yet (so it never auto-connects), and the FIRST
   * send is precisely what lazily creates its conversation + scratch dir and
   * triggers the connection. Without this the composer would be permanently
   * disabled and the chat could never be started.
   */
  allowOfflineCompose?: boolean
  injectContent?: ComposerInjectContent | null
  onInjectConsumed?: () => void
  /** Drop the input's own horizontal padding when an ancestor already supplies
   *  the gutter (the welcome column wraps this in its own `px-4`). */
  flush?: boolean
}

export const ChatInput = memo(function ChatInput({
  status,
  connectionExpected = true,
  promptCapabilities,
  defaultPath,
  agentName,
  onFocus,
  onSend,
  onCancel,
  modes,
  configOptions,
  modeLoading = false,
  configOptionsLoading = false,
  selectorsLoading = false,
  selectedModeId,
  onModeChange,
  onConfigOptionChange,
  agentType,
  conversationId,
  draftConversationConfig,
  onDraftConversationConfigChange,
  availableCommands,
  attachmentTabId,
  folderPickerOverride,
  draftStorageKey,
  isActive,
  showActiveFlow,
  queue,
  onEnqueue,
  onQueueReorder,
  onQueueEdit,
  onQueueDelete,
  editingItemId,
  editingDraftText,
  editingDraftBlocks,
  isEditingQueueItem,
  onSaveQueueEdit,
  onCancelQueueEdit,
  onForkSend,
  onSteer,
  onAddFeedback,
  feedbackAddDisabled,
  allowOfflineCompose = false,
  injectContent,
  onInjectConsumed,
  flush = false,
}: ChatInputProps) {
  const t = useTranslations("Folder.chat.chatInput")
  const isConnected = status === "connected"
  const isPrompting = status === "prompting"
  const isConnecting = status === "connecting"
  // A restart removes the old ACP entry before the replacement is created, so
  // the store briefly exposes `null`; session initialization then keeps the
  // connection interactive while selectors are still loading. Treat all three
  // phases as one visual wait state for the composer. Offline drafts opt out so
  // a brand-new conversation can still be written before its first launch.
  const connectionLoading =
    !allowOfflineCompose &&
    (isConnecting ||
      selectorsLoading ||
      (status === null && connectionExpected))
  // The agent names its slash commands as part of coming up, so until it has
  // the composer's `/` panel shows a loading row rather than refusing to open.
  //
  // `connecting` alone is not the whole wait: the backend emits `connected`
  // EARLY — before session resume/load/new — and only forwards the agent's
  // buffered command list once `selectors_ready` has fired and the conversation
  // loop is running (see `emit_selectors_ready` in acp/connection.rs). Ending
  // the loading state at `connected` would blank the panel again for the whole
  // (often slow) session-init leg. `selectorsLoading` closes exactly that gap
  // and is bounded: `selectors_ready` fires on every establishment path whether
  // or not the agent has any commands, so this can never hang on a spinner.
  const commandsLoading = isConnecting || selectorsLoading

  // The composer docks at the bottom of the message list, but keeps a 20px
  // breathing gap now that the workspace no longer has a bottom status bar.
  // The root layout owns mobile safe-area padding, so this remains a visual
  // gutter rather than a second safe-area inset. The welcome/draft composer
  // (`flush`) shares the same bottom gap while supplying its own px-4 gutter.
  return (
    <div
      className={cn("pt-0", flush ? "pb-5" : "px-4 pb-5")}
      onContextMenu={(event) => event.stopPropagation()}
      // Touch and pen open a context menu from a LONG PRESS, which Radix arms on
      // pointerdown — and the whole conversation panel (composer included) sits
      // inside its own context-menu trigger. Without this, a slow tap on any
      // composer control (the agent icon, the send button, …) pops the
      // conversation menu. Mouse presses keep bubbling, so the panel's
      // selection bookkeeping is untouched; the composer's OWN context menu
      // still arms, since its trigger is nested below this wrapper.
      onPointerDown={(event) => {
        if (event.pointerType !== "mouse") event.stopPropagation()
      }}
    >
      {queue &&
        queue.length > 0 &&
        onQueueReorder &&
        onQueueEdit &&
        onQueueDelete && (
          <MessageQueueDisplay
            queue={queue}
            onReorder={onQueueReorder}
            onEdit={onQueueEdit}
            onDelete={onQueueDelete}
            editingItemId={editingItemId ?? null}
          />
        )}
      <MessageInput
        onSend={onSend}
        promptCapabilities={promptCapabilities}
        onFocus={onFocus}
        defaultPath={defaultPath}
        disabled={
          allowOfflineCompose
            ? false
            : (!isConnected && !isPrompting) || selectorsLoading
        }
        connectionLoading={connectionLoading}
        isPrompting={isPrompting}
        onCancel={onCancel}
        modes={modes}
        configOptions={configOptions}
        modeLoading={modeLoading}
        configOptionsLoading={configOptionsLoading}
        selectedModeId={selectedModeId}
        onModeChange={onModeChange}
        onConfigOptionChange={onConfigOptionChange}
        agentType={agentType}
        conversationId={conversationId}
        draftConversationConfig={draftConversationConfig}
        onDraftConversationConfigChange={onDraftConversationConfigChange}
        availableCommands={availableCommands}
        commandsLoading={commandsLoading}
        attachmentTabId={attachmentTabId}
        folderPickerOverride={folderPickerOverride}
        draftStorageKey={draftStorageKey}
        isActive={isActive}
        showActiveFlow={showActiveFlow}
        onEnqueue={onEnqueue}
        editingItemId={editingItemId}
        editingDraftText={editingDraftText}
        editingDraftBlocks={editingDraftBlocks}
        isEditingQueueItem={isEditingQueueItem}
        onSaveQueueEdit={onSaveQueueEdit}
        onCancelQueueEdit={onCancelQueueEdit}
        onForkSend={onForkSend}
        onSteer={onSteer}
        onAddFeedback={onAddFeedback}
        feedbackAddDisabled={feedbackAddDisabled}
        injectContent={injectContent}
        onInjectConsumed={onInjectConsumed}
        placeholder={
          connectionLoading
            ? t("connecting")
            : isPrompting
              ? t("agentResponding", { agent: agentName ?? "Agent" })
              : t("sendMessage")
        }
        className="min-h-32 max-h-60"
      />
    </div>
  )
})

ChatInput.displayName = "ChatInput"
