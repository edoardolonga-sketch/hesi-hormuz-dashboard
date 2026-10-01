import { readFile, writeFile } from "node:fs/promises";

const QUARANTINE_FILE = new URL(
  "../data/brent-historical-quarantine.json",
  import.meta.url
);

const ALFRED_CANDIDATES_FILE = new URL(
  "../data/brent-alfred-candidates.json",
  import.meta.url
);

const OUTPUT_FILE = new URL(
  "../data/historical-admission-report.json",
  import.meta.url
);

async function readJson(file, label) {
  const raw = await readFile(file, "utf8");

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      `Invalid JSON in ${label}`
    );
  }
}

function validTimestamp(value) {
  if (!value) {
    return false;
  }

  return Number.isFinite(
    new Date(value).getTime()
  );
}

function evaluateObservation(
  observation,
  dataset
) {
  const reasons = [];

  if (!observation.sourceId) {
    reasons.push(
      "MISSING_SOURCE_ID"
    );
  }

  if (!observation.seriesId) {
    reasons.push(
      "MISSING_SERIES_ID"
    );
  }

  if (!observation.observationDate) {
    reasons.push(
      "MISSING_OBSERVATION_DATE"
    );
  }

  if (
    typeof observation.value !== "number" ||
    !Number.isFinite(observation.value)
  ) {
    reasons.push(
      "INVALID_VALUE"
    );
  }

  if (!observation.availableAt) {
    reasons.push(
      "AVAILABLE_AT_NOT_VERIFIED"
    );
  } else if (
    !validTimestamp(
      observation.availableAt
    )
  ) {
    reasons.push(
      "INVALID_AVAILABLE_AT"
    );
  }

  if (
    !observation.availableAtEvidence
  ) {
    reasons.push(
      "AVAILABLE_AT_EVIDENCE_MISSING"
    );
  }

  if (
    !observation.availableAtMethod
  ) {
    reasons.push(
      "AVAILABLE_AT_METHOD_MISSING"
    );
  }

  /*
   * ALFRED candidates require an additional
   * methodological check.
   *
   * Structural validity does NOT mean that
   * the observation is automatically approved
   * for the leakage-safe historical store.
   */

  const structuralPass =
    reasons.length === 0;

  const methodReviewRequired =
    dataset === "alfred_candidates";

  return {
    dataset,

    sourceId:
      observation.sourceId ?? null,

    seriesId:
      observation.seriesId ?? null,

    observationDate:
      observation.observationDate ?? null,

    value:
      observation.value ?? null,

    availableAt:
      observation.availableAt ?? null,

    availableAtMethod:
      observation.availableAtMethod ?? null,

    structuralPass,

    methodReviewRequired,

    admitted:
      structuralPass &&
      !methodReviewRequired,

    reasons
  };
}

function countReasons(results) {
  const reasonCounts = {};

  for (const result of results) {
    for (const reason of result.reasons) {
      reasonCounts[reason] =
        (reasonCounts[reason] || 0) + 1;
    }
  }

  return reasonCounts;
}

async function main() {
  const validationTimestamp =
    new Date().toISOString();

  const quarantine = await readJson(
    QUARANTINE_FILE,
    "brent-historical-quarantine.json"
  );

  const alfredCandidates =
    await readJson(
      ALFRED_CANDIDATES_FILE,
      "brent-alfred-candidates.json"
    );

  if (
    !Array.isArray(
      quarantine.observations
    )
  ) {
    throw new Error(
      "Quarantine observations array is missing."
    );
  }

  if (
    !Array.isArray(
      alfredCandidates.candidates
    )
  ) {
    throw new Error(
      "ALFRED candidates array is missing."
    );
  }

  const quarantineResults =
    quarantine.observations.map(
      (observation) =>
        evaluateObservation(
          observation,
          "quarantine"
        )
    );

  const alfredResults =
    alfredCandidates.candidates.map(
      (observation) =>
        evaluateObservation(
          observation,
          "alfred_candidates"
        )
    );

  const allResults = [
    ...quarantineResults,
    ...alfredResults
  ];

  const structuralPass =
    allResults.filter(
      (result) =>
        result.structuralPass
    );

  const structuralFail =
    allResults.filter(
      (result) =>
        !result.structuralPass
    );

  const methodReviewRequired =
    allResults.filter(
      (result) =>
        result.methodReviewRequired &&
        result.structuralPass
    );

  const admitted =
    allResults.filter(
      (result) =>
        result.admitted
    );

  const output = {
    schemaVersion: "1.1",

    status:
      admitted.length === 0
        ? "NO_HISTORICAL_OBSERVATIONS_ADMITTED"
        : "HISTORICAL_ADMISSION_REQUIRES_REVIEW",

    validationTimestamp,

    sourceDatasets: [
      "brent-historical-quarantine.json",
      "brent-alfred-candidates.json"
    ],

    policy:
      "Historical observations require valid AvailableAt, explicit availability evidence, and a documented availability method. Structural passage does not authorize automatic promotion. ALFRED candidates remain subject to explicit methodological review.",

    summary: {
      evaluated:
        allResults.length,

      structuralPass:
        structuralPass.length,

      structuralFail:
        structuralFail.length,

      methodReviewRequired:
        methodReviewRequired.length,

      admitted:
        admitted.length,

      reasonCounts:
        countReasons(
          structuralFail
        )
    },

    datasets: {
      quarantine: {
        evaluated:
          quarantineResults.length,

        structuralPass:
          quarantineResults.filter(
            (result) =>
              result.structuralPass
          ).length
      },

      alfredCandidates: {
        evaluated:
          alfredResults.length,

        structuralPass:
          alfredResults.filter(
            (result) =>
              result.structuralPass
          ).length,

        methodReviewRequired:
          alfredResults.filter(
            (result) =>
              result.structuralPass &&
              result.methodReviewRequired
          ).length
      }
    },

    admittedObservations:
      admitted,

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
      "This report evaluates both the original Brent quarantine and the ALFRED historical candidates.",
      "Structural passage means required availability fields and evidence are present and syntactically valid.",
      "Structural passage is not equivalent to methodological approval.",
      "ALFRED candidates remain blocked from automatic admission even when they pass structural validation.",
      "No observation is written to historical-observations.json by this validator.",
      "No calibration dataset or official HESI value is modified."
    ]
  };

  await writeFile(
    OUTPUT_FILE,
    `${JSON.stringify(
      output,
      null,
      2
    )}\n`,
    "utf8"
  );

  console.log(
    "Historical admission validation"
  );

  console.log(
    "-------------------------------"
  );

  console.log(
    `Total evaluated: ${allResults.length}`
  );

  console.log(
    `Structural pass: ${structuralPass.length}`
  );

  console.log(
    `Structural fail: ${structuralFail.length}`
  );

  console.log(
    `Method review required: ${methodReviewRequired.length}`
  );

  console.log(
    `Admitted: ${admitted.length}`
  );

  console.log(
    "Automatic admission: DISABLED"
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
    "Historical admission validation failed:"
  );

  console.error(error);

  process.exit(1);
});
