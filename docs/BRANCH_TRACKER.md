# Concept Photography branch tracker

`main` holds approved production releases. `self-hosted-workspace-migration` combines verified work for office rehearsal. The verified starting point for this sequence is `358459aa07b535896e71332a8d6837c42ddbd6c9`. Each phase starts at the last integration commit once its Linux and Windows checks pass.

| Phase and branch | Objective | Starting commit | Latest commit | Status | Evidence and outstanding work |
| --- | --- | --- | --- | --- | --- |
| 1 · `feature/final-code-review` | Review core workflows, correct defects and enable feature CI | `358459a` | `f27873bea8fa861e8eca54dd0b4343604f9c963c` | Integration Verified | Date-scoped work periods and worksheet filters that survive an asynchronous refresh. [Feature diff](https://github.com/Marykamalaperli/Concept-Photography/compare/358459a...f27873b) |
| 2 · `feature/windows-setup-wizard` | Guided installation, startup and beginner instructions | `f0bd6fdb36859e145ec43fd3bd5f4bc03ee1574f` | `0ff3ca1e2e7712ca52584f6496dcf0b84a02e986` | Integration Verified | Guided setup and isolated Windows configuration test. Device checks remain part of office acceptance. [Windows quick start](../START_HERE.md) |
| 3 · `feature/security-hardening` | Authorization, employee privacy and negative tests | `0fa1735d2c575ff22fb3299a0ed4d31d756f7664` | [Feature branch](https://github.com/Marykamalaperli/Concept-Photography/tree/feature/security-hardening) | Testing | Location disclosure and cross-account verification. [Operations and security](OPERATIONS.md) |
| 4 · `feature/server-reliability` | Recovery, maintenance, logs and safe updates | After phase 3 | — | Planned | [Recovery procedures](OPERATIONS.md#backup-and-recovery) |
| 5 · `feature/migration-rehearsal` | Synthetic legacy export, reconciliation and recovery exercise | After phase 4 | — | Planned | [Migration guide](MIGRATION.md) |
| 6 · `feature/release-candidate` | Final verification, release notes and office acceptance | After phase 5 | — | Planned | [Office acceptance](PRODUCTION_ACCEPTANCE.md) |

## Integration record

| Feature | Test status | Pull request | Merge status | Integration commit and evidence |
| --- | --- | --- | --- | --- |
| Final code review | 37 tests passed and 51 axe views had zero violations. [Feature CI](https://github.com/Marykamalaperli/Concept-Photography/actions/runs/46144819933) | GitHub API blocked creation | Normal merge after confirming applicable rules | `f0bd6fdb36859e145ec43fd3bd5f4bc03ee1574f` · 37 tests and browser workflow passed. [Integration CI](https://github.com/Marykamalaperli/Concept-Photography/actions/runs/46144964518) |
| Windows setup wizard | 37 Linux tests and 38 Windows tests, including the wizard. [Feature CI](https://github.com/Marykamalaperli/Concept-Photography/actions/runs/46145872904) | GitHub API blocked creation | Normal merge after confirming applicable rules | `0fa1735d2c575ff22fb3299a0ed4d31d756f7664` · Regression and browser workflow passed. [Integration CI](https://github.com/Marykamalaperli/Concept-Photography/actions/runs/46146034163) |
| Security hardening | [Feature Actions](https://github.com/Marykamalaperli/Concept-Photography/actions?query=branch%3Afeature%2Fsecurity-hardening) | [Compare](https://github.com/Marykamalaperli/Concept-Photography/compare/self-hosted-workspace-migration...feature/security-hardening?expand=1) | Pending | Pending |

## Review and integration

1. Fetch the remote, confirm a clean checkout and fast-forward the local integration branch. Start or resume only the phase’s dedicated feature branch.
2. Run the relevant local tests, push the branch, and confirm the Linux and Windows jobs at its exact head. Use synthetic data to test migration, access, attendance and finance. Check the browser when a workflow or rendering can change.
3. Open a pull request into `self-hosted-workspace-migration`. Record the objective, changes, affected paths, data and security impact, test results, remaining checks, and rollback in the review. If pull request access is unavailable, record the comparison and follow the repository’s review requirements before integration.
4. After integration, confirm the merge SHA, repeat the full regression and applicable browser checks, and verify both Actions jobs for the integrated commit before creating the next branch.
5. Keep feature branches through release acceptance. Production release requires the studio owner’s explicit approval and checked office acceptance results.

## Recommended GitHub protections

Configure these only with repository-owner approval. Require a pull request and an appropriate reviewer on both long-lived branches. Require `checks (ubuntu-latest)` and `checks (windows-latest)` and require the branch to be current before merging. The Ubuntu job includes the dependency audit. Restrict force-push and deletion. Keep Pages publication as a manual approval on `main` following the approved HTTPS and data cutover. [Current GitHub rulesets](https://github.com/Marykamalaperli/Concept-Photography/rules)
