"""Versioned initial schema and additive upgrades for local databases."""
from sqlalchemy import inspect, text
from .database import engine, Base

def migrate():
    with engine.begin() as connection:
        if engine.dialect.name == 'postgresql': connection.execute(text('CREATE EXTENSION IF NOT EXISTS vector'))
        connection.execute(text('CREATE TABLE IF NOT EXISTS schema_versions (version INTEGER PRIMARY KEY)'))
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        columns = {c['name'] for c in inspect(connection).get_columns('chunks')}
        if 'embedding_model' not in columns:
            connection.execute(text("ALTER TABLE chunks ADD COLUMN embedding_model VARCHAR NOT NULL DEFAULT 'local:feature-hash-256'"))
        eval_columns = {c['name'] for c in inspect(connection).get_columns('eval_runs')}
        if 'method' not in eval_columns:
            connection.execute(text("ALTER TABLE eval_runs ADD COLUMN method VARCHAR NOT NULL DEFAULT 'extractive retrieval smoke test'"))
        doc_columns = {c['name'] for c in inspect(connection).get_columns('documents')}
        if 'processing_at' not in doc_columns:
            connection.execute(text('ALTER TABLE documents ADD COLUMN processing_at FLOAT DEFAULT 0'))
        user_columns={c['name'] for c in inspect(connection).get_columns('users')}
        for field,kind,default in [('avatar_url','TEXT',"''"),('bio','TEXT',"''"),('company','VARCHAR',"''"),('google_sub','VARCHAR','NULL')]:
            if field not in user_columns: connection.execute(text(f'ALTER TABLE users ADD COLUMN {field} {kind} DEFAULT {default}'))
        conversation_columns={c['name'] for c in inspect(connection).get_columns('conversations')}
        if 'workflow_state' not in conversation_columns:
            connection.execute(text("ALTER TABLE conversations ADD COLUMN workflow_state JSON DEFAULT '{}'"))
        connection.execute(text('CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique ON users (google_sub)'))
        if engine.dialect.name == 'postgresql':
            connection.execute(text('CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops)'))
            connection.execute(text("CREATE INDEX IF NOT EXISTS chunks_search_gin ON chunks USING gin (to_tsvector('english', content))"))
        connection.execute(text('INSERT INTO schema_versions (version) VALUES (1) ON CONFLICT (version) DO NOTHING'))
        connection.execute(text('INSERT INTO schema_versions (version) VALUES (2) ON CONFLICT (version) DO NOTHING'))

if __name__ == '__main__':
    migrate()
    print('AgentForge schema version 1 applied.')
