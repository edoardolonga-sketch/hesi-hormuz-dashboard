import { readFile, writeFile } from "node:fs/promises";

const INPUT_FILE = new URL(
  "../data/point-in-time-backtest.json",
  import.meta.url
);

const OUTPUT_FILE = new URL(
  "../data/point-in-time-coverage.json",
  import.meta.url
);

const REQUIRED_SOURCES = [
  "brent_market",
  "cftc_cot",
  "eia_wpsr"
];

async function readJson(file, label) {
  const raw = await readFile(file, "utf8");

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${label}`);
  }
}

function parseTimestamp(value, label) {
  const time = new Date(value).getTime();

  if (!Number.isFinite(time)) {
    throw new Error(`Invalid timestamp: ${label}`);
  }

  return time;
}

function hasSource(snapshot, sourceId) {
  return snapshot.sourceCoverage?.[sourceId] === true;
}

function coverageKey(snapshot) {
  return REQUIRED_SOURCES
    .filter((sourceId) => hasSource(snapshot, sourceId))
    .join("+") || "NONE";
}

function yearFromTimestamp(value) {
  return new Date(value).getUTCFullYear();
}

async function main() {
  const analysisTimestamp = new Date().toISOString();

  const backtest = await readJson(
    INPUT_FILE,
    "point-in-time-backtest.json"
  );

  if (
    backtest.status !==
    "POINT_IN_TIME_BACKTEST_DATASET_NOT_CALIBRATED"
  ) {
    throw new Error(
      "Point-in-time dataset has an unexpected status."
    );
  }

  if (
    backtest.pointInTimePolicy?.enabled !== true
  ) {
    throw new Error(
      "Point-in-time protection is not enabled."
    );
  }

  if (
    backtest.pointInTimePolicy
      ?.futureInformationAllowed !== false
  ) {
    throw new Error(
      "Point-in-time dataset does not explicitly prohibit future information."
    );
  }

  if (
    backtest.summary?.leakageViolations !== 0
  ) {
    throw new Error(
      "Point-in-time dataset contains leakage violations."
    );
  }

  if (!Array.isArray(backtest.snapshots)) {
    throw new Error(
      "Point-in-time snapshots array is missing."
    );
  }

  if (backtest.snapshots.length === 0) {
    throw new Error(
      "Point-in-time dataset contains no snapshots."
    );
  }

  const coverageCounts = {};
  const sourceSnapshotCounts = {};

  for (const sourceId of REQUIRED_SOURCES) {
    sourceSnapshotCounts[sourceId] = 0;
  }

  let previousSnapshotTime = null;

  let firstBrentSnapshot = null;
  let firstCftcSnapshot = null;
  let firstEiaSnapshot = null;
  let firstAllSourcesSnapshot = null;

  let allSourcesSnapshotCount = 0;

  const yearlyCoverage = {};

  for (const snapshot of backtest.snapshots) {
    if (!snapshot.snapshotAt) {
      throw new Error(
        "Snapshot has no snapshotAt."
      );
    }

    const snapshotTime = parseTimestamp(
      snapshot.snapshotAt,
      "snapshotAt"
    );

    if (
      previousSnapshotTime !== null &&
      snapshotTime <= previousSnapshotTime
    ) {
      throw new Error(
        "Snapshots are not in strictly increasing chronological order."
      );
    }

    previousSnapshotTime = snapshotTime;

    if (
      snapshot.eligibilityRule !==
      "availableAt < snapshotAt"
    ) {
      throw new Error(
        `Unexpected eligibility rule at ${snapshot.snapshotAt}.`
      );
    }

    if (
      !snapshot.sourceCoverage ||
      typeof snapshot.sourceCoverage !== "object"
    ) {
      throw new Error(
        `Missing sourceCoverage at ${snapshot.snapshotAt}.`
      );
    }

    if (
      !Array.isArray(
        snapshot.latestObservations
      )
    ) {
      throw new Error(
        `Missing latestObservations at ${snapshot.snapshotAt}.`
      );
    }

    /*
     * Independent structural check:
     * no observation exposed by the snapshot may have
     * AvailableAt equal to or later than snapshotAt.
     */
    for (
      const observation of
      snapshot.latestObservations
    ) {
      if (!observation.availableAt) {
        throw new Error(
          `Observation without AvailableAt at ${snapshot.snapshotAt}.`
        );
      }

      const availableTime =
        parseTimestamp(
          observation.availableAt,
          `${observation.sourceId} availableAt`
        );

      if (availableTime >= snapshotTime) {
        throw new Error(
          `Leakage detected at ${snapshot.snapshotAt}.`
        );
      }
    }

    const brentAvailable =
      hasSource(snapshot, "brent_market");

    const cftcAvailable =
      hasSource(snapshot, "cftc_cot");

    const eiaAvailable =
      hasSource(snapshot, "eia_wpsr");

    if (
      brentAvailable &&
      firstBrentSnapshot === null
    ) {
      firstBrentSnapshot =
        snapshot.snapshotAt;
    }

    if (
      cftcAvailable &&
      firstCftcSnapshot === null
    ) {
      firstCftcSnapshot =
        snapshot.snapshotAt;
    }

    if (
      eiaAvailable &&
      firstEiaSnapshot === null
    ) {
      firstEiaSnapshot =
        snapshot.snapshotAt;
    }

    for (const sourceId of REQUIRED_SOURCES) {
      if (hasSource(snapshot, sourceId)) {
        sourceSnapshotCounts[sourceId] += 1;
      }
    }

    const key = coverageKey(snapshot);

    coverageCounts[key] =
      (coverageCounts[key] || 0) + 1;

    const allSourcesAvailable =
      brentAvailable &&
      cftcAvailable &&
      eiaAvailable;

    if (allSourcesAvailable) {
      allSourcesSnapshotCount += 1;

      if (firstAllSourcesSnapshot === null) {
        firstAllSourcesSnapshot =
          snapshot.snapshotAt;
      }
    }

    const year =
      yearFromTimestamp(
        snapshot.snapshotAt
      );

    if (!yearlyCoverage[year]) {
      yearlyCoverage[year] = {
        snapshotCount: 0,
        brentAvailable: 0,
        cftcAvailable: 0,
        eiaAvailable: 0,
        allSourcesAvailable: 0
      };
    }

    yearlyCoverage[year].snapshotCount += 1;

    if (brentAvailable) {
      yearlyCoverage[year]
        .brentAvailable += 1;
    }

    if (cftcAvailable) {
      yearlyCoverage[year]
        .cftcAvailable += 1;
    }

    if (eiaAvailable) {
      yearlyCoverage[year]
        .eiaAvailable += 1;
    }

    if (allSourcesAvailable) {
      yearlyCoverage[year]
        .allSourcesAvailable += 1;
    }
  }

  const totalSnapshots =
    backtest.snapshots.length;

  const allSourcesCoveragePct =
    totalSnapshots > 0
      ? Number(
          (
            (allSourcesSnapshotCount /
              totalSnapshots) *
            100
          ).toFixed(4)
        )
      : 0;

  const fullCoverageExists =
    firstAllSourcesSnapshot !== null;

  const output = {
    schemaVersion: "1.0",

    status:
      "POINT_IN_TIME_COVERAGE_ANALYZED_NOT_CALIBRATED",

    analysisTimestamp,

    sourceArtifact: {
      status: backtest.status,
      buildTimestamp:
        backtest.buildTimestamp || null,
      snapshotCount:
        totalSnapshots,
      leakageViolations:
        backtest.summary
          ?.leakageViolations ?? null
    },

    requiredSources:
      REQUIRED_SOURCES,

    summary: {
      totalSnapshots,

      firstSnapshotAt:
        backtest.snapshots[0]
          ?.snapshotAt || null,

      lastSnapshotAt:
        backtest.snapshots[
          backtest.snapshots.length - 1
        ]?.snapshotAt || null,

      firstAvailableSnapshotBySource: {
        brent_market:
          firstBrentSnapshot,
        cftc_cot:
          firstCftcSnapshot,
        eia_wpsr:
          firstEiaSnapshot
      },

      firstAllSourcesSnapshotAt:
        firstAllSourcesSnapshot,

      allSourcesSnapshotCount,

      allSourcesCoveragePct,

      fullCoverageExists
    },

    sourceSnapshotCounts,

    coverageCombinations:
      coverageCounts,

    yearlyCoverage,

    researchAssessment: {
      fullHesiHistoricalCoverageEstablished:
        fullCoverageExists,

      calibrationAuthorized: false,

      calibrationPerformed: false,

      backtestPerformanceMeasured: false,

      predictiveValidityEstablished: false,

      reason:
        fullCoverageExists
          ? "At least one point-in-time snapshot contains all required sources. This establishes overlap existence only, not sufficient historical depth or calibration readiness."
          : "No point-in-time snapshot contains all required sources. A full multi-source HESI historical backtest cannot yet be constructed from the current admitted dataset."
    },

    safeguards: {
      sourceDatasetModified: false,
      pointInTimeDatasetModified: false,
      historicalObservationsModified: false,
      calibrationPerformed: false,
      modelWeightsModified: false,
      thresholdsModified: false,
      forecastModelTrained: false,
      officialHesiModified: false,
      dashboardOfficialHesiModified: false
    },

    interpretationLimits: [
      "This analysis measures point-in-time source overlap only.",
      "Source availability means the snapshot contains at least one eligible latest observation for that source.",
      "Availability does not imply that the observation is sufficiently fresh for a scientific HESI calculation.",
      "Full source overlap does not establish sufficient sample size for calibration.",
      "Full source overlap does not establish predictive validity.",
      "The leakage check validates the implemented AvailableAt eligibility rule but does not independently verify provider publication metadata.",
      "No calibration, model fitting, weight optimization, threshold optimization or forecast training is performed.",
      "Official HESI remains unchanged."
    ]
  };

  await writeFile(
    OUTPUT_FILE,
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8"
  );

  console.log(
    "HESI point-in-time source coverage analysis"
  );
  console.log(
    "-------------------------------------------"
  );
  console.log(
    `Analysis timestamp: ${analysisTimestamp}`
  );
  console.log(
    `Snapshots analyzed: ${totalSnapshots}`
  );
  console.log(
    `First Brent snapshot: ${firstBrentSnapshot}`
  );
  console.log(
    `First CFTC snapshot: ${firstCftcSnapshot}`
  );
  console.log(
    `First EIA snapshot: ${firstEiaSnapshot}`
  );
  console.log(
    `First all-source snapshot: ${firstAllSourcesSnapshot}`
  );
  console.log(
    `All-source snapshots: ${allSourcesSnapshotCount}`
  );
  console.log(
    `All-source coverage: ${allSourcesCoveragePct}%`
  );
  console.log(
    "Calibration performed: NO"
  );
  console.log(
    "Predictive validity established: NO"
  );
  console.log(
    "Official HESI modified: NO"
  );
}

main().catch((error) => {
  console.error(
    "Point-in-time coverage analysis failed:"
  );
  console.error(error);
  process.exit(1);
});
