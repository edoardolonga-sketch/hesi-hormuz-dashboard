import { readFile, writeFile } from "node:fs/promises";

const CANDIDATES_FILE = new URL(
  "../data/brent-alfred-candidates.json",
  import.meta.url
);

const OUTPUT_FILE = new URL(
  "../data/brent-alfred-methodology-review.json",
  import.meta.url
);

const EXPECTED_SERIES_ID =
  "DCOILBRENTEU";

const EXPECTED_METHOD =
  "ALFRED_INITIAL_RELEASE_REALTIME_START_END_OF_DAY_UTC";

async function readJson(file, label) {
  const raw =
    await readFile(file, "utf8");

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      `Invalid JSON in ${label}`
    );
  }
}

function validDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  return Number.isFinite(
    new Date(
      `${value}T00:00:00.000Z`
    ).getTime()
  );
}

function validTimestamp(value) {
  if (
    typeof value !== "string"
  ) {
    return false;
  }

  return Number.isFinite(
    new Date(value).getTime()
  );
}

function reviewCandidate(candidate) {
  const reasons = [];

  if (
    candidate.sourceId !==
    "brent_market"
  ) {
    reasons.push(
      "UNEXPECTED_SOURCE_ID"
    );
  }

  if (
    candidate.seriesId !==
    EXPECTED_SERIES_ID
  ) {
    reasons.push(
      "UNEXPECTED_SERIES_ID"
    );
  }

  if (
    !validDate(
      candidate.observationDate
    )
  ) {
    reasons.push(
      "INVALID_OBSERVATION_DATE"
    );
  }

  if (
    typeof candidate.value !==
      "number" ||
    !Number.isFinite(
      candidate.value
    ) ||
    candidate.value <= 0
  ) {
    reasons.push(
      "INVALID_VALUE"
    );
  }

  if (
    !validTimestamp(
      candidate.availableAt
    )
  ) {
    reasons.push(
      "INVALID_AVAILABLE_AT"
    );
  }

  if (
    candidate.availableAtMethod !==
    EXPECTED_METHOD
  ) {
    reasons.push(
      "UNEXPECTED_AVAILABLE_AT_METHOD"
    );
  }

  const evidence =
    candidate.availableAtEvidence;

  if (
    !evidence ||
    typeof evidence !== "object"
  ) {
    reasons.push(
      "AVAILABLE_AT_EVIDENCE_MISSING"
    );
  } else {
    if (
      evidence.provider !==
      "Federal Reserve Bank of St. Louis FRED/ALFRED"
    ) {
      reasons.push(
        "UNEXPECTED_EVIDENCE_PROVIDER"
      );
    }

    if (
      evidence.endpoint !==
      "fred/series/observations"
    ) {
      reasons.push(
        "UNEXPECTED_EVIDENCE_ENDPOINT"
      );
    }

    if (
      Number(evidence.outputType) !== 4
    ) {
      reasons.push(
        "UNEXPECTED_OUTPUT_TYPE"
      );
    }

    if (
      !validDate(
        evidence.realtimeStart
      )
    ) {
      reasons.push(
        "INVALID_REALTIME_START"
      );
    }

    if (
      evidence.realtimeStart &&
      validTimestamp(
        candidate.availableAt
      )
    ) {
      const expectedAvailableAt =
        `${evidence.realtimeStart}T23:59:59.999Z`;

      if (
        candidate.availableAt !==
        expectedAvailableAt
      ) {
        reasons.push(
          "AVAILABLE_AT_METHOD_MISMATCH"
        );
      }
    }
  }

  if (
    validDate(
      candidate.observationDate
    ) &&
    validTimestamp(
      candidate.availableAt
    )
  ) {
    const observationTime =
      new Date(
        `${candidate.observationDate}T00:00:00.000Z`
      ).getTime();

    const availableTime =
      new Date(
        candidate.availableAt
      ).getTime();

    if (
      availableTime <
      observationTime
    ) {
      reasons.push(
        "AVAILABLE_AT_PRECEDES_OBSERVATION"
      );
    }
  }

  return {
    sourceId:
      candidate.sourceId ?? null,

    seriesId:
      candidate.seriesId ?? null,

    observationDate:
      candidate.observationDate ?? null,

    availableAt:
      candidate.availableAt ?? null,

    value:
      candidate.value ?? null,

    method:
      candidate.availableAtMethod ?? null,

    passesMethodChecks:
      reasons.length === 0,

    reasons
  };
}

function countReasons(results) {
  const counts = {};

  for (const result of results) {
    for (
      const reason of result.reasons
    ) {
      counts[reason] =
        (counts[reason] || 0) + 1;
    }
  }

  return counts;
}

async function main() {
  const reviewTimestamp =
    new Date().toISOString();

  const input =
    await readJson(
      CANDIDATES_FILE,
      "brent-alfred-candidates.json"
    );

  if (
    !Array.isArray(
      input.candidates
    )
  ) {
    throw new Error(
      "ALFRED candidates array is missing."
    );
  }

  const results =
    input.candidates.map(
      reviewCandidate
    );

  const passed =
    results.filter(
      (result) =>
        result.passesMethodChecks
    );

  const failed =
    results.filter(
      (result) =>
        !result.passesMethodChecks
    );

  const output = {
    schemaVersion: "1.0",

    status:
      failed.length === 0
        ? "METHOD_CHECKS_PASSED_REVIEW_STILL_REQUIRED"
        : "METHOD_CHECKS_FAILED",

    reviewTimestamp,

    sourceDataset:
      "brent-alfred-candidates.json",

    seriesId:
      EXPECTED_SERIES_ID,

    reviewedMethod:
      EXPECTED_METHOD,

    methodologyDecision: {
      automatedChecksPassed:
        failed.length === 0,

      humanMethodologicalApproval:
        false,

      admissionAuthorized:
        false,

      rationale:
        "Automated checks verify internal consistency of the conservative ALFRED AvailableAt convention. They do not by themselves establish that the convention is scientifically sufficient for calibration."
    },

    summary: {
      evaluated:
        results.length,

      passedMethodChecks:
        passed.length,

      failedMethodChecks:
        failed.length,

      reasonCounts:
        countReasons(failed)
    },

    failedObservations:
      failed,

    promotion: {
      historicalStoreUpdated:
        false,

      calibrationDatasetUpdated:
        false,

      officialHesiUpdated:
        false
    },

    notes: [
      "This review checks consistency between ALFRED realtime_start and the conservative end-of-day UTC AvailableAt convention.",
      "The script does not promote observations.",
      "A successful automated review is necessary but not sufficient for methodological approval.",
      "Historical admission remains disabled until an explicit methodological decision is documented.",
      "Official HESI remains unchanged."
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
    "ALFRED Brent methodology review"
  );

  console.log(
    "-------------------------------"
  );

  console.log(
    `Evaluated: ${results.length}`
  );

  console.log(
    `Passed method checks: ${passed.length}`
  );

  console.log(
    `Failed method checks: ${failed.length}`
  );

  console.log(
    "Human methodological approval: NO"
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
    "ALFRED methodology review failed:"
  );

  console.error(error);

  process.exit(1);
});
