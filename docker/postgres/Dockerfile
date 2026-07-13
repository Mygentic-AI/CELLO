FROM postgres:18

# Install pgaudit for the matching Postgres major version
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-18-pgaudit \
    && rm -rf /var/lib/apt/lists/*

# Dev role passwords are deliberately NOT an initdb hook. initdb runs at first boot, BEFORE
# Flyway — and the roles it would target (cello_service, cello_analytics, cello_ops_agent) are
# created BY Flyway (V2/V7/V26). An ALTER ROLE here fires against roles that do not exist yet, so
# on a fresh volume the roles end up with no password and every service-role connection fails
# auth. The passwords are applied by the `role-passwords` compose service, which waits for Flyway
# to finish. See docker-compose.yml.
