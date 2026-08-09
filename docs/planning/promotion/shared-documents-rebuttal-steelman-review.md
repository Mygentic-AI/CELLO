---
name: Shared Documents Rebuttal — Steelman Review
type: review
date: 2026-08-09
topics: [m14, documents, positioning, messaging, objection-handling, steelman]
status: active
description: >
  Maximum-strength pass over the "haven't shared documents been solved?" rebuttal.
  Sharper formulations of the seven arguments, eleven missing arguments worth adding,
  the case for cutting argument 6, a three-point 60-second version, and eight places
  the document hedges a claim the shipping build actually supports.
---

# Steelman review — shared documents objection rebuttal

Agent output, verbatim. Reviewed target: [[shared-documents-objection-rebuttal]].
Constraint applied throughout: every proposal must survive a counterparty who has
fully automated their workflow.

---

## 1. Sharper formulations of the seven

### Argument 1 — easy or confidential

The existing line lands the fork but stops one beat before the kill. The fork is a symptom; the cause is that **the setting you want does not exist in any of these products**. Name the missing setting and the automation counter dies on contact — an agent can provision a grant, it cannot invent a grant shape the platform doesn't offer.

> **"Pick any of them and you get two settings. Public — genuinely easy, and the contract you're negotiating is readable by anyone who finds the link, while you're still negotiating it. Or private — and now the person on the other side of the deal has an account inside your company. There is no setting for *this one document, this one person, nothing else*. That's the setting we are."**

Close on this, not on effort:

> **"Removing someone from your org is also one command. It just takes away everything else they had at the same time — which is exactly why nobody does it, and why stale access piles up in every company you've ever worked at. Kill our document and nothing else in the world changes."**

### Argument 2 — you can refuse an individual edit

The current quotable spends its whole length on Google Docs, which is the easy half, and the concession to GitHub arrives afterwards in prose. Put the concession *inside* the quote so you're never seen to be dodging, and end on the thing that survives full automation.

> **"In a live document there's no such thing as declining an edit. Whatever they type is in your file before you've read it, and your only control is all-or-nothing. Now, GitHub does have a real gate, and it's fully automated now — a PR opens, review agents run, fixes get kicked off, nobody's awake. Be fair about that. But every one of those reviewers has to read the attacker's text in order to have an opinion about it. And an opinion is a thing you can argue with — a well-written diff can talk a reviewer into approving it. Our gate isn't forming an opinion. Both of us agreed at the start exactly which characters this document may contain, and the check is arithmetic. You can't talk a character-set check into liking you."**

The last sentence is the whole argument. It's the one formulation of this claim that a counterparty cannot automate their way past, because it isn't about their diligence — it's about the shape of what they'd have to defeat.

### Argument 3 — the document is an injection channel

Two changes. First, drop "as far as I know" — see §5. Second, the strongest property here is stated too gently: it isn't only that their content can't *steer* your agent, it's that their writing **cannot cause your agent to run at all**.

> **"The moment your agent can read a document I can write to, I'm typing directly into your agent's head. Google Docs has no opinion about that. Git has no opinion about that. Here, me writing to the document can't even make your agent think — the edit merges into your file and leaves a flag with none of my words in it. Your agent reads when your agent decides to read, and what it reads has already been through a character set that both of us signed."**

Then the harder version of the fourth property (and the safer one — see §5):

> **"And there is no channel for them to argue with your security. Not a hard one — none. Counterparty text arguing that you should lower your defences is the single most attacker-favourable thing you can build, because the document gets screened and the plea's entire purpose is to persuade. So the answer to a refusal isn't a conversation, it's that the sender adopts the stricter rule and republishes."**

### Argument 4 — code has an oracle, prose doesn't

**This is the best-written argument in the document and I can't beat the setup.** One clause at the end is worth swapping — "nothing on earth tells either of us" is an abstraction where a concrete image is available:

> **"…It picks one, it reads beautifully, and there is no compiler for a payment term. The person who finds out a clause went missing is your lawyer, in a year."**

And the resolution is under-claimed as "we don't create the situation":

> **"So we don't have a merge step at all. Your edit and my edit, any order, any delay — same document both sides. There's nothing to arbitrate, so there's nothing to arbitrate wrong."**

### Argument 5 — the middleman

The current line is strong. It gets stronger when you name the money instead of the principle:

> **"A shared workspace means everyone sees everyone. Fine for colleagues, disqualifying for commerce. If I buy work from you and sell the result to my client, the shared room introduces my supplier to my customer — and that introduction is my margin. Every tool in this category was designed for an org chart. Most business happens between org charts."**

### Argument 6 — you are the message bus

Sharper compression, and lead with the sentence that is true of every product in the category without exception:

> **"Every one of those tools notifies a human. Not one of them notifies an agent. So the workflow everybody actually runs — and everybody recognises this — is: email arrives, I read it, I paste 'they changed the doc, go look' into my agent. I'm the integration. Here, the thing that receives your edit is the same background process that already holds my identity, and it's up whenever I'm logged in. My copy is correct before any human reads anything."**

But see §3 — I think this argument should come out of the numbered set anyway.

### Argument 7 — nobody in the middle holds it

This is one paragraph carrying the entire enterprise case, and it is the most under-built thing in the document. The shipping build supports far more than "no vendor can change terms."

> **"A term sheet in Google Docs is a term sheet Google holds. Draft it in a private repo and Microsoft holds it. Ours exists on exactly two machines, encrypted on both. There's no third copy to subpoena, no account to suspend, no tier to deprecate, no terms of service being rewritten by a company that isn't party to the deal. And it goes further than the contents: nothing in the middle even keeps a list of who is working with whom. We turned down the easy version of our own delivery design specifically because it would have created that table."**

---

## 2. Missing arguments — the ones worth adding

Ranked by force. Every one survives a fully automated counterparty.

### M1. Assume their agent gets compromised — how much of you is standing behind it?

Argument 1 gestures at this ("put an autonomous process inside my perimeter") and never states the incident. It should be its own argument, because it reframes the whole grant question from *trust* to *blast radius*, and "I trust them" is the objection you actually get.

The mechanism that can't be automated away: an org membership or an account credential is a grant sized to the *issuer's* boundaries, not to the work. No amount of tooling makes a seat smaller than the org it's a seat in.

> **"Don't ask whether you trust them. With autonomous agents, assume their agent gets taken over next Tuesday — that's a when, not an if. If what you gave them was a seat in your org, then everything that seat can reach is now the attacker's: every repo, every doc shared with that account, the history too. If what you gave them was one document, the worst case is that they write nonsense into one file, I refuse it, and I kill it. The size of the grant is the size of the incident."**

### M2. They hold the log of what you did in their room

Completely absent, and it's the sharpest thing you can say to anyone who has ever been a guest in a customer's workspace.

> **"Here's the part people don't think about when they accept the invite. You're in their org now — which means they hold the audit log of your own conduct, on a retention policy they set, in a system their admin controls. If it's ever disputed, the record of what you did is in the other side's hands. Both of us hold the same signed history here. Neither of us can edit it, and neither of us can let it expire."**

### M3. The file on disk is the entire integration story

Currently this only appears defensively, buried in a pushback answer. It's a positive argument and it's a big one.

> **"The shared document is a file, in a folder, on your machine. That's the whole integration. Your agent edits it with the same tools it edits everything else with. You open it in whatever editor you like. You can commit it to git, your backup picks it up, your scanner scans it, your grep greps it. Nobody has to build a connector to the filesystem — it's the one interface every tool ever written already supports. The alternative on the other side of this comparison is granting your agent OAuth over your entire Drive so it can touch one file."**

### M4. What happens when the work ends

Nobody in the category has a good answer to this and nobody gets asked it, because everyone has quietly accepted that access is a lease.

> **"Ask what happens when the engagement is over. On every hosted tool one of us owned the room, so one of us keeps the document and the other one gets 'you no longer have access to this file' — including access to their own contributions. Here you both already hold the whole thing, signed, on your own disks. Ending the relationship doesn't take anything away from either side. And in the version where it ends badly: the person you fell out with cannot delete the evidence, and neither can you."**

### M5. What it costs an agent to work on shared state

Argument 6 brushes this and then leaves. It deserves its own slot, and unlike argument 6 it does not decay as counterparties get more sophisticated — you cannot automate a remote read into being free, and a perfect webhook still only tells you *that* something changed.

> **"Think about what it costs an agent to work on a shared document. On a hosted tool, the only way to know what it currently says is to pull the whole thing into the model's context — and you do that again every session, mostly to find out nothing moved. Here the current version is already a file on the disk, and the daemon will tell you exactly what changed since you last looked: three lines, here they are. Your agent reads a diff, not a document. On something touched ten times a day that's the difference between a workable habit and a bill you notice."**

### M6. The CRDT is not a preference — it is what makes "no host" possible

Argument 4 uses the CRDT defensively (to avoid bad merges). Its offensive use is missing, and it's the technical answer to "why hasn't someone just done this with diffs."

> **"A patch only means something relative to a version. Apply it to the wrong base and it either fails or it silently corrupts. That's why every diff-based system needs somebody in the middle deciding what order things happened in. Ours has no order. Your edit and my edit can arrive out of sequence, twice over, three days apart, and we land on the identical document. That's not a design preference — it's the reason it's possible to have nobody in the middle at all."**

### M7. Your counterparty doesn't get to schedule your day

The refuse-rather-than-ask decision is one of the most distinctive things in the design and the document never mentions it.

> **"Notice what every other tool does when it isn't sure about something: it asks you. Which means the other side chooses the moment you get interrupted — and if they're hostile, they choose it a hundred times. We refuse instead. The sender gets told exactly why, in a form their software can act on, and nobody wakes you up. Your counterparty doesn't get to schedule your day."**

### M8. It can break, but it can't lie

The refuse-never-mutate rule, the machine-readable reason, the policy log on both sides, and the visible stalled state add up to a reliability claim the category can't make.

> **"The dangerous failure isn't the one that stops you. It's the one where we both keep working and my copy no longer says what yours says and neither of us finds out for three weeks. That's literally what a 'conflicted copy' in a sync folder is. So we never quietly fix an edit up — we refuse it whole, hand the reason back to the sender's software, and if it can't be resolved the document says so, on both sides, in plain sight. It can break, but it can't lie."**

### M9. Collaboration ratchets security up, never down

This exists as a half-sentence at the end of argument 2. It's a whole argument, and it's the most elegant one in the set.

> **"In every other setup, working with someone means one of you drops to the other's standard — you join their workspace and live under their rules, or they join yours and live under yours. Here the document ends up under both sets of rules at once, and the stricter one wins every time. Nobody is ever asked to accept less protection than they walked in with. It only composes in one direction, and that's deliberate — the other direction is the one an attacker would use."**

### M10. Data residency — you don't answer the question, you delete it

> **"Cross-border, the question is never 'can we share a file'. It's whose servers is it sitting on, in which country, under whose subpoena — and answering that takes a lawyer, a data processing agreement and a procurement cycle before anyone writes a word. We don't answer it. The document is on your machine and on theirs. Nothing in the middle stores it, and nothing in the middle keeps a record that the two of you are working together."**

### M11. Sometimes the fact of the collaboration is the secret

Worth splitting out from M10 for a deal audience.

> **"Sometimes the contents aren't the sensitive part — the existence is. Two companies start co-editing a document in December and that's the story, whatever's inside it. Every hosted tool knows that, encrypted or not, because someone has to route it. We don't have that someone."**

---

## 3. What to cut

**Cut argument 6 from the numbered set. Demote it to demo colour, and put M5 (context economics) in its slot.**

The case:

**It has a built-in expiry date and the document admits it.** The concession paragraph says out loud: if you already run CI on that repo, "you built the always-on receiver years ago and this argument doesn't bite you." The fallback is that the *counterparty* usually isn't running a pipeline. That is a claim about how sophisticated other people are, and it is the single claim most certain to be false in twelve months — it's the same class of claim as the three arguments that already died during drafting. You'd be seeding the set with a fourth one.

**It needs two concessions before it can throw a punch.** Any argument that opens with "concede the obvious first, or this one falls apart" and then "concede the exception before they raise it" is spending your podium time defending its own right to exist. In the seven-argument set, that's the weakest ratio in the document.

**Its durable core is already carried elsewhere.** Strip out the decaying part and what's left — no third-party credential, no hosted receiver, no poll — is argument 1's grant shape plus argument 7's no-host. Nothing is lost.

**And the thing it was reaching for is better said as cost.** M5 makes the same observation about how agents actually consume shared state, but grounds it in tokens rather than in whether the other guy runs GitHub Actions. Cost doesn't get automated away; capability does.

Keep the material — the tool-by-tool walk and the "I'm the message bus" line are excellent in a live demo where you're showing the daemon receive an edit with nobody awake. It just isn't load-bearing enough to be one of seven.

**Secondary, structural:** argument 3 is about 50% duplicate of argument 2. Its second property (character space agreed at consent) and third (refuse, not sanitise) are both explicitly cross-referenced back to argument 2 in the text — you are saying the same thing twice with a pointer admitting it. Reduce 3 to the two properties that are only its own: *arrival cannot make your agent run*, and *there is no channel to argue with your security*. That makes it shorter, entirely non-redundant, and better as the moat argument.

---

## 4. The 60-second version — three points

Spoken, roughly 55 seconds at a normal pace:

> **"There are only two ways to share a document today. Either a host holds it — Google, Notion, a private repo — so one of us owns the room and the other one is a guest with an account inside a company they don't control. Or you send copies, and then there's no shared truth at all, just two files and a person reconciling them. Every tool you can name is one of those two. There's no setting anywhere for 'this one document, this one person, and nothing else.' That's the setting we built.**
>
> **Second — the moment your agent can read a document I can write to, I'm typing straight into your agent's head. Every one of those tools has no opinion about that. We do. You can refuse an individual edit. And the thing doing the refusing isn't a reviewer forming an opinion you could argue your way past — it's a character set that both of us agreed to and signed at the start. You can't talk arithmetic into liking you.**
>
> **Third — nobody hosts it. It's a file on your machine, a file on theirs, encrypted on both. No vendor can change the terms of the room, because there's no room. And when the work is finished, you both still have the whole thing, signed. Nobody gets locked out of something they wrote."**

Three points, in that order, because point one collapses every competitor name they were about to say, point two is the one nothing else in the world does, and point three is what they repeat to their colleague afterwards.

---

## 5. Where the document is too cautious

**1. "As far as I know this is the only shared-artifact system designed on the assumption that the other side's text is hostile."** In speech, "as far as I know" reads as uncertainty about your own category, which is worse than the overclaim it's protecting against. Say: **"I don't know of another one, and I've gone looking."** Same truth, no wobble, and it invites them to name one — which is a conversation you win.

**2. Argument 3's fourth property is simultaneously overclaimed and underclaimed.** "If they need an exception, it arrives as structured evidence" describes the rebuttal path, which the design log lists under *can slip* — so it may not be in the build you're demoing. The safe version is also the stronger version: **there is no channel for them to argue at all.** A refusal is the end of it, and the resolution is that the sender adopts the stricter rule. Fix this one before it's said in public — it's the only place I found where the prose can outrun the build.

**3. The content profile binding is stated softly and it's the hardest cryptographic fact in the feature.** "Cryptographically bound to the document" understates it: the document's identifier *is* the hash of the agreement. Say it as:

> **"The document's name is the hash of what we agreed. You cannot loosen the rules and still be holding the same document. There's no admin who can grant an exception later — including us. We can't do it either, because there's no us in the middle."**

**4. Refuse-never-mutate is argued from principle when you have measurements.** The document says the sanitise-and-accept option "is the worst option available here." You ran it: 18 realistic samples through the screener, 9 tripped, **6 were silently rewritten** — a Hindi word turned into a different word, a family emoji split into three separate people, a document about prompt formats losing the thing it was about. That is a story a listener remembers and it converts an assertion into evidence:

> **"We didn't reason our way to that, we measured it. Eighteen real documents through our own screener: six of them came out saying something different. One Hindi word became a different word. A family emoji became three separate people. If we'd shipped that, the receiver would be holding different bytes than the sender signed, both sides would believe they agreed, and nothing anywhere would report it."**

**5. The kill switch is described only by its limit.** "You can stop it, and you can't unsend what already landed" is the right caveat, but the positive half is left on the floor: kill is **unilateral and immediate — it needs no cooperation, no admin, no support ticket, no ownership of the document.** Compare with a Google Doc you don't own, where you cannot make your own contributions stop being theirs. State both halves.

**6. "The feature works alone, on day one, with nobody to collaborate with. No cold start."** This is buried in a use-case section and hedged as "worth saying out loud in a demo." It is the most immediately verifiable thing in the entire document and it answers the two-sided-network objection you will definitely get. It should be near the top and stated flat: your laptop agent and your server agent holding one state that outlives a context window and crosses harnesses that can't share context. There is no cold start and you use it daily.

**7. The overlap flag is written as a caveat and it's a feature.** "Where convergence would produce nonsense — we don't pretend it's fine" is apologetic framing for something no editor on earth does: telling you that an incoming change landed on top of work you haven't published yet. Say it as a capability.

**8. One factual defect to fix.** The standfirst says seven arguments; the coda says "The six above describe value that exists the day someone installs it." One of those is wrong, and a technical interviewer reading the page will notice. (If you take the cut in §3, it becomes six — in which case fix the standfirst, not the coda.)

---

## Related Documents

- [[shared-documents-objection-rebuttal]] — the artifact under review
- [[2026-07-31_federated-collaborative-state-architecture]] — spec of record
- [[2026-08-05_1230_document-screening-convergence-and-content-profiles]] — the screening measurement cited in §5.4
