import os
os.environ['DATABASE_URL'] = os.getenv('TEST_DATABASE_URL', 'sqlite:///:memory:')
os.environ.pop('OPENAI_API_KEY', None)
os.environ.pop('COHERE_API_KEY', None)
os.environ.pop('REDIS_URL', None)
os.environ['EMBEDDING_PROVIDER'] = 'local'
os.environ['EVAL_PROVIDER'] = 'local'

import pytest
from fastapi.testclient import TestClient
from services.api.main import app
from services.api.database import Base, engine

@pytest.fixture
def client():
    Base.metadata.drop_all(engine)
    with TestClient(app) as client:
        client.headers['X-AgentForge-Client'] = 'dashboard'
        yield client

@pytest.fixture
def owner(client):
    response = client.post('/api/v1/auth/register', json={'email':'owner@example.com','name':'Owner','password':'secure-password-123'})
    assert response.status_code == 201
    return client

@pytest.fixture
def bot(owner):
    response = owner.post('/api/v1/bots', json={'name':'Support','description':'A support assistant'})
    assert response.status_code == 201
    return response.json()
