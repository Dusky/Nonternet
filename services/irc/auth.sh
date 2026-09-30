#!/bin/sh
# Ergo's auth-script (docs/08): one line of JSON in, one line of JSON out. The password is checked by
# core, so Ergo never holds a copy. Arguments: core's base URL and the bearer token.
read -r line
out=$(printf '%s' "$line" | if command -v curl >/dev/null 2>&1; then
  curl -sS --max-time 8 -H "Authorization: Bearer $2" -H 'Content-Type: application/json' --data-binary @- "$1/internal/irc/auth"
else
  wget -q -T 8 -O - --header "Authorization: Bearer $2" --header 'Content-Type: application/json' --post-data "$line" "$1/internal/irc/auth"
fi)
case "$out" in
  '{'*) printf '%s\n' "$out" ;;
  *) printf '%s\n' '{"success":false,"error":"core did not answer"}' ;;
esac
