/**
 * What the spec asks for, and where it lives.
 *
 * §7 has had a conformance check since the first commit, so a route cannot
 * exist without being documented and cannot be documented without existing.
 * §5 had nothing equivalent, and §5 is where most of the spec's substance is:
 * sixty-nine declarations across eleven subsections, plus the sub-entities
 * named mid-paragraph. Reading that as prose and building "the important bits"
 * is exactly how a build ends up quietly missing `FeedingPlan`.
 *
 * So this file lists every one of them, and `tests/architecture/spec-coverage`
 * checks three things that prose cannot:
 *
 *   1. Every declaration in §5 appears here — a new one in the spec fails the
 *      build until it is classified.
 *   2. Nothing here has left the spec — a stale entry fails too, so this does
 *      not slowly become a second, wrong spec.
 *   3. Anything marked `built` really is: every symbol named in `declares` has
 *      to exist in the workspace. Marking something done without doing it is a
 *      failing build, not a paragraph nobody re-reads.
 *
 * `planned` is a first-class, honest state. The `declares` list on a planned
 * entry is the to-do list for that entity — what has to exist before the entry
 * can flip. Scope is the domain model: schemas and derivations. Whether a
 * *screen* exists is §7's job, and it is already checked there.
 */

/** Build phases, exactly as §11 names them. */
export type Phase = "Phase 0" | "Phase 1" | "Phase 2" | "Phase 3" | "Phase 4" | "Phase 5";

export interface SpecCoverageEntry {
  /** Subsection the declaration appears under, e.g. `5.1`. */
  readonly section: string;
  /**
   * `entity` — a record with a schema and a CRUD surface.
   * `derivation` — a read model computed from other records (§4.5 exception 1).
   * `concept` — prose describing a rule or a screen, with no artifact of its own.
   */
  readonly kind: "entity" | "derivation" | "concept";
  /** Symbols that satisfy it. For a planned entry, the ones still to write. */
  readonly declares: readonly string[];
  readonly phase: Phase;
  readonly status: "built" | "planned";
  /** Why a concept has no code, or what a planned entry is waiting on. */
  readonly note?: string;
}

/**
 * Keyed by the spec's own bold lead-in, with `(added vN)` annotations stripped
 * — `normaliseLabel` in `spec-model.ts` does the stripping, so the key here is
 * the name as a person would say it.
 */
export const SPEC_COVERAGE: Readonly<Record<string, SpecCoverageEntry>> = {
  // ---------------------------------------------------------------- §5.1
  Property: {
    section: "5.1",
    kind: "entity",
    declares: ["propertySchema", "hasCoordinates"],
    phase: "Phase 0",
    status: "built",
  },
  BrandingConfig: {
    section: "5.1",
    kind: "entity",
    declares: ["brandingConfigSchema", "resolveFarmName", "resolveBusinessName"],
    phase: "Phase 0",
    status: "built",
  },
  Zone: {
    section: "5.1",
    kind: "entity",
    declares: ["zoneSchema", "ZONE_TYPES", "isOverCapacity"],
    phase: "Phase 0",
    status: "built",
  },
  WaterSource: {
    section: "5.1",
    kind: "entity",
    declares: ["waterSourceSchema", "freezeCheckTargets", "freezeChoreTitle"],
    phase: "Phase 0",
    status: "built",
  },
  "Pasture care": {
    section: "5.1",
    kind: "entity",
    declares: ["pastureCareLogSchema", "PASTURE_CARE_ACTIONS", "costPerAcre"],
    phase: "Phase 2",
    status: "built",
    note: "The `resting` flag it shares with Zone was built in Phase 0.",
  },
  Animal: {
    section: "5.1",
    kind: "entity",
    declares: ["animalSchema", "ageInMonths", "displayName"],
    phase: "Phase 0",
    status: "built",
  },
  ZoneAssignment: {
    section: "5.1",
    kind: "entity",
    declares: ["zoneAssignmentSchema", "move", "occupantsOf", "currentAssignment"],
    phase: "Phase 0",
    status: "built",
  },
  "CareInstruction resolution": {
    section: "5.1",
    kind: "derivation",
    declares: ["resolveCareInstructions", "ResolvedInstruction"],
    phase: "Phase 0",
    status: "built",
  },
  "Safety levels": {
    section: "5.1",
    kind: "entity",
    declares: [
      "safetyLevelSchema",
      "effectiveSafetyLevel",
      "SAFETY_LEVEL_DEFAULTS",
      "resolveSafetyLabels",
      "suggestedLevelAfterCalving",
    ],
    phase: "Phase 0",
    status: "built",
  },
  FeedingPlan: {
    section: "5.1",
    kind: "entity",
    declares: ["feedingPlanSchema", "dailyDemandOf", "planLineSchema"],
    phase: "Phase 1",
    status: "built",
  },
  Contact: {
    section: "5.1",
    kind: "entity",
    declares: ["contactSchema", "CONTACT_TAGS", "emergencyContacts"],
    phase: "Phase 2",
    status: "built",
  },
  Attachment: {
    section: "5.1",
    kind: "entity",
    declares: ["attachmentSchema", "isImage", "pendingUploads"],
    phase: "Phase 0",
    status: "built",
  },
  "Task / ChoreTemplate": {
    section: "5.1",
    kind: "entity",
    declares: ["taskSchema", "choreTemplateSchema", "occursOn", "occurrencesInWindow"],
    phase: "Phase 2",
    status: "built",
  },
  CalendarEvent: {
    section: "5.1",
    kind: "derivation",
    declares: ["calendarEventSchema", "CALENDAR_EVENT_KINDS", "projectEvents"],
    phase: "Phase 2",
    status: "built",
    note: "Projected from other modules; the manual-event half is a real record.",
  },
  Roadmap: {
    section: "5.1",
    kind: "entity",
    declares: ["roadmapItemSchema", "ROADMAP_ITEM_TYPES", "byPriority"],
    phase: "Phase 1",
    status: "built",
  },
  PurchaseCandidate: {
    section: "5.1",
    kind: "entity",
    declares: ["purchaseCandidateSchema", "CANDIDATE_STATUSES", "isExpiring"],
    phase: "Phase 1",
    status: "built",
  },
  "Costs are itemised, not guessed": {
    section: "5.1",
    kind: "derivation",
    declares: ["totalAcquisitionCost", "compareToBudget"],
    phase: "Phase 1",
    status: "built",
  },
  "Comparison view": {
    section: "5.1",
    kind: "derivation",
    declares: ["rankByTotalCost", "byTotalCost", "daysOnMarket"],
    phase: "Phase 1",
    status: "built",
    note: "The screen is §7's `/admin/*/candidates`; the ordering is the domain's.",
  },
  "Planned → actual": {
    section: "5.1",
    kind: "derivation",
    declares: ["realise", "abandon", "isPlanOpen"],
    phase: "Phase 1",
    status: "built",
    note: "One conversion used by PurchaseCandidate, PlannedMating and PlannedPlanting.",
  },
  Notifications: {
    section: "5.1",
    kind: "derivation",
    declares: ["NOTIFICATION_TRIGGERS", "dueNotifications", "notificationSettingSchema"],
    phase: "Phase 2",
    status: "planned",
    note: "§6 holds the full trigger list; NOTIFICATION_COVERAGE below tracks it.",
  },

  // ---------------------------------------------------------------- §5.2
  CattleProfile: {
    section: "5.2",
    kind: "entity",
    declares: ["cattleProfileSchema", "breedCompositionSchema", "registrationSchema"],
    phase: "Phase 1",
    status: "planned",
  },
  Pedigree: {
    section: "5.2",
    kind: "entity",
    declares: ["externalAnimalSchema", "buildPedigree", "ancestorsAtGeneration"],
    phase: "Phase 1",
    status: "planned",
    note: "Also declares ExternalAnimal, named mid-paragraph.",
  },
  SemenInventory: {
    section: "5.2",
    kind: "entity",
    declares: ["semenInventorySchema", "drawStraw", "isLowSemenInventory"],
    phase: "Phase 1",
    status: "planned",
  },
  SyncProtocol: {
    section: "5.2",
    kind: "entity",
    declares: ["syncProtocolSchema", "protocolStepSchema", "projectProtocol"],
    phase: "Phase 1",
    status: "planned",
  },
  HeatRecord: {
    section: "5.2",
    kind: "entity",
    declares: ["heatRecordSchema", "nextExpectedHeat", "OESTRUS_CYCLE_DAYS"],
    phase: "Phase 1",
    status: "planned",
  },
  BreedingRecord: {
    section: "5.2",
    kind: "entity",
    declares: ["breedingRecordSchema", "projectedDueDate", "DEFAULT_GESTATION_DAYS"],
    phase: "Phase 1",
    status: "planned",
  },
  CalvingRecord: {
    section: "5.2",
    kind: "entity",
    declares: ["calvingRecordSchema", "calfFromCalving", "calvingWindow"],
    phase: "Phase 1",
    status: "planned",
  },
  WeightRecord: {
    section: "5.2",
    kind: "entity",
    declares: ["weightRecordSchema", "averageDailyGain", "adjusted205DayWeight"],
    phase: "Phase 1",
    status: "planned",
  },
  HealthRecord: {
    section: "5.2",
    kind: "entity",
    declares: ["healthRecordSchema", "withdrawalEndDate", "animalsUnderWithdrawal"],
    phase: "Phase 1",
    status: "planned",
  },
  MedInventory: {
    section: "5.2",
    kind: "entity",
    declares: ["medInventorySchema", "expiringSoon"],
    phase: "Phase 1",
    status: "planned",
  },
  "AcquisitionRecord / SaleRecord": {
    section: "5.2",
    kind: "entity",
    declares: ["acquisitionRecordSchema", "saleRecordSchema", "TRANSACTION_TYPES"],
    phase: "Phase 2",
    status: "planned",
  },
  ProcessingRecord: {
    section: "5.2",
    kind: "entity",
    declares: ["processingRecordSchema", "cutLineSchema", "dressingPercentage"],
    phase: "Phase 2",
    status: "planned",
  },
  "Per-animal P&L": {
    section: "5.2",
    kind: "derivation",
    declares: ["animalProfitAndLoss", "herdRollup"],
    phase: "Phase 1",
    status: "planned",
  },
  CattleCandidate: {
    section: "5.2",
    kind: "entity",
    declares: ["cattleCandidateSchema", "CATTLE_SALE_TYPES"],
    phase: "Phase 1",
    status: "planned",
  },
  HerdRoadmap: {
    section: "5.2",
    kind: "entity",
    declares: ["geneticGoalSchema", "plannedMatingSchema", "matingToBreeding"],
    phase: "Phase 1",
    status: "planned",
  },

  // ---------------------------------------------------------------- §5.3
  FeedType: {
    section: "5.3",
    kind: "entity",
    declares: ["feedTypeSchema", "FEED_CATEGORIES", "FEED_UNITS"],
    phase: "Phase 1",
    status: "planned",
  },
  FeedPurchase: {
    section: "5.3",
    kind: "entity",
    declares: ["feedPurchaseSchema", "feedConsumptionSchema"],
    phase: "Phase 1",
    status: "planned",
  },
  "Inventory & projections": {
    section: "5.3",
    kind: "derivation",
    declares: ["onHand", "dailyDemand", "runOutDate", "reorderOn"],
    phase: "Phase 1",
    status: "planned",
  },
  "Cost per head": {
    section: "5.3",
    kind: "derivation",
    declares: ["allocateFeedCost", "costPerHead"],
    phase: "Phase 1",
    status: "planned",
  },

  // ---------------------------------------------------------------- §5.4
  Flock: {
    section: "5.4",
    kind: "entity",
    declares: ["flockSchema", "flockAdjustmentSchema", "headCountOn"],
    phase: "Phase 2",
    status: "planned",
  },
  EggLog: {
    section: "5.4",
    kind: "entity",
    declares: ["eggLogSchema", "eggBreakdownSchema", "eggTotalsByPeriod"],
    phase: "Phase 2",
    status: "planned",
  },
  EggDisposition: {
    section: "5.4",
    kind: "entity",
    declares: ["eggDispositionSchema", "EGG_DISPOSITIONS"],
    phase: "Phase 2",
    status: "planned",
  },

  // ---------------------------------------------------------------- §5.5
  Bed: {
    section: "5.5",
    kind: "entity",
    declares: ["bedSchema", "BED_TYPES"],
    phase: "Phase 3",
    status: "planned",
  },
  "Crop / Variety": {
    section: "5.5",
    kind: "entity",
    declares: ["cropSchema", "varietySchema", "seedInventorySchema"],
    phase: "Phase 3",
    status: "planned",
  },
  Planting: {
    section: "5.5",
    kind: "entity",
    declares: ["plantingSchema", "gardenCareLogSchema", "expectedHarvestDate"],
    phase: "Phase 3",
    status: "planned",
  },
  "SeasonPlan → planting notifications": {
    section: "5.5",
    kind: "entity",
    declares: ["seasonPlanSchema", "plannedPlantingSchema", "plantingToActual"],
    phase: "Phase 3",
    status: "planned",
  },
  "Rotation guard": {
    section: "5.5",
    kind: "derivation",
    declares: ["rotationWarning", "DEFAULT_ROTATION_YEARS"],
    phase: "Phase 3",
    status: "planned",
  },
  HarvestLog: {
    section: "5.5",
    kind: "entity",
    declares: ["harvestLogSchema", "preservationLogSchema", "PRESERVATION_METHODS"],
    phase: "Phase 3",
    status: "planned",
  },
  "Planting calendar": {
    section: "5.5",
    kind: "derivation",
    declares: ["plantingWindows", "frostDatesFor"],
    phase: "Phase 3",
    status: "planned",
  },

  // ---------------------------------------------------------------- §5.6
  Equipment: {
    section: "5.6",
    kind: "entity",
    declares: ["equipmentSchema", "EQUIPMENT_CATEGORIES"],
    phase: "Phase 2",
    status: "planned",
  },
  MaintenanceRule: {
    section: "5.6",
    kind: "entity",
    declares: [
      "maintenanceRuleSchema",
      "meterReadingSchema",
      "maintenanceLogSchema",
      "fuelLogSchema",
      "maintenanceDue",
    ],
    phase: "Phase 2",
    status: "planned",
  },
  EquipmentCandidate: {
    section: "5.6",
    kind: "entity",
    declares: ["equipmentCandidateSchema", "pricePerMile", "pricePerHour", "TITLE_STATUSES"],
    phase: "Phase 2",
    status: "planned",
  },
  EquipmentRoadmap: {
    section: "5.6",
    kind: "concept",
    declares: [],
    phase: "Phase 2",
    status: "planned",
    note: "The generic Roadmap aggregate with `domain: equipment`; no separate entity.",
  },

  // ---------------------------------------------------------------- §5.7
  Customer: {
    section: "5.7",
    kind: "entity",
    declares: ["customerSchema"],
    phase: "Phase 5",
    status: "planned",
    note: "Schema and rules land now as scaffold; the UI is Phase 5.",
  },
  BookingRequest: {
    section: "5.7",
    kind: "entity",
    declares: ["bookingRequestSchema", "BOOKING_STATUSES"],
    phase: "Phase 5",
    status: "planned",
  },
  BoardingAgreement: {
    section: "5.7",
    kind: "entity",
    declares: ["boardingAgreementSchema", "packageSchema", "PROGRAM_PACKAGES"],
    phase: "Phase 5",
    status: "planned",
  },
  ProgramEnrollment: {
    section: "5.7",
    kind: "entity",
    declares: ["programEnrollmentSchema", "DEFAULT_HALTER_COLOR"],
    phase: "Phase 5",
    status: "planned",
    note: "Own-animal enrollments are not Phase 5 — they gate the program roster.",
  },
  "TrainingLog & Milestones": {
    section: "5.7",
    kind: "entity",
    declares: ["trainingLogSchema", "MILESTONES", "milestoneStateOf"],
    phase: "Phase 5",
    status: "planned",
  },
  ProgramSchedule: {
    section: "5.7",
    kind: "entity",
    declares: ["programScheduleSchema", "scheduleSlotSchema", "daySheetFor"],
    phase: "Phase 5",
    status: "planned",
  },
  ShowEntry: {
    section: "5.7",
    kind: "entity",
    declares: ["showEntrySchema"],
    phase: "Phase 5",
    status: "planned",
  },
  LiabilityForm: {
    section: "5.7",
    kind: "entity",
    declares: ["liabilityFormSchema", "signatureSchema", "signedSnapshotSchema"],
    phase: "Phase 5",
    status: "planned",
    note: "The signed snapshot is on §4.5's immutable-legal-record exception list.",
  },
  RuleEngine: {
    section: "5.7",
    kind: "derivation",
    declares: ["BOARDING_RULES", "evaluateRules", "ruleDeadlines"],
    phase: "Phase 5",
    status: "planned",
    note: "RULE_COVERAGE below tracks the individual rules from the §5.7 table.",
  },
  Invoice: {
    section: "5.7",
    kind: "entity",
    declares: ["invoiceSchema", "invoiceLineSchema", "invoiceTotal"],
    phase: "Phase 5",
    status: "planned",
  },

  // ---------------------------------------------------------------- §5.8
  Pet: {
    section: "5.8",
    kind: "concept",
    declares: [],
    phase: "Phase 2",
    status: "planned",
    note: "An Animal with species dog|cat, reusing HealthRecord and FeedingPlan — no new entity, by §2's one-animal-model rule.",
  },

  // ---------------------------------------------------------------- §5.10
  CareGuide: {
    section: "5.10",
    kind: "entity",
    declares: ["careGuideSchema", "guideSectionSchema", "composeGuide"],
    phase: "Phase 4",
    status: "planned",
  },

  // ---------------------------------------------------------------- §5.11
  SupplyItem: {
    section: "5.11",
    kind: "entity",
    declares: ["supplyItemSchema", "SUPPLY_CATEGORIES", "isLowStock"],
    phase: "Phase 2",
    status: "planned",
  },
  SupplyPurchase: {
    section: "5.11",
    kind: "entity",
    declares: ["supplyPurchaseSchema"],
    phase: "Phase 2",
    status: "planned",
  },
  SupplyUsage: {
    section: "5.11",
    kind: "entity",
    declares: ["supplyUsageSchema", "stockOnHand"],
    phase: "Phase 2",
    status: "planned",
  },
  "Durable tracking": {
    section: "5.11",
    kind: "entity",
    declares: ["durableAssignmentSchema", "DURABLE_CONDITIONS"],
    phase: "Phase 2",
    status: "planned",
  },
};

/**
 * §5.9 declares its entities mid-sentence rather than as bold lead-ins, so the
 * §5 parser cannot see them. Listed here so the section is not silently
 * uncovered — the test asserts every subsection 5.1–5.11 has entries.
 */
export const SECTION_ONLY_COVERAGE: Readonly<Record<string, SpecCoverageEntry>> = {
  HorseRoadmap: {
    section: "5.9",
    kind: "concept",
    declares: [],
    phase: "Phase 2",
    status: "planned",
    note: "The generic Roadmap aggregate with `domain: horses`.",
  },
  HorseCandidate: {
    section: "5.9",
    kind: "entity",
    declares: ["horseCandidateSchema", "TRAINING_LEVELS", "SOUNDNESS_STATUSES"],
    phase: "Phase 2",
    status: "planned",
  },
};

/**
 * The §6 default notification triggers, keyed by the spec's own wording.
 *
 * `derivedFrom` names the domain function that decides when the trigger fires.
 * A trigger with no derivation is a notification nobody can send.
 */
export const NOTIFICATION_COVERAGE: Readonly<
  Record<
    string,
    { readonly derivedFrom: string; readonly phase: Phase; readonly status: "built" | "planned" }
  >
> = {
  "vaccine/booster due": { derivedFrom: "boosterDue", phase: "Phase 1", status: "planned" },
  "withdrawal ending": { derivedFrom: "withdrawalEndDate", phase: "Phase 1", status: "planned" },
  "preg check due": { derivedFrom: "pregCheckDue", phase: "Phase 1", status: "planned" },
  "calving window opening": { derivedFrom: "calvingWindow", phase: "Phase 1", status: "planned" },
  "sync-protocol step today": {
    derivedFrom: "projectProtocol",
    phase: "Phase 1",
    status: "planned",
  },
  "feed run-out approaching": { derivedFrom: "reorderOn", phase: "Phase 1", status: "planned" },
  "med expiring": { derivedFrom: "expiringSoon", phase: "Phase 1", status: "planned" },
  "maintenance due (hours/miles/date)": {
    derivedFrom: "maintenanceDue",
    phase: "Phase 2",
    status: "planned",
  },
  "bull ring due": { derivedFrom: "ruleDeadlines", phase: "Phase 5", status: "planned" },
  "bull/heifer/steer departure approaching": {
    derivedFrom: "ruleDeadlines",
    phase: "Phase 5",
    status: "planned",
  },
  "new booking request": {
    derivedFrom: "bookingRequestSchema",
    phase: "Phase 5",
    status: "planned",
  },
  "liability form unsigned near drop-off": {
    derivedFrom: "evaluateRules",
    phase: "Phase 5",
    status: "planned",
  },
  "drop-off/pickup reminders": {
    derivedFrom: "evaluateRules",
    phase: "Phase 5",
    status: "planned",
  },
  "planting window opening (per season plan, indoor & outdoor)": {
    derivedFrom: "plantingWindows",
    phase: "Phase 3",
    status: "planned",
  },
  "chore overdue": { derivedFrom: "isOverdue", phase: "Phase 2", status: "built" },
  "low semen inventory": {
    derivedFrom: "isLowSemenInventory",
    phase: "Phase 1",
    status: "planned",
  },
  "supply low-stock": { derivedFrom: "isLowStock", phase: "Phase 2", status: "planned" },
  "purchase-candidate sale date approaching": {
    derivedFrom: "isExpiring",
    phase: "Phase 1",
    status: "built",
  },
  "candidate listing expiring": { derivedFrom: "isExpiring", phase: "Phase 1", status: "built" },
  "frost warning": { derivedFrom: "frostRisk", phase: "Phase 3", status: "planned" },
  "tank-freeze warning": { derivedFrom: "freezeCheckTargets", phase: "Phase 2", status: "built" },
  "calving watch (pressure drop / full moon / cold snap inside a due window)": {
    derivedFrom: "calvingWatchSignals",
    phase: "Phase 1",
    status: "planned",
  },
};

/** The §5.7 rule table. Each rule is a policy object, per the spec's wording. */
export const RULE_COVERAGE: Readonly<
  Record<string, { readonly id: string; readonly status: "built" | "planned" }>
> = {
  "Must be weaned at drop-off (no pairs unless cow is here for breeding)": {
    id: "weaned-at-drop-off",
    status: "planned",
  },
  "Under 6 months old at drop-off": { id: "under-six-months", status: "planned" },
  "Tagged / visible ID": { id: "visible-id", status: "planned" },
  "Bulls ringed by 8 months": { id: "bull-ringed-by-eight-months", status: "planned" },
  "Bulls depart by 10 months": { id: "bull-departs-by-ten-months", status: "planned" },
  "Heifers/steers depart by 12 months": { id: "depart-by-twelve-months", status: "planned" },
  "Behavior termination clause": { id: "behaviour-termination", status: "planned" },
  "Owner pays feed & supplies": { id: "owner-pays-consumables", status: "planned" },
  "Owner liability for damages / no responsibility assumed / owner handles medical": {
    id: "owner-liability",
    status: "planned",
  },
};

/** The §4.4 kiosk boards, and the §7 route each one lives at. */
export const KIOSK_BOARD_COVERAGE: Readonly<Record<string, string>> = {
  "Pen Board": "/kiosk/pen-board",
  Calendar: "/kiosk/calendar",
  "Today's Chores": "/kiosk/chores",
  "Egg Quick-Entry": "/kiosk/eggs",
  "Program Day Sheet": "/kiosk/program-day",
  "Housesitter Mode": "/kiosk/housesitter",
};
