---
name: block-docker-push
enabled: true
event: bash
pattern: docker\s+push
action: block
---

🚫 **docker push from local is NEVER allowed.**

All image pushes must go through the CI/CD pipeline (CodeBuild). Use ECR cross-region replication for multi-region — never push from a local machine.

See CLAUDE.md: "NEVER push Docker images from local."
