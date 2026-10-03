"""
The tower's season and seed (docs/18). There is one shared tower per season. The same seed always builds the same
floors, so a floor can be rebuilt or tested and come out identical.
"""
import random

from evennia.server.models import ServerConfig

KEY = "tower_season"


def current():
    """{"season": n, "seed": int} for the season now running, made on first use."""
    s = ServerConfig.objects.conf(KEY)
    if not s:
        s = {"season": 1, "seed": random.SystemRandom().randrange(2**31)}
        ServerConfig.objects.conf(KEY, value=s)
    return dict(s)


def rng(seed, *parts):
    """A random generator fixed by the seed and the parts given (a floor number, say)."""
    return random.Random(":".join(str(p) for p in (seed, *parts)))
