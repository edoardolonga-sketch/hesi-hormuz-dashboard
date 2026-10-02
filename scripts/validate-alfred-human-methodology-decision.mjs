import { readFile } from "node:fs/promises";

const HUMAN_DECISION_FILE = new URL(
  "../data/brent-alfred-human-methodology-decision.json",
  import.meta.url
);

const POLICY_VALIDATION_FILE = new URL(
  "../data/brent-alfred-availableat-policy-validation.json",
  import.meta.url
);

const POINT_IN_TIME_FILE = new URL(
  "../data/brent-alfred-point-in-time-validation.json",
  import.meta.url
);

async function readJson(file, label) {
  const raw = await readFile(file, "utf8");

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${label}`);
  }
}

function requireCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const decision = await readJson(
    HUMAN_DECISION_FILE,
    "brent-alfred-human-methodology-decision.json"
  );

  const policyValidation = await readJson(
    POLICY_VALIDATION_FILE,
    "brent-alfred-availableat-policy-validation.json"
  );

  const pointInTimeValidation = await readJson(
    POINT_IN_TIME_FILE,
    "brent-alfred-point-in-time-validation.json"
  );

  requireCondition(
    policyValidation.summary?.passed === true,
    "AvailableAt policy validation has not passed."
  );

  requireCondition(
    pointInTimeValidation.summary?.passed === true,
    "Point-in-time validation has not passed."
  );

  requireCondition(
    decision.schemaVersion === "1.0",
    "Unexpected human decision schema version."
  );

  requireCondition(
    decision.decisionType ===
      "ALFRED_BRENT_AVAILABLE_AT_METHODOLOGY",
    "Unexpected methodology decision type."
  );

  requireCondition(
    decision.decisionRecorded === true,
    "Human methodology decision has not been explicitly recorded."
  );

  requireCondition(
    decision.approved === true ||
      decision.approved === false,
    "Human methodology decision must explicitly approve or reject."
  );

  requireCondition(
    typeof decision.decidedBy === "string" &&
      decision.decidedBy.trim().length > 0,
    "Human decision must identify the decision maker."
  );

  requireCondition(
    typeof decision.decidedAt === "string" &&
      Number.isFinite(Date.parse(decision.decidedAt)),
    "Human decision must contain a valid decidedAt timestamp."
  );

  requireCondition(
    typeof decision.rationale === "string" &&
      decision.rationale.trim().length > 0,
    "Human decision must contain an explicit rationale."
  );

  requireCondition(
    decision.acknowledgements
      ?.dateLevelEvidenceOnly === true,
    "Human decision must acknowledge date-level evidence only."
  );

  requireCondition(
    decision.acknowledgements
      ?.exactIntradayTimeNotEstablished === true,
    "Human decision must acknowledge that exact intraday timing is not established."
  );

  requireCondition(
    decision.acknowledgements
      ?.endOfDayUtcIsResearchConvention === true,
    "Human decision must acknowledge the end-of-day UTC research convention."
  );

  requireCondition(
    decision.acknowledgements
      ?.longLagsRetainedWithoutBackwardShift === true,
    "Human decision must acknowledge retention of long lags."
  );

  requireCondition(
    decision.acknowledgements
      ?.negativeLagAnomalyExcluded === true,
    "Human decision must acknowledge exclusion of the negative-lag anomaly."
  );

  /*
   * Critical separation:
   *
   * Methodological approval is NOT admission authorization.
   * This validator refuses any human-decision artifact that
   * attempts to authorize admission at the same time.
   */
  requireCondition(
    decision.admissionAuthorized === false,
    "Methodology decision must not authorize historical admission."
  );

  requireCondition(
    decision.historicalStoreModified === false,
    "Methodology decision must not modify the historical store."
  );

  requireCondition(
    decision.calibrationDatasetModified === false,
    "Methodology decision must not modify the calibration dataset."
  );

  requireCondition(
    decision.officialHesiModified === false,
    "Methodology decision must not modify official HESI."
  );

  console.log(
    "ALFRED human methodology decision validation"
  );

  console.log(
    "-------------------------------------------"
  );

  console.log(
    `Decision recorded: YES`
  );

  console.log(
    `Methodology approved: ${
      decision.approved ? "YES" : "NO"
    }`
  );

  console.log(
    `Decision maker: ${decision.decidedBy}`
  );

  console.log(
    `Decision timestamp: ${decision.decidedAt}`
  );

  console.log(
    "Date-level evidence acknowledged: YES"
  );

  console.log(
    "Exact intraday timing not established: ACKNOWLEDGED"
  );

  console.log(
    "End-of-day UTC research convention: ACKNOWLEDGED"
  );

  console.log(
    "Long lags retained without backward shift: ACKNOWLEDGED"
  );

  console.log(
    "Negative-lag anomaly excluded: ACKNOWLEDGED"
  );

  console.log(
    "Admission authorized: NO"
  );

  console.log(
    "Historical store modified: NO"
  );

  console.log(
    "Calibration dataset modified: NO"
  );

  console.log(
    "Official HESI modified: NO"
  );

  console.log(
    "Human methodology decision validation: PASS"
  );
}

main().catch((error) => {
  console.error(
    "ALFRED human methodology decision validation failed:"
  );

  console.error(error);

  process.exit(1);
});
