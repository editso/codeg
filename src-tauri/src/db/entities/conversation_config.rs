use sea_orm::entity::prelude::*;

/// One optional configuration row per conversation. Keeping it separate from
/// `conversation` makes the override surface extensible without widening the
/// sidebar/list query model.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "conversation_config")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub conversation_id: i32,
    pub model_provider_id: Option<i32>,
    #[sea_orm(column_type = "Text")]
    pub additional_mcp_refs_json: String,
    #[sea_orm(column_type = "Text")]
    pub session_config_values_json: String,
    pub version: i32,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::conversation::Entity",
        from = "Column::ConversationId",
        to = "super::conversation::Column::Id"
    )]
    Conversation,
}

impl Related<super::conversation::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Conversation.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
