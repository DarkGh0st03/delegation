import {createTrustedProjectTestSourceProfile} from "../../src/gitea-permission-containment.mjs";

/** Test-source rule of a sample repository with backend and frontend tests. */
export const SAMPLE_TEST_SOURCES = createTrustedProjectTestSourceProfile({
  roots: ["tests/backend", "tests/frontend"],
  suffixes: [".test.ts", ".test.tsx"]
});
