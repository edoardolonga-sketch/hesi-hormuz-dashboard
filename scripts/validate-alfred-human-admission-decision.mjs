import { readFile } from "node:fs/promises";

const ADMISSION_DECISION_FILE = new URL(
  "../data/brent-alfred-human-admission-decision.json",
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
    ADMISSION_DECISION_FILE,
    "brent-alfred-human-admission-decision.json"
  );

  requireCondition(
    decision.schemaVersion === "1.0",
    "Unexpected human admission decision schema version."
  );

  requireCondition(
    decision.decisionType ===
      "ALFRED_BRENT_HISTORICAL_ADMISSION",
    "Unexpected human admission decision type."
  );

  requireCondition(
    typeof decision.decisionRecorded === "boolean",
    "decisionRecorded must be boolean."
  );

  requireCondition(
    typeof decision.approved === "boolean",
    "approved must be boolean."
  );

  requireCondition(
    decision.methodologyPrerequisite
      ?.methodologyDecisionRecorded === true,
    "Methodology decision prerequisite has not been recorded."
  );

  requireCondition(
    decision.methodologyPrerequisite
      ?.methodologyApproved === true,
    "Methodology prerequisite has not been approved."
  );

  requireCondition(
    decision.acknowledgements
      ?.preparedCandidates === 3939,
    "Unexpected number of prepared ALFRED candidates."
  );

  requireCondition(
    decision.acknowledgements
      ?.negativeLagAnomalyExcluded === true,
    "Negative-lag anomaly exclusion has not been acknowledged."
  );

  requireCondition(
    decision.acknowledgements
      ?.availableAtUsesApprovedConservativeConvention === true,
    "Approved conservative AvailableAt convention has not been acknowledged."
  );

  requireCondition(
    decision.acknowledgements
      ?.longLagsRetainedWithoutBackwardShift === true,
    "Long-lag preservation has not been acknowledged."
  );

  requireCondition(
    decision.acknowledgements
      ?.admissionDoesNotImplyCalibrationApproval === true,
    "Separation between admission and calibration approval has not been acknowledged."
  );

  requireCondition(
    decision.acknowledgements
      ?.admissionDoesNotModifyOfficialHesi === true,
    "Separation between admission and official HESI has not been acknowledged."
  );

  requireCondition(
    typeof decision.admissionAuthorized === "boolean",
    "admissionAuthorized must be boolean."
  );

  requireCondition(
    decision.historicalStoreModified === false,
    "Human admission decision artifact must not itself modify the historical store."
  );

  requireCondition(
    decision.calibrationDatasetModified === false,
    "Human admission decision artifact must not modify the calibration dataset."
  );

  requireCondition(
    decision.officialHesiModified === false,
    "Human admission decision artifact must not modify official HESI."
  );

  if (decision.decisionRecorded === false) {
    requireCondition(
      decision.approved === false,
      "An unrecorded admission decision cannot be approved."
    );

    requireCondition(
      decision.admissionAuthorized === false,
      "An unrecorded admission decision cannot authorize admission."
    );

    requireCondition(
      decision.decidedBy === null,
      "An unrecorded admission decision must not contain decidedBy."
    );

    requireCondition(
      decision.decidedAt === null,
      "An unrecorded admission decision must not contain decidedAt."
    );

    requireCondition(
      decision.rationale === null,
      "An unrecorded admission decision must not contain a rationale."
    );
  }

  if (decision.decisionRecorded === true) {
    requireCondition(
      typeof decision.decidedBy === "string" &&
        decision.decidedBy.trim().length > 0,
      "A recorded admission decision requires decidedBy."
    );

    requireCondition(
      typeof decision.decidedAt === "string" &&
        !Number.isNaN(Date.parse(decision.decidedAt)),
      "A recorded admission decision requires a valid decidedAt."
    );

    requireCondition(
      typeof decision.rationale === "string" &&
        decision.rationale.trim().length > 0,
      "A recorded admission decision requires a rationale."
    );

    if (decision.approved === true) {
      requireCondition(
        decision.admissionAuthorized === true,
        "An approved admission decision must explicitly authorize admission."
      );
    }

    if (decision.approved === false) {
      requireCondition(
        decision.admissionAuthorized === false,
        "A rejected admission decision cannot authorize admission."
      );
    }
  }

  let status = "ADMISSION_DECISION_PENDING";

  if (
    decision.decisionRecorded === true &&
    decision.approved === true
  ) {
    status = "ADMISSION_APPROVED";
  } else if (
    decision.decisionRecorded === true &&
    decision.approved === false
  ) {
    status = "ADMISSION_REJECTED";
  }

  console.log(
    "ALFRED human admission decision validation"
  );

  console.log(
    "-----------------------------------------"
  );

  console.log(
    `Status: ${status}`
  );

  console.log(
    `Decision recorded: ${
      decision.decisionRecorded ? "YES" : "NO"
    }`
  );

  console.log(
    `Admission approved: ${
      decision.approved ? "YES" : "NO"
    }`
  );

  console.log(
    `Admission authorized: ${
      decision.admissionAuthorized ? "YES" : "NO"
    }`
  );

  console.log(
    "Historical store modified by decision artifact: NO"
  );

  console.log(
    "Calibration dataset modified: NO"
  );

  console.log(
    "Official HESI modified: NO"
  );

  console.log(
    "Human admission decision validation: PASS"
  );
}

main().catch((error) => {
  console.error(
    "ALFRED human admission decision validation failed:"
  );

  console.error(error);

  process.exit(1);
});
