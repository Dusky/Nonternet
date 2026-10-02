"""
The tavern guestbook (docs/18): a book on the bar that people sign with a line or two. Like the noticeboard these are the
person's own words: in their export (keyed by the core account id), gone with the account, and builders and admins can take
an entry out. Kept as a list on the book object; the newest MAX_ENTRIES stay.
"""
import time

from evennia.utils.ansi import raw

from world.noticeboard import GAP_SECONDS, MAX_LEN, NoteError, clean

MAX_ENTRIES = 100
PAGE = 10


def entries(book):
    return list(book.db.entries or [])


def sign(book, core_id, author, text, now=None):
    now = now if now is not None else time.time()
    text = clean(text, empty="Write something to sign with.")
    if not core_id:
        raise NoteError("Only signed-in site accounts can sign the book.")
    mine = [e for e in entries(book) if e["core_id"] == core_id]
    if mine and now - max(e["at"] for e in mine) < GAP_SECONDS:
        raise NoteError("You signed the book a moment ago. Give it a minute.")
    next_id = (book.db.next_entry or 0) + 1
    book.db.next_entry = next_id
    book.db.entries = (entries(book) + [{"id": next_id, "core_id": core_id, "author": author, "text": text, "at": now}])[-MAX_ENTRIES:]
    return next_id


def remove(book, entry_id, core_id=None, force=False):
    """You can strike your own entry; builders and admins (force) any. Returns the entry that went."""
    found = [e for e in entries(book) if e["id"] == entry_id]
    if not found:
        raise NoteError("There is no entry with that number.")
    if not force and found[0]["core_id"] != core_id:
        raise NoteError("That is not your entry.")
    book.db.entries = [e for e in entries(book) if e["id"] != entry_id]
    return found[0]


def remove_all_of(book, core_id):
    kept = [e for e in entries(book) if e["core_id"] != core_id]
    gone = len(entries(book)) - len(kept)
    if gone:
        book.db.entries = kept
    return gone


def lines(book, page=1):
    items = entries(book)
    if not items:
        return ["The book is empty. Sign the first line with 'sign <words>'."]
    pages = (len(items) + PAGE - 1) // PAGE
    page = max(1, min(page, pages))
    newest_first = list(reversed(items))[(page - 1) * PAGE: page * PAGE]
    out = [f"|wThe guestbook|n |x(page {page} of {pages}, newest first)|n"]
    for e in newest_first:
        when = time.strftime("%d %b %Y", time.gmtime(e["at"]))
        out.append(f"  |c#{e['id']}|n {raw(e['text'])} |x- {raw(e['author'])}, {when}|n")
    if page < pages:
        out.append(f"|xMore: 'book {page + 1}'.|n")
    return out
