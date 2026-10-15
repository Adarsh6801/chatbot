import asyncio
import hashlib
import hmac
import json
import time
import httpx
from services.api.providers import embeddings
from services.api.rag import embed, generate_stream
from services.api.security import rate_limit
from services.api.database import Session, Bot, Conversation, Message, User
from fastapi import HTTPException
import pytest

def mock_client(monkeypatch, handler):
    original=httpx.AsyncClient
    transport=httpx.MockTransport(handler)
    monkeypatch.setattr(httpx,'AsyncClient',lambda *a,**kw:original(transport=transport))

def test_openai_embeddings_request_and_sorting(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY','test-key')
    def handler(request):
        payload=json.loads(request.content)
        assert payload['dimensions']==256
        assert payload['input']==['first','second']
        return httpx.Response(200,json={'data':[{'index':1,'embedding':[2.0]*256},{'index':0,'embedding':[1.0]*256}]})
    mock_client(monkeypatch,handler)
    vectors=asyncio.run(embeddings(['first','second'],'openai:text-embedding-3-small'))
    assert vectors[0][0]==1 and vectors[1][0]==2

def test_provider_streams_token_events_and_reports_usage(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY','test-key')
    def handler(request):
        payload=json.loads(request.content)
        assert payload['stream'] is True and payload['stream_options']['include_usage'] is True
        data='data: '+json.dumps({'choices':[{'delta':{'content':'Hello '}}]})+'\n\n'
        data+='data: '+json.dumps({'choices':[{'delta':{'content':'[1]'}}]})+'\n\n'
        data+='data: '+json.dumps({'choices':[],'usage':{'total_tokens':12,'prompt_tokens':10,'completion_tokens':2},'model':'test-model'})+'\n\n'
        data+='data: [DONE]\n\n'
        return httpx.Response(200,text=data,headers={'content-type':'text/event-stream'})
    mock_client(monkeypatch,handler)
    async def collect(): return [item async for item in generate_stream('test',[],'Be concise.',[])]
    events=asyncio.run(collect())
    assert events[:2]==[('token','Hello '),('token','[1]')]
    assert events[-1][1]['tokens']==12 and events[-1][1]['cost']>0

def test_provider_failure_does_not_emit_fabricated_answer(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY','test-key')
    monkeypatch.delenv('ANTHROPIC_API_KEY',raising=False)
    mock_client(monkeypatch,lambda request:httpx.Response(503,json={'error':'unavailable'}))
    async def collect(): return [item async for item in generate_stream('test',[],'',[])]
    with pytest.raises(httpx.HTTPStatusError): asyncio.run(collect())

def test_anthropic_fallback_only_before_any_openai_token(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY','test-key')
    monkeypatch.setenv('ANTHROPIC_API_KEY','fallback-key')
    def handler(request):
        if request.url.host=='api.openai.com': return httpx.Response(503)
        return httpx.Response(200,text='data: {"type":"message_start","message":{"model":"fallback","usage":{"input_tokens":3}}}\n\ndata: {"type":"content_block_delta","delta":{"text":"Fallback [1]"}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":2}}\n\n')
    mock_client(monkeypatch,handler)
    async def collect(): return [item async for item in generate_stream('test',[],'',[])]
    events=asyncio.run(collect())
    assert events[0]==('token','Fallback [1]')
    assert events[-1][1]['model']=='fallback' and events[-1][1]['tokens']==5

def test_shared_rate_limit_is_atomic(client):
    with Session() as db:
        rate_limit(db,'unique-key',limit=2)
        rate_limit(db,'unique-key',limit=2)
        with pytest.raises(HTTPException) as error: rate_limit(db,'unique-key',limit=2)
        assert error.value.status_code==429

def test_monthly_message_quota_counts_all_agents(owner,bot):
    with Session() as db:
        agent=db.get(Bot,bot['id'])
        c=Conversation(bot_id=agent.id,visitor_id='fixture-visitor')
        db.add(c);db.flush()
        db.add_all([Message(bot_id=agent.id,conversation_id=c.id,role='user',content='test') for _ in range(100)])
        db.commit()
    response=owner.post('/api/v1/chat/'+bot['public_key'],json={'message':'hello','visitor_id':'fixture-visitor'})
    assert response.status_code==429

def test_signed_stripe_webhook_is_idempotent(owner,monkeypatch):
    pytest.importorskip('stripe')
    secret='whsec_test'
    monkeypatch.setenv('STRIPE_WEBHOOK_SECRET',secret)
    user=owner.get('/api/v1/auth/me').json()
    event={'id':'evt_test_123','type':'checkout.session.completed','data':{'object':{'client_reference_id':user['id'],'payment_status':'paid','customer':'cus_test','subscription':'sub_test','metadata':{'plan':'pro'}}}}
    raw=json.dumps(event).encode();timestamp=int(time.time())
    signature=hmac.new(secret.encode(),str(timestamp).encode()+b'.'+raw,hashlib.sha256).hexdigest()
    headers={'stripe-signature':f't={timestamp},v1={signature}'}
    assert owner.post('/api/v1/webhooks/stripe',content=raw,headers=headers).status_code==200
    assert owner.post('/api/v1/webhooks/stripe',content=raw,headers=headers).status_code==200
    assert owner.get('/api/v1/auth/me').json()['plan']=='pro'
    assert owner.post('/api/v1/webhooks/stripe',content=raw,headers={'stripe-signature':'bad'}).status_code==400

def test_oauth_unconfigured_and_invalid_state(client):
    assert client.get('/api/v1/auth/config').json()['google_enabled'] is False
    assert client.get('/api/v1/auth/google/start',follow_redirects=False).status_code==503
    assert client.get('/api/v1/auth/google/callback?code=fake&state=fake').status_code==400

def test_dashboard_preview_allows_credentialed_cors(owner,bot):
    response=owner.post('/api/v1/chat/'+bot['public_key'],json={'message':'test','visitor_id':'fixture-visitor'},headers={'origin':'http://localhost:3000'})
    assert response.headers['access-control-allow-origin']=='http://localhost:3000'
    assert response.headers['access-control-allow-credentials']=='true'

def test_corrupt_zip_upload_is_a_validation_error(owner,bot):
    response=owner.post(f'/api/v1/bots/{bot["id"]}/documents/upload',files={'file':('bad.docx',b'PKbad archive')})
    assert response.status_code==422
