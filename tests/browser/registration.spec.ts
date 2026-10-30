import { test, expect } from "@playwright/test";

for (const failed of [false, true]) {
  test(`registration redirects to login with ${failed ? "email failure" : "verification instructions"}`, async ({ page }) => {
    await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js**", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: 'window.turnstile = { render(el, options) { options.callback("test-token"); return "test"; }, remove() {}, reset() {} };',
      })
    );
    await page.route("**/api/auth/sign-up/email", async (route) => {
      expect(route.request().postDataJSON().callbackURL).toBe("/verify");
      await route.fulfill({ json: { user: { id: "test" }, ...(failed ? { emailDelivery: "failed" } : {}) } });
    });
    await page.goto("/register");
    await page.getByLabel("Display name", { exact: true }).fill("Test member");
    await page.getByLabel(/^Username/).fill("testmember");
    await page.getByLabel(/^Email/).fill("member@example.com");
    await page.getByLabel(/^Password/).fill("A-test-password-123");
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page).toHaveURL(`/login?registration=${failed ? "email-failed" : "success"}`);
    if (failed) {
      await expect(page.getByRole("alert")).toContainText("Your account was created, but we could not send the verification email.");
      await expect(page.getByRole("status")).not.toContainText("Registration successful");
    } else {
      await expect(page.getByRole("status")).toContainText("Registration successful. Check your email to verify your account before signing in.");
    }
    await expect(page.getByRole("link", { name: "Resend verification email" })).toHaveAttribute("href", "/verify");
  });
}
