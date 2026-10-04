# CLAUDE.md

This file provides guidance to AI assistants (Claude Code and others) working in this repository.

## Repository Status

This repository is currently **empty** — no source code, configuration, or documentation exists yet beyond this file. This CLAUDE.md serves as the foundational guide to be updated as the project grows.

---

## Project Overview

> **TODO:** Update this section once the project type and purpose are established.

- **Project name:** test-remote-research
- **Owner:** signor0810
- **Purpose:** (not yet defined)
- **Primary language:** (not yet defined)
- **Framework/runtime:** (not yet defined)

---

## Repository Structure

> **TODO:** Update this section as directories and files are added.

```
test-remote-research/
├── CLAUDE.md          # This file — AI assistant guidance
└── mods/
    └── herdr-bridge/  # Claude Code mod: routes tools to other agents via herdr, tracks tokens
```

Once files are added, document them here with their purpose.

---

## Development Setup

> **TODO:** Update these steps once the project stack is chosen.

### Prerequisites

List required tools, runtimes, and versions here.

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd test-remote-research

# Install dependencies (update for your stack)
# npm install        # Node.js / JavaScript
# pip install -r requirements.txt  # Python
# cargo build        # Rust
# go mod download    # Go
```

### Environment Configuration

```bash
# Copy environment template (add .env.example once variables are known)
cp .env.example .env
# Edit .env with your local values
```

---

## Git Workflow

### Branch Naming Convention

- `main` or `master` — stable production branch (never push directly)
- `claude/<description>-<session-id>` — AI-assisted development branches
- `feature/<description>` — new features
- `fix/<description>` — bug fixes
- `chore/<description>` — maintenance tasks (deps, tooling, docs)

### Commit Message Convention

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<optional scope>): <short description>

<optional body>

<optional footer>
```

**Types:**
- `feat` — new feature
- `fix` — bug fix
- `docs` — documentation changes only
- `style` — formatting, no logic change
- `refactor` — code restructuring, no behavior change
- `test` — adding or updating tests
- `chore` — maintenance (dependency updates, tooling, CI)
- `perf` — performance improvements

**Examples:**
```
feat(auth): add JWT token refresh endpoint
fix(api): handle null response from upstream service
docs: update README with setup instructions
chore: upgrade dependencies to latest versions
```

### Pull Request Workflow

1. Create a branch from `main` with a descriptive name
2. Make focused, atomic commits with clear messages
3. Push the branch and open a Pull Request
4. Ensure CI checks pass before merging
5. Squash merge into `main` with a conventional commit message

---

## AI Assistant Instructions

### General Guidelines

- **Read before writing.** Always read existing files before editing them.
- **Minimal changes.** Only modify what is directly requested or clearly necessary. Do not refactor surrounding code.
- **No speculative improvements.** Don't add features, error handling, or abstractions beyond what's asked.
- **No unnecessary comments.** Only add comments where logic is non-obvious; don't document self-evident code.
- **Security first.** Never introduce SQL injection, XSS, command injection, or other OWASP Top 10 vulnerabilities.

### File Editing Conventions

- Prefer editing existing files over creating new ones.
- Match the existing indentation and style of the file being edited.
- Do not add blank lines or whitespace changes unrelated to the task.
- Do not alter imports, exports, or function signatures unless explicitly required.

### What Requires User Confirmation

Always confirm with the user before:
- Deleting files or directories
- Force-pushing or resetting git history
- Modifying CI/CD pipelines
- Changing authentication, authorization, or security-sensitive logic
- Dropping database tables or running destructive migrations
- Pushing to `main`/`master` directly

### What Can Be Done Autonomously

- Reading any file in the repository
- Creating or editing source files as part of a requested task
- Running tests, linters, and formatters
- Creating feature branches and committing changes
- Opening pull requests on designated branches

---

## Code Style

> **TODO:** Update with project-specific style rules once the stack is determined.

Until a linter/formatter is configured, follow these defaults:

- **Indentation:** 2 spaces (or match existing file style)
- **Line length:** 100 characters max
- **Trailing whitespace:** none
- **End of file:** single newline
- **String quotes:** consistent within a file (prefer single quotes in JS/TS, double in Python)

---

## Testing

> **TODO:** Update with the actual test runner, conventions, and commands once established.

### Running Tests

```bash
# Add actual test commands here once configured
# npm test
# pytest
# cargo test
# go test ./...
```

### Test Conventions

- Tests should live alongside source files or in a dedicated `tests/` directory (TBD)
- Test files should be named `<module>.test.<ext>` or `test_<module>.<ext>` (depends on stack)
- Every new feature or bug fix should include a corresponding test
- Do not commit code that causes existing tests to fail

---

## Linting and Formatting

> **TODO:** Add actual lint/format commands once tooling is configured.

```bash
# Lint
# npm run lint
# ruff check .

# Format
# npm run format
# ruff format .
# black .
```

---

## CI/CD

> **TODO:** Add CI/CD pipeline details once configured (GitHub Actions, GitLab CI, etc.)

No CI/CD configuration exists yet. When added, document:
- What triggers pipelines (push, PR, merge)
- What checks must pass before merging
- How deployments are triggered and to which environments

---

## Environment Variables

> **TODO:** Document all required environment variables once they are defined.

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| *(none yet)* | — | — | — |

---

## Dependency Management

> **TODO:** Update with the actual package manager and update policy.

- Keep dependencies up to date; prefer LTS/stable versions
- Pin exact versions in lock files; use semver ranges in manifests
- Review changelogs before major version bumps
- Do not add dependencies for functionality available in the standard library

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `CLAUDE.md` | AI assistant guidance (this file) |
| *(none yet)* | — |

---

## Updating This File

This file should be updated whenever:
- A new tech stack or framework is adopted
- New conventions or standards are established
- The project structure changes significantly
- New CI/CD or deployment workflows are added
- New required environment variables are introduced

Keep this file current — it is the primary source of truth for any AI assistant working in this repository.
