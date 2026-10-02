import { readFile, writeFile } from "node:fs/promises";

const STAGING_FILE = new URL(
  "../data/brent-alfred-admission-ready.json",
  import.meta.url
);

const DECISION_FILE = new URL(
  "../data/brent-alfred-human-admission-decision.json",
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
    Array.isArray(staging.preparedCandidates),
    "Prepared ALFRED candidates array is missing."
  );

  requireCondition(
    staging.preparedCandidates.length > 0,
    "No prepared ALFRED candidates are available."
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
   * PROCESS CANDIDATES
   *
   * Idempotent policy:
   *
   * - missing key + valid candidate -> admit
   * - existing key + same value -> preserve existing
   * - existing key + different value -> abort
   *
   * Existing AvailableAt is never replaced.
   */

  const candidateKeys = new Set();

  const admitted = [];
  const preservedExisting = [];

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
        Number.isFinite(
          Date.parse(
            `${candidate.observationDate}T00:00:00.000Z`
          )
        ),
      "Candidate contains invalid observationDate."
    );

    requireCondition(
      validTimestamp(candidate.availableAt),
      "Candidate contains invalid AvailableAt."
    );

    const observationDateMs = Date.parse(
      `${candidate.observationDate}T00:00:00.000Z`
    );

    const availableAtMs = Date.parse(
      candidate.availableAt
    );

    requireCondition(
      availableAtMs >= observationDateMs,
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

      preservedExisting.push({
        key,
        existingValue: existing.value,
        candidateValue: candidate.value,
        existingAvailableAt:
          existing.availableAt,
        candidateAvailableAt:
          candidate.availableAt
      });

      continue;
    }

    const admittedObservation = {
      sourceId: candidate.sourceId,
      seriesId: candidate.seriesId,
      observationDate:
        candidate.observationDate,
      availableAt:
        candidate.availableAt,
      value: candidate.value,
      unit:
        candidate.unit ??
        "usd_per_barrel",
      frequency:
        candidate.frequency ??
        "daily",
      availableAtEvidence:
        candidate.availableAtEvidence ??
        null,
      availableAtMethod:
        candidate.availableAtMethod ??
        null
    };

    admitted.push(
      admittedObservation
    );

    existingByKey.set(
      key,
      admittedObservation
    );
  }

  /*
   * FINAL STORE
   */

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
      historical.observations.length +
        admitted.length,
    "Unexpected final historical observation count."
  );

  /*
   * VERIFY EVERY PREPARED CANDIDATE
   * EXISTS AFTER ADMISSION
   */

  const finalByKey = new Map(
    finalObservations.map(
      (observation) => [
        observationKey(observation),
        observation
      ]
    )
  );

  for (const candidate of staging.preparedCandidates) {
    const key =
      observationKey(candidate);

    const finalObservation =
      finalByKey.get(key);

    requireCondition(
      finalObservation,
      `Prepared candidate missing from final historical store: ${key}`
    );

    requireCondition(
      finalObservation.value ===
        candidate.value,
      `Final historical value conflicts with ALFRED candidate: ${key}`
    );
  }

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

    observations:
      finalObservations,

    alfredBrentAdmission: {
      decisionRecorded: true,
      admissionAuthorized: true,

      preparedCandidates:
        staging.preparedCandidates.length,

      newlyAdmittedThisRun:
        admitted.length,

      existingCandidatesPreservedThisRun:
        preservedExisting.length,

      allPreparedCandidatesPresent:
        true,

      valueConflicts: 0,

      existingObservationsOverwritten:
        0,

      overlapPolicy:
        "Existing observations are preserved when their value matches the approved ALFRED candidate. No overwrite or replacement of existing observations or AvailableAt timestamps is allowed.",

      idempotent:
        true,

      calibrationAuthorized:
        false,

      officialHesiAuthorized:
        false
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
    `New observations admitted this run: ${admitted.length}`
  );

  console.log(
    `Existing candidate observations preserved: ${preservedExisting.length}`
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
    "All prepared candidates present: YES"
  );

  console.log(
    "Idempotent admission: YES"
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
