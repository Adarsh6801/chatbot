import hashlib
import hmac
import secrets
import time
import os
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from .database import get_db, User, LoginSession, ApiKey, Bot, RateBucket

def digest(token): return hashlib.sha256(token.encode()).hexdigest()

def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    return salt + ':' + hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()

def verify_password(password, encoded):
    salt = encoded.split(':')[0]
    return hmac.compare_digest(password_hash(password, salt), encoded)

def current_user(request: Request, db: Session = Depends(get_db)):
    token = request.cookies.get('agentforge_session')
    bearer = request.headers.get('authorization', '')
    if bearer.startswith('Bearer '):
        key = db.query(ApiKey).filter_by(key_hash=digest(bearer[7:])).first()
        if key:
            return db.get(User, key.user_id)
    if token:
        session = db.get(LoginSession, digest(token))
        if session and session.expires_at > time.time():
            user = db.get(User, session.user_id)
            if user: return user
    raise HTTPException(401, 'Sign in to continue.')

def owned_bot(db, bot_id, user):
    bot = db.query(Bot).filter_by(id=bot_id, user_id=user.id).first()
    if not bot: raise HTTPException(404, 'Agent not found.')
    return bot

def rate_limit(db, key, limit=30, seconds=60):
    if os.getenv('REDIS_URL'):
        import redis
        cache = redis.Redis.from_url(os.environ['REDIS_URL'], socket_timeout=2, socket_connect_timeout=2)
        window = int(time.time()) // seconds
        script = "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return n"
        try:
            count = cache.eval(script, 1, 'af:rate:'+digest(key)+':'+str(window), seconds)
            if count > limit: raise HTTPException(429, 'Too many requests. Please try again shortly.', headers={'Retry-After':str(seconds)})
            return
        except redis.RedisError:
            pass
    # Atomic SQL update shared by API processes; no per-process limiter bypass.
    from sqlalchemy import update
    from sqlalchemy.exc import IntegrityError
    window = int(time.time()) // seconds
    bucket_key = digest(key) + ':' + str(window)
    bucket = db.get(RateBucket, bucket_key)
    if not bucket:
        try:
            with db.begin_nested():
                db.add(RateBucket(key=bucket_key, window=window, count=0))
                db.flush()
        except IntegrityError:
            pass
    result = db.execute(update(RateBucket).where(RateBucket.key == bucket_key, RateBucket.count < limit).values(count=RateBucket.count + 1))
    db.commit()
    if result.rowcount != 1: raise HTTPException(429, 'Too many requests. Please try again shortly.', headers={'Retry-After': str(seconds)})
