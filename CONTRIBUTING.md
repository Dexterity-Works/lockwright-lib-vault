# Contributing to Lockwright

The source is open under the [LICENSE](./LICENSE.md).

This GitHub repo is a fork of `tetherto/pearpass-lib-vault` on purpose. Open issues and pull requests here (`Thaoh/lockwright-lib-vault`). Never open a pull request against `tetherto/pearpass-lib-vault`.

Any pull request or issue may be closed without explanation.

## Issues

- Feature requests are welcome.
- For bug reports, provide a failing test case or steps to reproduce.

## Pull Request

Newer contributors are encouraged to start small. Tests, both failing and passing, are very helpful.

- Keep pull requests focused on a single feature or bug fix
- Provide a clear description of changes
- After cloning, run `git config core.hooksPath .husky` so the pre-commit lint hook runs
- Ensure code passes linting: `pnpm run lint`
- Ensure tests are passing: `pnpm test`
  - except any added failing tests

## License

By contributing, you agree that your contributions will be licensed under the project [LICENSE](./LICENSE.md).
