"""Telnet over TLS is off unless the site config turns it on, and then always has a key and certificate (docs/09)."""
import os
import tempfile
from unittest import TestCase

from server.conf.tls import tls_settings


class TlsSettingsTest(TestCase):
    def setUp(self):
        self.game = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.game, "server"))

    def test_off_by_default(self):
        self.assertEqual(tls_settings({"mud": {}}, {}, self.game), (False, None))
        self.assertFalse(os.path.exists(os.path.join(self.game, "server", "ssl.cert")))

    def test_makes_a_self_signed_certificate_once_and_keeps_it(self):
        site = {"site": {"domain": "example.test"}, "mud": {"tls": {"enabled": True, "port": 4993}}}
        self.assertEqual(tls_settings(site, {}, self.game), (True, 4993))
        cert = os.path.join(self.game, "server", "ssl.cert")
        first = open(cert, "rb").read()
        self.assertIn(b"BEGIN CERTIFICATE", first)
        tls_settings(site, {}, self.game)
        self.assertEqual(open(cert, "rb").read(), first)

    def test_uses_the_sites_certificate_when_given(self):
        src = tempfile.mkdtemp()
        for name, text in (("c.pem", "CERT"), ("k.pem", "KEY")):
            with open(os.path.join(src, name), "w") as f:
                f.write(text)
        env = {"MUD_TLS_CERT": os.path.join(src, "c.pem"), "MUD_TLS_KEY": os.path.join(src, "k.pem")}
        self.assertEqual(tls_settings({"mud": {"tls": {"enabled": True}}}, env, self.game), (True, 4003))
        self.assertEqual(open(os.path.join(self.game, "server", "ssl.cert")).read(), "CERT")
