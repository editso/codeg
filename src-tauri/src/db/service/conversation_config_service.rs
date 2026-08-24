use chrono::Utc;
use sea_orm::{
    sea_query::Expr, ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
    Set,
};

use crate::db::entities::conversation_config;
use crate::db::error::DbError;

pub async fn get(
    conn: &DatabaseConnection,
    conversation_id: i32,
) -> Result<Option<conversation_config::Model>, DbError> {
    Ok(conversation_config::Entity::find_by_id(conversation_id)
        .one(conn)
        .await?)
}

/// Persist a full replacement only when the caller still owns `expected_version`.
/// Version 0 represents the implicit empty configuration before a row exists.
pub async fn save(
    conn: &DatabaseConnection,
    conversation_id: i32,
    model_provider_id: Option<i32>,
    additional_mcp_refs_json: String,
    session_config_values_json: String,
    proxy_mode: String,
    proxy_url: Option<String>,
    expected_version: i32,
) -> Result<conversation_config::Model, DbError> {
    let current = get(conn, conversation_id).await?;
    let now = Utc::now();
    match current {
        Some(current) => {
            if current.version != expected_version {
                return Err(DbError::Conflict(format!(
                    "conversation config version conflict: expected {expected_version}, current {}",
                    current.version
                )));
            }
            let next_version = expected_version.checked_add(1).ok_or_else(|| {
                DbError::Validation("conversation config version cannot be incremented".to_string())
            })?;
            let result = conversation_config::Entity::update_many()
                .col_expr(
                    conversation_config::Column::ModelProviderId,
                    Expr::value(model_provider_id),
                )
                .col_expr(
                    conversation_config::Column::AdditionalMcpRefsJson,
                    Expr::value(additional_mcp_refs_json),
                )
                .col_expr(
                    conversation_config::Column::SessionConfigValuesJson,
                    Expr::value(session_config_values_json),
                )
                .col_expr(
                    conversation_config::Column::ProxyMode,
                    Expr::value(proxy_mode),
                )
                .col_expr(
                    conversation_config::Column::ProxyUrl,
                    Expr::value(proxy_url),
                )
                .col_expr(
                    conversation_config::Column::Version,
                    Expr::value(next_version),
                )
                .col_expr(
                    conversation_config::Column::UpdatedAt,
                    Expr::value(now),
                )
                .filter(conversation_config::Column::ConversationId.eq(conversation_id))
                .filter(conversation_config::Column::Version.eq(expected_version))
                .exec(conn)
                .await?;
            if result.rows_affected != 1 {
                return Err(DbError::Conflict(format!(
                    "conversation config version conflict: expected {expected_version}"
                )));
            }
            get(conn, conversation_id).await?.ok_or_else(|| {
                DbError::NotFound(format!("conversation config not found: {conversation_id}"))
            })
        }
        None => {
            if expected_version != 0 {
                return Err(DbError::Conflict(format!(
                    "conversation config version conflict: expected {expected_version}, current 0"
                )));
            }
            let active = conversation_config::ActiveModel {
                conversation_id: Set(conversation_id),
                model_provider_id: Set(model_provider_id),
                additional_mcp_refs_json: Set(additional_mcp_refs_json),
                session_config_values_json: Set(session_config_values_json),
                proxy_mode: Set(proxy_mode),
                proxy_url: Set(proxy_url),
                version: Set(1),
                created_at: Set(now),
                updated_at: Set(now),
            };
            match active.insert(conn).await {
                Ok(row) => Ok(row),
                Err(error) => {
                    if get(conn, conversation_id).await?.is_some() {
                        Err(DbError::Conflict(format!(
                            "conversation config version conflict: expected {expected_version}, current changed"
                        )))
                    } else {
                        Err(DbError::Database(error))
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::{fresh_in_memory_db, seed_conversation, seed_folder};
    use crate::models::AgentType;

    #[tokio::test]
    async fn persists_and_replaces_conversation_proxy_fields() {
        let db = fresh_in_memory_db().await;
        let folder_id = seed_folder(&db, "/tmp/conversation-proxy").await;
        let conversation_id = seed_conversation(&db, folder_id, AgentType::Codex).await;

        let created = save(
            &db.conn,
            conversation_id,
            None,
            "[]".to_string(),
            "{}".to_string(),
            "custom".to_string(),
            Some("http://127.0.0.1:7890".to_string()),
            0,
        )
        .await
        .expect("insert conversation proxy config");
        assert_eq!(created.proxy_mode, "custom");
        assert_eq!(
            created.proxy_url.as_deref(),
            Some("http://127.0.0.1:7890")
        );
        assert_eq!(created.version, 1);

        let updated = save(
            &db.conn,
            conversation_id,
            None,
            "[]".to_string(),
            "{}".to_string(),
            "direct".to_string(),
            None,
            created.version,
        )
        .await
        .expect("replace conversation proxy config");
        assert_eq!(updated.proxy_mode, "direct");
        assert!(updated.proxy_url.is_none());
        assert_eq!(updated.version, 2);
    }
}
