"""Validated visual workflows; no arbitrary code execution or private-network requests outside the fixed development demo API."""
import asyncio
import copy
import ipaddress
import json
import logging
import os
import re
import socket
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse, quote, parse_qsl, urlencode, urlunparse
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from .database import get_db, Workflow, WorkflowApiLog, BotActivityLog, Bot, Chunk, Document, now
from .security import current_user, owned_bot
from .rag import words, generate, INJECTION
from .providers import hybrid_search

router=APIRouter(prefix='/api/v1/bots/{bot_id}/workflow',tags=['workflows'])
TYPES={'start','intent','message','capture','condition','api','knowledge','end'}
VARIABLE=re.compile(r'^[a-zA-Z][a-zA-Z0-9_]{0,49}$')
TEMPLATE=re.compile(r'\{\{\s*([a-zA-Z][\w.]*)\s*\}\}')
SENSITIVE_FIELD=re.compile(r'(password|secret|token|authorization|credential|api[_-]?key|private[_-]?key|card|cvv)',re.I)

def safe_log_url(value):
    parsed=urlparse(str(value))
    query=urlencode([(key,'[redacted]') for key,_ in parse_qsl(parsed.query,keep_blank_values=True)])
    host=parsed.netloc.rsplit('@',1)[-1]
    return urlunparse((parsed.scheme,host,parsed.path,parsed.params,query,'[redacted]' if parsed.fragment else ''))[:1000]

def response_preview(value):
    def redact(item,depth=0):
        if depth>8: return '[nested value omitted]'
        if isinstance(item,dict): return {str(k):('[redacted]' if SENSITIVE_FIELD.search(str(k)) else redact(v,depth+1)) for k,v in list(item.items())[:100]}
        if isinstance(item,list): return [redact(v,depth+1) for v in item[:100]]
        if isinstance(item,str): return item[:4000]
        if item is None or isinstance(item,(bool,int,float)): return item
        return str(item)[:1000]
    try: rendered=json.dumps(redact(value),ensure_ascii=False,default=str)
    except Exception: rendered='[response could not be serialized]'
    return rendered[:16000]

def safe_log_details(value):
    try:
        cleaned=json.loads(response_preview(value))
        return cleaned
    except Exception:
        return {'preview':response_preview(value),'truncated':True}

def cleanup_api_logs(db):
    cutoff=(datetime.now(timezone.utc)-timedelta(hours=24)).isoformat()
    old_api=db.query(WorkflowApiLog).filter(WorkflowApiLog.created_at < cutoff).delete(synchronize_session=False)
    old_bot=db.query(BotActivityLog).filter(BotActivityLog.created_at < cutoff).delete(synchronize_session=False)
    return old_api+old_bot

def record_bot_log(db,bot_id,source,conversation_id,event):
    try:
        db.add(BotActivityLog(bot_id=bot_id,conversation_id=conversation_id,source=source,event_type=event.get('event_type','event'),severity=event.get('severity','info'),title=str(event.get('title','Bot activity'))[:180],details=safe_log_details(event.get('details') or {})))
        db.commit()
    except Exception:
        db.rollback()
        logging.getLogger('agentforge').exception('Could not persist bot activity log for bot %s',bot_id)

def record_api_log(db,bot_id,source,conversation_id,event):
    details={'node_id':event['node_id'],'node_name':event['node_name'],'method':event['method'],'url':safe_log_url(event['url']),'status_code':event.get('status_code'),'duration_ms':max(0,int(event.get('duration_ms',0))),'response':event.get('response'),'error':(event.get('error') or '')[:1000] or None}
    record_bot_log(db,bot_id,source,conversation_id,{'event_type':'api_call','severity':'info' if event['success'] else 'error','title':f"{event['method']} {event['node_name']}",'details':details})

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
                if os.getenv('APP_ENV')=='production' and url.hostname=='api' and url.port==8000 and url.path=='/api/v1/demo/pricing': errors.append('Replace the local demo pricing API with your production API URL before publishing.')
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
    method=config.get('method','GET')
    internal_demo=(os.getenv('APP_ENV','development')!='production' and parsed.scheme=='http' and parsed.hostname=='api' and parsed.port==8000 and parsed.path=='/api/v1/demo/pricing' and not parsed.query and not parsed.fragment and method=='GET' and not config.get('_authorization') and not config.get('headers') and not config.get('body'))
    if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password or (parsed.port not in (None,80,443) and not internal_demo): raise ValueError('Use a public HTTP(S) API on a standard port.')
    if config.get('_authorization') and parsed.scheme!='https': raise ValueError('Authenticated API requests must use HTTPS.')
    host=parsed.hostname.encode('idna').decode();port=parsed.port or (443 if parsed.scheme=='https' else 80)
    if internal_demo:
        target=url
    else:
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
        async with client.stream(method,target,headers=headers,json=payload if method!='GET' else None,extensions={'sni_hostname':host}) as response:
            if response.is_redirect: raise ValueError('API redirects are blocked. Use the final URL.')
            raw=bytearray()
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

async def run_graph(graph,message,state,knowledge,api_log=None,activity_log=None):
    nodes={n['id']:n for n in graph['nodes']};edges=graph['edges']
    variables=copy.deepcopy(state.get('variables',{}));variables['message']=message
    if not state.get('awaiting'): variables['original_message']=message
    trace=[];outputs=[];result={'citations':[],'confidence':1.0,'model':'workflow','tokens':0,'cost':0,'abstained':False}
    current=state.get('awaiting') or next(n['id'] for n in graph['nodes'] if n['type']=='start')
    waiting=bool(state.get('awaiting'))
    def next_node(id,label='default'):
        return next((e['target'] for e in edges if e['source']==id and (e.get('label') or 'default')==label),None)
    def log_step(entry):
        if not activity_log:return
        details={key:entry[key] for key in ('node_id','type','status','intent','outcome','http_status','confidence','abstained','citation_count','reason') if key in entry}
        severity='error' if entry.get('status')=='failed' else 'warning' if entry.get('status')=='waiting' else 'info'
        try:activity_log({'event_type':'workflow_step','severity':severity,'title':entry.get('name','Workflow step'),'details':details})
        except Exception:logging.getLogger('agentforge').exception('Could not record workflow step activity')
    for step in range(40):
        if current not in nodes: break
        node=nodes[current];kind=node['type'];config=node.get('config',{});label='default'
        entry={'node_id':current,'name':node.get('name',kind),'type':kind,'status':'completed'};trace.append(entry)
        if kind=='end':
            log_step(entry);break
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
                    log_step(entry)
                    return result|{'answer':'\n\n'.join(outputs),'trace':trace,'state':{'awaiting':current,'variables':variables}}
                variables[key]=float(value) if validation=='number' else value;waiting=False
            elif key not in variables or config.get('always_ask',False):
                outputs.append(render(config['prompt'],variables));entry['status']='waiting'
                log_step(entry)
                return result|{'answer':'\n\n'.join(outputs),'trace':trace,'state':{'awaiting':current,'variables':variables}}
        elif kind=='condition':
            value=lookup(variables,config.get('variable',''));expected=config.get('value','');operator=config.get('operator','equals')
            matched=str(value).lower()==str(expected).lower() if operator=='equals' else str(expected).lower() in str(value).lower() if operator=='contains' else value not in ('',None) if operator=='exists' else False
            if operator=='greater_than':
                try: matched=float(value)>float(expected)
                except (ValueError,TypeError): matched=False
            label='true' if matched else 'false';entry['outcome']=label
        elif kind=='api':
            api_started=time.perf_counter()
            def log_api_call(success,status_code=None,response_data=None,error=None):
                if not api_log:return
                event={'node_id':current,'node_name':node.get('name',kind),'method':config.get('method','GET'),'url':config.get('url',''),'status_code':status_code,'success':success,'duration_ms':int((time.perf_counter()-api_started)*1000),'response':response_data,'error':error}
                try:api_log(event)
                except Exception:logging.getLogger('agentforge').exception('Workflow API log callback failed for bot %s',getattr(api_log,'bot_id','unknown'))
            try:
                api_result=await call_api(config,variables)
                variables[config.get('variable','api_result')]=api_result
                entry['http_status']=api_result['status']
                if api_result['status']>=400:
                    entry['status']='failed';label='error';log_api_call(False,api_result['status'],api_result.get('data'),f"HTTP {api_result['status']}")
                    if not next_node(current,'error'):
                        log_step(entry)
                        outputs.append(config.get('error_message','The connected service is temporarily unavailable. Please try again.'))
                        break
                else:log_api_call(True,api_result['status'],api_result.get('data'))
            except Exception as error:
                entry['status']='failed';label='error';variables[config.get('variable','api_result')]={'error':'The connected service could not complete the request.'}
                safe_error=str(error) if isinstance(error,ValueError) else f'{type(error).__name__}: request failed'
                log_api_call(False,None,None,safe_error)
                if not next_node(current,'error'):
                    log_step(entry)
                    outputs.append(config.get('error_message','The connected service is temporarily unavailable. Please try again.'))
                    break
        elif kind=='knowledge':
            try: data=await knowledge(render(config.get('query','{{message}}'),variables))
            except Exception:
                entry['status']='failed'
                data={'answer':'Knowledge search is temporarily unavailable. Please try again.','citations':[],'confidence':0,'abstained':True,'model':'guardrail','tokens':0,'cost':0}
            entry['confidence']=data.get('confidence',0);entry['abstained']=bool(data.get('abstained'));entry['citation_count']=len(data.get('citations',[]))
            outputs.append(data['answer']);result.update({k:v for k,v in data.items() if k!='answer'})
        log_step(entry)
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

@router.get('/logs')
def api_logs(bot_id:str,hours:int=24,status:str='all',event_type:str='all',limit:int=200,offset:int=0,db=Depends(get_db),user=Depends(current_user)):
    owned_bot(db,bot_id,user)
    if not 1<=hours<=24: raise HTTPException(422,'Choose a time range from 1 to 24 hours.')
    if status not in ('all','success','error'): raise HTTPException(422,'Status must be all, success, or error.')
    allowed_types=('all','message_received','workflow_step','api_call','knowledge_search','knowledge_source','assistant_response','workflow_saved','workflow_published','workflow_enabled','agent_created','agent_settings','error')
    if event_type not in allowed_types: raise HTTPException(422,'Unknown bot log event type.')
    if not 1<=limit<=500 or offset<0: raise HTTPException(422,'Invalid log page size or offset.')
    cleanup_api_logs(db);db.commit()
    cutoff=(datetime.now(timezone.utc)-timedelta(hours=hours)).isoformat()
    query=db.query(BotActivityLog).filter(BotActivityLog.bot_id==bot_id,BotActivityLog.created_at>=cutoff)
    if event_type=='error':query=query.filter(BotActivityLog.severity=='error')
    elif event_type!='all':query=query.filter(BotActivityLog.event_type==event_type)
    if status=='success':query=query.filter(BotActivityLog.severity!='error')
    elif status=='error':query=query.filter(BotActivityLog.severity=='error')
    total=query.count()
    fetch=offset+limit
    rows=query.order_by(BotActivityLog.created_at.desc()).limit(fetch).all()
    items=[]
    for row in rows:
        details=row.details or {}
        response=details.get('response')
        items.append({'id':row.id,'created_at':row.created_at,'source':row.source,'event_type':row.event_type,'severity':row.severity,'title':row.title,'conversation_id':row.conversation_id,'details':details,'node_id':details.get('node_id'),'node_name':details.get('node_name'),'method':details.get('method'),'url':details.get('url'),'status_code':details.get('status_code'),'success':row.severity!='error','duration_ms':details.get('duration_ms',0),'response_preview':response_preview(response) if response is not None else None,'error':details.get('error')})
    # Preserve API calls captured by older versions while they age out of the 24-hour window.
    if event_type in ('all','api_call','error'):
        legacy=db.query(WorkflowApiLog).filter(WorkflowApiLog.bot_id==bot_id,WorkflowApiLog.created_at>=cutoff)
        if event_type=='error':legacy=legacy.filter(WorkflowApiLog.success==0)
        if status=='success':legacy=legacy.filter(WorkflowApiLog.success==1)
        elif status=='error':legacy=legacy.filter(WorkflowApiLog.success==0)
        total+=legacy.count()
        for row in legacy.order_by(WorkflowApiLog.created_at.desc()).limit(fetch).all():
            items.append({'id':row.id,'created_at':row.created_at,'source':row.source,'event_type':'api_call','severity':'info' if row.success else 'error','title':f'{row.method} {row.node_name}','conversation_id':row.conversation_id,'details':{},'node_id':row.node_id,'node_name':row.node_name,'method':row.method,'url':row.url,'status_code':row.status_code,'success':bool(row.success),'duration_ms':row.duration_ms,'response_preview':row.response_preview,'error':row.error})
    items.sort(key=lambda item:item['created_at'],reverse=True)
    return {'items':items[offset:offset+limit],'total':total,'hours':hours,'status':status,'event_type':event_type,'limit':limit,'offset':offset}

@router.put('')
def save(bot_id:str,body:SaveInput,db=Depends(get_db),user=Depends(current_user)):
    owned_bot(db,bot_id,user);validate_graph(body.graph);w=get_workflow(db,bot_id)
    w.draft=secure_graph(body.graph,w.draft);w.updated_at=now();db.commit()
    record_bot_log(db,bot_id,'dashboard',None,{'event_type':'workflow_saved','severity':'info','title':'Workflow draft saved','details':{'node_count':len(body.graph.get('nodes',[])),'edge_count':len(body.graph.get('edges',[]))}})
    return {'graph':public_graph(w.draft),'updated_at':w.updated_at}

@router.post('/publish')
def publish(bot_id:str,db=Depends(get_db),user=Depends(current_user)):
    owned_bot(db,bot_id,user);w=get_workflow(db,bot_id);validate_graph(w.draft,publish=True)
    w.published_graph=copy.deepcopy(w.draft);w.version+=1;w.enabled=1;w.updated_at=now();db.commit()
    record_bot_log(db,bot_id,'dashboard',None,{'event_type':'workflow_published','severity':'info','title':'Workflow published','details':{'version':w.version,'node_count':len(w.published_graph.get('nodes',[]))}})
    return {'enabled':True,'version':w.version}

@router.patch('/enabled')
def enabled(bot_id:str,body:EnableInput,db=Depends(get_db),user=Depends(current_user)):
    owned_bot(db,bot_id,user);w=get_workflow(db,bot_id)
    if body.enabled and not w.published_graph: raise HTTPException(422,'Publish a workflow before enabling it.')
    w.enabled=int(body.enabled);db.commit();record_bot_log(db,bot_id,'dashboard',None,{'event_type':'workflow_enabled','severity':'info','title':'Workflow '+('enabled' if w.enabled else 'disabled'),'details':{'enabled':bool(w.enabled)}});return {'enabled':bool(w.enabled)}

@router.post('/test')
async def test(bot_id:str,body:TestInput,db=Depends(get_db),user=Depends(current_user)):
    bot=owned_bot(db,bot_id,user);w=get_workflow(db,bot_id);validate_graph(w.draft,publish=True)
    if INJECTION.search(body.message): return {'answer':"I can't follow instructions that override my safety rules.",'trace':[],'state':{},'citations':[],'confidence':0}
    if len(json.dumps(body.state))>50000: raise HTTPException(422,'Test session is too large. Reset the emulator.')
    result=await run_graph(w.draft,body.message,body.state,lambda q:knowledge_answer(db,bot,q),api_log=lambda event:record_api_log(db,bot.id,'playground',None,event),activity_log=lambda event:record_bot_log(db,bot.id,'playground',None,event))
    record_bot_log(db,bot.id,'playground',None,{'event_type':'assistant_response','severity':'warning' if result.get('abstained') else 'info','title':'Playground workflow test completed','details':{'confidence':round(float(result.get('confidence',0)),4),'citation_count':len(result.get('citations',[])),'abstained':bool(result.get('abstained')),'trace_steps':len(result.get('trace',[]))}})
    return result
