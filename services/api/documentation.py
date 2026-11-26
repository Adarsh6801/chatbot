"""Public read-only routes for the editable customer documentation center."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .database import DocumentationCategory, DocumentationPage, get_db

router = APIRouter(prefix='/api/v1/public/docs', tags=['documentation'])


def page_summary(page: DocumentationPage) -> dict:
    return {
        'id': page.id, 'category_id': page.category_id, 'title': page.title,
        'slug': page.slug, 'summary': page.summary, 'status': page.status,
        'position': page.position, 'updated_at': page.updated_at,
    }


@router.get('')
def documentation_index(q: str = Query('', max_length=120), db: Session = Depends(get_db)):
    categories = db.query(DocumentationCategory).order_by(DocumentationCategory.position, DocumentationCategory.title).all()
    page_query = db.query(DocumentationPage).join(DocumentationCategory, DocumentationPage.category_id == DocumentationCategory.id).filter(DocumentationPage.status == 'published')
    if q.strip():
        needle = '%' + q.strip().replace('\\', '\\\\').replace('%', r'\%').replace('_', r'\_') + '%'
        page_query = page_query.filter(or_(
            DocumentationPage.title.ilike(needle, escape='\\'),
            DocumentationPage.summary.ilike(needle, escape='\\'),
            DocumentationPage.content.ilike(needle, escape='\\'),
            DocumentationCategory.title.ilike(needle, escape='\\'),
            DocumentationCategory.description.ilike(needle, escape='\\'),
        ))
    pages = page_query.order_by(DocumentationPage.position, DocumentationPage.title).all()
    pages_by_category: dict[str, list[dict]] = {}
    for page in pages:
        pages_by_category.setdefault(page.category_id, []).append(page_summary(page))
    return {'categories': [
        {'id': category.id, 'title': category.title, 'slug': category.slug,
         'description': category.description, 'position': category.position,
         'pages': pages_by_category.get(category.id, [])}
        for category in categories if pages_by_category.get(category.id)
    ]}


@router.get('/{slug}')
def documentation_page(slug: str, db: Session = Depends(get_db)):
    page = db.query(DocumentationPage).filter_by(slug=slug, status='published').first()
    if not page:
        raise HTTPException(404, 'Documentation page not found.')
    category = db.get(DocumentationCategory, page.category_id)
    return {**page_summary(page), 'content': page.content,
            'category': {'title': category.title, 'slug': category.slug} if category else None}
