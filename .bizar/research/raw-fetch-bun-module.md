# bun-module (zenobi-us/bun-module)

## Source: README (GitHub)
- URL: https://github.com/zenobi-us/bun-module
- Template repo for generating Bun modules (TypeScript packages published to npm)
- Deprecated opencode-plugin-template — now points to bun-module as the canonical generator

### Project Structure (generated)
```
my-module/
├── src/
│   ├── index.ts          # Module entry point
│   └── something/else.ts # All the things!
├── .github/
│   └── workflows/        # CI/CD workflows
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript config
└── README.md             # Your module's documentation
```

### package.json (template)
- `"type": "module"` — ESM only
- `"exports"` map with `types` + `default` pointing to `./dist/index.d.ts` / `./dist/index.js`
- `"files": ["dist", "src/version.ts"]` — only ship compiled output + version marker
- `"publishConfig": { "access": "public" }`
- devDependencies: `vitest`, `@types/node`, `bun-types`, `eslint`, `prettier`, `typescript-eslint`
- No runtime dependencies (pure TypeScript library)

### tsconfig.json
- `"target": "ESNext"`, `"module": "ESNext"`, `"moduleResolution": "bundler"`
- `"strict": true`, `"noEmit": true` (Bun handles compilation)
- `"allowImportingTsExtensions": true`
- `"types": ["bun-types"]`

### Build & Tooling
- Uses `mise` for tooling management (not direct npm scripts)
- `bun run build` / `bun run test` / `bun run lint` / `bun run format`
- Test: Vitest
- Lint: ESLint 9.x + Prettier
- Release: release-please with two channels (pre-release `.next`, stable `latest`)
- Conventional commits required
- NPM Trusted Publishing (OIDC, no tokens)
- First release must be manual (`npm publish`), then trusted publishing auto

### Key takeaways for package structure
- Entry point: `src/index.ts`, compiled to `dist/index.js` + `dist/index.d.ts`
- Dual `exports` map (types + default) for TypeScript consumers
- `version.ts` tracked by release-please for version bumps
- No bundler — Bun's native TypeScript support
- Plugin-specific packages: `@opencode-ai/plugin` as dependency
