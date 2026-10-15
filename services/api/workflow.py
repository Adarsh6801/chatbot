"""Validated visual workflows; no arbitrary code execution or private-network requests."""
import asyncio
import copy
import ipaddress
import json
import os
import re
import socket
from pathlib import Path
from urllib.parse import urlparse, quote
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from .database import get_db, Workflow, Bot, Chunk, Document, now
from .security import current_user, owned_bot
from .rag import words, generate, INJECTION
from .providers import hybrid_search

router=APIRouter(prefix='/api/v1/bots/{bot_id}/workflow',tags=['workflows'])
TYPES={'start','intent','message','capture','condition','api','knowledge','end'}
VARIABLE=re.compile(r'^[a-zA-Z][a-zA-Z0-9_]{0,49}$')
TEMPLATE=re.compile(r'\{\{\s*([a-zA-Z][\w.]*)\s*\}\}')

def starter():
    return {'nodes':[{'id':'start','type':'start','name':'Start','x':60,'y':160,'config':{}},{'id':'knowledge','type':'knowledge','name':'Search knowledge','x':340,'y':160,'config':{'query':'{{message}}'}},{'id':'end','type':'end','name':'End','x':620,'y':160,'config':{}}], 'edges':[{'id':'start-kb','source':'start','target':'knowledge','label':'default'},{'id':'kb-end','source':'knowledge','target':'end','label':'default'}]}

def lookup(variables,path):
    value=variables
    for part in path.split('.'):
        if isinstance(value,dict): value=value.get(part,'')
        elif isinstance(value,list) and part.isdigit(): value=value[int(part)] if int(part)<len(value) else ''
        else: return ''
    return value

def render(template,variables,url=False):
    def replace(match):
        value=lookup(variables,match.group(1))
        value=json.dumps(value,ensure_ascii=False) if isinstance(value,(dict,list)) else str(value)
        return quote(value,safe='') if url else value
    return TEMPLATE.sub(replace,str(template))

def resolve_json(value,variables):
    if isinstance(value,dict): return {key:resolve_json(item,variables) for key,item in value.items()}
    if isinstance(value,list): return [resolve_json(item,variables) for item in value]
    if isinstance(value,str):
        match=TEMPLATE.fullmatch(value)
        return lookup(variables,match.group(1)) if match else render(value,variables)
    return value

def validate_graph(graph,publish=False):
    nodes,edges=graph.get('nodes',[]),graph.get('edges',[])
    errors=[]
    if not 1<=len(nodes)<=60: errors.append('Use between 1 and 60 nodes.')
    if len(edges)>150: errors.append('A workflow can have at most 150 connections.')
    ids=[n.get('id') for n in nodes]
    if len(set(ids))!=len(ids) or any(not isinstance(id,str) or not VARIABLE.fullmatch(id) for id in ids): errors.append('Node IDs must be unique and use letters, numbers, and underscores.')
    starts=[n for n in nodes if n.get('type')=='start']
    if len(starts)!=1: errors.append('Add exactly one Start node.')
    labels=set()
    for edge in edges:
        if edge.get('source') not in ids or edge.get('target') not in ids: errors.append('A connection references a missing node.')
        label=edge.get('label') or 'default'
        pair=(edge.get('source'),label)
        if pair in labels: errors.append('Each output label can connect to only one next node.')
        labels.add(pair)
    for node in nodes:
        kind=node.get('type');config=node.get('config',{})
        if kind not in TYPES: errors.append('Unknown node type.')
        if not isinstance(config,dict): errors.append('Node settings must be an object.');continue
        if publish:
            if kind=='message' and not str(config.get('text','')).strip(): errors.append(f'{node.get("name")}: add a message.')
            if kind=='capture':
                if not VARIABLE.fullmatch(str(config.get('variable',''))): errors.append('Capture needs a valid variable name.')
                if not config.get('prompt'): errors.append('Capture needs a question to ask the visitor.')
                if config.get('validation','text') not in ('text','email','number'): errors.append('Invalid capture validation.')
            if kind=='api':
                url=urlparse(str(config.get('url','')))
                if url.scheme not in ('http','https') or not url.hostname or '{{' in url.netloc: errors.append('API requests need a fixed public HTTP(S) host.')
                if config.get('method','GET') not in ('GET','POST','PUT','PATCH','DELETE'): errors.append('Unsupported API method.')
                if not VARIABLE.fullmatch(str(config.get('variable','api_result'))): errors.append('API result needs a valid variable name.')
                if not isinstance(config.get('headers',{}),dict): errors.append('API headers must be a JSON object.')
                if config.get('_authorization') and url.scheme!='https': errors.append('Authenticated API requests must use HTTPS.')
            if kind=='condition' and config.get('operator','equals') not in ('equals','contains','exists','greater_than'): errors.append('Invalid condition operator.')
            if kind=='intent':
                intents=config.get('intents',[])
                if not intents or len(intents)>20: errors.append('Add between 1 and 20 intents.')
                names=[i.get('id') for i in intents]
                if len(set(names))!=len(names) or any(not isinstance(id,str) or not VARIABLE.fullmatch(id) for id in names): errors.append('Intent IDs must be unique variable names.')
                for intent in intents:
                    if not intent.get('examples'): errors.append('Each intent needs an example phrase.')
                    if (node['id'],intent.get('id')) not in labels: errors.append(f'Connect the {intent.get("name",intent.get("id"))} intent output.')
                if (node['id'],'default') not in labels: errors.append('Connect the intent fallback output.')
            if kind=='condition' and any((node['id'],label) not in labels for label in ('true','false')): errors.append('Connect both condition outcomes.')
            if kind not in ('end','intent','condition') and (node['id'],'default') not in labels: errors.append(f'{node.get("name",kind)}: connect the next node.')
    if publish and starts:
        visited=set();pending=[starts[0]['id']]
        while pending:
            id=pending.pop()
            if id in visited: continue
            visited.add(id);pending.extend(e['target'] for e in edges if e.get('source')==id)
        if set(ids)-visited: errors.append('Connect all nodes to the Start path before publishing.')
        if not any(n.get('type')=='end' and n['id'] in visited for n in nodes): errors.append('Add a reachable End node.')
        visiting=set();complete=set()
        def has_cycle(id):
            if id in visiting: return True
            if id in complete: return False
            visiting.add(id)
            if any(has_cycle(e['target']) for e in edges if e.get('source')==id and e.get('target') in ids): return True
            visiting.remove(id);complete.add(id);return False
        if has_cycle(starts[0]['id']): errors.append('Remove circular connections. Use a Capture node to wait for the next visitor message.')
    if errors: raise HTTPException(422, ' '.join(dict.fromkeys(errors)))
    if len(json.dumps(graph))>150000: raise HTTPException(422,'Workflow is too large.')
    return graph

def cipher():
    from cryptography.fernet import Fernet
    key=os.getenv('WORKFLOW_ENCRYPTION_KEY')
    if not key and os.getenv('APP_ENV')=='production': raise HTTPException(503,'Set WORKFLOW_ENCRYPTION_KEY before saving integration credentials in production.')
    if not key:
        path=Path('data/workflow-encryption.key');path.parent.mkdir(parents=True,exist_ok=True)
        try:
            with path.open('xb') as file: file.write(Fernet.generate_key())
        except FileExistsError: pass
        key=path.read_bytes()
    return Fernet(key.encode() if isinstance(key,str) else key)

def secure_graph(graph,old):
    result=copy.deepcopy(graph)
    old_nodes={n['id']:n for n in (old or {}).get('nodes',[])}
    for node in result['nodes']:
        config=node.setdefault('config',{})
        config.pop('_authorization',None);config.pop('has_authorization',None)
        if node['type']=='api':
            auth=config.pop('authorization','')
            clear=config.pop('clear_authorization',False)
            existing=old_nodes.get(node['id'],{}).get('config',{}).get('_authorization')
            if auth: config['_authorization']=cipher().encrypt(str(auth).encode()).decode()
            elif existing and not clear: config['_authorization']=existing
    return result

def public_graph(graph):
    result=copy.deepcopy(graph)
    for node in result.get('nodes',[]):
        config=node.get('config',{})
        if config.pop('_authorization',None): config['has_authorization']=True
    return result

async def call_api(config,variables):
    url=render(config.get('url',''),variables,url=True)
    parsed=urlparse(url)
    if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None,80,443): raise ValueError('Use a public HTTP(S) API on a standard port.')
    if config.get('_authorization') and parsed.scheme!='https': raise ValueError('Authenticated API requests must use HTTPS.')
    host=parsed.hostname.encode('idna').decode();port=parsed.port or (443 if parsed.scheme=='https' else 80)
    addresses=await asyncio.to_thread(socket.getaddrinfo,host,port,0,socket.SOCK_STREAM)
    ips=[a[4][0] for a in addresses]
    if not ips or any(not ipaddress.ip_address(ip).is_global for ip in ips): raise ValueError('Private or reserved API addresses are blocked.')
    ip=ips[0];target=f'{parsed.scheme}://'+(f'[{ip}]' if ':' in ip else ip)+((':'+str(parsed.port)) if parsed.port else '')+(parsed.path or '/')+('?' + parsed.query if parsed.query else '')
    headers={str(key):render(value,variables) for key,value in config.get('headers',{}).items()}
    if any(key.lower() in ('host','cookie','content-length','connection','transfer-encoding','authorization') for key in headers): raise ValueError('Use the protected authorization field for credentials; transport headers cannot be overridden.')
    headers['Host']=host
    if config.get('_authorization'): headers['Authorization']=cipher().decrypt(config['_authorization'].encode()).decode()
    payload=resolve_json(config.get('body',{}),variables)
    async with httpx.AsyncClient(timeout=15,follow_redirects=False,trust_env=False) as client:
        async with client.stream(config.get('method','GET'),target,headers=headers,json=payload if config.get('method','GET')!='GET' else None,extensions={'sni_hostname':host}) as response:
            if response.is_redirect: raise ValueError('API redirects are blocked. Use the final URL.')
            response.raise_for_status();raw=bytearray()
            async for block in response.aiter_bytes():
                raw.extend(block)
                if len(raw)>262144: raise ValueError('API response exceeds 256 KB.')
    try: data=json.loads(raw)
    except ValueError: data={'text':raw.decode(errors='replace')[:10000]}
    return {'status':response.status_code,'data':data}

def detect_intent(message,intents):
    query=set(words(message));best,score='default',0
    for intent in intents:
        for example in intent.get('examples',[]):
            terms=set(words(str(example)))
            overlap=len(query & terms)/max(len(terms),1)
            similarity=1.0 if str(example).lower().strip() in message.lower() else overlap
            if similarity>score and similarity>=0.5: best,score=intent['id'],similarity
    return best

async def run_graph(graph,message,state,knowledge):
    nodes={n['id']:n for n in graph['nodes']};edges=graph['edges']
    variables=copy.deepcopy(state.get('variables',{}));variables['message']=message
    if not state.get('awaiting'): variables['original_message']=message
    trace=[];outputs=[];result={'citations':[],'confidence':1.0,'model':'workflow','tokens':0,'cost':0,'abstained':False}
    current=state.get('awaiting') or next(n['id'] for n in graph['nodes'] if n['type']=='start')
    waiting=bool(state.get('awaiting'))
    def next_node(id,label='default'):
        return next((e['target'] for e in edges if e['source']==id and (e.get('label') or 'default')==label),None)
    for step in range(40):
        if current not in nodes: break
        node=nodes[current];kind=node['type'];config=node.get('config',{});label='default'
        entry={'node_id':current,'name':node.get('name',kind),'type':kind,'status':'completed'};trace.append(entry)
        if kind=='end': break
        if kind=='intent':
            label=detect_intent(message,config.get('intents',[]));variables['intent']=label;entry['intent']=label
        elif kind=='message': outputs.append(render(config.get('text',''),variables))
        elif kind=='capture':
            key=config['variable']
            if waiting:
                value=message.strip();validation=config.get('validation','text')
                valid=bool(value) and (validation!='email' or bool(re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',value))) and (validation!='number' or bool(re.fullmatch(r'-?\d+(\.\d+)?',value)))
                if not valid:
                    entry['status']='waiting';outputs.append('Please enter a valid '+validation+'. '+render(config['prompt'],variables))
                    return result|{'answer':'\n\n'.join(outputs),'trace':trace,'state':{'awaiting':current,'variables':variables}}
                variables[key]=float(value) if validation=='number' else value;waiting=False
            elif key not in variables or config.get('always_ask',False):
                outputs.append(render(config['prompt'],variables));entry['status']='waiting'
                return result|{'answer':'\n\n'.join(outputs),'trace':trace,'state':{'awaiting':current,'variables':variables}}
        elif kind=='condition':
            value=lookup(variables,config.get('variable',''));expected=config.get('value','');operator=config.get('operator','equals')
            matched=str(value).lower()==str(expected).lower() if operator=='equals' else str(expected).lower() in str(value).lower() if operator=='contains' else value not in ('',None) if operator=='exists' else False
            if operator=='greater_than':
                try: matched=float(value)>float(expected)
                except (ValueError,TypeError): matched=False
            label='true' if matched else 'false';entry['outcome']=label
        elif kind=='api':
            try:
                variables[config.get('variable','api_result')]=await call_api(config,variables)
                entry['http_status']=variables[config.get('variable','api_result')]['status']
            except Exception:
                entry['status']='failed';label='error';variables[config.get('variable','api_result')]={'error':'The connected service could not complete the request.'}
                if not next_node(current,'error'):
                    outputs.append(config.get('error_message','The connected service is temporarily unavailable. Please try again.'))
                    break
        elif kind=='knowledge':
            try: data=await knowledge(render(config.get('query','{{message}}'),variables))
            except Exception:
                entry['status']='failed'
                data={'answer':'Knowledge search is temporarily unavailable. Please try again.','citations':[],'confidence':0,'abstained':True,'model':'guardrail','tokens':0,'cost':0}
            outputs.append(data['answer']);result.update({k:v for k,v in data.items() if k!='answer'})
        current=next_node(current,label)
        if not current: break
    else:
        outputs.append('This workflow could not finish. Please contact the agent owner.');trace.append({'status':'failed','reason':'Step limit reached'})
    return result|{'answer':'\n\n'.join(o for o in outputs if o) or 'How can I help you?','trace':trace,'state':{'variables':variables}}

async def knowledge_answer(db,bot,query):
    if INJECTION.search(query): return {'answer':"I can't follow instructions that override my safety rules.",'citations':[],'confidence':0,'abstained':True,'model':'guardrail','tokens':0,'cost':0}
    hits=await hybrid_search(db,bot.id,query);hits=[h for h in hits[:8] if h['confidence']>=min(0.12,bot.threshold)]
    confidence=max((h['confidence'] for h in hits),default=0)
    if confidence<bot.threshold: return {'answer':"I don't know based on the available documents.",'citations':[],'confidence':confidence,'abstained':True,'model':'guardrail','tokens':0,'cost':0}
    answer,model,tokens,cost=await generate(query,hits,bot.system_prompt,[])
    citations=[{'id':h['chunk'].id,'index':i+1,'source':db.get(Document,h['chunk'].document_id).name,'excerpt':h['chunk'].content[:500]} for i,h in enumerate(hits)]
    return {'answer':answer,'citations':citations,'confidence':confidence,'abstained':False,'model':model,'tokens':tokens,'cost':cost}

class SaveInput(BaseModel):
    graph:dict
class TestInput(BaseModel):
    message:str=Field(min_length=1,max_length=4000)
    state:dict=Field(default_factory=dict)
class EnableInput(BaseModel):
    enabled:bool

def get_workflow(db,bot_id):
    workflow=db.query(Workflow).filter_by(bot_id=bot_id).first()
    if not workflow:
        workflow=Workflow(bot_id=bot_id,draft=starter());db.add(workflow);db.commit()
    return workflow

@router.get('')
def get(bot_id:str,db=Depends(get_db),user=Depends(current_user)):
    owned_bot(db,bot_id,user);w=get_workflow(db,bot_id)
    return {'graph':public_graph(w.draft),'enabled':bool(w.enabled),'version':w.version,'updated_at':w.updated_at,'has_published':bool(w.published_graph)}

@router.put('')
def save(bot_id:str,body:SaveInput,db=Depends(get_db),user=Depends(current_user)):
    owned_bot(db,bot_id,user);validate_graph(body.graph);w=get_workflow(db,bot_id)
    w.draft=secure_graph(body.graph,w.draft);w.updated_at=now();db.commit()
    return {'graph':public_graph(w.draft),'updated_at':w.updated_at}

@router.post('/publish')
def publish(bot_id:str,db=Depends(get_db),user=Depends(current_user)):
    owned_bot(db,bot_id,user);w=get_workflow(db,bot_id);validate_graph(w.draft,publish=True)
    w.published_graph=copy.deepcopy(w.draft);w.version+=1;w.enabled=1;w.updated_at=now();db.commit()
    return {'enabled':True,'version':w.version}

@router.patch('/enabled')
def enabled(bot_id:str,body:EnableInput,db=Depends(get_db),user=Depends(current_user)):
    owned_bot(db,bot_id,user);w=get_workflow(db,bot_id)
    if body.enabled and not w.published_graph: raise HTTPException(422,'Publish a workflow before enabling it.')
    w.enabled=int(body.enabled);db.commit();return {'enabled':bool(w.enabled)}

@router.post('/test')
async def test(bot_id:str,body:TestInput,db=Depends(get_db),user=Depends(current_user)):
    bot=owned_bot(db,bot_id,user);w=get_workflow(db,bot_id);validate_graph(w.draft,publish=True)
    if INJECTION.search(body.message): return {'answer':"I can't follow instructions that override my safety rules.",'trace':[],'state':{},'citations':[],'confidence':0}
    if len(json.dumps(body.state))>50000: raise HTTPException(422,'Test session is too large. Reset the emulator.')
    return await run_graph(w.draft,body.message,body.state,lambda q:knowledge_answer(db,bot,q))
