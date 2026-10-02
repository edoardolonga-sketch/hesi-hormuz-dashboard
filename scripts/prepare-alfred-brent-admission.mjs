import { readFile, writeFile } from "node:fs/promises";

const REVIEW_FILE = new URL(
  "../data/brent-alfred-methodology-review.json",
  import.meta.url
);

const HUMAN_DECISION_FILE = new URL(
  "../data/brent-alfred-human-methodology-decision.json",
  import.meta.url
);

const OUTPUT_FILE = new URL(
  "../data/brent-alfred-admission-ready.json",
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

function validTimestamp(value) {
  return (
    typeof value === "string" &&
    Number.isFinite(new Date(value).getTime())
  );
}

function key(observation) {
  return (
    `${observation.sourceId}|` +
    `${observation.seriesId}|` +
    `${observation.observationDate}`
  );
}

async function main() {
  const preparationTimestamp =
    new Date().toISOString();

  const review = await readJson(
    REVIEW_FILE,
    "brent-alfred-methodology-review.json"
  );

  const humanDecision = await readJson(
    HUMAN_DECISION_FILE,
    "brent-alfred-human-methodology-decision.json"
  );

  requireCondition(
    Array.isArray(review.reviewedCandidates),
    "reviewedCandidates array is missing."
  );

  /*
   * Methodology has now been explicitly approved
   * by human review.
   *
   * This script still performs PREPARATION ONLY.
   * Methodological approval must never be interpreted
   * as authorization for historical admission.
   */
  requireCondition(
    humanDecision.schemaVersion === "1.0",
    "Unexpected human decision schema version."
  );

  requireCondition(
    humanDecision.decisionType ===
      "ALFRED_BRENT_AVAILABLE_AT_METHODOLOGY",
    "Unexpected human methodology decision type."
  );

  requireCondition(
    humanDecision.decisionRecorded === true,
    "Human methodology decision has not been recorded."
  );

  requireCondition(
    humanDecision.approved === true,
    "ALFRED AvailableAt methodology has not been approved."
  );

  requireCondition(
    humanDecision.acknowledgements
      ?.dateLevelEvidenceOnly === true,
    "Date-level evidence acknowledgement is missing."
  );

  requireCondition(
    humanDecision.acknowledgements
      ?.exactIntradayTimeNotEstablished === true,
    "Intraday timing acknowledgement is missing."
  );

  requireCondition(
    humanDecision.acknowledgements
      ?.endOfDayUtcIsResearchConvention === true,
    "End-of-day UTC convention acknowledgement is missing."
  );

  requireCondition(
    humanDecision.acknowledgements
      ?.longLagsRetainedWithoutBackwardShift === true,
    "Long-lag acknowledgement is missing."
  );

  requireCondition(
    humanDecision.acknowledgements
      ?.negativeLagAnomalyExcluded === true,
    "Negative-lag anomaly acknowledgement is missing."
  );

  /*
   * Critical safety gate:
   *
   * Methodology approval is YES.
   * Historical admission authorization remains NO.
   */
  requireCondition(
    humanDecision.admissionAuthorized === false,
    "Historical admission is already authorized."
  );

  requireCondition(
    humanDecision.historicalStoreModified === false,
    "Historical store was unexpectedly modified."
  );

  requireCondition(
    humanDecision.calibrationDatasetModified === false,
    "Calibration dataset was unexpectedly modified."
  );

  requireCondition(
    humanDecision.officialHesiModified === false,
    "Official HESI was unexpectedly modified."
  );

  const seen = new Set();
  const ready = [];

  for (const candidate of review.reviewedCandidates) {
    requireCondition(
      candidate.passesMethodChecks === true,
      "Reviewed candidate does not pass method checks."
    );

    requireCondition(
      candidate.admissionStatus ===
        "METHOD_CHECKS_PASSED_NOT_ADMITTED",
      "Unexpected candidate admission status."
    );

    requireCondition(
      candidate.sourceId &&
        candidate.seriesId &&
        candidate.observationDate &&
        validTimestamp(candidate.availableAt) &&
        typeof candidate.value === "number" &&
        Number.isFinite(candidate.value),
      "Invalid reviewed candidate."
    );

    const observationKey = key(candidate);

    requireCondition(
      !seen.has(observationKey),
      `Duplicate reviewed candidate: ${observationKey}`
    );

    seen.add(observationKey);

    ready.push({
      sourceId:
        candidate.sourceId,

      seriesId:
        candidate.seriesId,

      observationDate:
        candidate.observationDate,

      availableAt:
        candidate.availableAt,

      value:
        candidate.value,

      unit:
        candidate.unit,

      frequency:
        candidate.frequency,

      availableAtEvidence:
        candidate.availableAtEvidence,

      availableAtMethod:
        candidate.availableAtMethod,

      preparationStatus:
        "READY_FOR_EXPLICIT_ADMISSION_DECISION"
    });
  }

  ready.sort(
    (a, b) =>
      new Date(a.observationDate).getTime() -
      new Date(b.observationDate).getTime()
  );

  const output = {
    schemaVersion: "1.1",

    status:
      "METHODOLOGY_APPROVED_PREPARED_NOT_ADMITTED",

    preparationTimestamp,

    sourceDataset:
      "brent-alfred-methodology-review.json",

    sourceHumanDecision:
      "brent-alfred-human-methodology-decision.json",

    summary: {
      reviewedCandidates:
        review.reviewedCandidates.length,

      preparedCandidates:
        ready.length,

      admittedObservations:
        0
    },

    methodologyState: {
      decisionRecorded:
        true,

      humanMethodologicalApproval:
        true,

      admissionAuthorized:
        false
    },

    preparedCandidates:
      ready,

    promotion: {
      automaticAdmission:
        false,

      historicalStoreUpdated:
        false,

      calibrationDatasetUpdated:
        false,

      officialHesiUpdated:
        false
    },

    notes: [
      "This file is an admission-ready staging artifact only.",
      "The ALFRED AvailableAt methodology has been explicitly approved by human review.",
      "Prepared candidates passed the automated structural and methodology-consistency checks.",
      "Methodological approval does not authorize historical admission.",
      "A separate explicit admission decision is required before any prepared candidate can enter historical-observations.json.",
      "No observation is written to historical-observations.json by this script.",
      "The excluded negative-lag ALFRED anomaly is not present in this staging artifact.",
      "No AvailableAt timestamp is moved backward.",
      "Calibration and official HESI remain unchanged."
    ]
  };

  await writeFile(
    OUTPUT_FILE,
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8"
  );

  console.log(
    "Prepare ALFRED Brent admission staging"
  );

  console.log(
    "-------------------------------------"
  );

  console.log(
    `Reviewed candidates: ${review.reviewedCandidates.length}`
  );

  console.log(
    `Prepared candidates: ${ready.length}`
  );

  console.log(
    "Human methodology decision recorded: YES"
  );

  console.log(
    "Methodology approved: YES"
  );

  console.log(
    "Admitted observations: 0"
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
}

main().catch((error) => {
  console.error(
    "ALFRED admission preparation failed:"
  );

  console.error(error);

  process.exit(1);
});
