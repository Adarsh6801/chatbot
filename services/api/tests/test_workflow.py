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

def test_google_admin_signin_redirects_to_admin_origin(client,monkeypatch):
    mock_google(monkeypatch)
    monkeypatch.setenv('ADMIN_WEB_ORIGIN','https://admin.example.test')
    start=client.get('/api/v1/auth/google/start?admin=true',follow_redirects=False)
    state=parse_qs(urlparse(start.headers['location']).query)['state'][0]
    response=client.get('/api/v1/auth/google/callback',params={'state':state,'code':'test-code'},follow_redirects=False)
    assert response.headers['location']=='https://admin.example.test'

def test_google_link_keeps_existing_workspace_identity(owner,monkeypatch):
    before=owner.get('/api/v1/auth/me').json();mock_google(monkeypatch,email='different-google@example.com')
    assert google_callback(owner,link=True).status_code==307
    after=owner.get('/api/v1/auth/me').json()
    assert after['id']==before['id'] and after['email']==before['email'] and after['google_connected']

def test_account_deletion_summary_and_permanent_delete(owner,bot,monkeypatch):
    from services.api.database import ApiKey, Bot, LoginSession, SupportTicket
    source(owner,bot)
    assert owner.patch('/api/v1/bots/'+bot['id'],json={'published':True}).status_code==200
    assert events(ask(owner,bot))[-1][0]=='done'
    key=owner.post('/api/v1/account/keys',json={'name':'Personal'}).json()
    ticket=owner.post('/api/v1/support/tickets',json={'subject':'Help me','message':'Testing delete'}).json()
    assert ticket['id']

    me=owner.get('/api/v1/auth/me').json()
    with Session() as db:
        u=db.get(User,me['id'])
        u.plan='pro';u.billing_provider='stripe';u.stripe_customer_id='cus_del';u.subscription_id='sub_del'
        db.commit()
    second=owner.post('/api/v1/bots',json={'name':'Draft Bot'})
    assert second.status_code==201

    summary=owner.get('/api/v1/account/deletion-summary')
    assert summary.status_code==200
    data=summary.json()
    assert data['has_active_subscription'] is True
    assert data['has_paid_plan'] is True
    assert data['plan']=='pro'
    assert data['total_bots']==2
    assert data['published_bots']==1
    assert data['draft_bots']==1

    cancelled=[]
    import stripe
    monkeypatch.setenv('STRIPE_SECRET_KEY','sk_test_dummy')
    monkeypatch.setattr(stripe.Subscription,'cancel',lambda sid: cancelled.append(sid))

    assert owner.delete('/api/v1/account',headers={'origin':'https://evil.example'}).status_code==403
    deleted=owner.delete('/api/v1/account')
    assert deleted.status_code==200 and deleted.json()['ok'] is True
    assert cancelled==['sub_del']
    assert owner.get('/api/v1/auth/me').status_code==401
    assert owner.get('/api/v1/public/bots/'+bot['slug']).status_code==404
    assert owner.get('/api/v1/bots',headers={'Authorization':'Bearer '+key['key']}).status_code==401
    with Session() as db:
        assert db.get(User,me['id']) is None
        assert db.query(Bot).filter_by(user_id=me['id']).count()==0
        assert db.query(LoginSession).filter_by(user_id=me['id']).count()==0
        assert db.query(ApiKey).filter_by(user_id=me['id']).count()==0
        assert db.query(SupportTicket).filter_by(user_id=me['id']).count()==0


def test_admin_user_view_and_edits_audit_logged(client,owner,bot,monkeypatch):
    from fastapi.testclient import TestClient
    from services.api.database import BillingAttempt,BotActivityLog,Payment,TokenUsage
    source(owner,bot)
    assert owner.patch('/api/v1/bots/'+bot['id'],json={'published':True}).status_code==200
    assert events(ask(owner,bot))[-1][0]=='done'
    key=owner.post('/api/v1/account/keys',json={'name':'Deploy Key'}).json()
    ticket=owner.post('/api/v1/support/tickets',json={'subject':'Billing help','message':'Need invoice details'}).json()
    me=owner.get('/api/v1/auth/me').json()

    assert owner.get('/api/v1/admin/users/'+me['id']).status_code==403

    admin_client=TestClient(client.app)
    admin_client.headers['X-AgentForge-Client']='dashboard'
    reg=admin_client.post('/api/v1/auth/register',json={'name':'Platform Admin','email':'admin-ops@example.com','password':'AdminPassword123!'})
    assert reg.status_code in (200,201),reg.text
    admin_me=admin_client.get('/api/v1/auth/me').json()
    monkeypatch.setenv('ADMIN_USER_ID',admin_me['id'])

    with Session() as db:
        u=db.get(User,me['id'])
        u.billing_provider='razorpay'
        u.razorpay_subscription_id='sub_rzp_test_1'
        db.add(BillingAttempt(user_id=me['id'],provider='razorpay',provider_reference='sub_rzp_test_1',plan='pro',status='active',paid_count=1,amount=2900,currency='USD'))
        db.add(Payment(id='pay_rzp_1',user_id=me['id'],provider='razorpay',kind='subscription',plan='pro',tokens=10000,amount=2900,currency='USD',status='paid'))
        db.add(TokenUsage(user_id=me['id'],tokens=42,subscription_tokens=42,topup_tokens=0,source='chat'))
        db.add(BotActivityLog(bot_id=bot['id'],source='chat',event_type='response_sent',severity='info',title='Answered test question',details={'ok':True}))
        db.commit()

    users_list=admin_client.get('/api/v1/admin/users',params={'q':me['email']})
    assert users_list.status_code==200
    listed=next(item for item in users_list.json()['items'] if item['id']==me['id'])
    assert listed['has_subscription'] is True

    detail=admin_client.get('/api/v1/admin/users/'+me['id'])
    assert detail.status_code==200,detail.text
    payload=detail.json()
    assert payload['user']['email']==me['email']
    assert payload['user']['has_subscription'] is True
    assert payload['user']['active_session_count']>=1
    assert len(payload['agents'])==1 and payload['agents'][0]['id']==bot['id']
    assert len(payload['subscription']['attempts'])==1
    assert len(payload['subscription']['payments'])==1
    assert any(u['tokens']==42 for u in payload['subscription']['token_usage'])
    assert len(payload['conversations'])==1
    assert len(payload['api_keys'])==1 and payload['api_keys'][0]['id']==key['id']
    assert len(payload['tickets'])==1 and payload['tickets'][0]['id']==ticket['id']
    assert len(payload['logs']['bot_activity'])>=1

    assert admin_client.patch('/api/v1/admin/users/'+admin_me['id'],json={'is_active':False}).status_code==422
    assert admin_client.post('/api/v1/admin/users/'+admin_me['id']+'/sessions/revoke').status_code==422

    edited_user=admin_client.patch('/api/v1/admin/users/'+me['id'],json={'name':'Updated Owner','company':'Acme AI','plan':'pro','subscription_tokens':15000,'topup_tokens':500})
    assert edited_user.status_code==200,edited_user.text
    assert edited_user.json()['user']['plan']=='pro'
    assert edited_user.json()['user']['subscription_tokens']==15000

    edited_agent=admin_client.patch(f"/api/v1/admin/users/{me['id']}/agents/{bot['id']}",json={'name':'Renamed Agent','description':'Updated desc','threshold':0.42,'published':False})
    assert edited_agent.status_code==200,edited_agent.text
    assert edited_agent.json()['id']==bot['id']
    assert edited_agent.json()['published'] is False

    assert admin_client.delete(f"/api/v1/admin/users/{me['id']}/keys/{key['id']}").status_code==200
    assert admin_client.post(f"/api/v1/admin/users/{me['id']}/sessions/revoke").status_code==200
    assert owner.get('/api/v1/auth/me').status_code==401

    assert admin_client.patch('/api/v1/admin/users/'+me['id'],json={'is_active':False}).status_code==200
    assert admin_client.patch('/api/v1/admin/users/'+me['id'],json={'is_active':True}).status_code==200

    refreshed=admin_client.get('/api/v1/admin/users/'+me['id']).json()
    assert refreshed['user']['name']=='Updated Owner'
    assert refreshed['user']['company']=='Acme AI'
    assert refreshed['user']['topup_tokens']==500
    assert refreshed['user']['is_active'] is True
    assert refreshed['agents'][0]['name']=='Renamed Agent'
    assert refreshed['agents'][0]['description']=='Updated desc'
    assert abs(refreshed['agents'][0]['threshold']-0.42)<1e-6
    assert refreshed['agents'][0]['published'] is False
    assert refreshed['api_keys']==[]
    actions=[entry['action'] for entry in refreshed['logs']['admin_audit']]
    for expected in ('user.updated','agent.updated','user.api_key_revoked','user.sessions_revoked'):
        assert expected in actions


def _sample_pdf_bytes(text: str) -> bytes:
    safe = text.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
    stream = f"BT /F1 12 Tf 72 720 Td ({safe}) Tj ET".encode('latin1')
    objs = [
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
        b"4 0 obj\n<< /Length " + str(len(stream)).encode('ascii') + b" >>\nstream\n" + stream + b"\nendstream\nendobj\n",
        b"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for obj in objs:
        offsets.append(len(out))
        out.extend(obj)
    xref_pos = len(out)
    out.extend(f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode('ascii'))
    for off in offsets:
        out.extend(f"{off:010d} 00000 n \n".encode('ascii'))
    out.extend(f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode('ascii'))
    return bytes(out)


def test_website_bot_sloty_companion_kb_pdfs_walkthroughs_and_admin(client, owner, monkeypatch):
    from fastapi.testclient import TestClient
    from services.api.database import AdminAudit

    cfg_res = client.get('/api/v1/site-bot/config')
    assert cfg_res.status_code == 200, cfg_res.text
    cfg = cfg_res.json()
    assert cfg['enabled'] is True
    assert cfg['name'] == 'Sloty'
    assert any(w['slug'] == 'build-your-first-agent' for w in cfg['walkthroughs'])

    guest_client = TestClient(client.app)
    guest_headers = {
        'X-Forwarded-For': '203.0.113.45',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0 Safari/537.36',
    }
    guide_chat = guest_client.post(
        '/api/v1/site-bot/chat',
        headers=guest_headers,
        json={'message': 'Guide me step-by-step to build my first bot', 'visitor_id': 'guest-visitor-1001', 'current_page': '/'},
    )
    assert guide_chat.status_code == 200, guide_chat.text
    guide_msg = guide_chat.json()['message']
    assert any(a['type'] == 'walkthrough' and a['walkthrough_slug'] == 'build-your-first-agent' for a in guide_msg['actions'])

    redir_chat = guest_client.post(
        '/api/v1/site-bot/chat',
        headers=guest_headers,
        json={
            'message': 'Take me to API documentation and tell me the chat endpoint',
            'visitor_id': 'guest-visitor-1001',
            'conversation_id': guide_chat.json()['conversation_id'],
            'current_page': '/',
        },
    )
    assert redir_chat.status_code == 200, redir_chat.text
    redir_msg = redir_chat.json()['message']
    assert any(a['type'] == 'redirect' and a['route'] == '/api-docs' and a.get('auto') is True for a in redir_msg['actions'])
    assert '/api/v1/chat/' in redir_msg['content'] or any('/api-docs' in (c.get('url') or '') for c in redir_msg['citations'])

    owner_headers = {
        'X-Forwarded-For': '198.51.100.22',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Safari/604.1',
    }
    owner_chat = owner.post(
        '/api/v1/site-bot/chat',
        headers=owner_headers,
        json={'message': 'Who are you?', 'visitor_id': 'owner-visitor-2002', 'current_page': '/agents'},
    )
    assert owner_chat.status_code == 200, owner_chat.text
    assert 'Sloty' in owner_chat.json()['message']['content']
    hist = owner.get('/api/v1/site-bot/history', params={'visitor_id': 'owner-visitor-2002'})
    assert hist.status_code == 200 and len(hist.json()['messages']) == 2

    assert owner.get('/api/v1/admin/site-bot').status_code == 403

    admin_client = TestClient(client.app)
    admin_client.headers['X-AgentForge-Client'] = 'dashboard'
    reg = admin_client.post('/api/v1/auth/register', json={'name': 'Site Bot Admin', 'email': 'sitebot-admin@example.com', 'password': 'AdminPassword123!'})
    assert reg.status_code in (200, 201), reg.text
    admin_id = admin_client.get('/api/v1/auth/me').json()['id']
    monkeypatch.setenv('ADMIN_USER_ID', admin_id)

    renamed = admin_client.patch('/api/v1/admin/site-bot/config', json={'name': 'NovaGuide', 'accent_color': '#2f6c58'})
    assert renamed.status_code == 200 and renamed.json()['config']['name'] == 'NovaGuide'
    assert client.get('/api/v1/site-bot/config').json()['name'] == 'NovaGuide'
    admin_client.patch('/api/v1/admin/site-bot/config', json={'name': 'Sloty'})

    kb_add = admin_client.post('/api/v1/admin/site-bot/knowledge', json={'title': 'Custom SLA', 'content': 'Enterprise workspaces include dedicated 99.95% uptime SLA.'})
    assert kb_add.status_code == 201, kb_add.text
    kb_id = kb_add.json()['id']
    kb_edit = admin_client.patch('/api/v1/admin/site-bot/knowledge/' + kb_id, json={'content': 'Enterprise workspaces include dedicated 99.99% SLA and onboarding.'})
    assert kb_edit.status_code == 200

    pdf_bytes = _sample_pdf_bytes('Sloty PDF Manual: Dedicated onboarding runs within 24 hours.')
    pdf_upload = admin_client.post('/api/v1/admin/site-bot/knowledge/upload', files={'file': ('manual.pdf', pdf_bytes, 'application/pdf')})
    assert pdf_upload.status_code == 201, pdf_upload.text
    assert pdf_upload.json()['source_type'] == 'pdf' and pdf_upload.json()['chunk_count'] >= 1

    pdf_qa = guest_client.post(
        '/api/v1/site-bot/chat',
        headers=guest_headers,
        json={'message': 'How fast does dedicated onboarding run according to the Sloty PDF Manual?', 'visitor_id': 'guest-visitor-1001', 'conversation_id': guide_chat.json()['conversation_id'], 'current_page': '/plans'},
    )
    assert pdf_qa.status_code == 200 and '24 hours' in pdf_qa.json()['message']['content']

    wt = admin_client.post('/api/v1/admin/site-bot/walkthroughs', json={
        'slug': 'check-billing-tokens',
        'title': 'Check billing & tokens',
        'description': 'Inspect your remaining token balance',
        'keywords': ['billing tokens', 'token balance'],
        'steps': [{'title': 'Step 1', 'instruction': 'Review your remaining tokens here.', 'route': '/plans', 'selector': '', 'action_label': 'Inspect', 'auto_advance_on_click': False}],
    })
    assert wt.status_code == 201, wt.text
    wt_id = wt.json()['id']
    assert admin_client.patch('/api/v1/admin/site-bot/walkthroughs/' + wt_id, json={'title': 'Inspect billing & token balance'}).status_code == 200
    assert admin_client.delete('/api/v1/admin/site-bot/walkthroughs/' + wt_id).status_code == 200
    assert admin_client.delete('/api/v1/admin/site-bot/knowledge/' + kb_id).status_code == 200

    convs = admin_client.get('/api/v1/admin/site-bot/conversations')
    assert convs.status_code == 200
    items = convs.json()['items']
    guest_row = next(c for c in items if c['visitor_id'] == 'guest-visitor-1001')
    assert guest_row['ip_address'] == '203.0.113.45'
    assert 'Desktop' in guest_row['device_summary'] and 'Chrome' in guest_row['device_summary']
    assert guest_row['user_id'] is None

    owner_row = next(c for c in items if c['visitor_id'] == 'owner-visitor-2002')
    assert owner_row['ip_address'] == '198.51.100.22'
    assert 'Mobile' in owner_row['device_summary'] and 'iOS' in owner_row['device_summary']
    assert owner_row['user_email'] == 'owner@example.com' and owner_row['user_id'] is not None

    detail = admin_client.get('/api/v1/admin/site-bot/conversations/' + guest_row['id'])
    assert detail.status_code == 200 and len(detail.json()['messages']) >= 4

    with Session() as db:
        audit_actions = [e.action for e in db.query(AdminAudit).all()]
        for expected in ('site_bot.config_updated', 'site_bot.knowledge_created', 'site_bot.knowledge_uploaded', 'site_bot.walkthrough_created'):
            assert expected in audit_actions


def test_site_logo_updates_cache_busted_public_url(client, monkeypatch):
    import struct
    from fastapi.testclient import TestClient

    monkeypatch.setenv('S3_BUCKET', 'test-branding-bucket')
    fake_store = {}
    counter = {'n': 0}

    def fake_store_site_logo(raw):
        counter['n'] += 1
        uri = f"s3://test-branding-bucket/site-assets/branding/logo-{counter['n']}.png"
        fake_store[uri] = raw
        return uri

    def fake_read_site_logo(uri):
        return fake_store[uri], 'image/png'

    monkeypatch.setattr('services.api.admin.store_site_logo', fake_store_site_logo)
    monkeypatch.setattr('services.api.main.read_site_logo', fake_read_site_logo)

    admin_client = TestClient(client.app)
    admin_client.headers['X-AgentForge-Client'] = 'dashboard'
    reg = admin_client.post('/api/v1/auth/register', json={'name': 'Brand Admin', 'email': 'brand-admin@example.com', 'password': 'AdminPassword123!'})
    assert reg.status_code in (200, 201), reg.text
    admin_id = admin_client.get('/api/v1/auth/me').json()['id']
    monkeypatch.setenv('ADMIN_USER_ID', admin_id)

    png_header = b'\x89PNG\r\n\x1a\n' + struct.pack('>I4sII', 13, b'IHDR', 256, 256)
    first_png = png_header + b'first-logo-bytes'
    second_png = png_header + b'second-logo-bytes'

    assert admin_client.put('/api/v1/admin/settings/site', json={'name': 'MyBrand', 'brand_display': 'image'}).status_code == 422

    up1 = admin_client.post('/api/v1/admin/settings/site/logo', files={'file': ('logo1.png', first_png, 'image/png')})
    assert up1.status_code == 200 and '?v=' in up1.json()['logo_url']
    pub1 = client.get('/api/v1/public/site-settings')
    assert pub1.status_code == 200 and pub1.headers.get('cache-control') == 'no-store'
    assert pub1.json()['brand_display'] == 'both'
    url1 = pub1.json()['logo_url']
    assert '?v=' in url1

    save_img = admin_client.put('/api/v1/admin/settings/site', json={'name': 'MyBrand', 'brand_display': 'image'})
    assert save_img.status_code == 200 and save_img.json()['brand_display'] == 'image'
    assert client.get('/api/v1/public/site-settings').json()['brand_display'] == 'image'

    up2 = admin_client.post('/api/v1/admin/settings/site/logo', files={'file': ('logo2.png', second_png, 'image/png')})
    assert up2.status_code == 200
    pub2 = client.get('/api/v1/public/site-settings')
    url2 = pub2.json()['logo_url']
    assert url2 != url1
    path_and_query = url2.replace(str(client.base_url), '')
    fetched = client.get(path_and_query)
    assert fetched.status_code == 200 and fetched.content == second_png

    save_txt = admin_client.put('/api/v1/admin/settings/site', json={'name': 'MyBrand', 'brand_display': 'text'})
    assert save_txt.status_code == 200 and client.get('/api/v1/public/site-settings').json()['brand_display'] == 'text'


def test_admin_pages_and_public_faqs_terms_privacy(client, owner, monkeypatch):
    from fastapi.testclient import TestClient
    from services.api.database import AdminAudit

    for slug in ('faqs', 'terms', 'privacy'):
        pub = client.get('/api/v1/public/pages/' + slug)
        assert pub.status_code == 200, pub.text
        assert pub.json()['slug'] == slug
    assert len(client.get('/api/v1/public/pages/faqs').json()['faqs']) >= 1

    assert owner.get('/api/v1/admin/pages').status_code == 403

    admin_client = TestClient(client.app)
    admin_client.headers['X-AgentForge-Client'] = 'dashboard'
    reg = admin_client.post('/api/v1/auth/register', json={'name': 'Pages Admin', 'email': 'pages-admin@example.com', 'password': 'AdminPassword123!'})
    assert reg.status_code in (200, 201), reg.text
    admin_id = admin_client.get('/api/v1/auth/me').json()['id']
    monkeypatch.setenv('ADMIN_USER_ID', admin_id)

    listed = admin_client.get('/api/v1/admin/pages')
    assert listed.status_code == 200
    assert [p['slug'] for p in listed.json()['items']] == ['faqs', 'terms', 'privacy']

    terms_detail = admin_client.get('/api/v1/admin/pages/terms')
    assert terms_detail.status_code == 200 and 'content' in terms_detail.json()

    updated_terms = admin_client.patch('/api/v1/admin/pages/terms', json={'title': 'Updated Terms', 'content': '## Clause 1\nRespect workspace limits.'})
    assert updated_terms.status_code == 200 and updated_terms.json()['title'] == 'Updated Terms'
    assert 'Clause 1' in client.get('/api/v1/public/pages/terms').json()['content']

    hidden_privacy = admin_client.patch('/api/v1/admin/pages/privacy', json={'status': 'draft'})
    assert hidden_privacy.status_code == 200
    assert client.get('/api/v1/public/pages/privacy').status_code == 404
    assert admin_client.patch('/api/v1/admin/pages/privacy', json={'status': 'published'}).status_code == 200
    assert client.get('/api/v1/public/pages/privacy').status_code == 200

    created_faq = admin_client.post('/api/v1/admin/pages/faqs/items', json={
        'question': 'Does Sloty support PDF knowledge?',
        'answer': 'Yes, upload PDFs directly in the Admin Website Bot console.',
        'category': 'Website Bot',
        'position': 99,
        'published': True,
    })
    assert created_faq.status_code == 201, created_faq.text
    faq_id = created_faq.json()['id']
    assert any(f['id'] == faq_id for f in client.get('/api/v1/public/pages/faqs').json()['faqs'])

    edited_faq = admin_client.patch('/api/v1/admin/pages/faqs/items/' + faq_id, json={'answer': 'Yes, upload readable PDFs up to 10 MB.'})
    assert edited_faq.status_code == 200 and '10 MB' in edited_faq.json()['answer']

    assert admin_client.delete('/api/v1/admin/pages/faqs/items/' + faq_id).status_code == 200
    assert not any(f['id'] == faq_id for f in client.get('/api/v1/public/pages/faqs').json()['faqs'])

    with Session() as db:
        actions = [e.action for e in db.query(AdminAudit).all()]
        for expected in ('site_page.updated', 'faq.created', 'faq.updated', 'faq.deleted'):
            assert expected in actions
