#!/bin/sh
# Creates one database per domain service, reflecting the platform principle
# of domain-owned data rather than a single shared mega-database.
set -e

for db in identity_db audit_db workflow_db document_db payment_db notification_db civilreg_db trading_license_db complaints_db; do
  echo "Creating database: $db"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" -c "CREATE DATABASE $db;"
done
