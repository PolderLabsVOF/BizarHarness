Open or manage a Bizar visual plan. Plans are collaborative canvases for structuring work across agents.

## Usage

```
/plan new <slug> [template]  — Create a new plan with a unique slug
/plan list                   — List all existing plans
/plan open <slug>            — Open a plan (returns the canvas URL)
/plan get <slug>             — Get full plan content as JSON
/plan add <slug> --title "..." — Add a new element to a plan
/plan update <slug> <id> ...  — Update an element's content/title/status
/plan delete <slug> <id>    — Delete an element from a plan
/plan comment <slug> [id] "..." — Add a comment to a plan or element
/plan comments <slug> [id]   — List comments on a plan or element
/plan status <slug> <status> — Set plan status (draft|approved|rejected|in-progress|done)
/plan wait <slug>            — Block until the plan receives feedback
```

## Routing

- If the user wants to create a new plan → `/plan new <slug>`
- If the user wants to see existing plans → `/plan list`
- If the user wants to open/view a plan → `/plan open <slug>`
- If the user wants to add content to a plan → `/plan add <slug> --title "..."`
- If the user wants to modify a plan element → `/plan update <slug> <id> ...`
- If the user wants to discuss/approve/reject → `/plan status <slug> <status>`
