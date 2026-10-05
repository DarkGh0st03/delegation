import { expect, test } from "@playwright/test";

const USER_ID = "usr-001";
const ADMIN_HEADERS = {
  "x-demo-role": "admin"
};

test("researcher acceptance: account suspension lifecycle and UI actions", async ({
  page,
  request
}) => {
  const userUrl = `http://127.0.0.1:3000/api/users/${USER_ID}`;
  const suspendUrl = `${userUrl}/suspend`;
  const reactivateUrl = `${userUrl}/reactivate`;

  const initial = await request.get(userUrl, { headers: ADMIN_HEADERS });
  expect(initial.ok()).toBeTruthy();
  expect((await initial.json()).status).toBe("ACTIVE");

  const suspend = await request.post(suspendUrl, { headers: ADMIN_HEADERS });
  expect([200, 204]).toContain(suspend.status());

  const suspended = await request.get(userUrl, { headers: ADMIN_HEADERS });
  expect((await suspended.json()).status).toBe("SUSPENDED");

  const duplicateSuspend = await request.post(suspendUrl, {
    headers: ADMIN_HEADERS
  });
  expect(duplicateSuspend.status()).toBe(409);

  const reactivate = await request.post(reactivateUrl, {
    headers: ADMIN_HEADERS
  });
  expect([200, 204]).toContain(reactivate.status());

  const activeAgain = await request.get(userUrl, { headers: ADMIN_HEADERS });
  expect((await activeAgain.json()).status).toBe("ACTIVE");

  const duplicateReactivate = await request.post(reactivateUrl, {
    headers: ADMIN_HEADERS
  });
  expect(duplicateReactivate.status()).toBe(409);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  await page.getByText("Alice Romano").click();
  await expect(page.getByRole("heading", { name: "Alice Romano" })).toBeVisible();
  await expect(page.getByText("ACTIVE", { exact: true })).toBeVisible();

  const suspendAction = page.getByRole("button", { name: /suspend/i });
  await expect(suspendAction).toBeVisible();
  await suspendAction.click();
  await expect(page.getByText("SUSPENDED", { exact: true })).toBeVisible();

  const reactivateAction = page.getByRole("button", { name: /reactivate/i });
  await expect(reactivateAction).toBeVisible();
  await reactivateAction.click();
  await expect(page.getByText("ACTIVE", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /suspend/i })).toBeVisible();
});
