use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(ConversationConfig::Table)
                    .add_column(
                        ColumnDef::new(ConversationConfig::ProxyMode)
                            .string()
                            .not_null()
                            .default("follow_global"),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(ConversationConfig::Table)
                    .add_column(ColumnDef::new(ConversationConfig::ProxyUrl).text().null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(ConversationConfig::Table)
                    .drop_column(ConversationConfig::ProxyUrl)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(ConversationConfig::Table)
                    .drop_column(ConversationConfig::ProxyMode)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum ConversationConfig {
    Table,
    ProxyMode,
    ProxyUrl,
}
