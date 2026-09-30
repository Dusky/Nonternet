"""
Making a character (docs/18): EvAdventure's character sheet menu, with our character class, a fix for
its charisma roll, and checks on the name. Up to MAX_NR_CHARACTERS per account.
"""
import re

from django.conf import settings
from evennia import create_object, search_tag
from evennia.accounts.models import AccountDB
from evennia.contrib.tutorials.evadventure import chargen as ev
from evennia.objects.models import ObjectDB
from evennia.prototypes.spawner import spawn
from evennia.utils.evmenu import EvMenu

NAME_RE = re.compile(r"^[A-Za-z][A-Za-z'-]{1,19}$")


def name_problem(name, account=None):
    """Why this can't be a character name, or None."""
    if not NAME_RE.match(name or ""):
        return "A name is 2 to 20 letters (an apostrophe or hyphen is fine), starting with a letter."
    if ObjectDB.objects.filter(db_key__iexact=name, db_typeclass_path__contains="haracter").exists():
        return "Someone already has a character called that."
    other = AccountDB.objects.filter(username__iexact=name).first()
    if other and (account is None or other.pk != account.pk):
        return "That is someone's handle on the site. Choose another name."
    return None


def start_room():
    rooms = search_tag("start", category="world")
    return rooms[0] if rooms else ObjectDB.objects.get_id(settings.START_LOCATION)


class CharacterSheet(ev.TemporaryCharacterSheet):
    def __init__(self):
        super().__init__()
        # EvAdventure's tables roll "no armor" and "none" as if they were items.
        if self.armor == "no armor":
            self.armor = None
        self.helmet = None if self.helmet == "none" else self.helmet
        self.shield = None if self.shield == "none" else self.shield

    def apply(self, account):
        from typeclasses.characters import Character

        where = start_room()
        new = create_object(
            Character, key=self.name, location=where, home=where, permissions=settings.PERMISSION_ACCOUNT_DEFAULT,
            attributes=(
                ("strength", self.strength), ("dexterity", self.dexterity), ("constitution", self.constitution),
                ("intelligence", self.intelligence), ("wisdom", self.wisdom),
                ("charisma", self.charisma),  # upstream copies wisdom here
                ("hp", self.hp), ("hp_max", self.hp_max), ("desc", self.desc),
            ),
        )
        new.locks.add(f"puppet:id({new.id}) or pid({account.id}) or perm(Developer) or pperm(Developer);delete:id({account.id}) or perm(Admin)")
        from world.prototypes import by_key

        for key in (self.weapon, self.armor, self.shield, self.helmet, *self.backpack):
            proto = by_key(key) if key else None
            if proto:
                new.equipment.move(spawn(proto)[0])
        return new


def _update_name(caller, raw_string, **kwargs):
    name = raw_string.strip()
    problem = name_problem(name, caller)
    if problem:
        caller.msg(f"|r{problem}|n")
    else:
        kwargs["tmp_character"].name = name
    return "node_chargen", kwargs


def node_change_name(caller, raw_string, **kwargs):
    text = f"Your character is called |w{kwargs['tmp_character'].name}|n. Type a new name, or press Enter to keep it."
    return text, {"key": "_default", "goto": (_update_name, kwargs)}


def node_apply_character(caller, raw_string, **kwargs):
    sheet = kwargs["tmp_character"]
    problem = name_problem(sheet.name, caller)
    if problem:
        caller.msg(f"|r{problem}|n")
        return node_change_name(caller, "", **kwargs)
    new = sheet.apply(caller)
    caller.characters.add(new)
    return f"|g{new.key} is ready.|n Type |wic {new.key}|n to play.", None


def start_chargen(caller, session=None):
    sheet = CharacterSheet()
    if name_problem(sheet.name, caller):
        sheet.name = ""  # the random name was taken; they pick one
    EvMenu(
        caller,
        {"node_chargen": ev.node_chargen, "node_change_name": node_change_name,
         "node_swap_abilities": ev.node_swap_abilities, "node_apply_character": node_apply_character},
        startnode="node_chargen", session=session, startnode_input=("", {"tmp_character": sheet}),
    )
