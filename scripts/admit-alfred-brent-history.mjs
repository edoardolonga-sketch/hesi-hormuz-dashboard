import { readFile, writeFile } from "node:fs/promises";

const STAGING_FILE = new URL(
  "../data/brent-alfred-admission-ready.json",
  import.meta.url
);

const DECISION_FILE = new URL(
  "../data/brent-alfred-human-admission-decision.json",
  import.meta.url
);

const OVERLAP_FILE = new URL(
  "../data/brent-alfred-admission-overlap.json",
  import.meta.url
);

const HISTORICAL_FILE = new URL(
  "../data/historical-observations.json",
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

function observationKey(observation) {
  return (
    `${observation.sourceId}|` +
    `${observation.seriesId}|` +
    `${observation.observationDate}`
  );
}

function validTimestamp(value) {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value))
  );
}

async function main() {
  const staging = await readJson(
    STAGING_FILE,
    "brent-alfred-admission-ready.json"
  );

  const decision = await readJson(
    DECISION_FILE,
    "brent-alfred-human-admission-decision.json"
  );

  const overlap = await readJson(
    OVERLAP_FILE,
    "brent-alfred-admission-overlap.json"
  );

  const historical = await readJson(
    HISTORICAL_FILE,
    "historical-observations.json"
  );

  /*
   * HUMAN AUTHORIZATION
   */

  requireCondition(
    decision.schemaVersion === "1.0",
    "Unexpected human admission decision schema."
  );

  requireCondition(
    decision.decisionType ===
      "ALFRED_BRENT_HISTORICAL_ADMISSION",
    "Unexpected human admission decision type."
  );

  requireCondition(
    decision.decisionRecorded === true,
    "Human admission decision has not been recorded."
  );

  requireCondition(
    decision.approved === true,
    "Human historical admission has not been approved."
  );

  requireCondition(
    decision.admissionAuthorized === true,
    "Historical admission has not been explicitly authorized."
  );

  requireCondition(
    decision.methodologyPrerequisite
      ?.methodologyDecisionRecorded === true &&
      decision.methodologyPrerequisite
        ?.methodologyApproved === true,
    "Approved methodology prerequisite is missing."
  );

  requireCondition(
    decision.historicalStoreModified === false,
    "Decision artifact must not claim that it modified the historical store."
  );

  requireCondition(
    decision.calibrationDatasetModified === false,
    "Admission decision must not authorize calibration modification."
  );

  requireCondition(
    decision.officialHesiModified === false,
    "Admission decision must not authorize official HESI modification."
  );

  /*
   * STAGING
   */

  requireCondition(
    staging.status ===
      "METHODOLOGY_APPROVED_PREPARED_NOT_ADMITTED",
    "ALFRED staging is not in the expected state."
  );

  requireCondition(
    staging.methodologyState?.decisionRecorded === true &&
      staging.methodologyState
        ?.humanMethodologicalApproval === true,
    "ALFRED staging does not contain approved methodology."
  );

  requireCondition(
    staging.methodologyState?.admissionAuthorized === false,
    "Staging artifact must remain non-authorizing."
  );

  requireCondition(
    Array.isArray(staging.preparedCandidates),
    "Prepared ALFRED candidates array is missing."
  );

  requireCondition(
    staging.preparedCandidates.length === 3939,
    "Expected exactly 3939 prepared ALFRED candidates."
  );

  /*
   * OVERLAP ANALYSIS
   */

  requireCondition(
    overlap.status === "ANALYZED_NOT_ADMITTED",
    "ALFRED overlap analysis is not in the expected state."
  );

  requireCondition(
    overlap.summary?.preparedCandidates === 3939,
    "Overlap report does not contain 3939 prepared candidates."
  );

  requireCondition(
    overlap.summary?.overlappingKeys === 2,
    "Expected exactly 2 existing ALFRED overlap keys."
  );

  requireCondition(
    overlap.summary?.exactOverlaps === 0,
    "Unexpected exact-overlap count."
  );

  requireCondition(
    overlap.summary?.valueMatchesAvailableAtDiffers === 2,
    "Expected exactly 2 same-value/different-AvailableAt overlaps."
  );

  requireCondition(
    overlap.summary?.valueConflicts === 0,
    "Value conflicts exist. Admission aborted."
  );

  requireCondition(
    overlap.summary?.nonOverlappingCandidates === 3937,
    "Expected exactly 3937 non-overlapping candidates."
  );

  requireCondition(
    overlap.overlapPolicy?.automaticOverwriteAllowed === false &&
      overlap.overlapPolicy
        ?.automaticReplacementAllowed === false,
    "Overlap report does not prohibit overwrite/replacement."
  );

  requireCondition(
    overlap.safeguards?.historicalStoreModified === false &&
      overlap.safeguards
        ?.calibrationDatasetModified === false &&
      overlap.safeguards?.officialHesiModified === false,
    "Overlap analysis safeguards are not intact."
  );

  /*
   * EXISTING HISTORICAL STORE
   */

  requireCondition(
    Array.isArray(historical.observations),
    "Historical observations array is missing."
  );

  const existingByKey = new Map();

  for (const observation of historical.observations) {
    const key = observationKey(observation);

    requireCondition(
      !existingByKey.has(key),
      `Historical store contains duplicate key: ${key}`
    );

    existingByKey.set(key, observation);
  }

  /*
   * PREPARE ADMISSION
   */

  const candidateKeys = new Set();
  const admitted = [];
  const preservedOverlaps = [];

  for (const candidate of staging.preparedCandidates) {
    requireCondition(
      candidate.sourceId === "brent_market",
      "Unexpected ALFRED candidate sourceId."
    );

    requireCondition(
      candidate.seriesId === "DCOILBRENTEU",
      "Unexpected ALFRED candidate seriesId."
    );

    requireCondition(
      candidate.preparationStatus ===
        "READY_FOR_EXPLICIT_ADMISSION_DECISION",
      "Candidate is not ready for explicit admission."
    );

    requireCondition(
      typeof candidate.value === "number" &&
        Number.isFinite(candidate.value),
      "Candidate contains invalid value."
    );

    requireCondition(
      typeof candidate.observationDate === "string" &&
        Number.isFinite(Date.parse(candidate.observationDate)),
      "Candidate contains invalid observationDate."
    );

    requireCondition(
      validTimestamp(candidate.availableAt),
      "Candidate contains invalid AvailableAt."
    );

    requireCondition(
      Date.parse(candidate.availableAt) >=
        Date.parse(candidate.observationDate),
      `AvailableAt precedes observationDate: ${candidate.observationDate}`
    );

    const key = observationKey(candidate);

    requireCondition(
      !candidateKeys.has(key),
      `Duplicate prepared candidate key: ${key}`
    );

    candidateKeys.add(key);

    const existing = existingByKey.get(key);

    if (existing) {
      requireCondition(
        existing.value === candidate.value,
        `Existing historical value conflicts with ALFRED candidate: ${key}`
      );

      preservedOverlaps.push({
        key,
        existingValue: existing.value,
        candidateValue: candidate.value,
        existingAvailableAt: existing.availableAt,
        candidateAvailableAt: candidate.availableAt
      });

      continue;
    }

    admitted.push({
      sourceId: candidate.sourceId,
      seriesId: candidate.seriesId,
      observationDate: candidate.observationDate,
      availableAt: candidate.availableAt,
      value: candidate.value,
      unit: candidate.unit ?? "usd_per_barrel",
      frequency: candidate.frequency ?? "daily",
      availableAtEvidence:
        candidate.availableAtEvidence ?? null,
      availableAtMethod:
        candidate.availableAtMethod ?? null
    });
  }

  /*
   * FINAL PRE-WRITE ASSERTIONS
   */

  requireCondition(
    preservedOverlaps.length === 2,
    "Expected exactly 2 preserved existing overlaps."
  );

  requireCondition(
    admitted.length === 3937,
    "Expected exactly 3937 new ALFRED observations for admission."
  );

  const finalObservations = [
    ...historical.observations,
    ...admitted
  ];

  const finalKeys = new Set();

  for (const observation of finalObservations) {
    const key = observationKey(observation);

    requireCondition(
      !finalKeys.has(key),
      `Final historical store would contain duplicate key: ${key}`
    );

    finalKeys.add(key);
  }

  requireCondition(
    finalObservations.length ===
      historical.observations.length + 3937,
    "Unexpected final historical observation count."
  );

  /*
   * DETERMINISTIC OUTPUT
   */

  finalObservations.sort((a, b) => {
    const dateComparison =
      a.observationDate.localeCompare(
        b.observationDate
      );

    if (dateComparison !== 0) {
      return dateComparison;
    }

    return a.availableAt.localeCompare(
      b.availableAt
    );
  });

  /*
   * WRITE HISTORICAL STORE ONLY
   */

  const output = {
    ...historical,

    status:
      "HISTORICAL_STORE_WITH_APPROVED_ALFRED_BRENT",

    observations: finalObservations,

    alfredBrentAdmission: {
      decisionRecorded: true,
      admissionAuthorized: true,
      preparedCandidates: 3939,
      newlyAdmitted: 3937,
      preservedExistingOverlaps: 2,
      valueConflicts: 0,
      overlapPolicy:
        "Existing observations are preserved. No overwrite or replacement is allowed.",
      calibrationAuthorized: false,
      officialHesiAuthorized: false
    }
  };

  await writeFile(
    HISTORICAL_FILE,
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8"
  );

  console.log(
    "ALFRED Brent historical admission"
  );

  console.log(
    "--------------------------------"
  );

  console.log(
    `Prepared candidates: ${staging.preparedCandidates.length}`
  );

  console.log(
    `New observations admitted: ${admitted.length}`
  );

  console.log(
    `Existing overlaps preserved: ${preservedOverlaps.length}`
  );

  console.log(
    "Existing observations overwritten: 0"
  );

  console.log(
    "Value conflicts: 0"
  );

  console.log(
    `Historical store observations: ${finalObservations.length}`
  );

  console.log(
    "Calibration authorized: NO"
  );

  console.log(
    "Official HESI modified: NO"
  );
}

main().catch((error) => {
  console.error(
    "ALFRED Brent historical admission failed:"
  );

  console.error(error);

  process.exit(1);
});
