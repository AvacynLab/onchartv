import { expect as baseExpect, test as baseTest } from "@playwright/test";
import { getUnixTime } from "date-fns";
import {
  createAuthenticatedContext,
  expectNoApplicationErrorOverlay,
  type UserContext,
} from "./helpers";

type Fixtures = {
  adaContext: UserContext;
  babbageContext: UserContext;
  curieContext: UserContext;
};

export const test = baseTest.extend<object, Fixtures>({
  adaContext: [
    async ({ browser }, use, workerInfo) => {
      const ada = await createAuthenticatedContext({
        browser,
        name: `ada-${workerInfo.workerIndex}-${getUnixTime(new Date())}`,
      });

      await use(ada);
      await ada.context.close();
    },
    { scope: "worker" },
  ],
  babbageContext: [
    async ({ browser }, use, workerInfo) => {
      const babbage = await createAuthenticatedContext({
        browser,
        name: `babbage-${workerInfo.workerIndex}-${getUnixTime(new Date())}`,
      });

      await use(babbage);
      await babbage.context.close();
    },
    { scope: "worker" },
  ],
  curieContext: [
    async ({ browser }, use, workerInfo) => {
      const curie = await createAuthenticatedContext({
        browser,
        name: `curie-${workerInfo.workerIndex}-${getUnixTime(new Date())}`,
      });

      await use(curie);
      await curie.context.close();
    },
    { scope: "worker" },
  ],
});

test.afterEach(async ({ page }) => {
  // The client-side Next.js overlay only appears when a runtime exception slips
  // past our guards. Asserting on its absence after every scenario gives us an
  // inexpensive e2e signal that the hardened UI continues to render safely.
  await expectNoApplicationErrorOverlay(page);
});

export const expect = baseExpect;
