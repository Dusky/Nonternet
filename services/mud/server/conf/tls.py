"""
Telnet over TLS for native MUD clients (docs/09, docs/17 2026-10-18): off unless the site config turns it on
(`mud.tls.enabled`). Evennia 5.0.1 serves it on SSL_PORTS and reads server/ssl.key and server/ssl.cert (VERIFIED in
evennia/server/portal/ssl.py); its own key maker is broken, so this module always provides the files: the site's own
certificate when MUD_TLS_CERT and MUD_TLS_KEY point at one (in production, the one Caddy keeps for mud.<domain>),
otherwise a self-signed one made once and kept.
"""
import datetime
import os
import shutil


def tls_settings(site, env, game_dir):
    """Returns (enabled, port) and makes sure the key and certificate are in place when enabled."""
    tls = ((site or {}).get("mud") or {}).get("tls") or {}
    if not tls.get("enabled"):
        return False, None
    port = int(tls.get("port") or 4003)
    key_out = os.path.join(game_dir, "server", "ssl.key")
    cert_out = os.path.join(game_dir, "server", "ssl.cert")
    cert, key = env.get("MUD_TLS_CERT"), env.get("MUD_TLS_KEY")
    if cert and key and os.path.exists(cert) and os.path.exists(key):
        shutil.copyfile(key, key_out)
        shutil.copyfile(cert, cert_out)
        os.chmod(key_out, 0o600)
    elif not (os.path.exists(key_out) and os.path.exists(cert_out)):
        host = ((site or {}).get("mud") or {}).get("public_host") or "mud.{}".format(((site or {}).get("site") or {}).get("domain") or "localhost")
        _self_signed(host, key_out, cert_out)
    return True, port


def _self_signed(host, key_out, cert_out):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID

    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, host)])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
        .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=3650))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName(host)]), critical=False)
        .sign(key, hashes.SHA256())
    )
    with open(key_out, "wb") as f:
        f.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()))
    os.chmod(key_out, 0o600)
    with open(cert_out, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
