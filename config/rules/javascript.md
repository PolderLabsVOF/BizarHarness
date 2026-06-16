# JavaScript / TypeScript Rules

- Use `const` by default, `let` only when reassignment is needed
- Prefer arrow functions for callbacks and closures
- Use async/await over raw promises or callbacks
- All functions must have explicit return types (TypeScript) or JSDoc (JavaScript)
- Use optional chaining (`?.`) and nullish coalescing (`??`) over `&&` or `||` guards
- No `any` types — use `unknown` and narrow with type guards
- Use strict mode (`"use strict"`) in all modules
- Prefer named exports over default exports