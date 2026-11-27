"""Versioned initial schema and additive upgrades for local databases."""
from sqlalchemy import inspect, text
from .database import engine, Base, Session, Bot, AgentVersion, AppSetting, DocumentationCategory, DocumentationPage, now

def migrate():
    lock_conn = None
    if engine.dialect.name == 'postgresql':
        lock_conn = engine.connect()
        lock_conn.execute(text('SELECT pg_advisory_lock(48151623)'))
        lock_conn.commit()
    try:
        _run_migrations()
    finally:
        if lock_conn is not None:
            try:
                lock_conn.execute(text('SELECT pg_advisory_unlock(48151623)'))
                lock_conn.commit()
            finally:
                lock_conn.close()


def _run_migrations():
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
        if 'is_active' not in user_columns: connection.execute(text('ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1'))
        if 'razorpay_subscription_id' not in user_columns: connection.execute(text('ALTER TABLE users ADD COLUMN razorpay_subscription_id VARCHAR'))
        if 'billing_provider' not in user_columns: connection.execute(text("ALTER TABLE users ADD COLUMN billing_provider VARCHAR NOT NULL DEFAULT 'stripe'"))
        for field, kind, default in [('free_started_at','VARCHAR','NULL'),('free_trial_used','INTEGER','0'),('topup_tokens','INTEGER','0'),('subscription_tokens','INTEGER','0')]:
            if field not in user_columns: connection.execute(text(f'ALTER TABLE users ADD COLUMN {field} {kind} NOT NULL DEFAULT {default}' if default != 'NULL' else f'ALTER TABLE users ADD COLUMN {field} {kind}'))
        payment_columns={c['name'] for c in inspect(connection).get_columns('payments')}
        if 'kind' not in payment_columns: connection.execute(text("ALTER TABLE payments ADD COLUMN kind VARCHAR NOT NULL DEFAULT 'subscription'"))
        if 'tokens' not in payment_columns: connection.execute(text('ALTER TABLE payments ADD COLUMN tokens INTEGER'))
        token_usage_columns={c['name'] for c in inspect(connection).get_columns('token_usage')}
        if 'subscription_tokens' not in token_usage_columns: connection.execute(text('ALTER TABLE token_usage ADD COLUMN subscription_tokens INTEGER NOT NULL DEFAULT 0'))
        if 'topup_tokens' not in token_usage_columns: connection.execute(text('ALTER TABLE token_usage ADD COLUMN topup_tokens INTEGER NOT NULL DEFAULT 0'))
        connection.execute(text("UPDATE users SET free_started_at = created_at, free_trial_used = 1 WHERE free_started_at IS NULL AND free_trial_used = 0"))
        connection.execute(text("UPDATE users SET subscription_tokens = CASE plan WHEN 'pro' THEN 10000000 WHEN 'team' THEN 50000000 ELSE 100000 END WHERE subscription_tokens = 0"))
        conversation_columns={c['name'] for c in inspect(connection).get_columns('conversations')}
        if 'workflow_state' not in conversation_columns:
            connection.execute(text("ALTER TABLE conversations ADD COLUMN workflow_state JSON DEFAULT '{}'"))
        if 'user_id' not in conversation_columns:
            connection.execute(text('ALTER TABLE conversations ADD COLUMN user_id VARCHAR'))
        if 'user_name' not in conversation_columns:
            connection.execute(text('ALTER TABLE conversations ADD COLUMN user_name VARCHAR'))
        connection.execute(text('CREATE INDEX IF NOT EXISTS ix_conversations_user_id ON conversations (user_id)'))
        bot_columns={c['name'] for c in inspect(connection).get_columns('bots')}
        if 'published_config' not in bot_columns:
            connection.execute(text('ALTER TABLE bots ADD COLUMN published_config JSON'))
        connection.execute(text('CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique ON users (google_sub)'))
        if engine.dialect.name == 'postgresql':
            connection.execute(text('CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops)'))
            connection.execute(text("CREATE INDEX IF NOT EXISTS chunks_search_gin ON chunks USING gin (to_tsvector('english', content))"))
        connection.execute(text('INSERT INTO schema_versions (version) VALUES (1) ON CONFLICT (version) DO NOTHING'))
        connection.execute(text('INSERT INTO schema_versions (version) VALUES (2) ON CONFLICT (version) DO NOTHING'))
        connection.execute(text('INSERT INTO schema_versions (version) VALUES (3) ON CONFLICT (version) DO NOTHING'))
        connection.execute(text('INSERT INTO schema_versions (version) VALUES (4) ON CONFLICT (version) DO NOTHING'))
        connection.execute(text('INSERT INTO schema_versions (version) VALUES (5) ON CONFLICT (version) DO NOTHING'))
        connection.execute(text('INSERT INTO schema_versions (version) VALUES (6) ON CONFLICT (version) DO NOTHING'))
        connection.execute(text('INSERT INTO schema_versions (version) VALUES (7) ON CONFLICT (version) DO NOTHING'))
        connection.execute(text('INSERT INTO schema_versions (version) VALUES (8) ON CONFLICT (version) DO NOTHING'))
        connection.execute(text('INSERT INTO schema_versions (version) VALUES (9) ON CONFLICT (version) DO NOTHING'))
        connection.execute(text('INSERT INTO schema_versions (version) VALUES (10) ON CONFLICT (version) DO NOTHING'))
        connection.execute(text('INSERT INTO schema_versions (version) VALUES (11) ON CONFLICT (version) DO NOTHING'))
        connection.execute(text('INSERT INTO schema_versions (version) VALUES (12) ON CONFLICT (version) DO NOTHING'))
    with Session() as db:
        from .site_bot_seed import ensure_site_bot_seeded
        from .site_pages import ensure_site_pages_seeded
        ensure_site_bot_seeded(db)
        ensure_site_pages_seeded(db)
        if not db.get(AppSetting, 'documentation_seed_v1'):
            from .documentation_content import DEFAULT_DOCUMENTATION
            for section in DEFAULT_DOCUMENTATION:
                category = DocumentationCategory(title=section['title'], slug=section['slug'], description=section['description'], position=section['position'])
                db.add(category)
                db.flush()
                for page in section['pages']:
                    db.add(DocumentationPage(category_id=category.id, title=page['title'], slug=page['slug'], summary=page['summary'], content=page['content'], status='published', position=page['position']))
            db.add(AppSetting(key='documentation_seed_v1', value='seeded', updated_at=now()))
        for bot in db.query(Bot).all():
            widget = dict(bot.widget_config or {})
            for key, value in {'color':'#d6ff63','position':'right','greeting':'Hi! What can I help you find?','logo':'','launcher_icon':'sparkle'}.items(): widget.setdefault(key,value)
            snapshot = {'name': bot.name, 'description': bot.description or '', 'system_prompt': bot.system_prompt or '', 'threshold': bot.threshold, 'widget_config': widget}
            if bot.published_config is None: bot.published_config = snapshot
            if bot.published and not db.query(AgentVersion).filter_by(bot_id=bot.id, kind='major').count():
                db.add(AgentVersion(bot_id=bot.id, created_by=bot.user_id, major=1, minor=0, kind='major', snapshot=bot.published_config or snapshot))
        db.commit()

if __name__ == '__main__':
    migrate()
    print('AgentForge schema version 10 applied.')
