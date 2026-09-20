# TypeSafe Jev documentation (not included)

This folder is where the project expects a local copy of TypeSafe's documentation, `llms-full.md`. The file is TypeSafe's, not mine to redistribute, so it is git-ignored and was removed from this repository's history before publication (see "History" in the top-level README).

The documentation is public at <https://docs.typesafe.ai>. To put the same single-file export here, from the repository root:

```bash
curl -L https://docs.typesafe.ai/llms-full.txt -o docs/jev/llms-full.md
```

PowerShell:

```powershell
Invoke-WebRequest https://docs.typesafe.ai/llms-full.txt -OutFile docs/jev/llms-full.md
```

Nothing at run time needs it. It is there for whoever works on the code: `CLAUDE.md` tells the coding agent to check Jev's API against it instead of guessing, and `NOTES.md` cites it by line number (for example L1158). Those line numbers refer to the copy downloaded on 2026-09-19; the file changes as TypeSafe updates its docs, so treat them as approximate.
