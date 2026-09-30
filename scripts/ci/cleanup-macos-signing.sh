#!/usr/bin/env bash

set -u

keychain_path="${CI_SIGNING_KEYCHAIN:-}"
certificate_path="${CI_SIGNING_CERTIFICATE:-}"

if [[ -n "$keychain_path" && -f "$keychain_path" ]]; then
  security delete-keychain "$keychain_path" || true
fi
if [[ -n "$certificate_path" && -f "$certificate_path" ]]; then
  rm -f -- "$certificate_path"
fi
