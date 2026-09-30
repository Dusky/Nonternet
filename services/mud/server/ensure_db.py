"""
Creates the MUD's database on its Postgres server if it isn't there yet (docs/15). Run before
`evennia migrate` in the container. Does nothing without MUD_DATABASE_URL (SQLite is used then).
"""
import os
import sys
from urllib.parse import urlparse

url = os.environ.get("MUD_DATABASE_URL")
if not url:
    sys.exit(0)

import psycopg  # noqa: E402

name = urlparse(url).path.lstrip("/")
if not name.replace("_", "").isalnum():
    sys.exit(f"MUD_DATABASE_URL names an odd database: {name!r}")
admin = urlparse(url)._replace(path="/postgres").geturl()
with psycopg.connect(admin, autocommit=True) as conn:
    if not conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone():
        conn.execute(f'CREATE DATABASE "{name}"')
        print(f"Created database {name}.")
