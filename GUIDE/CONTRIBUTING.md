# Contributing to Discreet

Thanks for your interest in contributing! This guide covers how to get started.

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/Discreet.git
   cd Discreet
   ```
3. **Create a branch** for your work:
   ```bash
   git checkout -b feature/your-feature-name
   ```
4. **Set up** the dev environment — see [QUICKSTART.md](QUICKSTART.md)

## Development Workflow

1. Make your changes on your feature branch
2. Test locally (`cargo test`, `./scripts/smoke_test.sh`)
3. Commit with clear, descriptive messages
4. Push to your fork and open a Pull Request against `main`

## Code Standards

### Rust (Backend)

- Follow standard Rust conventions (`cargo fmt`, `cargo clippy`)
- Use parameterized SQL queries — never interpolate user input into SQL strings
- All new endpoints need rate limiting applied
- Add migration files for any schema changes (numbered sequentially)

### TypeScript (Client)

- Use TypeScript (`.tsx`/`.ts`) — no plain JavaScript
- Import theme utilities from `'../theme'`, icons from `'../icons'`, API from `'../api/CitadelAPI'`
- Preserve E2EE invariants — encryption/decryption happens client-side only

### General

- Do not commit `.env` files or any secrets
- Do not modify `client/index.html` (legacy production client)
- Keep PRs focused — one feature or fix per PR

## Priority Contribution Areas

- **OpenMLS integration** — advancing the MLS encryption layer
- **Voice & video** — WebRTC + SFrame encrypted media
- **Desktop app** — Tauri 2.0 for Windows, macOS, Linux
- **Mobile app** — React Native for iOS and Android
- **Security auditing** — penetration testing, code review
- **Test coverage** — unit tests, integration tests, E2E tests
- **Documentation** — API docs, guides, tutorials

## Reporting Issues

Use [GitHub Issues](https://github.com/CitadelOpenSource/Discreet/issues) to report bugs or request features. Include:

- Steps to reproduce (for bugs)
- Expected vs actual behavior
- OS, browser, and relevant environment details

## License

By contributing, you agree that your contributions will be licensed under AGPL-3.0-or-later.
