---
name: CELLO 60-Second Launch Demo Post Strategy
type: gtm
date: 2026-07-18
topics: [launch, demo, X, content, distribution, virality]
status: draft
description: Beat-by-beat script, caption candidates, production specs, timing strategy, and distribution flywheel for the first CELLO public demo on X.
---

# CELLO 60-Second Launch Demo Post Strategy
How to structure, produce, time, and amplify the first public demo on X

---

## Part 1: The Core Story (One Sentence)

**Your AI agent just had a real work conversation with your colleague's AI agent — directly, without any platform in the middle — and both of you are holding the sealed record.**

Every decision in the video serves this sentence. Not the cryptography. Not the install command. Not the architecture. The conversation happened, it was real, and both parties have proof.

The structural implication: the video is a story about two *people's* agents, not about a technology. The labels on screen say "Your Agent" and "Colleague's Agent" — not "cello-daemon" and "Hermes." The viewer should be projecting themselves into the left window, not marveling at the implementation.

---

## Part 2: The 60-Second Script

### Beat-by-Beat Breakdown

---

**0–2s — The hook (pattern interrupt)**

*On screen*: Split screen appears instantly, no intro. Left panel: terminal window labeled **"Your Agent (Claude Code)"**. Right panel: terminal window labeled **"Colleague's Agent (Hermes)"**. Both idle, cursors blinking.

*Text overlay* (bottom center, white on dark): `Two agents. No platform. Watch.`

*Pacing*: Hard cut to split screen. No fade, no title card. The split itself is the interrupt.

---

**2–5s — The connection**

*On screen*: Left panel — a single MCP call appears:
```
cello_initiate_session → "sarah-hermes"
```
Right panel — a connection notification appears:
```
[Incoming session from: andre-claude]
Session established.
```

*Text overlay*: none. Let the connection event speak.

*Pacing*: 3 seconds is enough. Don't rush it — this is the moment the viewer realizes these are two separate machines.

---

**5–22s — The conversation (hold here)**

*On screen*: Messages appear in alternating panels, naturally paced. Work-realistic. Not "hello world." Use something that any professional would recognize as actual work:

```
[Your Agent → Colleague's Agent]
"I've reviewed the Q2 proposal. The pricing structure works. 
Flagging one risk: the delivery timeline assumes 6 weeks 
but the vendor said 8 minimum."

[Colleague's Agent → Your Agent]
"Noted. Can you draft a mitigation — show the client 
two scenarios: 6-week premium vs 8-week standard?"

[Your Agent → Colleague's Agent]
"Done. Sending the draft now."

[Colleague's Agent → Your Agent]  
"Received. Looks good. Sealing the session."
```

*Text overlay*: none during the conversation. The content is the proof.

*Pacing*: Messages appear at natural reading speed. This is the longest segment — 17 seconds — because this is the money shot. Do not rush it. The viewer needs to read it.

---

**22–25s — The pause before the seal**

*On screen*: Both panels go quiet. A beat of silence. Then both show simultaneously:

```
Session sealed.
```

*Text overlay*: none.

*Pacing*: This pause is intentional. It creates anticipation. Three seconds of both screens saying "Session sealed" before the receipt appears.

---

**25–38s — The receipt (hold longer than feels comfortable)**

*On screen*: The sealed transcript materializes in a third panel or expands from the split. Show enough to be readable: both agent names, the message exchange, a hash, a timestamp, a "Verified by 2-of-3 directory nodes" line.

*Text overlay* (top of receipt panel): `Both sides hold this. Forever.`

*Pacing*: 13 seconds on the receipt. This is intentionally long. The viewer needs time to read it and think "that's real." Zoom in slightly 3 seconds in so the hash and timestamp are legible on mobile.

---

**38–43s — The contrast flash**

*On screen*: Quick cut (2s) to a recognizable Slack message: a grey bubble reading `[paste of 400 lines of AI conversation] — can you have your agent look at this?`

*Text overlay* (red, punchy): `vs. this`

Then immediately cut back to the sealed receipt.

*Pacing*: 2 seconds on Slack, 3 seconds back on the receipt. Fast enough to be punchy, slow enough to register.

---

**43–55s — The implication**

*On screen*: Both terminal windows visible again, idle.

*Text overlay* (center, white, large): Three lines appearing one at a time:
```
Direct.
Verifiable.  
No platform in the middle.
```

*Pacing*: Each line appears with a 1.5-second gap. Lets it land.

---

**55–60s — The CTA**

*On screen*: Clean screen, CELLO wordmark.

*Text overlay*:
```
Install in 60 seconds.
@CELLO_protocol
Thread below ↓
```

*Pacing*: Hold for 5 seconds. Long enough for someone to screenshot.

---

### Pacing Summary

| Segment | Duration | Purpose |
|---|---|---|
| Hook/split screen | 0–2s | Pattern interrupt |
| Connection | 2–5s | Establishes two real machines |
| Conversation | 5–22s | The money shot — don't rush |
| Pause before seal | 22–25s | Anticipation |
| Receipt (hold) | 25–38s | The proof |
| Contrast flash | 38–43s | Old world vs. new world |
| Implication | 43–55s | Why it matters |
| CTA | 55–60s | Next action |

---

## Part 3: The Caption

### Candidate A — Statement + Implication
> Two AI agents just had a work conversation. Both sides hold the sealed transcript. No platform brokered it.
>
> This is CELLO.

*Rationale*: Clean, credible, declarative. Works for technical audience. Slightly passive — doesn't pull the viewer in.

---

### Candidate B — Pain-first
> In 2026, when you need your AI agent to work with a colleague's AI agent, you paste things into Slack.
>
> That's the state of AI collaboration right now. We built something different.
>
> [video]

*Rationale*: Strong pain hook. "Paste things into Slack" is instantly recognizable. But "we built something different" is vague and positions CELLO as a company announcement, not a demo reveal.

---

### Candidate C — First-person authentic (recommended)
> I asked my Claude Code agent to connect with a colleague's Hermes agent.
>
> They had a real work conversation. Both of us have the sealed record. No platform in the middle — direct, peer-to-peer.
>
> This is what AI agent collaboration looks like now.
>
> [video]

*Rationale*: **This is the strongest one.** Three reasons:

1. "I asked" — first-person, authentic, consistent with Yaser's insight that the framing must feel personal and considered, not polished.
2. "My Claude Code agent... a colleague's Hermes agent" — immediately legible to the ICP (people who actually use these tools). Not abstract. The ICP reads this and thinks "that's me and Sarah."
3. "This is what AI agent collaboration looks like now" — positions CELLO as the category, not just a product. It's an assertion about the world, which invites disagreement and discussion. Discussion = replies = algorithm.

**Do not add hashtags to the main post.** Hashtags signal "promotional" to the algorithm and look desperate. Use them in the first reply if at all.

---

### Follow-Up Thread (3 posts, post immediately after the main video)

Post these as replies to the main post within 5 minutes of publishing. This seeds the comments section before the algorithm decides whether to amplify.

**Reply 1** (post immediately):
> If you've ever pasted a giant AI conversation into Slack to share context with a colleague, this is for you.
>
> Here's exactly what happened in the video — and how to try it yourself:

**Reply 2** (post 2 minutes after Reply 1):
> Install:
> ```
> claude mcp add cello -- npx --yes @cello-protocol/connect
> ```
> Then run `cello_start_agent` in any Claude Code session. Your agent is live. That's the whole install.
>
> Share your agent address with anyone using CELLO. They can connect directly — no accounts, no onboarding flow.

**Reply 3** (post 2 minutes after Reply 2):
> What you're seeing is two independent agents — different machines, different owners — finding each other, exchanging messages, and sealing a record that both parties hold.
>
> No relay that loses your context. No platform that could go down. No third party that sees the content.
>
> Private beta. DM or reply to get in.

---

## Part 4: Production Notes

### Screen Layout
- **Split screen 50/50** — left and right panels, separated by a thin white line (2px) on dark background
- **Panel labels**: Bold, white, 16px, positioned top-left of each panel. Use role labels only:
  - Left: `Your Agent` (subtitle: `Claude Code`)
  - Right: `Colleague's Agent` (subtitle: `Hermes`)
  - Never: "daemon," "relay," "peer," "node," "libp2p"
- **Theme**: Dark (pure black `#000000` background, not dark grey). Terminal text in white or green. Labels in white. This reads cleanly on mobile OLED screens.
- **Font size**: Minimum 16px for terminal output. 20px for labels. Test by exporting a still frame and reading it on your phone at arm's length. If you have to zoom in, it's too small.
- **Third panel (receipt)**: When the sealed transcript appears, it either slides in from the bottom (preferred — feels like it materializes from below) or expands to full screen replacing the split. Do not show it as a tiny inset — it needs to be readable.

### What to Show vs. What to Hide

**Show:**
- The `cello_initiate_session` tool call (it's readable and concrete)
- The message content (the work conversation — make it word-for-word the script above)
- The `Session sealed.` line
- The sealed receipt: agent names, message digest, timestamp, verification line
- Nothing else

**Hide everything else:**
- Any install output, npm warnings, or dependency logs
- Stack traces, error output of any kind (pre-run the demo, resolve any errors before recording)
- IP addresses, internal hostnames, port numbers
- Any MCP tool call that isn't `cello_initiate_session`, `cello_send`, or `cello_sealed_receipt`
- The `>` prompt character — if possible, show only output, not the input commands. This keeps the focus on what's happening, not on typing.

### The One Moment to Hold Longer

**The sealed receipt appearing at 25–38s.** This is the demo equivalent of "I see it loading, it's real, I believe it."

Hold it for 13 seconds. This feels uncomfortably long while editing. Ship it anyway. The viewer needs time to:
1. See both agent names on the receipt
2. Read the message digest
3. Read the timestamp
4. Read "Verified by 2-of-3 directory nodes"
5. Believe it

If you cut away from the receipt too early, you've just told them the story without showing them the proof. Beefed.ai's rule: "Make the reveal replicable — show the step, then repeat it back." The receipt appearing at 25s, held to 38s, then referenced again at 43s when you cut back from the Slack contrast — that repetition converts skepticism.

### Sound

**No music.** Terminal work is silent, and adding background music signals "I'm trying to make this feel exciting." The demo should be exciting because of what happens, not because of a beat drop.

If you want any sound, use only:
- Keystroke sounds at natural typing rhythm (subtle, not exaggerated)
- A very quiet "seal" sound effect at the moment `Session sealed.` appears — one note, 0.5 seconds, then silence

No voiceover. The text overlays do that work. A voiceover forces the viewer to listen and watch simultaneously, which increases cognitive load on mobile.

### Recording Tools

**Terminal recording**: Use [asciinema](https://asciinema.org/) to record terminal sessions, then [svg-term-cli](https://github.com/marionebl/svg-term-cli) to export clean SVG renders, then convert to video at the right frame rate. This gives you pixel-perfect terminal output with no cursor jitter, no accidental mouse movement, and the ability to control timing precisely.

**Alternative (simpler)**: Record with OBS at 1920×1080, then edit in DaVinci Resolve (free tier handles this) or CapCut for the text overlays and timing adjustments. Pre-script every command — use a separate session to type the commands that get copy-pasted in during recording so there are no typos on screen.

**The Tamir Dresher approach**: Pre-record the "slow" parts (install, setup, directory sync), then edit to cut them to 2-second montages. The live-action part of the demo is only the conversation and the receipt. Viewers accept jump cuts in terminal demos — they don't want to watch npm install. Cut everything that isn't the core story.

**Test the recording before the real take**: Run the entire demo script twice before hitting record. Pre-warm the session. Have the demo agent already running. Confirm the sealed receipt populates correctly. The worst outcome is recording a great demo that fails at second 52 when the receipt doesn't appear.

### X Format Specs

- **Native upload**: Required. Links to YouTube/Vimeo are deprioritized by the algorithm. Upload directly to X.
- **Aspect ratio**: **1:1 (square)** — the most mobile-friendly. Fills more of the screen than 16:9. If you're showing a split-screen terminal, 1:1 gives you more vertical space to show the full message content. Alternative: **4:5** if you want slightly more height.
- **File format**: MP4, H.264 codec, AAC audio (even if silent). Keep under 512MB. At 1080×1080 for 60 seconds, this is easily achievable.
- **Subtitles**: Not needed (no voiceover). Text overlays in the video itself serve this purpose and are more legible at small sizes than auto-generated subtitles.

---

## Part 5: Timing the Post

### How to Read the Timeline

Read your X timeline for 20 minutes before posting. You are looking for **convergence signals** — multiple independent people expressing the same pain within a short window, without knowing each other or knowing CELLO exists.

**High-signal triggers to wait for:**

1. **An Anthropic announcement about Claude capabilities** — model updates, new Claude Code features, MCP enhancements. The timeline floods with "I wonder if you could..." and "does this mean agents can..." posts. Post within 2 hours of the announcement wave, not the announcement itself.

2. **A "frustration post" from someone with followers** — someone with 10k+ followers tweets "I need my agents to talk to each other — why doesn't this exist yet?" or "spent 3 hours copy-pasting AI context between two projects today." This is a gift. Reply with the demo in the thread AND post your main demo tweet referencing the frustration.

3. **A multi-agent thread going viral** — when someone's Claude Code + Codex workflow post gets 500+ retweets, the follow-on conversation always includes "but how do they coordinate?" Post your demo as the answer.

4. **The LocalLLaMA / HN multi-agent wave** — watch r/LocalLLaMA and HN front page for multi-agent coordination threads. These communities amplify real implementations. A post that goes up while this thread is on the HN front page gets 10x the traction it would otherwise.

### The Three-Signal Rule

Post when at least **two of these three conditions** are true:
- [ ] Someone with 10k+ followers has expressed the pain CELLO solves in the last 4 hours
- [ ] A major AI announcement happened in the last 24 hours that created a "what's next" conversation
- [ ] Your timeline has 3+ independent posts about multi-agent coordination this week

If zero conditions are met, wait. A demo posted into a dead timeline is a wasted demo.

### What NOT to Do

- **Do not post at 9am on a Tuesday because that's "optimal posting time."** Optimal time is when your ICP is talking about your problem. That's a wave, not a clock.
- **Do not post the day of a major unrelated tech news event** (OpenAI announcement, Apple event, major geopolitical news). These events vacuum up timeline attention.
- **Do not post without your seed replies written and staged.** The first 30 minutes of replies determine whether the algorithm amplifies the post. Post the main video, immediately follow with the 3-reply thread from Part 3. Do not let the first comment be silence.
- **Do not post if the demo has any chance of failing.** Pre-run it 3 times that day before posting. If anything is flaky, fix it first. A demo that fails live is worse than no demo.

### Seed Engagement in the First 30 Minutes

After posting the main video and the 3-reply thread:
1. DM 3 people who would genuinely find this useful. Not asking for a retweet — asking "does this solve the problem you had last week?" Real replies from real people beat 50 algorithmic impressions.
2. Reply to any comment within 5 minutes of it appearing. Even a "yes, exactly" reply to a question keeps the thread active and signals to the algorithm that the post is generating engagement.
3. If anyone quote-tweets with a question, answer it immediately with depth. The QT creates a second distribution event.

---

## Part 6: The Distribution Flywheel

One 60-second recording becomes 7 content pieces. Do all 7 before the week is out.

### The 7 Pieces

**1. The main demo post** (60 seconds, X native video)
The full demo. The mothership. Everything else points back to this.

**2. The 10-second loop clip** (X short video)
Extract only the conversation appearing + "Session sealed." + receipt appearing. No context, no CTA. Just the transformation. Caption: `This is what AI agent collaboration looks like now.` Loop-worthy because it ends right where it begins. Post 2 days after the main demo.

**3. The "before" screenshot** (static image tweet)
A screenshot of the Slack paste moment from the contrast flash in the demo. Caption: `This is what "AI agent collaboration" looks like in 2026. We fixed it.` Link back to the demo video. Post 3 days after the main demo.

**4. The sealed receipt close-up** (static image tweet)
A full-screen screenshot of the sealed transcript — agent names, messages, hash, timestamp, verification line. Caption: `When two AI agents finish a conversation, they both hold this. Permanent. Verifiable. No platform needed. [link to demo]` Post 4 days after the main demo.

**5. The "old way vs. new way" comparison** (2-image post or carousel)
Left image: Slack thread of someone pasting AI context. Right image: the sealed receipt. No explanation needed. Caption: `Before CELLO / After CELLO.` Post 5 days after the main demo.

**6. The "install in 60 seconds" speedrun** (15-second video)
A second, faster demo format: just the install command → `cello_start_agent` → connection established → receipt. No conversation content — just the mechanical proof that it takes 60 seconds. This is for the audience that saw the demo and wants to know "but how hard is it really?" Post 6 days after the main demo.

**7. The LinkedIn version** (same video, different caption)
Same recording, recut to 45 seconds (cut the contrast flash — LinkedIn audience has less patience for snark). Caption rewritten for a business audience: "AI agents can now work together directly — without any platform in the middle. This is what we built." Post to LinkedIn the same day as the main X post but with a separate caption that removes all technical shorthand.

### The Multiplier Effect

Each piece drives back to the main demo for context. Each piece is purpose-built for its moment in the viewer's discovery path:
- Saw the main demo → The 10-second loop gets them to watch it again (repetition builds belief)
- Saw the loop → The receipt close-up gives them something to screenshot and share
- Saw the receipt → The "before/after" gives them the contrast they need to articulate the value to a colleague
- Got the contrast → The speedrun removes the "but is it actually easy?" objection
- Convinced → The LinkedIn version is what they share with their team

---

## Part 7: The Follow-Up Thread (Ready to Post)

Post these as replies to the main video tweet, in order, within 5 minutes of the main post going live.

---

**Reply 1** (post immediately after the main video):

> If you've ever pasted a giant AI conversation into Slack to share context with a colleague, this is for you.
>
> How it works in 4 steps:

---

**Reply 2** (post 2 minutes after Reply 1):

> Step 1: Install
> ```
> claude mcp add cello -- npx --yes @cello-protocol/connect
> ```
>
> Step 2: Start your agent in any Claude Code session:
> `cello_start_agent`
>
> Step 3: Share your agent address with anyone also running CELLO.
>
> Step 4: They call `cello_initiate_session` with your address. Direct connection. No accounts. No setup on their end beyond the install.

---

**Reply 3** (post 2 minutes after Reply 2):

> What this is actually about:
>
> You're already using AI agents to do your work. When you need to collaborate with a colleague also using AI agents — same platform or different — there's no real layer for that. You're back to primitives: Slack pastes, email, shared docs.
>
> CELLO is that layer. Direct peer-to-peer. Both sides hold the sealed record.
>
> Private beta — DM to get access, or reply with what you'd use it for.

---

*End of document.*

---
