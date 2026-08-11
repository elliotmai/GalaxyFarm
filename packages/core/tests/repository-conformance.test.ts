import { describe, it } from "vitest";

import {
  InMemoryRepository,
  repositoryConformanceCases,
  unsearchableRepositoryCases,
  type ConformanceRecord,
} from "../src/testing/index.js";

/**
 * The in-memory repository is the reference implementation. If it cannot pass
 * the contract, the contract is wrong.
 */
describe("InMemoryRepository — repository contract", () => {
  for (const testCase of repositoryConformanceCases) {
    it(testCase.name, async () => {
      await testCase.run(new InMemoryRepository<ConformanceRecord>(["name"]));
    });
  }

  for (const testCase of unsearchableRepositoryCases) {
    it(testCase.name, async () => {
      await testCase.run(new InMemoryRepository<ConformanceRecord>([]));
    });
  }
});
