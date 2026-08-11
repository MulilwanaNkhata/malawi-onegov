#!/usr/bin/env node
// Simulates a feature phone dialing a USSD short code, using the exact
// webhook contract a real aggregator (e.g. Africa's Talking) speaks: every
// key press re-sends the FULL accumulated input so far, and the app
// responds "CON <text>" (show another screen) or "END <text>" (hang up).
//
// Usage: node ussd-simulator.mjs [gatewayUrl]
//   (defaults to http://localhost:4000/ussd -- the real production path,
//   through api-gateway -- not the service's own port)
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

const GATEWAY_URL = process.argv[2] ?? "http://localhost:4000/ussd";
const sessionId = `sim-${Date.now()}`;
const phoneNumber = "+265888123456";

const rl = readline.createInterface({ input: stdin, output: stdout });

function drawScreen(body) {
  const width = 34;
  const line = "+" + "-".repeat(width) + "+";
  console.log("\n" + line);
  for (const row of body.split("\n")) {
    console.log("| " + row.padEnd(width - 1));
  }
  console.log(line);
}

async function dial(text) {
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ sessionId, phoneNumber, serviceCode: "*384*OneGov#", text }),
  });
  return res.text();
}

async function main() {
  console.log(`Dialing *384*OneGov# as ${phoneNumber} ...`);
  let accumulated = "";

  for (;;) {
    const response = await dial(accumulated);
    const isEnd = response.startsWith("END ");
    const body = response.replace(/^(CON|END) /, "");
    drawScreen(body);

    if (isEnd) {
      const again = await rl.question("\n[session ended] Dial again? (y/N) ");
      if (again.trim().toLowerCase() !== "y") break;
      accumulated = "";
      console.log(`\nDialing *384*OneGov# as ${phoneNumber} ...`);
      continue;
    }

    const input = await rl.question("> ");
    accumulated = accumulated === "" ? input.trim() : `${accumulated}*${input.trim()}`;
  }

  rl.close();
}

main().catch((err) => {
  console.error("Simulator error:", err.message);
  process.exit(1);
});
