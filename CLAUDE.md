# Project conventions

## Tooling

- Use **Bun** as the default package manager and JavaScript/TypeScript runtime for this project.
  - Install dependencies with `bun install` (not `npm install`).
  - Run scripts with `bun run <script>`.
  - Run files with `bun <file>` and one-off binaries with `bunx <pkg>` (instead of `node` / `npx`).
  - Use `bun test` for the test runner.
