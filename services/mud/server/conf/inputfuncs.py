"""
Input functions

Input functions are always called from the client (they handle server
input, hence the name).

This module is loaded by being included in the
`settings.INPUT_FUNC_MODULES` tuple.

All *global functions* included in this module are considered
input-handler functions and can be called by the client to handle
input.

An input function must have the following call signature:

    cmdname(session, *args, **kwargs)

Where session will be the active session and *args, **kwargs are extra
incoming arguments and keyword properties.

A special command is the "default" command, which is will be called
when no other cmdname matches. It also receives the non-found cmdname
as argument.

    default(session, cmdname, *args, **kwargs)

"""

# def oob_echo(session, *args, **kwargs):
#     """
#     Example echo function. Echoes args, kwargs sent to it.
#
#     Args:
#         session (Session): The Session to receive the echo.
#         args (list of str): Echo text.
#         kwargs (dict of str, optional): Keyed echo text
#
#     """
#     session.msg(oob=("echo", args, kwargs))
#
#
# def default(session, cmdname, *args, **kwargs):
#     """
#     Handles commands without a matching inputhandler func.
#
#     Args:
#         session (Session): The active Session.
#         cmdname (str): The (unmatched) command name
#         args, kwargs (any): Arguments to function.
#
#     """
#     pass


# ---- the site's own (docs/09): a client asks for what world/oob.py otherwise sends on its own.
def _char(session):
    return session.puppet if session else None


def vitals_get(session, *args, **kwargs):
    from world import oob

    char = _char(session)
    if char:
        session.msg(vitals=((), oob.vitals(char)))


def room_get(session, *args, **kwargs):
    from world import oob

    char = _char(session)
    info = oob.room_info(char) if char else None
    if info:
        session.msg(room_info=((), info))


def area_map(session, *args, **kwargs):
    from world import oob

    char = _char(session)
    if char:
        session.msg(area_map=((), oob.area_map(char)))
