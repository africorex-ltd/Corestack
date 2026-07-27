# Security Policy

CoreStack is security-critical infrastructure for the applications built on it.
We take every report seriously.

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.**

Report privately via GitHub Security Advisories ("Report a vulnerability" on the
repository's Security tab). Include:

- A description of the vulnerability and its impact
- Steps to reproduce or a proof of concept
- Affected package(s) and version(s)

You will receive an acknowledgment within 72 hours and a status update at least
every 7 days until resolution.

## Scope

All `@corestack/*` packages in this repository are in scope. Vulnerabilities in
third-party dependencies should be reported upstream, but tell us too if CoreStack's
usage of the dependency amplifies the issue.

## Supported versions

Pre-1.0: only the latest released minor version receives security fixes.
