"""Out-of-character commands for making characters (docs/18)."""
from django.conf import settings
from evennia import Command

from world.chargen import start_chargen


class CmdCharCreate(Command):
    """
    Make a new character, with a rolled character sheet.

    Usage:
      charcreate

    You can have up to three characters.
    """

    key = "charcreate"
    aliases = ["newchar"]
    locks = "cmd:pperm(Player) or pperm(Builder) or pperm(Developer)"
    help_category = "General"

    def func(self):
        account = self.account
        limit = settings.MAX_NR_CHARACTERS
        if len(account.characters.all()) >= limit:
            self.msg(f"You already have {limit} characters, which is the most you can have.")
            return
        start_chargen(account, session=self.session)


class CmdBuildTown(Command):
    """
    Build the starting town again, making only what is missing.

    Usage:
      buildtown
    """

    key = "buildtown"
    locks = "cmd:perm(Developer)"
    help_category = "Building"

    def func(self):
        from world.build_town import build_town

        build_town(self.caller)
