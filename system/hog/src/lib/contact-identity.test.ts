import { describe, expect, test } from "bun:test";
import { contactInputForEmail } from "./contact-identity";

describe("contactInputForEmail", () => {
  test("derives first and last name from dotted local part", () => {
    const input = contactInputForEmail("martin.king@example.com");
    expect(input.firstName).toBe("Martin");
    expect(input.lastName).toBe("King");
  });

  test("uses separators beyond dots", () => {
    const input = contactInputForEmail("jane_a-doe+tag@example.com");
    expect(input.firstName).toBe("Jane");
    expect(input.lastName).toBe("Doe");
  });

  test("falls back to Owner when only one usable token", () => {
    const input = contactInputForEmail("martin@example.com");
    expect(input.firstName).toBe("Martin");
    expect(input.lastName).toBe("Owner");
  });

  test("falls back to Domain/Owner when no usable tokens", () => {
    const input = contactInputForEmail("123456@example.com");
    expect(input.firstName).toBe("Domain");
    expect(input.lastName).toBe("Owner");
  });

  test("always emits spaceship-required fields", () => {
    const input = contactInputForEmail("a.b@example.com");
    expect(input.email).toBe("a.b@example.com");
    expect(input.address1.length).toBeGreaterThan(0);
    expect(input.city.length).toBeGreaterThan(0);
    expect(input.country).toMatch(/^[A-Z]{2}$/);
    expect(input.phone).toMatch(/^\+\d{1,3}\.\d{4,}$/);
  });
});
