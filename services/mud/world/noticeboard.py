"""
The tavern noticeboard (docs/18): short notes people pin for each other. They are the person's own words, so they are in
their export (keyed by the core account id, never the in-game name) and go with the account when it is erased. Builders and
admins can take a note down. Kept as a list on the board object.
"""
import re
import time

from evennia.utils.ansi import raw

MAX_LEN = 200
MAX_NOTES = 30
GAP_SECONDS = 60
_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f​-‏‪-‮⁦-⁩]")


class NoteError(ValueError):
    pass


def clean(text):
    text = _CONTROL.sub(" ", (text or "").strip())
    text = re.sub(r"\s+", " ", text)
    if not text:
        raise NoteError("Write something to pin.")
    if len(text) > MAX_LEN:
        raise NoteError(f"A note can be up to {MAX_LEN} characters. Yours is {len(text)}.")
    return text


def notes(board):
    return list(board.db.notes or [])


def post(board, core_id, author, text, now=None):
    now = now if now is not None else time.time()
    text = clean(text)
    if not core_id:
        raise NoteError("Only signed-in site accounts can pin notes.")
    mine = [n for n in notes(board) if n["core_id"] == core_id]
    if mine and now - max(n["at"] for n in mine) < GAP_SECONDS:
        raise NoteError("You pinned a note a moment ago. Give it a minute.")
    next_id = (board.db.next_note or 0) + 1
    board.db.next_note = next_id
    kept = (notes(board) + [{"id": next_id, "core_id": core_id, "author": author, "text": text, "at": now}])[-MAX_NOTES:]
    board.db.notes = kept
    return next_id


def remove(board, note_id, core_id=None, force=False):
    """The author can take their own down; builders and admins (force) any."""
    found = [n for n in notes(board) if n["id"] == note_id]
    if not found:
        raise NoteError("There is no note with that number.")
    if not force and found[0]["core_id"] != core_id:
        raise NoteError("That is not your note.")
    board.db.notes = [n for n in notes(board) if n["id"] != note_id]


def remove_all_of(board, core_id):
    kept = [n for n in notes(board) if n["core_id"] != core_id]
    gone = len(notes(board)) - len(kept)
    if gone:
        board.db.notes = kept
    return gone


def lines(board):
    items = notes(board)
    if not items:
        return ["The board is bare. Pin the first note with 'post <words>'."]
    out = ["|wPinned to the board:|n"]
    for n in items:
        when = time.strftime("%d %b", time.gmtime(n["at"]))
        out.append(f"  |c#{n['id']}|n {raw(n['text'])} |x- {raw(n['author'])}, {when}|n")
    return out
