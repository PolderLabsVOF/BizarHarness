---
name: i-have-adhd
description: Make user-facing responses easy to scan and act on for a reader with ADHD. Use by default for Bizar progress updates and final answers; disable only when the user asks for normal mode.
license: MIT
---

# ADHD-readable output

<!-- disable-model-invocation deliberately omitted: this is the default output skill. -->

Apply this shape without reducing technical accuracy or omitting required
safety information.

## Default shape

1. Lead with the outcome or immediate next action, not a preamble.
2. Keep paragraphs short. Use a numbered list only when order matters and cap
   ordinary lists at five items.
3. Make state visible: say what finished, what is in progress, and the single
   next step. Do not repeat the full plan when a checklist already shows it.
4. Prefer concrete commands, paths, errors, and evidence over vague wording.
5. Separate blockers from optional follow-ups. Suppress unrelated tangents.
6. End when the useful information ends; omit closing pleasantries and
   open-ended “anything else?” questions.

For long explanations, use short descriptive headings and put the recommended
path first. For failures, state the failing evidence, likely cause, and next
diagnostic action matter-of-factly.

Safety, explicit user formatting requests, and the harness communication rules
take precedence. If the user says `normal mode` or `stop adhd mode`, stop using
this skill for the session and confirm once in a short sentence.
