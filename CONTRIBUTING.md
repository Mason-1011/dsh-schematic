# Contributing to dsh-schematic

Thanks for helping make DeepSeek Harness wiring easier to understand and safer to edit.

## Before opening an issue

- Update to the latest `dsh-schematic` release.
- Check existing issues for the same symptom.
- Confirm whether the problem still occurs with composition editing turned off.
- Remove secrets, prompts, session content, home-directory paths, and tokens from screenshots and logs.

Bug reports should include:

- `dsh-schematic`, DeepSeek Harness, Node.js, and browser versions;
- the profile name and relevant plugin/provider names;
- exact reproduction steps and expected versus actual behavior;
- relevant browser console or host logs, redacted where necessary.

## Pull requests

Keep changes focused. Explain the user-visible problem, the chosen behavior, and how you verified it. For UI changes, include a screenshot or short recording when practical.

```sh
npm ci
npm run build
```

The build must pass on Node 22 and 24. Do not commit generated `dist/` files unless a release process explicitly requires them.

The observer side must remain behavior-neutral: do not write session logs or alter service return values. Workbench writes must stay inside the versioned managed block, preserve bytes outside it, dry-run before write, and retain backup and rollback behavior.

## 中文说明

欢迎提交 issue 与范围清晰的 PR。Bug 报告请附 schematic、DSH、Node 与浏览器版本、profile、复现步骤及脱敏后的相关日志。观察侧必须保持行为中性;工作台写入必须局限在版本化受管块内,并保留写前干跑、备份和回滚机制。
