FROM postgres:18

# Install pgaudit for the matching Postgres major version
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-18-pgaudit \
    && rm -rf /var/lib/apt/lists/*

# Dev-only role passwords — set on first container startup via initdb hook.
# Roles are created by Flyway migrations; passwords live here, not in migration SQL.
COPY initdb/ /docker-entrypoint-initdb.d/
