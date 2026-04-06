# Contributing to CELLO

CELLO is moving from design into implementation. The architecture is defined — but we genuinely welcome feedback, especially on security, cryptographic correctness, and fundamental design decisions. If you see a flaw, say so.

---

## Ways to Contribute

### Design & Architecture Feedback
Open a [GitHub Discussion](../../discussions) if you:
- Spot a security vulnerability or weakness in the trust model
- believe something is fundamentally wrong with the approach
- Have experience with P2P identity, agent communication, or cryptographic signing and see an issue
- Want to propose an alternative to a design decision

This is the highest-value contribution right now.

### Issues
Use GitHub Issues for:
- **Bug reports** — once code exists
- **Feature requests** — concrete, scoped additions that fit the existing architecture
- **Documentation gaps** — missing or unclear explanations

### Pull Requests
Code contributions are welcome as implementation gets underway. Before opening a PR:

1. Check that an issue or discussion exists for the work
2. Keep PRs focused — one concern per PR
3. Include tests for any logic you add
4. Update relevant documentation

Use the PR template. Fill it out fully — sparse PRs will be returned for more detail.

---

## What We're Not Looking For

- Rewrites of core architecture without prior discussion
- Dependencies that introduce centralization or platform lock-in
- Features that belong in a layer above CELLO (e.g. marketplace logic, billing)

If you're unsure, open a discussion first.

---

## Security Issues

**Do not open a public issue for security vulnerabilities.**

Report them privately via GitHub's [Security Advisory](../../security/advisories/new) feature. We take security reports seriously and will respond promptly.

---

## Code Style

- Follow existing patterns in the codebase
- Write clear, auditable code — this is security infrastructure
- Comments for non-obvious logic, especially in cryptographic operations
- No unnecessary dependencies

---

## License

By contributing, you agree that your contributions will be licensed under the [Apache 2.0 License](LICENSE).
