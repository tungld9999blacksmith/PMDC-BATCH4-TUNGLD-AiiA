#!/bin/sh
# Nạp schema control plane vào database aiia (chạy một lần khi volume mới được tạo).
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname aiia -f /sql/aiia.sql
