# Runner

The `runner` service. It accepts only authenticated requests from the
Gateway (shared bearer) and never agent-defined commands.

For each request it:

1. checks on Gitea (read-only token) that the work branch HEAD is exactly the
   requested commit SHA, then downloads that commit's archive;
2. starts a throw-away Docker container from the image of the **project
   profile signed by the Engineer** (`request.project_profile`, bound by its
   SHA-256) and runs its phases in order (install, typecheck, tests, build…);
3. returns the result of each phase and bounded diagnostics for the repair
   loop: failing test files, test names and messages (Vitest JSON report),
   TypeScript errors (paths mapped with the repository's npm workspaces);
4. removes the container in every case.

PASS means that every phase of the project's own tests passed, including the
tests written by the Test agent. It is the only service, with `staging`, that
holds the host Docker socket.

Tests: `npm --prefix poc run runner:test`.
