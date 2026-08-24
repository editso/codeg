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

/// How one conversation resolves network proxy settings for its agent process
/// and the ACP terminal commands it launches.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConversationProxyMode {
    /// Inherit the process-wide proxy configured in System Settings (or by the
    /// host environment when Codeg has no explicit global proxy).
    #[default]
    FollowGlobal,
    /// Explicitly remove inherited proxy variables for this conversation.
    Direct,
    /// Override the inherited proxy with `proxy_url` for this conversation.
    Custom,
}

impl ConversationProxyMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::FollowGlobal => "follow_global",
            Self::Direct => "direct",
            Self::Custom => "custom",
        }
    }

    pub fn from_stored(value: &str) -> Option<Self> {
        match value {
            "follow_global" => Some(Self::FollowGlobal),
            "direct" => Some(Self::Direct),
            "custom" => Some(Self::Custom),
            _ => None,
        }
    }
}

/// Persisted, explicit session-level overrides. `model_provider_id: None`
/// means follow the agent default; MCP refs are additions only — the agent's
/// own native MCP configuration is left untouched. Proxy fields affect only
/// the process launched for this conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationConfigInfo {
    pub conversation_id: i32,
    pub model_provider_id: Option<i32>,
    pub additional_mcp_refs: Vec<ConversationMcpRef>,
    /// Values selected from ACP session config selectors (including model and
    /// reasoning controls), keyed by the agent-provided config id.
    pub session_config_values: BTreeMap<String, String>,
    pub proxy_mode: ConversationProxyMode,
    pub proxy_url: Option<String>,
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
    /// Missing for an older client preserves the stored proxy choice. New
    /// clients always send an explicit mode as part of the full replacement.
    #[serde(default)]
    pub proxy_mode: Option<ConversationProxyMode>,
    pub proxy_url: Option<String>,
    pub expected_version: i32,
}

/// Launch-only overrides for a new-conversation draft that has not created its
/// database row yet. The frontend persists this reference set per draft tab,
/// passes it to ACP connect, then writes it into the real conversation
/// configuration together with the first selector snapshot.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DraftConversationConfig {
    pub model_provider_id: Option<i32>,
    pub additional_mcp_refs: Vec<ConversationMcpRef>,
    /// Values selected from the live ACP selector surface before the first
    /// prompt creates the conversation row. Missing in older local draft blobs.
    #[serde(default)]
    pub session_config_values: BTreeMap<String, String>,
    /// Missing in drafts written by older frontends follows the global proxy.
    #[serde(default)]
    pub proxy_mode: ConversationProxyMode,
    pub proxy_url: Option<String>,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pre_proxy_update_shape_deserializes_as_preserve_existing() {
        let update: ConversationConfigUpdate = serde_json::from_value(serde_json::json!({
            "model_provider_id": null,
            "additional_mcp_refs": [],
            "session_config_values": {},
            "expected_version": 3
        }))
        .expect("deserialize legacy conversation config update");

        assert!(update.proxy_mode.is_none());
        assert!(update.proxy_url.is_none());
    }
}
