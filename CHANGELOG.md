# Changelog

All notable changes to Venue Visualizer are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-22

### Added

- Photoreal decor renders from the original room photo using the GitHub Copilot or Codex subscription CLI, or local FLUX
  via mflux. No API keys required.
- Claude Code, Codex, GitHub Copilot, and Kimi Code as brains for chat and venue planning.
- Three venue intake paths: find by name and review sourced research, upload photos, or extract room keyframes from a
  video tour. If you have no photos, describe the room and approve a generated empty base view.
- Editable DesignSpecs from chat, with deterministic venue rules and explicit render confirmation.
- An aligned structure check that compares architectural details with the base photo, plus an internal 3D layout guide
  for table placement.
- Saved Looks, side-by-side comparison, and PDF export with render and photo credits.
- First-run backend setup checks and `make doctor`, phone-friendly Studio layouts, and opt-in LAN pairing.

### Changed

- Added proof-driven regression testing: reproduce findings with a failing test, then save red and green evidence
  and UI screenshots in [docs/proof/](docs/proof/).
- Clarified when renders could not be verified or when the displayed render no longer reflects the current plan.

### Security

- Bound the default app and API to loopback; added a DNS-rebinding guard and cross-origin write protection.
- Kept the API on loopback in LAN mode, with expiring one-time pairing codes and revocable device access.
- Stripped API credentials from CLI subprocesses and used SSRF-safe fetches for web photos.

### Fixed

- Kept the Studio chat composer and Render controls in reach, and made quick replies send the selected answer.
- Unblocked references-only venue imports with explicit base-photo choices and prevented render-all without a base photo.

[Unreleased]: https://github.com/Bakar404/venue-visualizer/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Bakar404/venue-visualizer/compare/52118be52c7150aad9c0b8f9667edb0e26480ab1...v0.1.0
