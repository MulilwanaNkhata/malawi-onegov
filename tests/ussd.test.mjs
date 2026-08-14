import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  apiOrThrow,
  registerAndLoginCitizen,
  waitUntil,
  loginAsSupervisor,
  SEEDED_SUPERVISOR_PHONE,
} from "./helpers.mjs";

const GATEWAY_ROOT = (process.env.ONEGOV_BASE_URL ?? "http://localhost:4000/api").replace(/\/api$/, "");

/** USSD is a different protocol (form-encoded in, plain text CON/END out), not the JSON /api surface, so it gets its own small client here rather than reusing helpers.api(). */
async function dial({ sessionId, text }) {
  const res = await fetch(`${GATEWAY_ROOT}/ussd`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ sessionId, phoneNumber: "+265888000111", serviceCode: "*384*OneGov#", text }),
  });
  return res.text();
}

describe("USSD gateway (feature-phone access)", () => {
  test("dialing in with no input shows the root menu and continues the session", async () => {
    const response = await dial({ sessionId: "t-root", text: "" });
    assert.match(response, /^CON /, "first screen must continue the session (CON), not end it");
    assert.match(response, /Check Birth Certificate status/);
    assert.match(response, /Check Trading Licence status/);
    assert.match(response, /Apply for a Trading Licence/);
    assert.match(response, /Apply for a Birth Certificate/);
  });

  test("option 1 prompts for a Birth Certificate reference number", async () => {
    const response = await dial({ sessionId: "t-opt1", text: "1" });
    assert.match(response, /^CON /);
    assert.match(response, /reference number/i);
  });

  test("looking up a real Birth Certificate reference number returns its status", async () => {
    const citizen = await registerAndLoginCitizen("USSD Test Parent");
    const application = await apiOrThrow(
      "POST",
      "/applications",
      {
        childFullName: "USSD Test Child",
        dateOfBirth: "2026-01-01",
        placeOfBirth: "Karonga",
        sex: "MALE",
        motherFullName: "USSD Test Mother",
      },
      citizen.accessToken
    );

    const response = await dial({ sessionId: "t-bc-lookup", text: `1*${application.referenceNumber}` });
    assert.match(response, /^END /, "a final answer must end the session (END)");
    assert.ok(response.includes(application.referenceNumber));
    assert.match(response, /awaiting fee payment/i, `expected the SUBMITTED status description in: ${response}`);
  });

  test("looking up a real Trading Licence reference number returns its status", async () => {
    const citizen = await registerAndLoginCitizen("USSD Test Owner");
    const application = await apiOrThrow(
      "POST",
      "/trading-licenses",
      {
        businessName: "USSD Test Shop",
        businessType: "RETAIL",
        tradingAddress: "Test Road",
        district: "Karonga",
        ownerFullName: "USSD Test Owner",
      },
      citizen.accessToken
    );

    const response = await dial({ sessionId: "t-tl-lookup", text: `2*${application.referenceNumber}` });
    assert.match(response, /^END /);
    assert.ok(response.includes(application.referenceNumber));
    assert.ok(response.includes("USSD Test Shop"));
  });

  test("an unknown reference number gets a clean not-found message, not an error", async () => {
    const response = await dial({ sessionId: "t-unknown", text: "1*BC-2026-DOESNOTEXIST" });
    assert.match(response, /^END /);
    assert.match(response, /no birth certificate application found/i);
  });

  test("the help option ends the session with contact information", async () => {
    const response = await dial({ sessionId: "t-help", text: "5" });
    assert.match(response, /^END /);
    assert.match(response, /199/);
  });

  test("garbage input ends the session cleanly instead of crashing", async () => {
    const response = await dial({ sessionId: "t-garbage", text: "9*9*9*9" });
    assert.match(response, /^END /);
    assert.match(response, /invalid option/i);
  });
});

describe("USSD gateway: PIN-authenticated Trading Licence application (option 3)", () => {
  test("a citizen who has never set a USSD PIN is rejected, not crashed", async () => {
    const citizen = await registerAndLoginCitizen("No PIN Yet");
    const response = await dial({ sessionId: "t-nopin", text: `3*${citizen.phone}*1234` });
    assert.match(response, /^END /);
    assert.match(response, /incorrect phone number or pin/i);
  });

  test("setting a USSD PIN from the portal, then applying for a Trading Licence entirely over USSD", async () => {
    const citizen = await registerAndLoginCitizen("USSD Applicant");
    await apiOrThrow("POST", "/users/me/ussd-pin", { pin: "4321" }, citizen.accessToken);

    const wrongPin = await dial({ sessionId: "t-apply-wrong", text: `3*${citizen.phone}*0000` });
    assert.match(wrongPin, /^END /, "a wrong PIN must end the session, not let the caller keep guessing mid-session");
    assert.match(wrongPin, /incorrect phone number or pin/i);

    const bizTypeMenu = await dial({ sessionId: "t-apply", text: `3*${citizen.phone}*4321` });
    assert.match(bizTypeMenu, /^CON /);
    assert.match(bizTypeMenu, /select the business type/i);

    const final = await dial({
      sessionId: "t-apply",
      text: `3*${citizen.phone}*4321*2*USSD Test Diner*Along M1 Road*Mzuzu*USSD Applicant`,
    });
    assert.match(final, /^END /);
    assert.match(final, /application submitted/i);
    const refMatch = final.match(/Reference: (\S+)/);
    assert.ok(refMatch, `expected a reference number in: ${final}`);

    const created = await waitUntil(async () => {
      const licenses = await apiOrThrow("GET", "/trading-licenses", undefined, citizen.accessToken);
      return licenses.find((l) => l.referenceNumber === refMatch[1]);
    });
    assert.ok(created, "the USSD-submitted application should show up in the citizen's own portal list");
    assert.equal(created.businessType, "RESTAURANT", "option 2 in the business-type menu must map to RESTAURANT");
    assert.equal(created.businessName, "USSD Test Diner");
    assert.equal(created.district, "Mzuzu");
    assert.equal(created.applicantUserId, citizen.userId, "the application must be owned by the PIN-authenticated citizen");

    const statusCheck = await dial({ sessionId: "t-status", text: `2*${refMatch[1]}` });
    assert.match(statusCheck, /^END /);
    assert.ok(statusCheck.includes("USSD Test Diner"));
  });

  test("an invalid business-type digit ends the session cleanly", async () => {
    const citizen = await registerAndLoginCitizen("Bad Choice Applicant");
    await apiOrThrow("POST", "/users/me/ussd-pin", { pin: "1357" }, citizen.accessToken);

    const response = await dial({ sessionId: "t-badtype", text: `3*${citizen.phone}*1357*9` });
    assert.match(response, /^END /);
    assert.match(response, /invalid selection/i);
  });

  test("only a citizen account may apply for a Trading Licence over USSD, even with a valid PIN", async () => {
    const supervisorToken = await loginAsSupervisor();
    await apiOrThrow("POST", "/users/me/ussd-pin", { pin: "1111" }, supervisorToken);

    const response = await dial({ sessionId: "t-staff-apply", text: `3*${SEEDED_SUPERVISOR_PHONE}*1111` });
    assert.match(response, /^END /);
    assert.match(response, /only available to citizen accounts/i);
  });

  test("five wrong PIN attempts locks the USSD PIN for 15 minutes", async () => {
    const citizen = await registerAndLoginCitizen("Lockout Test");
    await apiOrThrow("POST", "/users/me/ussd-pin", { pin: "9999" }, citizen.accessToken);

    for (let i = 0; i < 5; i++) {
      const response = await dial({ sessionId: `t-lock-${i}`, text: `3*${citizen.phone}*0000` });
      assert.match(response, /^END /);
      assert.match(response, /incorrect phone number or pin/i);
    }

    // the correct PIN must now be rejected too -- the account is locked, not just that one wrong guess
    const lockedAttempt = await dial({ sessionId: "t-lock-final", text: `3*${citizen.phone}*9999` });
    assert.match(lockedAttempt, /^END /);
    assert.match(lockedAttempt, /too many incorrect pin attempts/i);
  });
});

describe("USSD gateway: PIN-authenticated Birth Certificate application (option 4)", () => {
  test("a citizen who has never set a USSD PIN is rejected, not crashed", async () => {
    const citizen = await registerAndLoginCitizen("BC No PIN Yet");
    const response = await dial({ sessionId: "t-bc-nopin", text: `4*${citizen.phone}*1234` });
    assert.match(response, /^END /);
    assert.match(response, /incorrect phone number or pin/i);
  });

  test("setting a USSD PIN from the portal, then applying for a Birth Certificate entirely over USSD, skipping the optional father details", async () => {
    const citizen = await registerAndLoginCitizen("BC USSD Applicant");
    await apiOrThrow("POST", "/users/me/ussd-pin", { pin: "2468" }, citizen.accessToken);

    const wrongPin = await dial({ sessionId: "t-bc-apply-wrong", text: `4*${citizen.phone}*0000` });
    assert.match(wrongPin, /^END /, "a wrong PIN must end the session, not let the caller keep guessing mid-session");
    assert.match(wrongPin, /incorrect phone number or pin/i);

    const dobPrompt = await dial({ sessionId: "t-bc-apply", text: `4*${citizen.phone}*2468*USSD Test Baby` });
    assert.match(dobPrompt, /^CON /);
    assert.match(dobPrompt, /date of birth/i);

    const sexMenu = await dial({
      sessionId: "t-bc-apply",
      text: `4*${citizen.phone}*2468*USSD Test Baby*15012026*Karonga District Hospital`,
    });
    assert.match(sexMenu, /^CON /);
    assert.match(sexMenu, /select the child's sex/i);

    const final = await dial({
      sessionId: "t-bc-apply",
      text: `4*${citizen.phone}*2468*USSD Test Baby*15012026*Karonga District Hospital*2*USSD Test Mother*0*0*0`,
    });
    assert.match(final, /^END /);
    assert.match(final, /application submitted/i);
    const refMatch = final.match(/Reference: (\S+)/);
    assert.ok(refMatch, `expected a reference number in: ${final}`);

    const created = await waitUntil(async () => {
      const applications = await apiOrThrow("GET", "/applications", undefined, citizen.accessToken);
      return applications.find((a) => a.referenceNumber === refMatch[1]);
    });
    assert.ok(created, "the USSD-submitted application should show up in the citizen's own portal list");
    assert.equal(created.childFullName, "USSD Test Baby");
    assert.equal(created.dateOfBirth, "2026-01-15", "DDMMYYYY 15012026 must convert to ISO 2026-01-15");
    assert.equal(created.placeOfBirth, "Karonga District Hospital");
    assert.equal(created.sex, "FEMALE", "option 2 in the sex menu must map to FEMALE");
    assert.equal(created.motherFullName, "USSD Test Mother");
    assert.equal(created.motherNationalId, null, "entering 0 must skip the optional mother's National ID");
    assert.equal(created.fatherFullName, null, "entering 0 must skip the optional father's full name");
    assert.equal(created.fatherNationalId, null, "entering 0 must skip the optional father's National ID");
    assert.equal(created.applicantUserId, citizen.userId, "the application must be owned by the PIN-authenticated citizen");

    const statusCheck = await dial({ sessionId: "t-bc-status", text: `1*${refMatch[1]}` });
    assert.match(statusCheck, /^END /);
    assert.ok(statusCheck.includes("USSD Test Baby"));
  });

  test("providing the optional father details carries them through instead of nulling them out", async () => {
    const citizen = await registerAndLoginCitizen("BC USSD Father Applicant");
    await apiOrThrow("POST", "/users/me/ussd-pin", { pin: "1122" }, citizen.accessToken);

    const final = await dial({
      sessionId: "t-bc-apply-father",
      text: `4*${citizen.phone}*1122*Full Details Baby*01062026*Mzuzu Central Hospital*1*Full Details Mother*ID-M-1*Full Details Father*ID-F-1`,
    });
    assert.match(final, /^END /);
    const refMatch = final.match(/Reference: (\S+)/);
    assert.ok(refMatch);

    const created = await waitUntil(async () => {
      const applications = await apiOrThrow("GET", "/applications", undefined, citizen.accessToken);
      return applications.find((a) => a.referenceNumber === refMatch[1]);
    });
    assert.equal(created.sex, "MALE", "option 1 in the sex menu must map to MALE");
    assert.equal(created.motherNationalId, "ID-M-1");
    assert.equal(created.fatherFullName, "Full Details Father");
    assert.equal(created.fatherNationalId, "ID-F-1");
  });

  test("an invalid date of birth ends the session cleanly instead of reaching the database", async () => {
    const citizen = await registerAndLoginCitizen("BC Bad Date Applicant");
    await apiOrThrow("POST", "/users/me/ussd-pin", { pin: "3344" }, citizen.accessToken);

    const notEightDigits = await dial({
      sessionId: "t-bc-baddate-1",
      text: `4*${citizen.phone}*3344*Bad Date Baby*3120`,
    });
    assert.match(notEightDigits, /^END /);
    assert.match(notEightDigits, /invalid date of birth/i);

    const notARealDate = await dial({
      sessionId: "t-bc-baddate-2",
      text: `4*${citizen.phone}*3344*Bad Date Baby*31022026`,
    });
    assert.match(notARealDate, /^END /);
    assert.match(notARealDate, /invalid date of birth/i);

    const futureDate = await dial({
      sessionId: "t-bc-baddate-3",
      text: `4*${citizen.phone}*3344*Bad Date Baby*01012099`,
    });
    assert.match(futureDate, /^END /);
    assert.match(futureDate, /invalid date of birth/i);
  });

  test("an invalid sex-menu digit ends the session cleanly", async () => {
    const citizen = await registerAndLoginCitizen("BC Bad Sex Applicant");
    await apiOrThrow("POST", "/users/me/ussd-pin", { pin: "5566" }, citizen.accessToken);

    const response = await dial({
      sessionId: "t-bc-badsex",
      text: `4*${citizen.phone}*5566*Bad Sex Baby*15012026*Blantyre*9`,
    });
    assert.match(response, /^END /);
    assert.match(response, /invalid selection/i);
  });

  test("only a citizen account may apply for a Birth Certificate over USSD, even with a valid PIN", async () => {
    const supervisorToken = await loginAsSupervisor();
    await apiOrThrow("POST", "/users/me/ussd-pin", { pin: "7788" }, supervisorToken);

    const response = await dial({ sessionId: "t-bc-staff-apply", text: `4*${SEEDED_SUPERVISOR_PHONE}*7788` });
    assert.match(response, /^END /);
    assert.match(response, /only available to citizen accounts/i);
  });
});
