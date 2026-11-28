# Concept Photography branch tracker

`main` holds approved production releases. `self-hosted-workspace-migration` combines verified work for office rehearsal. The verified starting point for this sequence is `358459aa07b535896e71332a8d6837c42ddbd6c9`. Each phase starts at the last integration commit once its Linux and Windows checks pass.

| Phase and branch | Objective | Starting commit | Latest commit | Status | Evidence and outstanding work |
| --- | --- | --- | --- | --- | --- |
| 1 · `feature/final-code-review` | Review core workflows, correct defects and enable feature CI | `358459a` | [Feature branch](https://github.com/Marykamalaperli/Concept-Photography/tree/feature/final-code-review) | Testing | Date-scoped work periods and worksheet filters that survive an asynchronous refresh. [Compare](https://github.com/Marykamalaperli/Concept-Photography/compare/self-hosted-workspace-migration...feature/final-code-review?expand=1) · [Actions](https://github.com/Marykamalaperli/Concept-Photography/actions?query=branch%3Afeature%2Ffinal-code-review) |
| 2 · `feature/windows-setup-wizard` | Guided installation, startup and beginner instructions | After phase 1 | — | Planned | [Windows installation](INSTALLATION.md) |
| 3 · `feature/security-hardening` | Authorization, employee privacy and negative tests | After phase 2 | — | Planned | [Operations and security](OPERATIONS.md) |
| 4 · `feature/server-reliability` | Recovery, maintenance, logs and safe updates | After phase 3 | — | Planned | [Recovery procedures](OPERATIONS.md#backup-and-recovery) |
| 5 · `feature/migration-rehearsal` | Synthetic legacy export, reconciliation and recovery exercise | After phase 4 | — | Planned | [Migration guide](MIGRATION.md) |
| 6 · `feature/release-candidate` | Final verification, release notes and office acceptance | After phase 5 | — | Planned | [Office acceptance](PRODUCTION_ACCEPTANCE.md) |

## Integration record

| Feature | Test status | Pull request | Merge status | Integration commit and evidence |
| --- | --- | --- | --- | --- |
| Final code review | In progress | Pending | Pending | Pending |

## Review and integration

1. Fetch the remote, confirm a clean checkout and fast-forward the local integration branch. Start or resume only the phase’s dedicated feature branch.
2. Run the relevant local tests, push the branch, and confirm the Linux and Windows jobs at its exact head. Use synthetic data to test migration, access, attendance and finance. Check the browser when a workflow or rendering can change.
3. Open a pull request into `self-hosted-workspace-migration`. Record the objective, changes, affected paths, data and security impact, test results, remaining checks, and rollback in the review. If pull request access is unavailable, record the comparison and follow the repository’s review requirements before integration.
4. After integration, confirm the merge SHA, repeat the full regression and applicable browser checks, and verify both Actions jobs for the integrated commit before creating the next branch.
5. Keep feature branches through release acceptance. Production release requires the studio owner’s explicit approval and checked office acceptance results.

## Recommended GitHub protections

Configure these only with repository-owner approval. Require a pull request and an appropriate reviewer on both long-lived branches. Require `checks (ubuntu-latest)` and `checks (windows-latest)` and require the branch to be current before merging. The Ubuntu job includes the dependency audit. Restrict force-push and deletion. Keep Pages publication as a manual approval on `main` following the approved HTTPS and data cutover. [Current GitHub rulesets](https://github.com/Marykamalaperli/Concept-Photography/rules)
