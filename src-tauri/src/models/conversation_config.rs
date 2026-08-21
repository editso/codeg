use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Stable reference to one MCP configuration from the unified local catalog.
/// The spec itself (which may contain headers or environment variables) stays
/// in the existing MCP store and is never copied into a conversation row.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ConversationMcpRef {
    pub id: String,
    pub fingerprint: String,
}

/// Persisted, explicit session-level overrides. `model_provider_id: None`
/// means follow the agent default; MCP refs are additions only — the agent's
/// own native MCP configuration is left untouched.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationConfigInfo {
    pub conversation_id: i32,
    pub model_provider_id: Option<i32>,
    pub additional_mcp_refs: Vec<ConversationMcpRef>,
    /// Values selected from ACP session config selectors (including model and
    /// reasoning controls), keyed by the agent-provided config id.
    pub session_config_values: BTreeMap<String, String>,
    pub version: i32,
    pub updated_at: DateTime<Utc>,
}

/// A save is compare-and-swap by version so two open views cannot silently
/// overwrite each other's selections.
#[derive(Debug, Clone, Deserialize)]
pub struct ConversationConfigUpdate {
    pub model_provider_id: Option<i32>,
    pub additional_mcp_refs: Vec<ConversationMcpRef>,
    pub session_config_values: BTreeMap<String, String>,
    pub expected_version: i32,
}

/// Launch-only overrides for a new-conversation draft that has not created its
/// database row yet. The frontend persists this small reference set per draft
/// tab, passes it to ACP connect, then writes it into the real conversation
/// configuration together with the first selector snapshot.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DraftConversationConfig {
    pub model_provider_id: Option<i32>,
    pub additional_mcp_refs: Vec<ConversationMcpRef>,
}

/// Safe display metadata for a candidate in the unified MCP catalog. The
/// canonical MCP spec deliberately remains server-side because it can contain
/// credentials in stdio env fields or HTTP headers.
#[derive(Debug, Clone, Serialize)]
pub struct ConversationMcpCandidate {
    pub id: String,
    pub fingerprint: String,
    pub source_apps: Vec<String>,
    /// This exact `{ id, fingerprint }` is already loaded from the current
    /// agent's native MCP configuration. It is displayed as selected but never
    /// appended again through ACP.
    pub native: bool,
    /// False when this candidate has the same server name as a different native
    /// MCP spec. ACP requires names to be unique, so such a variant cannot be
    /// appended safely without changing either configuration.
    pub appendable: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConversationMcpCatalog {
    pub candidates: Vec<ConversationMcpCandidate>,
    /// False only where the agent cannot receive any MCP entries over ACP, so
    /// a session-level addition would have no effect.
    pub supports_session_additions: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConversationConfigView {
    pub config: ConversationConfigInfo,
    pub mcp_catalog: ConversationMcpCatalog,
}
