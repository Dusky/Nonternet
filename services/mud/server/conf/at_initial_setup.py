"""Runs once, the first time the server starts with an empty database."""


def at_initial_setup():
    from world.build_town import build_town

    build_town()
