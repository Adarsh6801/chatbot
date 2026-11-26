"""Admin-managed public chat templates and safe theme normalization."""
import json
import re

from .database import AppSetting, now, uid

DEFAULT_THEME = {
    'layout': 'classic', 'accent_color': '#d6ff63', 'surface_color': '#ffffff',
    'text_color': '#252b25', 'muted_color': '#858b80', 'header_subtitle': 'Grounded in your knowledge',
    'welcome_title': 'Your answers start here.', 'suggested_prompt': 'What can you help me with?',
    'footer_text': 'Answers include source evidence', 'corner_radius': 16,
    'show_header': True, 'show_avatar': True, 'show_header_subtitle': True,
    'show_new_chat': True, 'show_welcome': True, 'show_welcome_icon': True,
    'show_suggestion': True, 'show_citations': True, 'show_footer': True,
}

DEFAULT_TEMPLATES = [
    {'id':'classic','name':'Classic','description':'A familiar assistant layout with a welcome prompt and source citations.','active':True,'config':dict(DEFAULT_THEME)},
    {'id':'minimal','name':'Minimal','description':'A quiet, compact chat with less decoration and a focused conversation area.','active':True,'config':{**DEFAULT_THEME,'layout':'minimal','surface_color':'#fbfbfa','accent_color':'#b7c7a1','corner_radius':10,'show_welcome_icon':False,'show_header_subtitle':False,'footer_text':'Powered by AgentForge'}},
    {'id':'studio','name':'Studio','description':'A warmer, more expressive welcome screen for branded support experiences.','active':True,'config':{**DEFAULT_THEME,'layout':'studio','surface_color':'#fffaf2','accent_color':'#eabf83','text_color':'#392f28','muted_color':'#8e7968','corner_radius':22,'welcome_title':'How can we help today?','suggested_prompt':'Show me what you can help with'}},
    {'id':'helpdesk','name':'Support Desk','description':'A focused support experience with clear service details.','active':True,'config':{**DEFAULT_THEME,'layout':'helpdesk','accent_color':'#3978d4','surface_color':'#f7faff','text_color':'#1c2c43','muted_color':'#718096','header_subtitle':'Support is here to help','welcome_title':'How can we help you today?','suggested_prompt':'I need help with my account','footer_text':'Support replies are based on verified help content','corner_radius':14}},
    {'id':'knowledge','name':'Knowledge Base','description':'A clear reference style for documentation and product answers.','active':True,'config':{**DEFAULT_THEME,'layout':'knowledge','accent_color':'#297b69','surface_color':'#f7fbf9','text_color':'#183b34','muted_color':'#6c8980','header_subtitle':'Answers from your knowledge base','welcome_title':'Find the answer you need.','suggested_prompt':'Search the product documentation','corner_radius':8}},
    {'id':'concierge','name':'Concierge','description':'A welcoming, premium assistant for guided customer experiences.','active':True,'config':{**DEFAULT_THEME,'layout':'concierge','accent_color':'#b58a50','surface_color':'#fffdf8','text_color':'#3b3328','muted_color':'#887b69','header_subtitle':'Your personal guide','welcome_title':'Welcome. Where shall we begin?','suggested_prompt':'Help me find the right place to start','corner_radius':24}},
    {'id':'boutique','name':'Boutique','description':'A refined warm palette for retail and lifestyle brands.','active':True,'config':{**DEFAULT_THEME,'layout':'boutique','accent_color':'#bd6e72','surface_color':'#fff8f6','text_color':'#432d31','muted_color':'#9b7478','header_subtitle':'A little help, thoughtfully delivered','welcome_title':'What are you looking for?','suggested_prompt':'Help me choose a product','corner_radius':18}},
    {'id':'bold','name':'Bold Launch','description':'A high contrast experience for product launches and modern SaaS.','active':True,'config':{**DEFAULT_THEME,'layout':'bold','accent_color':'#7257f5','surface_color':'#17152a','text_color':'#f4f2ff','muted_color':'#aaa5c5','header_subtitle':'Product support · Online','welcome_title':'Let’s make it happen.','suggested_prompt':'Show me what is new','footer_text':'Powered by your product team','corner_radius':20}},
    {'id':'editorial','name':'Editorial','description':'A typographic, reading-first layout for expert assistants.','active':True,'config':{**DEFAULT_THEME,'layout':'editorial','accent_color':'#c45d37','surface_color':'#fffdf9','text_color':'#302a25','muted_color':'#81766b','header_subtitle':'A considered answer, every time','welcome_title':'What would you like to know?','suggested_prompt':'Give me a concise overview','corner_radius':6}},
    {'id':'compact','name':'Compact','description':'A dense, efficient layout for quick answers and repeat visitors.','active':True,'config':{**DEFAULT_THEME,'layout':'compact','accent_color':'#1687a7','surface_color':'#f7fbfc','text_color':'#20343b','muted_color':'#71878e','header_subtitle':'Quick answers, grounded in sources','welcome_title':'What can I answer?','suggested_prompt':'Show me the most common questions','show_welcome_icon':False,'corner_radius':10}},
    {'id':'night','name':'Night Shift','description':'A calm dark theme for technical products and after-hours support.','active':True,'config':{**DEFAULT_THEME,'layout':'night','accent_color':'#67d5bb','surface_color':'#111c24','text_color':'#e8f1f2','muted_color':'#94a8ad','header_subtitle':'Here whenever you need us','welcome_title':'What are you working on?','suggested_prompt':'Help me troubleshoot an issue','corner_radius':16}},
    {'id':'personal-ai','name':'Personal AI','description':'A calm, personal assistant for everyday questions, planning, and reflection.','active':True,'context_default':True,'config':{**DEFAULT_THEME,'layout':'minimal','accent_color':'#7967d8','surface_color':'#f8f7ff','text_color':'#29263d','muted_color':'#827e99','header_subtitle':'Your personal assistant','welcome_title':'What’s on your mind?','suggested_prompt':'Help me plan my day','footer_text':'Here to help, whenever you need','corner_radius':18}},
    {'id':'product-support','name':'Product Support','description':'A clear support desk for product questions, troubleshooting, and account help.','active':True,'context_default':True,'config':{**DEFAULT_THEME,'layout':'helpdesk','accent_color':'#2875d8','surface_color':'#f5f9ff','text_color':'#1e2c42','muted_color':'#6f7f96','header_subtitle':'Product support · Online','welcome_title':'How can we help with your product?','suggested_prompt':'Help me troubleshoot an issue','footer_text':'Answers based on verified product information','corner_radius':14}},
    {'id':'sales-assistant','name':'Sales Assistant','description':'A friendly guide to product fit, plans, pricing, and next steps.','active':True,'context_default':True,'config':{**DEFAULT_THEME,'layout':'concierge','accent_color':'#07877d','surface_color':'#f2fbf9','text_color':'#173d3a','muted_color':'#658783','header_subtitle':'Let’s find the right fit','welcome_title':'What are you looking to achieve?','suggested_prompt':'Help me choose the right plan','footer_text':'Explore at your own pace','corner_radius':20}},
    {'id':'shopping-assistant','name':'Shopping Assistant','description':'A polished shopping guide for product discovery, comparisons, and recommendations.','active':True,'context_default':True,'config':{**DEFAULT_THEME,'layout':'boutique','accent_color':'#bf6572','surface_color':'#fff8f7','text_color':'#432d34','muted_color':'#98757d','header_subtitle':'Your shopping assistant','welcome_title':'Looking for something special?','suggested_prompt':'Help me find the right product','footer_text':'Thoughtful recommendations, based on your needs','corner_radius':18}},
    {'id':'booking-assistant','name':'Booking Assistant','description':'A helpful concierge for appointments, reservations, availability, and booking questions.','active':True,'context_default':True,'config':{**DEFAULT_THEME,'layout':'studio','accent_color':'#b17b45','surface_color':'#fffaf3','text_color':'#3c3026','muted_color':'#8b7967','header_subtitle':'Booking concierge · Ready to help','welcome_title':'Where would you like to go?','suggested_prompt':'Help me make a booking','footer_text':'I can help you find the right time','corner_radius':20}},
    {'id':'hr-assistant','name':'HR Assistant','description':'An approachable internal assistant for workplace policies, benefits, and people operations.','active':True,'context_default':True,'config':{**DEFAULT_THEME,'layout':'knowledge','accent_color':'#40816a','surface_color':'#f5faf7','text_color':'#233a31','muted_color':'#70877b','header_subtitle':'People team · Internal help','welcome_title':'How can I help at work?','suggested_prompt':'Find information about leave and benefits','footer_text':'Answers from your workplace resources','corner_radius':12}},
    {'id':'learning-tutor','name':'Learning Tutor','description':'A supportive learning companion for explanations, practice, and study questions.','active':True,'context_default':True,'config':{**DEFAULT_THEME,'layout':'editorial','accent_color':'#c26c3c','surface_color':'#fffaf5','text_color':'#392f29','muted_color':'#88796d','header_subtitle':'Your learning companion','welcome_title':'What would you like to learn?','suggested_prompt':'Explain a topic step by step','footer_text':'Keep asking questions as you learn','corner_radius':12}},
    {'id':'developer-assistant','name':'Developer Assistant','description':'A technical helper for API references, setup guides, and developer troubleshooting.','active':True,'context_default':True,'config':{**DEFAULT_THEME,'layout':'night','accent_color':'#52c7aa','surface_color':'#101b23','text_color':'#e7f1f3','muted_color':'#92a8ae','header_subtitle':'Developer docs · Online','welcome_title':'What are you building?','suggested_prompt':'Help me get started with the API','footer_text':'Answers grounded in your technical docs','corner_radius':14}},
    {'id':'finance-assistant','name':'Finance Assistant','description':'A straightforward guide for billing, invoices, payments, and account questions.','active':True,'context_default':True,'config':{**DEFAULT_THEME,'layout':'compact','accent_color':'#227b68','surface_color':'#f5faf8','text_color':'#213c34','muted_color':'#70867e','header_subtitle':'Billing support · Online','welcome_title':'What can I help you with today?','suggested_prompt':'I have a question about an invoice','footer_text':'Answers based on your billing information','corner_radius':10}},
]

LAYOUTS = ('classic','minimal','studio','helpdesk','knowledge','concierge','boutique','bold','editorial','compact','night')

TEXT_LIMITS = {'header_subtitle':120,'welcome_title':120,'suggested_prompt':180,'footer_text':180}
COLOR_FIELDS = ('accent_color','surface_color','text_color','muted_color')
BOOLEAN_FIELDS = ('show_header','show_avatar','show_header_subtitle','show_new_chat','show_welcome','show_welcome_icon','show_suggestion','show_citations','show_footer')

def normalize_theme(value, base=None):
    if not isinstance(value, dict):
        raise ValueError('Template config must be an object.')
    result = {**DEFAULT_THEME, **(base or {}), **value}
    if result.get('layout') not in LAYOUTS:
        raise ValueError('Choose a supported chat layout.')
    for key in COLOR_FIELDS:
        if not isinstance(result.get(key), str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', result[key]):
            raise ValueError(f'{key} must be a six-digit hex color.')
        result[key] = result[key].lower()
    for key, limit in TEXT_LIMITS.items():
        result[key] = str(result.get(key, DEFAULT_THEME[key])).strip()[:limit]
    for key in BOOLEAN_FIELDS:
        if not isinstance(result.get(key), bool):
            raise ValueError(f'{key} must be a boolean.')
    try:
        result['corner_radius'] = max(6, min(28, int(result.get('corner_radius', DEFAULT_THEME['corner_radius']))))
    except (TypeError, ValueError) as exc:
        raise ValueError('corner_radius must be a number from 6 to 28.') from exc
    return {key: result[key] for key in DEFAULT_THEME}

def normalize_customization(value):
    if not isinstance(value, dict):
        raise ValueError('Chat customization must be an object.')
    normalized = normalize_theme(value)
    return {key:normalized[key] for key in value if key in DEFAULT_THEME}

def get_templates(db):
    setting = db.get(AppSetting, 'chat_templates')
    if not setting:
        return [dict(row, config=dict(row['config'])) for row in DEFAULT_TEMPLATES]
    try:
        value = json.loads(setting.value)
        if not isinstance(value, list):
            return []
        # Add newly shipped starter templates once to catalogs created by older versions.
        marker = db.get(AppSetting, 'chat_templates_defaults_v3')
        if marker:
            return value
        existing = {row.get('id') for row in value if isinstance(row, dict)}
        return value + [dict(row, config=dict(row['config'])) for row in DEFAULT_TEMPLATES if row.get('context_default') and row['id'] not in existing]
    except (ValueError, TypeError):
        return []

def write_templates(db, templates):
    setting = db.get(AppSetting, 'chat_templates')
    payload = json.dumps(templates, separators=(',', ':'))
    if setting:
        setting.value, setting.updated_at = payload, now()
    else:
        db.add(AppSetting(key='chat_templates', value=payload, updated_at=now()))
    if not db.get(AppSetting, 'chat_templates_defaults_v3'):
        db.add(AppSetting(key='chat_templates_defaults_v3', value='1', updated_at=now()))

def template_data(template):
    return {'id':template['id'],'name':template['name'],'description':template.get('description',''),'active':bool(template.get('active',True)),'config':normalize_theme(template.get('config',{}))}

def resolve_agent_theme(db, widget_config):
    templates = get_templates(db)
    selected_id = (widget_config or {}).get('chat_template_id') or 'classic'
    template = next((item for item in templates if item.get('id') == selected_id), None)
    if template is None:
        template = next((item for item in DEFAULT_TEMPLATES if item['id'] == 'classic'), DEFAULT_TEMPLATES[0])
    base = normalize_theme(template.get('config') or {})
    overrides = (widget_config or {}).get('chat_customization') or {}
    return normalize_theme(overrides, base), template_data(template)
