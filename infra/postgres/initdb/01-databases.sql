-- Một instance PostgreSQL phục vụ nhiều vai trò, tách bằng database riêng.
CREATE DATABASE aiia;               -- control plane (schema app), xem src/database/aiia.sql
CREATE DATABASE iceberg_catalog;    -- Iceberg JDBC catalog
CREATE DATABASE mock_source;        -- CSDL của mock source (nguồn giả lập)
CREATE DATABASE metabase;           -- metadata của Metabase
CREATE DATABASE dagster;            -- run storage của Dagster
