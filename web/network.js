// One switch for the whole app: which NEAR network Proctor runs on.
// The site reads VITE_NETWORK at build time, the /api functions read NETWORK
// at run time; both default to testnet. Mainnet names come from the
// environment because nothing is deployed there yet: set them after running
// tools/deploy_mainnet.sh, and the same code serves mainnet.
const env = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : (typeof process !== "undefined" ? process.env : {});
const pick = (k) => env[`VITE_${k}`] ?? env[k];

export const NETWORKS = {
  testnet: {
    id: "testnet",
    contract: "app.proctor-91796.testnet",
    vault: "vault.proctor-91796.testnet",
    budget: "budget.proctor-91796.testnet",
    wallets: "wallets.proctor-91796.testnet",
    scammer: "scammer.proctor-91796.testnet",
    rpc: ["https://rpc.testnet.fastnear.com", "https://test.rpc.fastnear.com", "https://rpc.testnet.near.org", "https://near-testnet.drpc.org"],
    explorer: "https://testnet.nearblocks.io",
    outlayer: "outlayer.testnet",
    keystore: "https://testnet-api.outlayer.ai/secrets/pubkey",
    graderProject: "proctor-91796.testnet/grader",
    demoOwner: "builder.proctor-91796.testnet",
    deployed: true,
  },
  mainnet: {
    id: "mainnet",
    contract: pick("MAINNET_CONTRACT") || "",
    vault: pick("MAINNET_VAULT") || "",
    budget: pick("MAINNET_BUDGET") || "",
    wallets: pick("MAINNET_WALLETS") || "",
    scammer: pick("MAINNET_SCAMMER") || "",
    rpc: ["https://rpc.mainnet.fastnear.com", "https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org"],
    explorer: "https://nearblocks.io",
    outlayer: "outlayer.near",
    keystore: "https://api.outlayer.fastnear.com/secrets/pubkey",
    graderProject: pick("MAINNET_GRADER_PROJECT") || "",
    demoOwner: pick("MAINNET_DEMO_OWNER") || "",
    deployed: Boolean(pick("MAINNET_CONTRACT")),
  },
};

const chosen = pick("NETWORK") === "mainnet" ? "mainnet" : "testnet";
if (chosen === "mainnet" && !NETWORKS.mainnet.deployed) throw new Error("NETWORK=mainnet needs MAINNET_CONTRACT and friends; see tools/deploy_mainnet.sh");
export const NET = NETWORKS[chosen];
