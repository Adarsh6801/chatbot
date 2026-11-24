"""Redis/Celery workers are enabled by REDIS_URL; local mode uses BackgroundTasks."""
import asyncio
import os
from datetime import datetime, timedelta, timezone
from celery import Celery

celery = Celery('agentforge', broker=os.getenv('REDIS_URL', 'redis://localhost:6379/0'))
celery.conf.update(task_serializer='json', accept_content=['json'], task_acks_late=True, worker_prefetch_multiplier=1, task_reject_on_worker_lost=True, broker_connection_retry_on_startup=True, task_ignore_result=True)
celery.conf.beat_schedule = {'recover-persisted-ingestion':{'task':'agentforge.recover','schedule':60.0},'prune-workflow-api-logs':{'task':'agentforge.cleanup_api_logs','schedule':60.0}}

@celery.task(name='agentforge.ingest', autoretry_for=(ConnectionError,), retry_backoff=True, max_retries=3)
def ingest_job(document_id):
    from .ingestion import ingest
    asyncio.run(ingest(document_id))

@celery.task(name='agentforge.recover')
def recover_jobs():
    import time
    from sqlalchemy import or_, and_
    from .database import Session, Document
    with Session() as db:
        jobs=db.query(Document).filter(or_(Document.status=='PENDING',and_(Document.status=='PROCESSING',Document.processing_at < time.time()-600))).limit(100).all()
        for doc in jobs: ingest_job.delay(doc.id)

@celery.task(name='agentforge.cleanup_api_logs')
def cleanup_api_logs():
    from .database import Session, WorkflowApiLog, BotActivityLog
    cutoff=(datetime.now(timezone.utc)-timedelta(hours=24)).isoformat()
    with Session() as db:
        db.query(WorkflowApiLog).filter(WorkflowApiLog.created_at < cutoff).delete(synchronize_session=False)
        db.query(BotActivityLog).filter(BotActivityLog.created_at < cutoff).delete(synchronize_session=False)
        db.commit()

def dispatch(tasks, document_id):
    if os.getenv('REDIS_URL'):
        try: ingest_job.delay(document_id)
        except Exception:
            # Persisted PENDING job is recovered at the next API startup; do not lose it.
            import logging
            logging.getLogger('agentforge').error('Queue unavailable; document remains PENDING for recovery.')
            from .database import Session, Document
            with Session() as db:
                doc=db.get(Document,document_id)
                if doc:
                    doc.error='Queue unavailable. Automatic recovery will retry this source.'
                    db.commit()
    else:
        from .ingestion import ingest
        tasks.add_task(ingest, document_id)
