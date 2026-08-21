use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(ConversationConfig::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ConversationConfig::ConversationId)
                            .integer()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(ConversationConfig::ModelProviderId).integer().null())
                    .col(
                        ColumnDef::new(ConversationConfig::AdditionalMcpRefsJson)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ConversationConfig::Version)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ConversationConfig::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ConversationConfig::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(ConversationConfig::Table, ConversationConfig::ConversationId)
                            .to(Conversation::Table, Conversation::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(ConversationConfig::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum ConversationConfig {
    Table,
    ConversationId,
    ModelProviderId,
    AdditionalMcpRefsJson,
    Version,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum Conversation {
    Table,
    Id,
}
