#!/usr/bin/env bash

set -euo pipefail

github_environment_file="${GITHUB_ENV:?GITHUB_ENV is required}"
runner_temporary_directory="${RUNNER_TEMP:?RUNNER_TEMP is required}"

certificate_base64="${MACOS_CERTIFICATE_P12_BASE64:-}"
certificate_password="${MACOS_CERTIFICATE_PASSWORD:-}"
signing_identity="${MACOS_SIGN_IDENTITY:-}"
apple_id="${APPLE_ID_SECRET:-}"
apple_password="${APPLE_APP_SPECIFIC_PASSWORD_SECRET:-}"
apple_team_id="${APPLE_TEAM_ID_SECRET:-}"

append_environment_value() {
  local name="$1"
  local value="$2"
  local delimiter="SCREEN_RECORDER_$(uuidgen | tr '-' '_')"
  {
    printf '%s<<%s\n' "$name" "$delimiter"
    printf '%s\n' "$value"
    printf '%s\n' "$delimiter"
  } >> "$github_environment_file"
}

signing_values=("$certificate_base64" "$certificate_password" "$signing_identity")
notarization_values=("$apple_id" "$apple_password" "$apple_team_id")
signing_count=0
notarization_count=0
for value in "${signing_values[@]}"; do
  [[ -n "$value" ]] && signing_count=$((signing_count + 1))
done
for value in "${notarization_values[@]}"; do
  [[ -n "$value" ]] && notarization_count=$((notarization_count + 1))
done

if [[ "$signing_count" -ne 0 && "$signing_count" -ne 3 ]]; then
  echo '::error::Optional signing requires MACOS_CERTIFICATE_P12_BASE64, MACOS_CERTIFICATE_PASSWORD, and MACOS_SIGN_IDENTITY together.'
  exit 1
fi
if [[ "$notarization_count" -ne 0 && "$notarization_count" -ne 3 ]]; then
  echo '::error::Optional notarization requires APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID together.'
  exit 1
fi
if [[ "$notarization_count" -eq 3 && "$signing_count" -ne 3 ]]; then
  echo '::error::Notarization secrets were configured without a complete signing certificate set.'
  exit 1
fi

if [[ "$signing_count" -eq 0 ]]; then
  append_environment_value 'CI_SIGNING_CONFIGURED' 'false'
  append_environment_value 'CI_NOTARIZATION_CONFIGURED' 'false'
  echo 'No signing secrets detected; the build will use the credential-free ad-hoc signature.'
  exit 0
fi

certificate_path="$runner_temporary_directory/screen-recorder-signing.p12"
keychain_path="$runner_temporary_directory/screen-recorder-signing.keychain-db"
keychain_password="$(uuidgen)$(uuidgen)"

append_environment_value 'CI_SIGNING_KEYCHAIN' "$keychain_path"
append_environment_value 'CI_SIGNING_CERTIFICATE' "$certificate_path"
printf '%s' "$certificate_base64" | /usr/bin/base64 -D > "$certificate_path"
security create-keychain -p "$keychain_password" "$keychain_path"
security set-keychain-settings -lut 21600 "$keychain_path"
security unlock-keychain -p "$keychain_password" "$keychain_path"
security import "$certificate_path" \
  -k "$keychain_path" \
  -P "$certificate_password" \
  -T /usr/bin/codesign \
  -T /usr/bin/security \
  -t cert \
  -f pkcs12
security set-key-partition-list \
  -S apple-tool:,apple:,codesign: \
  -s \
  -k "$keychain_password" \
  "$keychain_path" >/dev/null

if ! security find-identity -v -p codesigning "$keychain_path" | grep -Fq "$signing_identity"; then
  echo '::error::MACOS_SIGN_IDENTITY was not found in the imported certificate.'
  exit 1
fi

append_environment_value 'SCREEN_RECORDER_MACOS_SIGN_IDENTITY' "$signing_identity"
append_environment_value 'SCREEN_RECORDER_MACOS_SIGN_KEYCHAIN' "$keychain_path"
append_environment_value 'CI_SIGNING_CONFIGURED' 'true'

if [[ "$notarization_count" -eq 3 ]]; then
  append_environment_value 'APPLE_ID' "$apple_id"
  append_environment_value 'APPLE_APP_SPECIFIC_PASSWORD' "$apple_password"
  append_environment_value 'APPLE_TEAM_ID' "$apple_team_id"
  append_environment_value 'CI_NOTARIZATION_CONFIGURED' 'true'
  echo 'Developer ID signing and notarization are configured for this build.'
else
  append_environment_value 'CI_NOTARIZATION_CONFIGURED' 'false'
  echo 'Developer ID signing is configured; notarization secrets were not provided.'
fi
