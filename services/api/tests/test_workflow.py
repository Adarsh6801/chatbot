import asyncio
import copy
import json
from types import SimpleNamespace
from urllib.parse import parse_qs,urlparse
import httpx
import pytest
from services.api.workflow import starter,run_graph,validate_graph,render,resolve_json,call_api
from services.api.database import Session,Workflow,User,Conversation
from .test_api import source,ask,events

def node(id,type,config=None): return {'id':id,'type':type,'name':id,'x':100,'y':100,'config':config or {}}
def edge(source,target,label='default'): return {'id':source+label+target,'source':source,'target':target,'label':label}
def answer(response): return ''.join(data['text'] for kind,data in events(response) if kind=='token')
def save(owner,bot,graph):
    r=owner.put(f'/api/v1/bots/{bot["id"]}/workflow',json={'graph':graph})
    assert r.status_code==200,r.text
def publish(owner,bot):
    r=owner.post(f'/api/v1/bots/{bot["id"]}/workflow/publish')
    assert r.status_code==200,r.text

def test_optional_workflow_draft_and_published_runtime(owner,bot):
    source(owner,bot)
    base=f'/api/v1/bots/{bot["id"]}/workflow'
    initial=owner.get(base).json()
    assert initial['enabled'] is False
    graph={'nodes':[node('start','start'),node('reply','message',{'text':'Hello from the published flow.'}),node('end','end')],'edges':[edge('start','reply'),edge('reply','end')]}
    save(owner,bot,graph)
    assert 'thirty days' in ''.join(d['text'] for k,d in events(ask(owner,bot)) if k=='token')
    publish(owner,bot)
    response=events(ask(owner,bot))
    assert any(k=='workflow' for k,d in response)
    assert 'Hello from the published flow.' in ''.join(d['text'] for k,d in response if k=='token')
    graph['nodes'][1]['config']['text']='Unpublished edit'
    save(owner,bot,graph)
    assert 'Unpublished edit' not in ask(owner,bot).text
    owner.patch(base+'/enabled',json={'enabled':False})
    assert 'thirty days' in ask(owner,bot).text

def test_published_knowledge_node_cites_agent_sources(owner,bot):
    source(owner,bot);save(owner,bot,starter());publish(owner,bot)
    data=events(ask(owner,bot))
    assert data[0][1]['citations'][0]['source']=='Refund policy'
    assert not data[-1][1]['abstained']

def test_intent_capture_condition_and_conversation_resume(owner,bot):
    graph={'nodes':[node('start','start'),node('intent','intent',{'intents':[{'id':'support','name':'Support','examples':['support','help']}]}),node('capture','capture',{'variable':'email','validation':'email','prompt':'What is your email?'}),node('condition','condition',{'variable':'email','operator':'contains','value':'@'}),node('reply','message',{'text':'We will contact {{email}}.'}),node('fallback','message',{'text':'Ask me a knowledge question.'}),node('end','end')], 'edges':[edge('start','intent'),edge('intent','capture','support'),edge('intent','fallback'),edge('capture','condition'),edge('condition','reply','true'),edge('condition','fallback','false'),edge('reply','end'),edge('fallback','end')]}
    save(owner,bot,graph);publish(owner,bot)
    first=events(ask(owner,bot,'I need support'))
    conv=first[0][1]['conversation_id']
    assert 'What is your email?' in ''.join(d['text'] for k,d in first if k=='token')
    assert 'valid email' in answer(ask(owner,bot,'not-an-email',conversation_id=conv))
    final=ask(owner,bot,'visitor@example.com',conversation_id=conv)
    assert 'We will contact visitor@example.com.' in answer(final)
    with Session() as db:
        state=db.get(Conversation,conv).workflow_state
        assert state['variables']['email']=='visitor@example.com' and 'awaiting' not in state

def test_publish_validation_rejects_broken_paths_and_cycles(owner,bot):
    base=f'/api/v1/bots/{bot["id"]}/workflow'
    graph=starter();graph['edges']=[];save(owner,bot,graph)
    assert owner.post(base+'/publish').status_code==422
    graph=starter();graph['edges'].append(edge('knowledge','start','loop'));save(owner,bot,graph)
    assert owner.post(base+'/publish').status_code==422

def test_workflow_is_owner_scoped_and_csrf_protected(owner,bot):
    from fastapi.testclient import TestClient
    from services.api.main import app
    base=f'/api/v1/bots/{bot["id"]}/workflow'
    with TestClient(app) as other:
        other.headers['X-AgentForge-Client']='dashboard'
        other.post('/api/v1/auth/register',json={'email':'other@example.com','password':'secure-password-123'})
        assert other.get(base).status_code==404
        assert other.put(base,json={'graph':starter()}).status_code==404
        assert other.post(base+'/test',json={'message':'hello'}).status_code==404
    assert owner.put(base,json={'graph':starter()},headers={'origin':'https://evil.example'}).status_code==403

def test_api_node_executes_and_maps_json_into_answer(owner,bot,monkeypatch):
    calls=[]
    async def fake(config,variables):
        calls.append((config,variables.copy()))
        return {'status':200,'data':{'status':'shipped','order':variables['order_id']}}
    monkeypatch.setattr('services.api.workflow.call_api',fake)
    graph={'nodes':[node('start','start'),node('capture','capture',{'variable':'order_id','prompt':'Your order number?'}),node('api','api',{'url':'https://orders.example.com/{{order_id}}','variable':'order'}),node('reply','message',{'text':'Order {{order_id}} is {{order.data.status}}.'}),node('end','end')],'edges':[edge('start','capture'),edge('capture','api'),edge('api','reply'),edge('reply','end')]}
    save(owner,bot,graph);publish(owner,bot)
    initial=events(ask(owner,bot,'Track my order'));conv=initial[0][1]['conversation_id']
    response=ask(owner,bot,'ORD123',conversation_id=conv)
    assert 'Order ORD123 is shipped.' in answer(response)
    assert len(calls)==1

def test_api_failure_uses_connected_knowledge_fallback(owner,bot,monkeypatch):
    source(owner,bot)
    async def failure(*a): raise httpx.ConnectError('private detail')
    monkeypatch.setattr('services.api.workflow.call_api',failure)
    graph={'nodes':[node('start','start'),node('api','api',{'url':'https://orders.example.com'}),node('reply','message',{'text':'Done.'}),node('knowledge','knowledge',{'query':'{{message}}'}),node('end','end')],'edges':[edge('start','api'),edge('api','reply'),edge('api','knowledge','error'),edge('reply','end'),edge('knowledge','end')]}
    save(owner,bot,graph);publish(owner,bot)
    response=ask(owner,bot)
    assert 'thirty days' in response.text and 'private detail' not in response.text

def test_integration_authorization_is_encrypted_and_redacted(owner,bot,monkeypatch):
    from cryptography.fernet import Fernet
    monkeypatch.setenv('WORKFLOW_ENCRYPTION_KEY',Fernet.generate_key().decode())
    graph={'nodes':[node('start','start'),node('api','api',{'url':'https://orders.example.com','authorization':'Bearer sensitive-test-token'}),node('end','end')],'edges':[edge('start','api'),edge('api','end')]}
    save(owner,bot,graph)
    data=owner.get(f'/api/v1/bots/{bot["id"]}/workflow').json()
    assert 'sensitive-test-token' not in json.dumps(data)
    assert data['graph']['nodes'][1]['config']['has_authorization']
    with Session() as db:
        stored=db.query(Workflow).filter_by(bot_id=bot['id']).one()
        assert 'sensitive-test-token' not in json.dumps(stored.draft)
    save(owner,bot,data['graph'])
    assert owner.get(f'/api/v1/bots/{bot["id"]}/workflow').json()['graph']['nodes'][1]['config']['has_authorization']

def test_private_api_targets_are_blocked():
    with pytest.raises(ValueError,match='Private'):
        asyncio.run(call_api({'url':'http://127.0.0.1/secrets'},{}))
    assert render('https://example.com/{{value}}',{'value':'../?secret=x'},url=True)=='https://example.com/..%2F%3Fsecret%3Dx'
    assert resolve_json({'amount':'{{amount}}'}, {'amount':3})=={'amount':3}

def test_api_transport_pins_dns_and_preserves_json_types(monkeypatch):
    monkeypatch.setattr('services.api.workflow.socket.getaddrinfo',lambda *a:[(2,1,6,'',('93.184.216.34',443))])
    original=httpx.AsyncClient
    def handler(request):
        assert request.url.host=='93.184.216.34'
        assert request.headers['host']=='orders.example.com'
        assert json.loads(request.content)=={'order':123,'email':'visitor@example.com'}
        return httpx.Response(200,json={'status':'shipped'})
    transport=httpx.MockTransport(handler)
    monkeypatch.setattr(httpx,'AsyncClient',lambda *a,**kw:original(transport=transport))
    result=asyncio.run(call_api({'url':'https://orders.example.com/orders/{{order}}','method':'POST','body':{'order':'{{order}}','email':'{{email}}'}},{'order':123,'email':'visitor@example.com'}))
    assert result=={'status':200,'data':{'status':'shipped'}}

def test_knowledge_provider_failure_returns_a_failed_step():
    async def failing(query): raise httpx.ConnectError('internal provider detail')
    result=asyncio.run(run_graph(starter(),'refund policy',{},failing))
    assert result['abstained'] and result['trace'][1]['status']=='failed'
    assert 'internal provider detail' not in result['answer']

def test_profile_updates_and_logout_invalidates_session(owner):
    before=owner.get('/api/v1/auth/me').json()
    response=owner.patch('/api/v1/account/profile',json={'name':'Updated Name','company':'Acme','bio':'Building bots','avatar_url':'https://example.com/avatar.png'})
    assert response.status_code==200
    assert response.json()['email']==before['email'] and response.json()['company']=='Acme'
    assert owner.get('/api/v1/auth/me').json()['name']=='Updated Name'
    assert owner.post('/api/v1/auth/logout').status_code==200
    assert owner.get('/api/v1/auth/me').status_code==401

def mock_google(monkeypatch,email='google@example.com',sub='google-sub-123'):
    monkeypatch.setenv('GOOGLE_CLIENT_ID','test-client');monkeypatch.setenv('GOOGLE_CLIENT_SECRET','test-secret')
    original=httpx.AsyncClient
    def handler(request):
        if request.url.host=='oauth2.googleapis.com': return httpx.Response(200,json={'access_token':'test-token'})
        return httpx.Response(200,json={'sub':sub,'email':email,'email_verified':True,'name':'Google User','picture':'https://example.com/avatar.png'})
    transport=httpx.MockTransport(handler)
    monkeypatch.setattr(httpx,'AsyncClient',lambda *a,**kw:original(transport=transport))

def google_callback(client,link=False):
    start=client.get('/api/v1/auth/google/start'+('?link=true' if link else ''),follow_redirects=False)
    assert start.status_code==307
    state=parse_qs(urlparse(start.headers['location']).query)['state'][0]
    return client.get('/api/v1/auth/google/callback',params={'state':state,'code':'test-code'},follow_redirects=False)

def test_google_registration_creates_profile_and_session(client,monkeypatch):
    mock_google(monkeypatch)
    assert google_callback(client).status_code==307
    profile=client.get('/api/v1/auth/me').json()
    assert profile['google_connected'] and profile['email']=='google@example.com'
    assert profile['avatar_url']=='https://example.com/avatar.png'
    client.post('/api/v1/auth/logout')
    assert google_callback(client).status_code==307
    with Session() as db: assert db.query(User).count()==1

def test_google_link_keeps_existing_workspace_identity(owner,monkeypatch):
    before=owner.get('/api/v1/auth/me').json();mock_google(monkeypatch,email='different-google@example.com')
    assert google_callback(owner,link=True).status_code==307
    after=owner.get('/api/v1/auth/me').json()
    assert after['id']==before['id'] and after['email']==before['email'] and after['google_connected']
