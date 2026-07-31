# The waitlist service image (DOD-GCP-RUNTIME-1).
#
# One container serving all thirteen handlers: the four public paths, the SNS
# bounce URL, and the authenticated internal surface Cloud Scheduler drives.
# python3.12 matches the Runtime the Lambdas declared in cello-waitlist.yaml, so
# the port does not quietly change interpreter versions underneath 7,205 lines
# of handler that were never run on anything else.
FROM python:3.12-slim

# PYTHONUNBUFFERED because Cloud Run collects stdout. Without it, _logging's
# JSON lines sit in a buffer and a container that dies takes its last — and most
# interesting — log lines with it.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Dependencies before source, so editing a handler does not reinstall psycopg2.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# NOT root. Cloud Run does not require it, which is exactly why it is easy to
# skip; a service that reaches a database and holds SES credentials should not
# also be able to rewrite its own code.
RUN useradd --create-home --uid 10001 waitlist && chown -R waitlist:waitlist /app
USER waitlist

# Cloud Run supplies PORT and it is not always 8080. Reading it rather than
# hardcoding is what makes the container run unchanged under `docker run` and
# under Cloud Run.
ENV PORT=8080
EXPOSE 8080

# gthread, not sync. _dispatch fires the email nudge on a daemon thread and the
# handlers spend their time waiting on Postgres and SES, so threads are the
# right shape — a sync worker would block the whole process on one drain.
#
# --timeout 120 because a wave assembly over a large cohort is legitimately slow
# and gunicorn's 30s default would kill it mid-transaction.
CMD exec gunicorn \
      --bind "0.0.0.0:${PORT}" \
      --workers 2 \
      --worker-class gthread \
      --threads 8 \
      --timeout 120 \
      --access-logfile - \
      --error-logfile - \
      _app:application
