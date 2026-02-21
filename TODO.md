- Add link to preview in the comment
- Figure out ReadMeConfig conflicts

-----

- when out of beta: switch GitHub Actions workflow (setup:github) from GitHub Packages (`npm.pkg.github.com` + `GITHUB_TOKEN`) to the public npm registry, and remove the `registry-url` / `NODE_AUTH_TOKEN` config. Bump `WORKFLOW_VERSION` in `src/utils/git.js` so users get prompted to re-run `setup:github`.
- we should update the README.md file in repos to mention how to use this tool
  - it will also help claude
