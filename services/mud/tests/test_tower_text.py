"""
The tower's words are short, plain and hand-written (docs/18, "keep AI slop low"). This fails on filler words, long lines,
dashes used for effect, piled-up adjectives and lines that start the same way.
"""
import re
from unittest import TestCase

from world.tower import tables

BANNED = ["ancient", "mysterious", "eerie", "whisper", "palpable", "tapestry", "testament", "echoes of", "a sense of",
          "otherworldly", "ethereal", "shroud", "looms", "beckon", "delve", "realm", "unspeakable", "you feel", "you sense",
          "seems to", "as if", "eldritch", "foreboding", "ominous", "forgotten", "untold", "myriad", "sinister"]


def all_lines():
    for kind, lines in tables.ROOM_KINDS.items():
        for line in lines:
            yield f"room {kind}", line, 160
    for line in tables.FEATURES:
        if line:
            yield "feature", line, 100
    yield "stair", tables.STAIR_LINE, 100
    yield "guard", tables.GUARD[1], 120


class TowerTextTest(TestCase):
    def test_no_filler_words_or_dashes_for_effect(self):
        for where, line, _cap in all_lines():
            low = line.lower()
            for word in BANNED:
                self.assertNotIn(word, low, f"{where}: {line}")
            self.assertNotIn("—", line, f"{where}: {line}")
            self.assertNotIn("...", line, f"{where}: {line}")
            self.assertNotIn("!", line, f"{where}: {line}")

    def test_lines_are_short_and_end_properly(self):
        for where, line, cap in all_lines():
            self.assertLessEqual(len(line), cap, f"{where}: {line}")
            self.assertTrue(line[0].isupper() and line.endswith("."), f"{where}: {line}")

    def test_no_three_adjectives_in_a_row(self):
        # "cold, dark, damp" style piles: three comma-separated single words before a noun.
        for where, line, _cap in all_lines():
            self.assertIsNone(re.search(r"\b[a-z]+, [a-z]+, [a-z]+ (?:room|hall|walls?|air|stone|floor)\b", line), f"{where}: {line}")

    def test_no_two_lines_start_the_same_way(self):
        starts = {}
        for where, line, _cap in all_lines():
            key = " ".join(line.lower().split()[:3])
            self.assertNotIn(key, starts, f"{where} and {starts.get(key)} both start '{key}'")
            starts[key] = where

    def test_names_are_plain(self):
        for kind in tables.ROOM_KINDS:
            self.assertLessEqual(len(kind.split()), 2, kind)
            self.assertNotIn(" of ", kind.lower(), kind)
