import { Router } from "express";
import {
  lookupBirthCertificate,
  lookupTradingLicense,
  verifyUssdPin,
  submitTradingLicenseApplication,
  submitBirthCertificateApplication,
  lookupPayableApplication,
  initiatePaymentOnBehalf,
  type ApplicationStatus,
} from "../lib/internalClients.js";

const router = Router();

const STATUS_DESCRIPTIONS: Record<string, string> = {
  SUBMITTED: "received, awaiting fee payment",
  UNDER_REVIEW: "under review",
  ADDITIONAL_INFO_REQUIRED: "needs more information -- check the OneGov portal",
  APPROVED: "approved, certificate being prepared",
  REJECTED: "not approved",
  ISSUED: "issued -- download it from the OneGov portal",
};

function describe(app: ApplicationStatus): string {
  return STATUS_DESCRIPTIONS[app.status] ?? app.status;
}

const ROOT_MENU =
  "CON Welcome to Malawi OneGov\n1. Check Birth Certificate status\n2. Check Trading Licence status\n3. Apply for a Trading Licence\n4. Apply for a Birth Certificate\n5. Pay a fee\n6. Help";

const BUSINESS_TYPES = ["RETAIL", "RESTAURANT", "SERVICES", "MANUFACTURING", "OTHER"] as const;
const BUSINESS_TYPE_MENU =
  "CON Select the business type:\n1. Retail\n2. Restaurant\n3. Services\n4. Manufacturing\n5. Other";

const CHILD_SEX_MENU = "CON Select the child's sex:\n1. Male\n2. Female";

const PAYMENT_PROVIDERS = ["AIRTEL_MONEY", "TNM_MPAMBA"] as const;
const PAYMENT_PROVIDER_LABELS: Record<(typeof PAYMENT_PROVIDERS)[number], string> = {
  AIRTEL_MONEY: "Airtel Money",
  TNM_MPAMBA: "TNM Mpamba",
};
const PAYMENT_PROVIDER_MENU = "CON Select your mobile money provider:\n1. Airtel Money\n2. TNM Mpamba";

/**
 * Parses an 8-digit DDMMYYYY entry (the only format a feature-phone keypad
 * can enter without separators) into the ISO "YYYY-MM-DD" string every
 * other channel (the portal's <input type="date">) already stores. Rejects
 * anything that isn't a real calendar date, and any date in the future.
 */
function parseUssdDateOfBirth(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^\d{8}$/.test(trimmed)) return null;

  const day = Number(trimmed.slice(0, 2));
  const month = Number(trimmed.slice(2, 4));
  const year = Number(trimmed.slice(4, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealCalendarDate =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  if (!isRealCalendarDate || date.getTime() > Date.now()) return null;

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const PIN_ERROR_MESSAGES: Record<"invalid" | "locked" | "error", string> = {
  invalid:
    "END Incorrect phone number or PIN. If you haven't set a USSD PIN yet, log in to the OneGov portal and set one from your profile.",
  locked: "END Too many incorrect PIN attempts. Please try again in 15 minutes, or reset your PIN from the OneGov portal.",
  error: "END OneGov is temporarily unavailable. Please try again shortly.",
};

/**
 * Implements the USSD aggregator webhook contract used by providers like
 * Africa's Talking: on every key press, the aggregator POSTs the FULL
 * accumulated input since the session started (segments separated by "*"),
 * not just the latest key. That means this handler is deliberately
 * stateless -- there is no server-side session store, no cleanup, nothing
 * to leak. Every response is prefixed "CON " (show another screen, session
 * continues) or "END " (final screen, session closes) exactly as the
 * protocol requires.
 *
 * The apply-for-a-licence flow (option 3), apply-for-a-birth-certificate
 * flow (option 4), and pay-a-fee flow (option 5) all re-verify the
 * phone+PIN against identity-service on every single step, not just once
 * at entry. Because
 * the design is stateless and the aggregator always resends the full text,
 * that's the only way to avoid trusting an unauthenticated replay of a
 * partial session -- and since a wrong PIN always ends the session
 * immediately (see below), a later step can only ever be reached with the
 * same PIN that already verified correctly, so the repeat checks are cheap
 * and never double-penalize a citizen for one mistake.
 */
router.post("/", async (req, res) => {
  const text = String(req.body.text ?? "").trim();
  res.type("text/plain");

  if (text === "") {
    return res.send(ROOT_MENU);
  }

  const parts = text.split("*");

  if (parts[0] === "1") {
    if (parts.length === 1) return res.send("CON Enter your Birth Certificate reference number:");
    if (parts.length === 2) {
      const app = await lookupBirthCertificate(parts[1]);
      if (!app) return res.send("END No Birth Certificate application found with that reference number.");
      return res.send(`END ${app.referenceNumber}\n${app.label}\nStatus: ${describe(app)}`);
    }
  }

  if (parts[0] === "2") {
    if (parts.length === 1) return res.send("CON Enter your Trading Licence reference number:");
    if (parts.length === 2) {
      const app = await lookupTradingLicense(parts[1]);
      if (!app) return res.send("END No Trading Licence application found with that reference number.");
      return res.send(`END ${app.referenceNumber}\n${app.label}\nStatus: ${describe(app)}`);
    }
  }

  if (parts[0] === "3") {
    if (parts.length === 1) return res.send("CON Enter your phone number as registered on OneGov (e.g. +265991234567):");
    if (parts.length === 2) return res.send("CON Enter your USSD PIN:");

    // Every step from here on carries phone (parts[1]) and PIN (parts[2]) --
    // re-check identity before doing anything else, every time.
    const auth = await verifyUssdPin(parts[1], parts[2]);
    if (!auth.ok) return res.send(PIN_ERROR_MESSAGES[auth.reason]);
    if (auth.role !== "CITIZEN") return res.send("END This service is only available to citizen accounts.");

    if (parts.length === 3) return res.send(BUSINESS_TYPE_MENU);

    const typeChoice = Number(parts[3]);
    if (!Number.isInteger(typeChoice) || typeChoice < 1 || typeChoice > BUSINESS_TYPES.length) {
      return res.send("END Invalid selection. Please dial again and follow the menu.");
    }
    const businessType = BUSINESS_TYPES[typeChoice - 1];

    if (parts.length === 4) return res.send("CON Enter your business name:");

    const businessName = parts[4].trim();
    if (parts.length === 5) return res.send("CON Enter your trading address:");

    const tradingAddress = parts[5].trim();
    if (parts.length === 6) return res.send("CON Enter your district (e.g. Lilongwe):");

    const district = parts[6].trim();
    if (parts.length === 7) return res.send("CON Enter the business owner's full name:");

    const ownerFullName = parts[7].trim();
    if (parts.length === 8) {
      const result = await submitTradingLicenseApplication(auth.userId, {
        businessName,
        businessType,
        tradingAddress,
        district,
        ownerFullName,
      });
      if (!result) {
        return res.send("END Could not submit your application right now. Please try again shortly, or use the OneGov portal.");
      }
      return res.send(
        `END Application submitted!\nReference: ${result.referenceNumber}\nYou'll be notified as it's processed. Check its status anytime from this menu (option 2).`
      );
    }
  }

  if (parts[0] === "4") {
    if (parts.length === 1) return res.send("CON Enter your phone number as registered on OneGov (e.g. +265991234567):");
    if (parts.length === 2) return res.send("CON Enter your USSD PIN:");

    // Same re-verify-every-step design as option 3 above -- see the doc
    // comment on this handler for why that's safe and cheap here.
    const auth = await verifyUssdPin(parts[1], parts[2]);
    if (!auth.ok) return res.send(PIN_ERROR_MESSAGES[auth.reason]);
    if (auth.role !== "CITIZEN") return res.send("END This service is only available to citizen accounts.");

    if (parts.length === 3) return res.send("CON Enter the child's full name:");

    const childFullName = parts[3].trim();
    if (parts.length === 4) {
      return res.send("CON Enter the child's date of birth as DDMMYYYY (e.g. 15012026 for 15 Jan 2026):");
    }

    const dateOfBirth = parseUssdDateOfBirth(parts[4]);
    if (!dateOfBirth) {
      return res.send("END Invalid date of birth. Please dial again and enter it as DDMMYYYY, e.g. 15012026.");
    }
    if (parts.length === 5) return res.send("CON Enter the place of birth (e.g. district or hospital):");

    const placeOfBirth = parts[5].trim();
    if (parts.length === 6) return res.send(CHILD_SEX_MENU);

    const sexChoice = parts[6];
    if (sexChoice !== "1" && sexChoice !== "2") {
      return res.send("END Invalid selection. Please dial again and follow the menu.");
    }
    const sex = sexChoice === "1" ? "MALE" : "FEMALE";
    if (parts.length === 7) return res.send("CON Enter the mother's full name:");

    const motherFullName = parts[7].trim();
    if (parts.length === 8) return res.send("CON Enter the mother's National ID number, or 0 if not available:");

    const motherNationalIdRaw = parts[8].trim();
    const motherNationalId = motherNationalIdRaw === "0" ? undefined : motherNationalIdRaw;
    if (parts.length === 9) return res.send("CON Enter the father's full name, or 0 if not available:");

    const fatherFullNameRaw = parts[9].trim();
    const fatherFullName = fatherFullNameRaw === "0" ? undefined : fatherFullNameRaw;
    if (parts.length === 10) return res.send("CON Enter the father's National ID number, or 0 if not available:");

    const fatherNationalIdRaw = parts[10].trim();
    const fatherNationalId = fatherNationalIdRaw === "0" ? undefined : fatherNationalIdRaw;
    if (parts.length === 11) {
      const result = await submitBirthCertificateApplication(auth.userId, {
        childFullName,
        dateOfBirth,
        placeOfBirth,
        sex,
        motherFullName,
        motherNationalId,
        fatherFullName,
        fatherNationalId,
      });
      if (!result) {
        return res.send("END Could not submit your application right now. Please try again shortly, or use the OneGov portal.");
      }
      return res.send(
        `END Application submitted!\nReference: ${result.referenceNumber}\nYou'll be notified as it's processed. Check its status anytime from this menu (option 1).`
      );
    }
  }

  if (parts[0] === "5") {
    if (parts.length === 1) return res.send("CON Enter your phone number as registered on OneGov (e.g. +265991234567):");
    if (parts.length === 2) return res.send("CON Enter your USSD PIN:");

    // Same re-verify-every-step design as options 3 and 4 above.
    const auth = await verifyUssdPin(parts[1], parts[2]);
    if (!auth.ok) return res.send(PIN_ERROR_MESSAGES[auth.reason]);
    if (auth.role !== "CITIZEN") return res.send("END This service is only available to citizen accounts.");

    if (parts.length === 3) {
      return res.send("CON Enter the reference number of the application you want to pay for (e.g. BC-2026-... or TL-2026-...):");
    }

    // Re-resolved on every step below too, for the same reason the PIN is
    // re-verified every step: the aggregator resends the full session text
    // each time, so ownership and payability have to be re-checked, not
    // just trusted from an earlier response.
    const referenceNumber = parts[3].trim();
    const payable = await lookupPayableApplication(referenceNumber);
    if (!payable) {
      return res.send("END No application found with that reference number.");
    }
    if (payable.applicantUserId !== auth.userId) {
      return res.send("END This application does not belong to your account.");
    }
    if (payable.status !== "SUBMITTED") {
      return res.send(
        `END This application's fee has already been paid, or it isn't ready for payment (status: ${payable.status}).`
      );
    }

    if (parts.length === 4) return res.send(PAYMENT_PROVIDER_MENU);

    const providerChoice = Number(parts[4]);
    if (!Number.isInteger(providerChoice) || providerChoice < 1 || providerChoice > PAYMENT_PROVIDERS.length) {
      return res.send("END Invalid selection. Please dial again and follow the menu.");
    }
    const provider = PAYMENT_PROVIDERS[providerChoice - 1];

    if (parts.length === 5) {
      const result = await initiatePaymentOnBehalf(auth.userId, {
        entityType: payable.entityType,
        entityId: payable.id,
        amount: payable.feeAmount,
        currency: payable.feeCurrency,
        provider,
        phoneNumber: parts[1],
      });
      if (!result) {
        return res.send("END Could not start your payment right now. Please try again shortly, or use the OneGov portal.");
      }
      return res.send(
        `END Payment of ${payable.feeAmount} ${payable.feeCurrency} started via ${PAYMENT_PROVIDER_LABELS[provider]}.\nYou'll be notified once it's confirmed -- usually within a few seconds.`
      );
    }
  }

  if (parts[0] === "6" && parts.length === 1) {
    return res.send("END For help, call 199 (toll-free) or visit your nearest District Office.");
  }

  return res.send("END Invalid option. Please dial again and follow the menu.");
});

export default router;
