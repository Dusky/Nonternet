"""Container health: the game server is up once its internal API answers (it refuses without a token)."""
import sys
import urllib.error
import urllib.request

try:
    urllib.request.urlopen("http://127.0.0.1:4001/internal/status", timeout=3)
    sys.exit(0)
except urllib.error.HTTPError as err:
    sys.exit(0 if err.code == 403 else 1)
except Exception:
    sys.exit(1)
