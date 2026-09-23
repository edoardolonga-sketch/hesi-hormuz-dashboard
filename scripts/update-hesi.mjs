import { readFile } from "node:fs/promises";

const DATA_FILE = new URL("../data/dashboard-data.json", import.meta.url);

async function main() {
  const raw = await readFile(DATA_FILE, "utf8");
  const data = JSON.parse(raw);

  if (!data.hesi) {
    throw new Error("Missing HESI block in dashboard-data.json");
  }

  if (!data.hesi.asOf) {
    throw new Error("Missing HESI asOf date");
  }

  console.log("HESI pipeline validation");
  console.log("------------------------");
  console.log(`Available checkpoint: ${data.hesi.asOf}`);
  console.log(`HESI Effective: ${data.hesi.effective}`);
  console.log(`Physical Stress: ${data.hesi.physical}`);
  console.log(`Market Stress: ${data.hesi.market}`);
  console.log("");
  console.log("Validation passed.");
  console.log("No dashboard data were modified.");
}

main().catch((error) => {
  console.error("HESI pipeline failed:");
  console.error(error);
  process.exit(1);
});
