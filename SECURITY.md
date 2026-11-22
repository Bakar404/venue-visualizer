# Security policy

## Supported versions

| Version | Security fixes |
| --- | --- |
| 0.1.x | Yes |

## Reporting a vulnerability

Use GitHub's [private vulnerability reporting](https://github.com/Bakar404/venue-visualizer/security/advisories/new)
to open a private draft advisory. Include the affected version, impact, and how to reproduce the issue. Do not post
vulnerability details in a public issue or pull request, or include credentials or personal venue data.

## Local-only security model

By default, the web app and API bind to loopback. The API rejects unexpected hosts to guard against DNS rebinding
and blocks cross-origin writes. AI tools run through the official CLIs with API credentials stripped from their
subprocess environments; venue photo downloads are checked to prevent server-side request forgery. This is a local
app, not a public or multi-tenant service.

`make dev-lan` is an explicit opt-in for trusted Wi-Fi. Only the web listener is exposed on the LAN; the API stays
on loopback behind the proxy. Phones pair with a one-time, expiring code shown on the host, and device access is
revocable. The connection uses plain HTTP, so don't enable LAN mode on shared or untrusted networks.
