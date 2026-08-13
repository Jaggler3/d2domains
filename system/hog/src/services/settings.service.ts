import { createRegistryClient, type RegistryDomainSettings } from "../adapters/registry";
import { assertDomainOwnership } from "./ownership";
import { loadEnv } from "../config/env";

const registry = createRegistryClient({ baseUrl: loadEnv().REGISTRY_URL });

export interface SettingsPatch {
  autorenew?: boolean;
  privacy?: boolean;
  locked?: boolean;
  nameservers?: string[];
}

export const settingsService = {
  async get(userId: string, domainName: string): Promise<RegistryDomainSettings> {
    await assertDomainOwnership(userId, domainName);
    const { domain } = await registry.getDomainSettings(domainName);
    return domain;
  },

  async patch(
    userId: string,
    domainName: string,
    patch: SettingsPatch,
  ): Promise<RegistryDomainSettings> {
    await assertDomainOwnership(userId, domainName);
    if (patch.nameservers) {
      await registry.setNameservers(domainName, patch.nameservers);
    }
    if (patch.autorenew !== undefined) {
      await registry.setAutorenew(domainName, patch.autorenew);
    }
    if (patch.privacy !== undefined) {
      await registry.setPrivacy(domainName, patch.privacy);
    }
    if (patch.locked !== undefined) {
      await registry.setLock(domainName, patch.locked);
    }
    return this.get(userId, domainName);
  },
};
