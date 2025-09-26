/**
 * Regression test ensuring the sidebar avatar falls back to the bundled SVG
 * placeholder during Playwright runs where remote avatar requests would fail.
 */
import { expect, test } from "../fixtures";

test.describe("Sidebar avatar fallbacks", () => {
  test("renders the offline placeholder when Playwright disables remote avatars", async ({
    page,
  }) => {
    await page.goto("/");

    const userNavButton = page.getByTestId("user-nav-button");
    await expect(userNavButton).toBeVisible();

    const avatarImage = userNavButton.locator("img");
    await expect(avatarImage).toBeVisible();

    await expect(avatarImage).toHaveAttribute(
      "src",
      /avatar-placeholder/,
      {
        message:
          "The Playwright run should render the local SVG avatar to stay offline",
      }
    );
  });
});
