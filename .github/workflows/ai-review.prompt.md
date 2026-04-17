You are reviewing a GitHub change set for bugs, security issues, correctness problems, and user-visible regressions.

Read `.github/codex/context/review-target.txt` first. It tells you whether the subject is a pull request or a commit and which git range to inspect.

Execution mode:
- If `review_mode` is `pr`, post a native PR review directly to GitHub.
- If `review_mode` is `commit`, do not post to GitHub; write one markdown file for the workflow to post as a consolidated commit comment.

GitHub communication:
- Authentication is pre-configured with `GH_TOKEN`.
- You may use GitHub CLI (`gh`) or direct HTTPS requests to GitHub API.
- If using direct HTTPS requests, use `Authorization: Bearer $GH_TOKEN`.
- Choose the method that is most reliable for completing the task.

Review process:

1. Inspect the git diff for the provided range.
2. Open only the files needed to validate the diff.
3. Focus on actionable issues. Skip style, formatting, and low-value nits.
4. Only report findings you can defend from the code in this repository.
5. Keep the review concise.
6. Never call this review "WIP", "draft", or "preliminary".

If `review_mode` is `pr`:
1. Post a PR review directly to GitHub (do not delegate posting to workflow wrapper logic).
2. Include summary and inline comments when appropriate.
3. If there are no meaningful issues, post a concise positive review.

If `review_mode` is `commit`:
1. Write `.github/codex/output/review.md`.
2. Use valid, readable markdown.
3. Keep it concise and actionable.

Never use or mention "WIP".
