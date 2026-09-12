# Bizar worker rules for Agent Orchestrator

This repository is running inside an Agent Orchestrator (AO) worker session.
AO is the sole owner of worker sessions, worktrees, branches, session messages,
pull-request lifecycle, CI/review feedback, previews, and browser state.

- Work only on the assigned AO task in this session and its assigned worktree.
- Do not create a Bizar, Claude Code, Codex, tmux, or ad-hoc subagent team.
  If parallel work is needed, report it through AO so the AO orchestrator can
  create focused worker sessions.
- Do not create or manage a second worktree, task database, session ledger, or
  PR coordinator. Use `ao send` only for a real blocker or required
  cross-session coordination.
- Treat OpenKan as an explicit standalone option. Do not claim, update, or
  complete `.ok/` tasks from an AO worker unless the task explicitly requires
  it and the AO orchestrator has serialized that shared-state operation.
- Use Bizar's repository guidance, hooks, skills, targeted tests, `make check`,
  and applicable verification gates to implement and prove the assigned work.
- Keep commits focused. Push, publish, deploy, release, or mutate a PR only
  when the assigned task or an explicit user instruction authorizes it.
- Report changed files, verification evidence, and remaining risks to AO when
  the task is complete.
