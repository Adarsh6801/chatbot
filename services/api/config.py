import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# Read local configuration without requiring an additional runtime dependency.
if (ROOT / '.env').exists():
    for line in (ROOT / '.env').read_text(encoding='utf-8').splitlines():
        if line.strip() and not line.lstrip().startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            os.environ.setdefault(key.strip(), value.strip().strip('\"').strip("'"))

DATABASE_URL = os.getenv('DATABASE_URL', 'sqlite:///./data/agentforge.db')
WEB_ORIGIN = os.getenv('WEB_ORIGIN', 'http://localhost:3000')
PUBLIC_WEB_URL = os.getenv('PUBLIC_WEB_URL', WEB_ORIGIN)
PRODUCTION = os.getenv('APP_ENV') == 'production'
PLANS = {
    'free': {'bots': 2, 'documents': 10, 'messages': 100},
    'pro': {'bots': 10, 'documents': 100, 'messages': 5000},
    'team': {'bots': 50, 'documents': 500, 'messages': 25000},
}
