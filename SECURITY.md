# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through a GitHub security advisory:
<https://github.com/jonksar/elicitor/security/advisories/new>

Do not open a public issue, pull request or discussion for a security problem. Include the
affected package and version, what an attacker can do, and steps or code to reproduce it. Fixes
are released as a new version and described in the advisory once it is published.

## Supported versions

Elicitor is 0.x. Only the latest published version receives security fixes.

## Scope

In scope: the published `@elicitor/*` packages. Out of scope: how a host application authorises,
validates and stores reports, which Elicitor leaves to the host by design
([docs/security.md](docs/security.md) lists what the host must do), and the model providers'
services.
