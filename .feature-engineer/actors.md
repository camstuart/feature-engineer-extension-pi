# System Actors

## Developer
A software engineer who installs the Feature Engineer extension into Pi and invokes `/feature` to develop new functionality. They have full technical authority — they review every artifact on disk before approving, provide rejection feedback when work needs to change, and own the resulting code. They are comfortable reading TypeScript, navigating the terminal, and making commit-level decisions. They interact with the extension through the Pi REPL and approve/reject workflow steps.

## Pi Coding Agent
The LLM-driven Pi session that the extension orchestrates. Each workflow step runs in a fresh agent session that reads its prompt, template, prior artifacts, and skill-specific instructions, then writes one artifact (or commits code, in automated steps) and ends its turn. The agent never owns the workflow — it executes exactly the skill it is given, in the mode (`direct` / `vague`) the user chose for `req-gathering`, and surfaces any blockers via `ui.notify`.

## Reviewer
Either the same Developer acting as their own reviewer, or a teammate reviewing the final pull request before merge. They read the requirement, technical architecture, test plan, implementation plan, and review concerns artifacts in order to verify the implementation matches intent. They do not interact with the extension directly — they consume its artifacts.
