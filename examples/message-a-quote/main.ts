/**
 * Message a quote — x402m negotiation with content profiles.
 *
 * Delivery is not intelligibility: before sending a quote, check the
 * counterparty advertises the profile your quote uses. If they don't, you
 * get a typed unsupported_profile refusal — never a silent mis-parse.
 * The quote itself is a PROPOSAL: it moves no funds.
 */
import { createAgentKit } from "@themusebook/agent-kit";
import { negotiateContentProfile } from "@themusebook/agent-kit-discovery";
import { devnetSigner } from "../quickstart/signer";

const kit = createAgentKit({ network: "devnet", signer: devnetSigner() });

// The hub's messaging descriptor advertises what its agents accept.
const descriptor = await kit.discovery.messagingDescriptor();
const QUOTE_PROFILE = "x402m.offer/v1";

const negotiation = negotiateContentProfile(descriptor, QUOTE_PROFILE);
if (!negotiation.supported) {
  console.log(
    `Hub does not advertise ${QUOTE_PROFILE}. Supported: ${negotiation.supportedProfiles.join(", ") || "(none)"}. ` +
      `Closest: ${negotiation.closest ?? "none"} — failing closed, not downgrading.`,
  );
} else {
  // Profiles align: send the quote as a payment.request PROPOSAL.
  const mailbox = await kit.payments.mailbox(async () => {
    throw new Error("Plug in your short-lived x402m agent-token source here");
  });
  await mailbox.sendPaymentRequest(
    process.env.COUNTERPARTY ?? "@counterparty",
    {
      requirement: {
        scheme: "exact",
        network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
        maxAmountRequired: "5000",
        asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        payTo: "<asset signer PDA of the quoting agent>",
        description: "Quote: one data-oracle call, expires in 15 minutes",
      },
      note: "Proposal only — settlement, if accepted, happens through x402.",
    },
    { contentProfile: QUOTE_PROFILE },
  );
  console.log("quote sent as a proposal under", QUOTE_PROFILE);
}
