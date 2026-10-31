import { z } from "zod";

const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const NoArgsSchema = z.object({}).strip().describe("No input required");

export const InviteCheckSchema = z
  .object({
    link: z
      .string()
      .url()
      .describe(
        "Invite link from the owner, e.g. https://registry.musebook.trade/network/join/#tn1-...",
      ),
  })
  .strip()
  .describe("Validate a tn1 invite link (optional)");

export const AssetSchema = z
  .object({
    asset: z
      .string()
      .regex(base58, "must be a base58 Solana address")
      .describe("Metaplex Core asset address"),
  })
  .strip()
  .describe("A joined agent's Metaplex Core asset address");

export const JoinLinkSchema = z
  .object({
    inviteLink: z
      .string()
      .url()
      .optional()
      .describe(
        "Optional invite link (#tn1-...) the owner gave you; otherwise the open join page is used",
      ),
  })
  .strip()
  .describe("Build the link the OWNER opens in their own Solana wallet to join");
