import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from .database import get_db, User, now
from .config import PRODUCTION, PUBLIC_WEB_URL
from .plan_catalog import get_plan_limits, get_plan
from .security import password_hash, current_user
from sqlalchemy.exc import IntegrityError

router = APIRouter(prefix='/api/v1/auth')

@router.get('/config')
def config():
    return {'google_enabled':bool(os.getenv('GOOGLE_CLIENT_ID') and os.getenv('GOOGLE_CLIENT_SECRET'))}

@router.get('/google/start')
def google_start(request:Request,link:bool=False,admin:bool=False,db=Depends(get_db)):
    if not os.getenv('GOOGLE_CLIENT_ID') or not os.getenv('GOOGLE_CLIENT_SECRET'): raise HTTPException(503,'Google sign-in is not configured.')
    state=secrets.token_urlsafe(32)
    verifier=secrets.token_urlsafe(48)
    import hashlib, base64
    challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
    params={'client_id':os.environ['GOOGLE_CLIENT_ID'],'redirect_uri':os.getenv('GOOGLE_REDIRECT_URI','http://localhost:8000/api/v1/auth/google/callback'),'response_type':'code','scope':'openid email profile','state':state,'code_challenge':challenge,'code_challenge_method':'S256'}
    response=RedirectResponse('https://accounts.google.com/o/oauth2/v2/auth?'+urlencode(params))
    cookie_domain=os.getenv('COOKIE_DOMAIN') or None
    response.set_cookie('af_oauth_state',state,max_age=600,httponly=True,secure=PRODUCTION,samesite='lax',domain=cookie_domain)
    response.set_cookie('af_oauth_verifier',verifier,max_age=600,httponly=True,secure=PRODUCTION,samesite='lax',domain=cookie_domain)
    if admin: response.set_cookie('af_oauth_admin','1',max_age=600,httponly=True,secure=PRODUCTION,samesite='lax',domain=cookie_domain)
    else: response.delete_cookie('af_oauth_admin',domain=cookie_domain)
    if link:
        user=current_user(request,db)
        response.set_cookie('af_oauth_link',user.id,max_age=600,httponly=True,secure=PRODUCTION,samesite='lax',domain=cookie_domain)
    else: response.delete_cookie('af_oauth_link',domain=cookie_domain)
    return response

@router.get('/google/callback')
async def google_callback(request:Request, code:str='', state:str='', db=Depends(get_db)):
    expected=request.cookies.get('af_oauth_state','')
    verifier=request.cookies.get('af_oauth_verifier','')
    if not expected or not state or not hmac.compare_digest(state,expected) or not verifier or not code:
        raise HTTPException(400,'Invalid or expired sign-in request.')
    if not os.getenv('GOOGLE_CLIENT_SECRET'): raise HTTPException(503,'Google sign-in is not configured.')
    async with httpx.AsyncClient(timeout=20) as client:
        token=await client.post('https://oauth2.googleapis.com/token',data={'client_id':os.environ['GOOGLE_CLIENT_ID'],'client_secret':os.environ['GOOGLE_CLIENT_SECRET'],'code':code,'code_verifier':verifier,'grant_type':'authorization_code','redirect_uri':os.getenv('GOOGLE_REDIRECT_URI','http://localhost:8000/api/v1/auth/google/callback')})
        if token.status_code!=200: raise HTTPException(400,'Google sign-in could not be completed.')
        profile=await client.get('https://openidconnect.googleapis.com/v1/userinfo',headers={'Authorization':'Bearer '+token.json()['access_token']})
        if profile.status_code!=200: raise HTTPException(400,'Google profile could not be verified.')
        info=profile.json()
    if not info.get('email_verified') or not info.get('email') or not info.get('sub'): raise HTTPException(403,'A verified Google email is required.')
    email=info['email'].lower()
    linked=request.cookies.get('af_oauth_link')
    if linked:
        user=current_user(request,db)
        if user.id!=linked: raise HTTPException(400,'The account-linking session has changed. Start again.')
        taken=db.query(User).filter(User.google_sub==info['sub'],User.id!=user.id).first()
        if taken: raise HTTPException(409,'That Google account is connected to another workspace.')
    else: user=db.query(User).filter_by(google_sub=info['sub']).first() or db.query(User).filter_by(email=email).first()
    if user and not user.is_active: raise HTTPException(403,'This account has been suspended. Contact support.')
    if not user:
        free_enabled = get_plan(db, 'free') is not None
        free_started_at = now() if free_enabled else (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
        user=User(email=email,name=info.get('name','Builder')[:80],password=password_hash(secrets.token_urlsafe(48)),free_started_at=free_started_at,free_trial_used=1,subscription_tokens=get_plan_limits(db, 'free')['tokens'] if free_enabled else 0)
        db.add(user)
    user.google_sub=info['sub']
    if str(info.get('picture','')).startswith('https://'): user.avatar_url=info['picture'][:2000]
    try: db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409,'That Google account is already connected. Please sign in again.')
    admin_login=request.cookies.get('af_oauth_admin')=='1'
    response=RedirectResponse(os.getenv('ADMIN_WEB_ORIGIN','http://localhost:3001') if admin_login else PUBLIC_WEB_URL + '/agents')
    from .main import set_session
    set_session(response,db,user)
    cookie_domain=os.getenv('COOKIE_DOMAIN') or None
    response.delete_cookie('af_oauth_state',domain=cookie_domain)
    response.delete_cookie('af_oauth_verifier',domain=cookie_domain)
    response.delete_cookie('af_oauth_link',domain=cookie_domain)
    response.delete_cookie('af_oauth_admin',domain=cookie_domain)
    return response
