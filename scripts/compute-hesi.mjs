import { readFile, writeFile } from "node:fs/promises";

const OBSERVATIONS_FILE = new URL(
  "../data/latest-observations.json",
  import.meta.url
);

const OUTPUT_FILE = new URL(
  "../data/hesi-computed.json",
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

function clamp(value, min = 0, max = 100) {
  return Math.min(
    max,
    Math.max(min, value)
  );
}

function round(value, decimals = 6) {
  const factor = 10 ** decimals;

  return (
    Math.round(value * factor) /
    factor
  );
}

function requireObservation(
  observations,
  sourceId
) {
  const observation =
    observations.find(
      (item) =>
        item.sourceId === sourceId
    );

  if (!observation) {
    throw new Error(
      `Missing required observation: ${sourceId}`
    );
  }

  return observation;
}

async function main() {
  const executionTimestamp =
    new Date().toISOString();

  const latest = await readJson(
    OBSERVATIONS_FILE,
    "latest-observations.json"
  );

  if (!Array.isArray(latest.observations)) {
    throw new Error(
      "Invalid observations array."
    );
  }

  const brent = requireObservation(
    latest.observations,
    "brent_market"
  );

  const cftc = requireObservation(
    latest.observations,
    "cftc_cot"
  );

  if (
    typeof brent.value !== "number" ||
    !Number.isFinite(brent.value) ||
    brent.value <= 0
  ) {
    throw new Error(
      "Invalid Brent observation."
    );
  }

  if (
    typeof cftc.managedMoneyNet !==
      "number" ||
    !Number.isFinite(
      cftc.managedMoneyNet
    )
  ) {
    throw new Error(
      "Invalid CFTC Managed Money observation."
    );
  }

  /*
   * EXPERIMENTAL NORMALIZATION
   *
   * These are transparent scaling anchors,
   * not trained model parameters.
   *
   * Brent:
   *   50 USD/bbl -> stress 0
   *   150 USD/bbl -> stress 100
   *
   * CFTC Managed Money Net:
   *   -200,000 -> stress 0
   *   +200,000 -> stress 100
   *
   * These anchors are provisional and must
   * later be replaced by historically fitted,
   * leakage-safe transformations.
   */

  const brentStress = clamp(
    ((brent.value - 50) / 100) * 100
  );

  const cftcStress = clamp(
    ((cftc.managedMoneyNet + 200000) /
      400000) *
      100
  );

  /*
   * Experimental Market Stress:
   *
   * 70% Brent level
   * 30% CFTC positioning
   *
   * This is NOT promoted to the official
   * dashboard HESI yet.
   */

  const marketStressExperimental =
    clamp(
      0.7 * brentStress +
      0.3 * cftcStress
    );

  const asOf =
    [brent.observationDate,
     cftc.observationDate]
      .sort()
      .at(-1);

  const output = {
    schemaVersion: "1.0",

    executionTimestamp,

    asOf,

    status:
      "EXPERIMENTAL_NOT_PROMOTED",

    availableAtProtection:
      "ENABLED",

    inputs: {
      brent: {
        observationDate:
          brent.observationDate,
        availableAt:
          brent.availableAt,
        value:
          brent.value,
        unit:
          brent.unit
      },

      cftc: {
        observationDate:
          cftc.observationDate,
        availableAt:
          cftc.availableAt,
        managedMoneyLong:
          cftc.managedMoneyLong,
        managedMoneyShort:
          cftc.managedMoneyShort,
        managedMoneySpreading:
          cftc.managedMoneySpreading,
        managedMoneyNet:
          cftc.managedMoneyNet,
        unit:
          cftc.unit
      }
    },

    components: {
      brentStress:
        round(brentStress),

      cftcPositioningStress:
        round(cftcStress)
    },

    marketStressExperimental:
      round(
        marketStressExperimental
      ),

    weights: {
      brent: 0.7,
      cftc: 0.3
    },

    promotion: {
      dashboardUpdated: false,
      officialHesiUpdated: false
    },

    methodologyNote:
      "Experimental market-stress calculation. Scaling anchors and weights are provisional and have not yet been fitted or validated out-of-sample. Result must not replace the official dashboard HESI until historical leakage-safe calibration is completed."
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
    "HESI experimental computation"
  );
  console.log(
    "-----------------------------"
  );

  console.log(
    `Brent: ${brent.value}`
  );

  console.log(
    `CFTC Managed Money Net: ${cftc.managedMoneyNet}`
  );

  console.log(
    `Brent stress: ${round(brentStress)}`
  );

  console.log(
    `CFTC stress: ${round(cftcStress)}`
  );

  console.log(
    `Experimental Market Stress: ${round(
      marketStressExperimental
    )}`
  );

  console.log(
    "Official dashboard HESI modified: NO"
  );

  console.log(
    "Status: EXPERIMENTAL_NOT_PROMOTED"
  );
}

main().catch((error) => {
  console.error(
    "HESI computation failed:"
  );
  console.error(error);
  process.exit(1);
});
