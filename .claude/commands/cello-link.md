Scan the CELLO Obsidian vault and add wikilinks between documents that reference each other.

## Step 1 — Build the frontmatter index

Read the first 15 lines of every `.md` file under `docs/planning/` (recursively). Extract `name`, `type`, `topics`, and `description` from each file's YAML frontmatter. Build a map of: file path → name, topics, description.

Use the Glob tool: `docs/planning/**/*.md`

## Step 2 — Find files that need linking

Run: `git log --oneline -10 -- docs/`

Identify:
- Files changed in the most recent 1–3 commits
- Files that have no `## Related Documents` section

These are the candidates. Focus work here.

## Step 3 — Find connections via topics

For each candidate file:
1. Read the full file
2. Look at its `topics:` list
3. Find all other files in the index that share 1+ topics
4. Read the last 30 lines (Related Documents section) of each matching file to see what's already linked
5. Determine which connections are real — shared design concept, one resolves the other, same session

## Step 4 — Update Related Documents sections

For each file that needs linking:
- If it has no `## Related Documents` section, add one at the very end (after a `---` divider)
- If it has one, check for missing links and add them
- Format: `- [[filename-without-extension|Human Readable Name]] — one sentence on why they connect`
- Do not duplicate links that are already there

## Step 5 — Commit

```bash
git add docs/
git commit -m "Add wikilinks: [list the files updated]"
```

## What counts as a real connection

- Files share a design concept (both discuss FROST, both discuss GDPR, etc.)
- One file makes a decision the other implements or expands
- One file surfaced a problem the other resolves
- They were part of the same design session and explicitly reference each other

## What does NOT need a link

- Two files that both mention "trust" generically with no shared specifics
- Files in the same review folder that don't actually cross-reference
- Every file linking to cello-design.md (only when the connection is specific to a named section)
