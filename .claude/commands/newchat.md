# /newchat

You are helping me transition to a fresh chat session.

Your job is to create a handoff package from this conversation.

Perform these steps:

## 1. Analyze the conversation

Extract:

- Main objective/project
- Important background context
- Decisions already made
- Assumptions
- Constraints
- User preferences
- Technical details
- Files, tools, APIs, or systems involved
- Outstanding questions
- Next actions

Do not include irrelevant conversation history.

## 2. Update context file

Create or update:

`CONTEXT.md`

Use this structure:

# Project Context

## Objective
[what we are trying to accomplish]

## Current State
[where things stand]

## Decisions
- ...

## Constraints
- ...

## Important Details
- ...

## Open Questions
- ...

## Next Steps
- ...

## User Preferences
- ...

Preserve useful previous information in CONTEXT.md unless it is outdated.

## 3. Generate a new chat prompt

After updating CONTEXT.md, output:

---
NEW CHAT PROMPT

You are continuing work from a previous session.

Read the following context:

[include the complete updated CONTEXT.md]

Continue from this point. Do not restart analysis unless needed.

First, confirm your understanding and suggest the next best action.
---

## 4. Keep the output concise

The goal is a clean handoff, not a transcript.
