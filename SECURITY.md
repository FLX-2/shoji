# Security

Shoji runs on your computer with your API key and your code, so security reports matter to us.

## Reporting a problem

Please don't open a public issue. Report it privately through [GitHub's private vulnerability reporting](https://github.com/FLX-2/shoji/security/advisories/new), with the steps to reproduce it and what an attacker could do.

## What's in scope

- The API key leaving the system keychain, or going anywhere but Anthropic.
- Private files (such as `.env` and keys) reaching a model, a tool or a diff.
- A role running a command, or an MCP tool changing something, without the permission Shoji should ask for.
- The spending limits being passed.

## Supported versions

Fixes go into the latest release.
