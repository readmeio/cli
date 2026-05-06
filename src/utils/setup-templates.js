import { WORKFLOW_VERSION } from './git.js';

const VERSION_HEADER = `# readme-lint v${WORKFLOW_VERSION}`;

const GITHUB_DEFAULT_RUNNER = 'ubuntu-latest';
const GITHUB_BLACKSMITH_RUNNER = 'blacksmith-2vcpu-ubuntu-2404';

export function githubWorkflow({ blacksmith = false } = {}) {
  const runner = blacksmith ? GITHUB_BLACKSMITH_RUNNER : GITHUB_DEFAULT_RUNNER;
  return `${VERSION_HEADER}
name: ReadMe Docs Lint

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write
  packages: read

jobs:
  lint:
    name: Lint docs
    runs-on: ${runner}

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Fix PR base branch
        id: fix-base
        if: github.event.pull_request.base.ref == 'main' || github.event.pull_request.base.ref == 'master'
        uses: actions/github-script@v7
        with:
          script: |
            const head = context.payload.pull_request.head.ref;
            const match = head.match(/^(v\\d+(?:\\.\\d+)*)/);
            if (!match) return;

            const versionBranch = match[1];

            try {
              await github.rest.repos.getBranch({
                owner: context.repo.owner,
                repo: context.repo.repo,
                branch: versionBranch,
              });
            } catch {
              return;
            }

            await github.rest.pulls.update({
              owner: context.repo.owner,
              repo: context.repo.repo,
              pull_number: context.issue.number,
              base: versionBranch,
            });

            core.setOutput('changed', 'true');
            core.setOutput('new_base', versionBranch);
            core.setOutput('old_base', context.payload.pull_request.base.ref);

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://npm.pkg.github.com

      - name: Lint docs
        id: lint
        continue-on-error: true
        env:
          NODE_AUTH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          GITHUB_BASE_SHA: \${{ github.event.pull_request.base.sha }}
        run: npx -y @readme/cli --no-check lint --github > comment.md

      - name: Comment on PR
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const marker = '<!-- readme-lint-results -->';
            let body = '';
            try { body = fs.readFileSync('comment.md', 'utf-8'); } catch {}
            if (!body.includes(marker)) return;

            const baseChanged = '\${{ steps.fix-base.outputs.changed }}' === 'true';
            if (baseChanged) {
              const oldBase = '\${{ steps.fix-base.outputs.old_base }}';
              const newBase = '\${{ steps.fix-base.outputs.new_base }}';
              body = body.replace('---', \`> **Base branch updated:** This PR was targeting \\\`\${oldBase}\\\` but has been updated to target \\\`\${newBase}\\\`.\\n\\n---\`);
            }

            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
            });
            const existing = comments.find(c => c.body.includes(marker));

            if (existing) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: existing.id,
                body,
              });
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.issue.number,
                body,
              });
            }


      - name: Fail if lint errors
        if: steps.lint.outcome == 'failure'
        run: exit 1
`;
}

export function gitlabWorkflow() {
  return `${VERSION_HEADER}
# Lints ReadMe docs on every merge request and posts results as an MR note.
# Requires a CI/CD variable named GITLAB_TOKEN with api scope (Settings → CI/CD → Variables)
# so the job can post comments back to the merge request.

readme-lint:
  stage: test
  image: node:20
  rules:
    - if: $CI_PIPELINE_SOURCE == 'merge_request_event'
  variables:
    GIT_DEPTH: 0
  script:
    - git fetch origin "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
    - export GITHUB_BASE_SHA="$(git rev-parse origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME)"
    - npx -y @readme/cli --no-check lint --github > comment.md || echo "LINT_FAILED=1" >> lint.env
    - |
      if [ -s comment.md ] && grep -q '<!-- readme-lint-results -->' comment.md; then
        BODY=$(cat comment.md)
        AUTH_HEADER="PRIVATE-TOKEN: $GITLAB_TOKEN"
        API="$CI_API_V4_URL/projects/$CI_PROJECT_ID/merge_requests/$CI_MERGE_REQUEST_IID/notes"
        EXISTING=$(curl -s -H "$AUTH_HEADER" "$API" | grep -o '"id":[0-9]*,"type":[^,]*,"body":"<!-- readme-lint-results -->' | head -1 | grep -o '"id":[0-9]*' | cut -d: -f2)
        if [ -n "$EXISTING" ]; then
          curl -s -X PUT -H "$AUTH_HEADER" --data-urlencode "body=$BODY" "$API/$EXISTING" > /dev/null
        else
          curl -s -X POST -H "$AUTH_HEADER" --data-urlencode "body=$BODY" "$API" > /dev/null
        fi
      fi
    - if [ -f lint.env ]; then exit 1; fi
  artifacts:
    when: always
    paths:
      - comment.md
`;
}

export function bitbucketWorkflow() {
  return `${VERSION_HEADER}
# Lints ReadMe docs on every pull request and posts results as a PR comment.
# Requires a repository variable named BITBUCKET_TOKEN (an app password with
# pullrequest:write scope) so the job can post comments back to the PR.

image: node:20

pipelines:
  pull-requests:
    '**':
      - step:
          name: Lint ReadMe docs
          clone:
            depth: full
          script:
            - export GITHUB_BASE_SHA="$(git rev-parse origin/$BITBUCKET_PR_DESTINATION_BRANCH)"
            - LINT_RC=0
            - npx -y @readme/cli --no-check lint --github > comment.md || LINT_RC=$?
            - |
              if [ -s comment.md ] && grep -q '<!-- readme-lint-results -->' comment.md; then
                BODY=$(cat comment.md)
                API="https://api.bitbucket.org/2.0/repositories/$BITBUCKET_WORKSPACE/$BITBUCKET_REPO_SLUG/pullrequests/$BITBUCKET_PR_ID/comments"
                AUTH="-u $BITBUCKET_USERNAME:$BITBUCKET_TOKEN"
                EXISTING=$(curl -s $AUTH "$API?pagelen=100" | grep -o '"id":[0-9]*[^}]*<!-- readme-lint-results -->' | head -1 | grep -o '"id":[0-9]*' | cut -d: -f2)
                JSON=$(node -e "console.log(JSON.stringify({content:{raw:require('fs').readFileSync('comment.md','utf-8')}}))")
                if [ -n "$EXISTING" ]; then
                  curl -s -X PUT $AUTH -H 'Content-Type: application/json' -d "$JSON" "$API/$EXISTING" > /dev/null
                else
                  curl -s -X POST $AUTH -H 'Content-Type: application/json' -d "$JSON" "$API" > /dev/null
                fi
              fi
            - exit $LINT_RC
          artifacts:
            - comment.md
`;
}

export function circleciWorkflow() {
  return `${VERSION_HEADER}
# Lints ReadMe docs on every PR and posts results as a PR comment.
# Requires CIRCLE_PROJECT_GITHUB_TOKEN (or your VCS-equivalent) as an env var
# in the project settings, with permission to comment on pull requests.

version: 2.1

jobs:
  readme-lint:
    docker:
      - image: cimg/node:20.11
    steps:
      - checkout
      - run:
          name: Lint ReadMe docs
          command: |
            BASE_BRANCH="\${CIRCLE_PR_BASE_BRANCH:-main}"
            git fetch origin "$BASE_BRANCH" || true
            export GITHUB_BASE_SHA="$(git rev-parse origin/$BASE_BRANCH 2>/dev/null || echo '')"
            set +e
            npx -y @readme/cli --no-check lint --github > comment.md
            LINT_RC=$?
            set -e
            if [ -n "$CIRCLE_PULL_REQUEST" ] && grep -q '<!-- readme-lint-results -->' comment.md; then
              PR_NUM=$(echo "$CIRCLE_PULL_REQUEST" | awk -F/ '{print $NF}')
              REPO="$CIRCLE_PROJECT_USERNAME/$CIRCLE_PROJECT_REPONAME"
              API="https://api.github.com/repos/$REPO/issues/$PR_NUM/comments"
              AUTH="Authorization: token $CIRCLE_PROJECT_GITHUB_TOKEN"
              EXISTING=$(curl -s -H "$AUTH" "$API?per_page=100" | grep -B1 '<!-- readme-lint-results -->' | grep -o '"id": [0-9]*' | head -1 | awk '{print $2}')
              JSON=$(node -e "console.log(JSON.stringify({body: require('fs').readFileSync('comment.md','utf-8')}))")
              if [ -n "$EXISTING" ]; then
                curl -s -X PATCH -H "$AUTH" -H 'Content-Type: application/json' -d "$JSON" "https://api.github.com/repos/$REPO/issues/comments/$EXISTING" > /dev/null
              else
                curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' -d "$JSON" "$API" > /dev/null
              fi
            fi
            exit $LINT_RC
          environment:
            NODE_OPTIONS: --max-old-space-size=4096

workflows:
  readme:
    jobs:
      - readme-lint:
          filters:
            branches:
              ignore:
                - main
                - master
`;
}

export function rwxWorkflow() {
  return `${VERSION_HEADER}
# Lints ReadMe docs on every PR and posts results as a PR comment.
# Requires a vault secret named GITHUB_TOKEN with permission to comment on PRs.

on:
  github:
    pull_request:
      init:
        commit-sha: \${{ event.pull_request.head.sha }}
        pr-number: \${{ event.pull_request.number }}
        repo: \${{ event.repository.full_name }}
        base-sha: \${{ event.pull_request.base.sha }}

tasks:
  - key: code
    call: mint/git-clone 1.6.6
    with:
      repository: https://github.com/\${{ init.repo }}.git
      ref: \${{ init.commit-sha }}

  - key: node
    call: mint/install-node 1.1.5
    with:
      node-version: '20'

  - key: lint
    use: [code, node]
    run: |
      set +e
      GITHUB_BASE_SHA="\${{ init.base-sha }}" npx -y @readme/cli --no-check lint --github > comment.md
      echo $? > lint.rc
    filter:
      - comment.md
      - lint.rc

  - key: comment
    use: lint
    env:
      GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
      REPO: \${{ init.repo }}
      PR: \${{ init.pr-number }}
    run: |
      if ! grep -q '<!-- readme-lint-results -->' comment.md; then exit 0; fi
      API="https://api.github.com/repos/$REPO/issues/$PR/comments"
      AUTH="Authorization: token $GITHUB_TOKEN"
      EXISTING=$(curl -s -H "$AUTH" "$API?per_page=100" | grep -B1 '<!-- readme-lint-results -->' | grep -o '"id": [0-9]*' | head -1 | awk '{print $2}')
      JSON=$(node -e "console.log(JSON.stringify({body: require('fs').readFileSync('comment.md','utf-8')}))")
      if [ -n "$EXISTING" ]; then
        curl -s -X PATCH -H "$AUTH" -H 'Content-Type: application/json' -d "$JSON" "https://api.github.com/repos/$REPO/issues/comments/$EXISTING" > /dev/null
      else
        curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' -d "$JSON" "$API" > /dev/null
      fi

  - key: report
    use: lint
    run: exit "$(cat lint.rc)"
`;
}

export function templateFor(platform, opts = {}) {
  switch (platform) {
    case 'github':    return githubWorkflow(opts);
    case 'gitlab':    return gitlabWorkflow();
    case 'bitbucket': return bitbucketWorkflow();
    case 'circleci':  return circleciWorkflow();
    case 'rwx':       return rwxWorkflow();
    default: throw new Error(`Unknown platform: ${platform}`);
  }
}
