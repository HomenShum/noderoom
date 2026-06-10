# LinkedIn — noderoom-live-collab-v1

I tried to make a README GIF for a spreadsheet agent.

It turned into a multiplayer AI workspace.

The spreadsheet-agent part was not the real problem. Lots of companies are already building AI
inside Excel, Sheets, finance models, and analyst workflows.

The harder question was:

What happens when a human and an AI agent edit the same live artifact?

A real demo had to show:

- multiple users in a room
- an agent editing a shared spreadsheet
- human edits during the agent run
- versioned cells
- locks
- CAS writes
- proposal review
- undo
- traces
- a reproducible walkthrough, not a fake final-state screenshot

That became NodeRoom: a live collaborative room where humans and NodeAgents work on shared
spreadsheets, notes, and walls without silently clobbering each other.

The lesson:

AI agents are moving from chat boxes into shared work surfaces.

The hard part is not just making them smart.

The hard part is making them safe collaborators over shared state.
