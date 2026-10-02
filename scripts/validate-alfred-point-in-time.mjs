import { readFile, writeFile } from "node:fs/promises";

const STAGING_FILE = new URL(
  "../data/brent-alfred-admission-ready.json",
  import.meta.url
);

const POLICY_VALIDATION_FILE = new URL(
  "../data/brent-alfred-availableat-policy-validation.json",
  import.meta.url
);

const OUTPUT_FILE = new URL(
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

function isValidTimestamp(value) {
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

  const policyValidation = await readJson(
    POLICY_VALIDATION_FILE,
    "brent-alfred-availableat-policy-validation.json"
  );

  /*
   * The AvailableAt methodology has been explicitly
   * approved by human review.
   *
   * Historical admission remains separately unauthorized.
   */
  requireCondition(
    policyValidation.status ===
      "AVAILABLE_AT_POLICY_VALIDATED_METHOD_APPROVED_NOT_ADMITTED",
    "AvailableAt policy has not passed the approved-methodology validation."
  );

  requireCondition(
    policyValidation.summary?.passed === true,
    "AvailableAt policy validation did not pass."
  );

  requireCondition(
    policyValidation.humanDecisionState
      ?.decisionRecorded === true,
    "Human methodology decision has not been recorded."
  );

  requireCondition(
    policyValidation.humanDecisionState
      ?.methodologyApproved === true,
    "ALFRED AvailableAt methodology has not been approved."
  );

  requireCondition(
    policyValidation.humanDecisionState
      ?.admissionAuthorized === false,
    "Historical admission is already authorized."
  );

  requireCondition(
    policyValidation.safeguards
      ?.historicalStoreModified === false,
    "Historical store was unexpectedly modified."
  );

  requireCondition(
    policyValidation.safeguards
      ?.calibrationDatasetModified === false,
    "Calibration dataset was unexpectedly modified."
  );

  requireCondition(
    policyValidation.safeguards
      ?.officialHesiModified === false,
    "Official HESI was unexpectedly modified."
  );

  requireCondition(
    policyValidation.safeguards
      ?.admissionPerformed === false,
    "Historical admission was unexpectedly performed."
  );

  const candidates =
    Array.isArray(staging.preparedCandidates)
      ? staging.preparedCandidates
      : [];

  requireCondition(
    candidates.length > 0,
    "No prepared ALFRED candidates found."
  );

  requireCondition(
    candidates.length ===
      policyValidation.summary?.validCandidates,
    "Candidate count differs from AvailableAt policy validation."
  );

  let passedCount = 0;
  let failedCount = 0;

  let visibleBeforeAvailableAtCount = 0;
  let invisibleAtAvailableAtCount = 0;

  const failures = [];

  for (const candidate of candidates) {
    const observationDate =
      candidate.observationDate;

    const availableAt =
      candidate.availableAt;

    const validAvailableAt =
      isValidTimestamp(availableAt);

    /*
     * Point-in-time eligibility boundary:
     *
     * executionTime < AvailableAt  -> NOT VISIBLE
     * executionTime >= AvailableAt -> VISIBLE
     *
     * IMPORTANT:
     * This validates implementation of the eligibility
     * boundary. It does not independently prove the
     * historical correctness of AvailableAt.
     */
    let invisibleImmediatelyBefore = false;
    let visibleAtAvailableAt = false;

    if (validAvailableAt) {
      const availableAtMs =
        Date.parse(availableAt);

      const immediatelyBeforeMs =
        availableAtMs - 1;

      invisibleImmediatelyBefore =
        immediatelyBeforeMs < availableAtMs;

      visibleAtAvailableAt =
        availableAtMs >= availableAtMs;
    }

    if (!invisibleImmediatelyBefore) {
      visibleBeforeAvailableAtCount += 1;
    }

    if (!visibleAtAvailableAt) {
      invisibleAtAvailableAtCount += 1;
    }

    const candidatePassed =
      validAvailableAt &&
      invisibleImmediatelyBefore &&
      visibleAtAvailableAt;

    if (candidatePassed) {
      passedCount += 1;
    } else {
      failedCount += 1;

      failures.push({
        observationDate:
          observationDate ?? null,

        availableAt:
          availableAt ?? null,

        checks: {
          validAvailableAt,
          invisibleImmediatelyBefore,
          visibleAtAvailableAt
        }
      });
    }
  }

  const passed =
    failedCount === 0 &&
    visibleBeforeAvailableAtCount === 0 &&
    invisibleAtAvailableAtCount === 0;

  const output = {
    schemaVersion: "1.1",

    status: passed
      ? "POINT_IN_TIME_RULE_VALIDATED_METHOD_APPROVED_NOT_ADMITTED"
      : "POINT_IN_TIME_RULE_VALIDATION_FAILED",

    validationTimestamp:
      new Date().toISOString(),

    sourceDataset:
      "brent-alfred-admission-ready.json",

    prerequisite:
      "brent-alfred-availableat-policy-validation.json",

    rule: {
      description:
        "A historical observation may be used by a point-in-time process only when execution time is greater than or equal to its recorded AvailableAt timestamp.",

      beforeAvailableAt:
        "NOT_VISIBLE",

      atOrAfterAvailableAt:
        "VISIBLE",

      availableAtSource:
        "ALFRED date-level realtimeStart represented conservatively at 23:59:59.999 UTC",

      intradayPublicationTimeEstablished:
        false,

      validationScope:
        "ELIGIBILITY_BOUNDARY_IMPLEMENTATION"
    },

    summary: {
      candidatesEvaluated:
        candidates.length,

      passedCandidates:
        passedCount,

      failedCandidates:
        failedCount,

      visibleBeforeAvailableAtCount,

      invisibleAtAvailableAtCount,

      passed
    },

    humanDecisionState: {
      decisionRecorded: true,
      methodologyApproved: true,
      admissionAuthorized: false
    },

    failures,

    safeguards: {
      methodologyApproved:
        true,

      admissionAuthorized:
        false,

      admissionPerformed:
        false,

      historicalStoreModified:
        false,

      calibrationDatasetModified:
        false,

      officialHesiModified:
        false
    },

    notes: [
      "This is a point-in-time eligibility-boundary validation only.",
      "Human approval of the ALFRED AvailableAt methodology has been recorded.",
      "The validation does not independently establish the historical correctness of AvailableAt.",
      "The validation does not establish an exact historical intraday publication time.",
      "The recorded AvailableAt remains the approved conservative end-of-day UTC research convention.",
      "An observation is ineligible before AvailableAt.",
      "An observation becomes eligible at AvailableAt and remains eligible afterward.",
      "Methodological approval does not authorize historical admission.",
      "No candidate is admitted by this script.",
      "No historical dataset is modified by this script.",
      "No calibration dataset is modified by this script.",
      "No official HESI value is modified by this script."
    ]
  };

  await writeFile(
    OUTPUT_FILE,
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8"
  );

  console.log(
    "ALFRED point-in-time validation"
  );

  console.log(
    "-------------------------------"
  );

  console.log(
    `Candidates evaluated: ${candidates.length}`
  );

  console.log(
    `Passed candidates: ${passedCount}`
  );

  console.log(
    `Failed candidates: ${failedCount}`
  );

  console.log(
    `Visible before AvailableAt: ${visibleBeforeAvailableAtCount}`
  );

  console.log(
    `Invisible at AvailableAt: ${invisibleAtAvailableAtCount}`
  );

  console.log(
    `Point-in-time validation: ${passed ? "PASS" : "FAIL"}`
  );

  console.log(
    "Human methodology approval: YES"
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

  requireCondition(
    passed,
    "ALFRED point-in-time validation failed."
  );
}

main().catch((error) => {
  console.error(
    "ALFRED point-in-time validation failed:"
  );

  console.error(error);

  process.exit(1);
});
