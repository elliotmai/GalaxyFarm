import { describe, it } from "vitest";

import { InMemoryRepository } from "../src/testing/in-memory-repository.js";
import {
  repositoryConformanceCases,
  type ConformanceRecord,
} from "../src/testing/repository-conformance.js";

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
});
