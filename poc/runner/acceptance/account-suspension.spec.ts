import { expect, test, type APIRequestContext } from "@playwright/test";

const USER_ID = "usr-001";
const USER_URL = `http://127.0.0.1:3000/api/users/${USER_ID}`;
const SUSPEND_URL = `${USER_URL}/suspend`;
const REACTIVATE_URL = `${USER_URL}/reactivate`;
const ADMIN_HEADERS = {
  "x-demo-role": "admin"
};

async function status(request: APIRequestContext): Promise<string> {
  const response = await request.get(USER_URL, { headers: ADMIN_HEADERS });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).status as string;
}

async function ensureActive(request: APIRequestContext): Promise<void> {
  if ((await status(request)) === "SUSPENDED") {
    const response = await request.post(REACTIVATE_URL, {
      headers: ADMIN_HEADERS
    });
    expect([200, 204]).toContain(response.status());
  }
  expect(await status(request)).toBe("ACTIVE");
}

test.afterEach(async ({ request }) => {
  await ensureActive(request);
});

test("researcher acceptance: administrator can suspend an ACTIVE account", async ({
  request
}) => {
  await ensureActive(request);

  const response = await request.post(SUSPEND_URL, { headers: ADMIN_HEADERS });
  expect([200, 204]).toContain(response.status());
  expect(await status(request)).toBe("SUSPENDED");
});

test("researcher acceptance: administrator can reactivate a SUSPENDED account", async ({
  request
}) => {
  await ensureActive(request);
  const suspended = await request.post(SUSPEND_URL, {
    headers: ADMIN_HEADERS
  });
  expect([200, 204]).toContain(suspended.status());

  const response = await request.post(REACTIVATE_URL, {
    headers: ADMIN_HEADERS
  });
  expect([200, 204]).toContain(response.status());
  expect(await status(request)).toBe("ACTIVE");
});

test("researcher acceptance: repeated state transitions are rejected", async ({
  request
}) => {
  await ensureActive(request);

  const firstSuspend = await request.post(SUSPEND_URL, {
    headers: ADMIN_HEADERS
  });
  expect([200, 204]).toContain(firstSuspend.status());

  const duplicateSuspend = await request.post(SUSPEND_URL, {
    headers: ADMIN_HEADERS
  });
  expect(duplicateSuspend.status()).toBe(409);

  const firstReactivate = await request.post(REACTIVATE_URL, {
    headers: ADMIN_HEADERS
  });
  expect([200, 204]).toContain(firstReactivate.status());

  const duplicateReactivate = await request.post(REACTIVATE_URL, {
    headers: ADMIN_HEADERS
  });
  expect(duplicateReactivate.status()).toBe(409);
});

test("researcher acceptance: UI exposes the action matching account state", async ({
  page,
  request
}) => {
  await ensureActive(request);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  await page.getByText("Alice Romano").click();
  await expect(page.getByRole("heading", { name: "Alice Romano" })).toBeVisible();
  await expect(page.getByText("ACTIVE", { exact: true })).toBeVisible();

  const suspendAction = page.getByRole("button", { name: /suspend/i });
  await expect(suspendAction).toBeVisible();
  await suspendAction.click();
  await expect(page.getByText("SUSPENDED", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /reactivate/i })).toBeVisible();

  const reactivateAction = page.getByRole("button", { name: /reactivate/i });
  await reactivateAction.click();
  await expect(page.getByText("ACTIVE", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /suspend/i })).toBeVisible();
});
