import {
  Configuration,
  PlaidApi,
  PlaidEnvironments
} from "plaid";
import { env } from "../config/env.js";

const envMap: Record<"sandbox" | "development" | "production", string> = {
  sandbox: PlaidEnvironments.sandbox!,
  development: PlaidEnvironments.development!,
  production: PlaidEnvironments.production!
};

const configuration = new Configuration({
  basePath: envMap[env.PLAID_ENV],
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": env.PLAID_CLIENT_ID,
      "PLAID-SECRET": env.PLAID_SECRET
    }
  }
});

export const plaidClient = new PlaidApi(configuration);
