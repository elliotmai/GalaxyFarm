/**
 * Executable enforcement of the data operations contract (spec §4.5).
 *
 * Two guards live here:
 *
 *   1. `findUnconfirmedDestructiveCalls` — clause 3, "confirmation before every
 *      destructive action". A presentation file that performs a destructive
 *      call must also pull in a confirmation helper.
 *   2. `findIncompleteCrudSurfaces` — clause 1, "full CRUD, everywhere it
 *      applies". An entity that declares a schema must declare the whole set of
 *      use cases that go with it.
 *
 * Both are *convention* checks over source text, not type-level proofs. That is
 * a deliberate trade: they cost nothing to run, they work on a codebase that is
 * still mostly unwritten, and they fail loudly the moment someone adds a delete
 * button with no dialog behind it. They are not a substitute for the component
 * tests that assert a specific dialog appears.
 */

export interface GuardFinding {
  file: string;
  line: number;
  symbol: string;
  reason: string;
}

export interface SourceFile {
  path: string;
  source: string;
}

/** Call expressions that mutate or destroy user data. */
const DESTRUCTIVE_CALL =
  /\b(delete|remove|destroy|purge|revoke|terminate|discard|void|archive|wipe|clear)([A-Z]\w*)?\s*\(/g;

/** Helpers that satisfy the confirmation requirement. */
const CONFIRMATION_HELPERS = [
  "useConfirmDelete",
  "useConfirmDestructive",
  "ConfirmDialog",
  "ConfirmDeleteDialog",
  "confirmDestructive",
  "withConfirmation",
];

/**
 * A method signature, not a call.
 *
 * `remove(id: Ulid, reason?: string): Promise<void>;` inside an interface
 * looks exactly like a call to a regex, and flagging it asks a type
 * declaration to import a dialog. The tell is the return-type annotation
 * followed by a semicolon and nothing else — a call cannot end that way.
 */
const METHOD_SIGNATURE = /^\s*(readonly\s+)?\w+(<[^>]*>)?\s*\([^)]*\)\s*:\s*[^;]+;\s*$/;

/**
 * Opt-out marker. A reason is mandatory: `// crud-guard: allow-unconfirmed —
 * clearing a local draft, nothing is persisted`. A bare marker does not count.
 */
const OPT_OUT = /\/\/\s*crud-guard:\s*allow-unconfirmed\s*[—-]\s*\S+/;

/** Destructive-sounding names that are not destructive to user data. */
const FALSE_FRIENDS = new Set([
  "removeEventListener",
  "removeChild",
  "clearTimeout",
  "clearInterval",
  "clearRect",
  "deleteProperty",
  "removeAttribute",
  "removeItem",
  "clearAll",
  "voidElement",
]);

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/**
 * Files whose job *is* confirmation, plus tests and fixtures, are exempt —
 * otherwise the guard would flag its own implementation.
 */
function isExempt(path: string): boolean {
  return (
    /\/tests?\//.test(path) ||
    /\.test\.[cm]?tsx?$/.test(path) ||
    /__fixtures__/.test(path) ||
    /\/confirm[-.]?/i.test(path)
  );
}

/**
 * Clause 3. Scans presentation sources for destructive calls that are not
 * accompanied by a confirmation helper.
 */
export function findUnconfirmedDestructiveCalls(files: readonly SourceFile[]): GuardFinding[] {
  const findings: GuardFinding[] = [];

  for (const { path, source } of files) {
    if (isExempt(path)) continue;

    const hasConfirmation = CONFIRMATION_HELPERS.some((helper) => source.includes(helper));
    if (hasConfirmation) continue;

    DESTRUCTIVE_CALL.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = DESTRUCTIVE_CALL.exec(source)) !== null) {
      const symbol = `${match[1]}${match[2] ?? ""}`;
      if (FALSE_FRIENDS.has(symbol)) continue;

      const line = lineOf(source, match.index);
      const lineText = source.split("\n")[line - 1] ?? "";
      const previousLine = source.split("\n")[line - 2] ?? "";
      if (OPT_OUT.test(lineText) || OPT_OUT.test(previousLine)) continue;
      // A declaration is not an action. The confirmation belongs at the call
      // site, and this is not one.
      if (METHOD_SIGNATURE.test(lineText)) continue;

      findings.push({
        file: path,
        line,
        symbol,
        reason:
          `\`${symbol}()\` is a destructive action with no confirmation helper in this file. ` +
          `Spec §4.5 clause 3 requires a dialog naming the record and its dependents. ` +
          `Import one of: ${CONFIRMATION_HELPERS.join(", ")} — or annotate the call with ` +
          `\`// crud-guard: allow-unconfirmed — <reason>\` if it genuinely destroys nothing persisted.`,
      });
    }
  }

  return findings;
}

/** Where entity definitions live: module domain layers, and the shared kernel. */
const ENTITY_FILE = /(?:\/src\/domain\/entities\/|packages\/core\/src\/entities\/).+\.ts$/;

/** Use cases are named `<operation>-<entity-slug>.ts`, in either layer. */
const USE_CASE_FILE = /\/src\/(?:application\/)?use-cases\/(\w+)-([\w-]+)\.ts$/;

/** The use cases every CRUD-able entity must expose (spec §4.5 clause 1). */
export const REQUIRED_CRUD_OPERATIONS = ["create", "get", "list", "update", "delete"] as const;

export interface EntityDeclaration {
  /** Entity name, e.g. `CattleProfile`. */
  name: string;
  /** Repo-relative path of the file declaring its schema. */
  file: string;
  /** Use-case operation names discovered for this entity. */
  operations: string[];
  /** Entities on the §4.5 exception list do not need a full surface. */
  exempt?: string;
}

/**
 * An entity that exists but has no use cases at all — declared, not yet built.
 *
 * Kept separate from a *partial* surface on purpose. Failing the build for
 * work that has not started yet produces a permanently red gate, and a
 * permanently red gate is one nobody reads. What matters is the half-built
 * case: the moment `create-zone.ts` lands without `delete-zone.ts`, that is a
 * screen shipping without a delete button, and that fails.
 */
export function notStartedEntities(entities: readonly EntityDeclaration[]): EntityDeclaration[] {
  return entities.filter((entity) => !entity.exempt && entity.operations.length === 0);
}

/**
 * Clause 1. Given the entities discovered in the codebase, report any whose
 * CRUD surface is started but incomplete.
 */
export function findIncompleteCrudSurfaces(entities: readonly EntityDeclaration[]): GuardFinding[] {
  const findings: GuardFinding[] = [];

  for (const entity of entities) {
    if (entity.exempt) continue;
    if (entity.operations.length === 0) continue; // not started — see notStartedEntities
    const missing = REQUIRED_CRUD_OPERATIONS.filter((op) => !entity.operations.includes(op));
    if (missing.length === 0) continue;

    findings.push({
      file: entity.file,
      line: 1,
      symbol: entity.name,
      reason:
        `${entity.name} is missing ${missing.map((m) => `\`${m}\``).join(", ")}. ` +
        `Spec §4.5 clause 1 requires every entity to expose ${REQUIRED_CRUD_OPERATIONS.join(", ")} ` +
        `unless it is on the enumerated exception list (derived read models, immutable ` +
        `legal/audit records, system-owned rows) — in which case declare the exemption.`,
    });
  }

  return findings;
}

/**
 * Discover entity declarations by convention: a domain entity file that exports
 * a `<Name>Schema`, paired with use-case files named `<operation>-<entity>.ts`
 * in the module's application layer.
 */
export function discoverEntities(files: readonly SourceFile[]): EntityDeclaration[] {
  const entities = new Map<string, EntityDeclaration>();

  for (const { path, source } of files) {
    // Modules keep entities under src/domain/entities; the shared kernel keeps
    // them under src/entities. Both are subject to §4.5.
    if (!ENTITY_FILE.test(path)) continue;
    for (const match of source.matchAll(/export\s+const\s+(\w+)Schema\b/g)) {
      // Schemas are values, so they are idiomatically camelCase
      // (`purchaseCandidateSchema`). The entity they describe is PascalCase,
      // and that is what belongs in a failure message.
      const name = capitalise(match[1] ?? "");
      if (name === "") continue;
      const exemptMatch = new RegExp(`crud-guard:\\s*exempt\\s*[—-]\\s*(.+)`, "i").exec(source);
      entities.set(name, {
        name,
        file: path,
        operations: [],
        ...(exemptMatch?.[1] ? { exempt: exemptMatch[1].trim() } : {}),
      });
    }
  }

  for (const { path } of files) {
    const match = USE_CASE_FILE.exec(path);
    if (!match?.[1] || !match[2]) continue;
    const [, operation, entitySlug] = match;
    for (const entity of entities.values()) {
      if (toSlug(entity.name) === entitySlug) entity.operations.push(operation);
    }
  }

  return [...entities.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** `purchaseCandidate` → `PurchaseCandidate`. */
export function capitalise(name: string): string {
  return name === "" ? "" : name[0]!.toUpperCase() + name.slice(1);
}

/** `CattleProfile` → `cattle-profile`. */
export function toSlug(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}
