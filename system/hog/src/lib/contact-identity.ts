import type { RegistryContactInput } from "../adapters/registry";

const PLACEHOLDER = {
  address1: "1 Registry Way",
  city: "Cheyenne",
  stateProvince: "WY",
  postalCode: "82001",
  country: "US",
  phone: "+1.5555550100",
};

export function contactInputForEmail(email: string): RegistryContactInput {
  const localPart = email.split("@")[0] ?? "";
  const [base] = localPart.split("+");
  const tokens = (base ?? "")
    .split(/[._\-+0-9]+/)
    .filter((t) => t.length >= 3)
    .map((t) => t[0]!.toUpperCase() + t.slice(1).toLowerCase());
  const firstName = tokens[0] ?? "Domain";
  const lastName = tokens.length > 1 ? tokens[tokens.length - 1]! : "Owner";
  return {
    firstName,
    lastName,
    email,
    ...PLACEHOLDER,
  };
}
