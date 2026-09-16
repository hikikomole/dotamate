#!/bin/sh
set -eu
mkdir -p secrets
read -r -p "Postgres password (leave empty to generate): " DBPW || true
DBPW=${DBPW:-$(openssl rand -hex 24)}
printf '%s\n' "$DBPW" > secrets/postgres_password.txt
printf 'postgresql://dota2helper:%s@postgres:5432/dota2helper\n' "$DBPW" > secrets/database_url.txt
openssl rand -hex 48 > secrets/jwt_secret.txt
openssl rand -hex 48 > secrets/cloudpayments_api_secret.txt
chmod 600 secrets/*.txt
printf '\nSecrets created in ./secrets. Keep them private.\n'
printf 'Set CLOUDPAYMENTS_PUBLIC_ID and domain values in .env if needed.\n'
