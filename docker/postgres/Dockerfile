FROM postgres:18

# Install pgaudit for the matching Postgres major version
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-18-pgaudit \
    && rm -rf /var/lib/apt/lists/*
