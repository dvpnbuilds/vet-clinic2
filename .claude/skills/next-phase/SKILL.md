---
name: next-phase
description: Start the next build phase. Trigger: "next phase", "start phase N", "continue building".
---
1. Read PROGRESS.md; confirm the previous phase is audited-pass. If not, stop and say so.
2. Read the next phase's scope and "Done when" criteria from PLAN.md, and re-read RULES.md.
3. Mark the phase "in progress" in PROGRESS.md, restate its scope in one paragraph, then build it.
4. Write tests for the phase's completion criteria as you go.
5. When done, mark it "built" in PROGRESS.md and tell DV to run /audit.
