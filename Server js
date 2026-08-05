import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Telegraf } from "telegraf";
import { TonClient, WalletContractV4, internal, toNano, Address, beginCell } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// --- CONFIGURATION ---
const USDT_MASTER_ADDRESS = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";

// GAS & SERVICE FEE SETTINGS (Deducted directly from withdrawal)
const USDT_MIN_WITHDRAWAL = 3.00;
const USDT_GAS_FEE = 0.25; // User gets ($3.00 - $0.25) = $2.75 USDT

const TON_MIN_WITHDRAWAL = 1.00;
const TON_GAS_FEE = 0.05;   // User gets (1.00 - 0.05) = 0.95 TON

const TASKS = [
  { id: "tg_channel", title: "Join Official Telegram Channel", reward: 0.20, url: "https://t.me/your_channel" },
  { id: "x_follow", title: "Follow us on X (Twitter)", reward: 0.15, url: "https://x.com/your_handle" },
  { id: "yt_sub", title: "Subscribe to YouTube Channel", reward: 0.25, url: "https://youtube.com" }
];

const UPGRADES = {
  1: { name: "Basic Miner", rate: 0.000006944, cost: 0 },         // 0.60 USDT / day
  2: { name: "GPU Rig", rate: 0.000013888, cost: 1.50 },          // 1.20 USDT / day
  3: { name: "ASIC Farm", rate: 0.000028935, cost: 3.00 }          // 2.50 USDT / day
};

// --- IN-MEMORY STATE ---
const db = {};               
const deviceMap = {};        
const pendingReferrals = {}; 

// --- HELPER: SAFE USER GETTER ---
function getOrCreateUser(userId, deviceFingerprint = "default_device") {
  if (!db[userId]) {
    db[userId] = {
      usdtBalance: 0.50, 
      tonBalance: 0.10,  
      lastSync: Date.now(),
      wallet: null,
      device: deviceFingerprint,
      tier: 1,
      completedTasks: [],
      lastDailyClaim: 0,
      lastSpin: 0,
      isProcessingWithdrawal: false
    };
  }
  return db[userId];
}

// --- TELEGRAM BOT SETUP ---
if (process.env.BOT_TOKEN) {
  const bot = new Telegraf(process.env.BOT_TOKEN);
  bot.start((ctx) => {
    const userId = ctx.from.id;
    const startParam = ctx.payload;

    if (startParam && startParam.startsWith("ref_")) {
      const referrerId = startParam.replace("ref_", "");
      if (referrerId !== String(userId)) {
        pendingReferrals[userId] = referrerId;
      }
    }

    ctx.reply("⚡ Welcome to TonStrike! Tap below to start mining USDT daily.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "⛏️ Launch TonStrike App", web_app: { url: process.env.WEBAPP_URL || `http://localhost:${process.env.PORT || 3000}` } }]
        ]
      }
    });
  });
  bot.launch().catch(err => console.error("Bot launch error:", err.message));
} else {
  console.warn("⚠️ BOT_TOKEN not set in environment variables.");
}

// --- TON CLIENT & WALLET ---
const tonClient = new TonClient({ endpoint: "https://toncenter.com/api/v2/jsonRPC" });

async function getHotWallet() {
  if (!process.env.HOT_WALLET_MNEMONIC) {
    throw new Error("HOT_WALLET_MNEMONIC missing in environment variables.");
  }
  const mnemonic = process.env.HOT_WALLET_MNEMONIC.trim().split(/\s+/);
  if (mnemonic.length !== 24) {
    throw new Error("Invalid HOT_WALLET_MNEMONIC length (must be 24 words).");
  }
  const key = await mnemonicToPrivateKey(mnemonic);
  const wallet = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 });
  return { contract: tonClient.open(wallet), key, address: wallet.address };
}

async function getJettonWalletAddress(userAddress) {
  const result = await tonClient.runMethod(
    Address.parse(USDT_MASTER_ADDRESS),
    "get_wallet_address",
    [{ type: "slice", cell: beginCell().storeAddress(Address.parse(userAddress)).endCell() }]
  );
  return result.stack.readAddress();
}

// --- REST API ENDPOINTS ---

app.post("/api/init-user", (req, res) => {
  try {
    const { userId, deviceFingerprint } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is required." });

    const fp = deviceFingerprint || `dev_${userId}`;
    if (deviceMap[fp] && deviceMap[fp] !== String(userId)) {
      return res.status(403).json({ error: "Device Lock: Phone linked to another account." });
    }
    deviceMap[fp] = String(userId);

    const isNew = !db[userId];
    const user = getOrCreateUser(userId, fp);

    if (isNew) {
      const referrerId = pendingReferrals[userId];
      if (referrerId && db[referrerId]) {
        db[referrerId].usdtBalance += 0.25;
        delete pendingReferrals[userId];
      }
    }

    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/sync-mining", (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is required." });

    const user = getOrCreateUser(userId);
    const now = Date.now();
    const elapsedSeconds = (now - user.lastSync) / 1000;

    const currentTier = user.tier || 1;
    const ratePerSec = (UPGRADES[currentTier] || UPGRADES[1]).rate;
    
    if (!user.isProcessingWithdrawal) {
      user.usdtBalance += elapsedSeconds * ratePerSec;
    }
    user.lastSync = now;

    res.json({ usdtBalance: user.usdtBalance, tonBalance: user.tonBalance, tier: user.tier });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/save-wallet", (req, res) => {
  try {
    const { userId, walletAddress } = req.body;
    if (!userId || !walletAddress) return res.status(400).json({ error: "Missing required fields." });

    try {
      Address.parse(walletAddress);
    } catch {
      return res.status(400).json({ error: "Invalid TON wallet address format." });
    }

    const user = getOrCreateUser(userId);
    user.wallet = walletAddress;
    res.json({ success: true, wallet: walletAddress });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/claim-daily", (req, res) => {
  try {
    const { userId } = req.body;
    const user = getOrCreateUser(userId);

    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    if (user.lastDailyClaim && (now - user.lastDailyClaim < ONE_DAY)) {
      const hours = Math.ceil((ONE_DAY - (now - user.lastDailyClaim)) / (1000 * 60 * 60));
      return res.status(400).json({ error: `Daily claim on cooldown! Wait ${hours}h.` });
    }

    user.usdtBalance += 0.10;
    user.lastDailyClaim = now;
    res.json({ success: true, message: "🎉 Claimed +0.10 USDT reward!", usdtBalance: user.usdtBalance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tasks/:userId", (req, res) => {
  try {
    const user = getOrCreateUser(req.params.userId);
    const userTasks = TASKS.map(t => ({
      ...t,
      completed: (user.completedTasks || []).includes(t.id)
    }));
    res.json({ tasks: userTasks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/complete-task", (req, res) => {
  try {
    const { userId, taskId } = req.body;
    const user = getOrCreateUser(userId);

    if (!user.completedTasks) user.completedTasks = [];
    if (user.completedTasks.includes(taskId)) {
      return res.status(400).json({ error: "Task already completed!" });
    }

    const task = TASKS.find(t => t.id === taskId);
    if (!task) return res.status(400).json({ error: "Task not found." });

    user.completedTasks.push(taskId);
    user.usdtBalance += task.reward;

    res.json({ success: true, message: `Completed! +${task.reward} USDT added.`, usdtBalance: user.usdtBalance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/upgrade-tier", (req, res) => {
  try {
    const { userId, targetTier } = req.body;
    const user = getOrCreateUser(userId);

    const currentTier = user.tier || 1;
    const nextUpgrade = UPGRADES[targetTier];

    if (!nextUpgrade) return res.status(400).json({ error: "Invalid upgrade tier." });
    if (targetTier <= currentTier) return res.status(400).json({ error: "Already unlocked this tier or higher." });

    if (user.usdtBalance < nextUpgrade.cost) {
      return res.status(400).json({ error: `Insufficient funds. Need ${nextUpgrade.cost} USDT.` });
    }

    user.usdtBalance -= nextUpgrade.cost;
    user.tier = Number(targetTier);

    res.json({ success: true, message: `Upgraded to ${nextUpgrade.name}!`, tier: user.tier, usdtBalance: user.usdtBalance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/spin-wheel", (req, res) => {
  try {
    const { userId } = req.body;
    const user = getOrCreateUser(userId);

    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;
    if (user.lastSpin && (now - user.lastSpin < ONE_DAY)) {
      const hours = Math.ceil((ONE_DAY - (now - user.lastSpin)) / (1000 * 60 * 60));
      return res.status(400).json({ error: `Spin on cooldown! Wait ${hours}h.` });
    }

    const prizes = [0.10, 0.15, 0.25, 0.50, 1.00];
    const won = prizes[Math.floor(Math.random() * prizes.length)];

    user.usdtBalance += won;
    user.lastSpin = now;

    res.json({ success: true, prize: won, message: `🎉 You won +${won} USDT!`, usdtBalance: user.usdtBalance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- WITHDRAWAL ENDPOINT WITH AUTO GAS DEDUCTION ---
app.post("/api/withdraw", async (req, res) => {
  const { userId, currency } = req.body;
  const user = getOrCreateUser(userId);

  if (!user.wallet) {
    return res.status(400).json({ error: "Save your TON wallet address first!" });
  }

  if (user.isProcessingWithdrawal) {
    return res.status(429).json({ error: "Withdrawal in progress. Please wait." });
  }

  user.isProcessingWithdrawal = true;

  try {
    const { contract, key, address: hotWalletAddress } = await getHotWallet();
    const seqno = await contract.getSeqno();

    if (currency === "TON") {
      if (user.tonBalance < TON_MIN_WITHDRAWAL) {
        user.isProcessingWithdrawal = false;
        return res.status(400).json({ error: `Minimum TON withdrawal is ${TON_MIN_WITHDRAWAL} TON.` });
      }

      const totalBalance = user.tonBalance;
      const payoutAmount = totalBalance - TON_GAS_FEE;
      user.tonBalance = 0;

      try {
        await contract.sendTransfer({
          seqno, secretKey: key.secretKey,
          messages: [internal({ to: user.wallet, value: toNano(payoutAmount.toFixed(4)), bounce: false, body: "TonStrike Payout" })]
        });
        user.isProcessingWithdrawal = false;
        return res.json({ success: true, message: `Sent ${payoutAmount.toFixed(2)} TON (${TON_GAS_FEE} TON gas deducted)` });
      } catch (err) {
        user.tonBalance = totalBalance;
        throw err;
      }
    }

    if (currency === "USDT") {
      if (user.usdtBalance < USDT_MIN_WITHDRAWAL) {
        user.isProcessingWithdrawal = false;
        return res.status(400).json({ error: `Minimum USDT withdrawal is ${USDT_MIN_WITHDRAWAL} USDT.` });
      }

      const totalBalance = user.usdtBalance;
      const payoutAmount = totalBalance - USDT_GAS_FEE;
      user.usdtBalance = 0;

      try {
        const usdtUnits = BigInt(Math.floor(payoutAmount * 1_000_000));
        const jettonBody = beginCell()
          .storeUint(0xf8a7ea5, 32).storeUint(0, 64)
          .storeCoins(usdtUnits).storeAddress(Address.parse(user.wallet))
          .storeAddress(hotWalletAddress).storeBit(0)
          .storeCoins(toNano("0.001")).storeBit(0)
          .endCell();

        const senderJettonWallet = await getJettonWalletAddress(hotWalletAddress.toString());

        await contract.sendTransfer({
          seqno, secretKey: key.secretKey,
          messages: [internal({ to: senderJettonWallet, value: toNano("0.05"), bounce: true, body: jettonBody })]
        });

        user.isProcessingWithdrawal = false;
        return res.json({ success: true, message: `Sent ${payoutAmount.toFixed(2)} USDT ($${USDT_GAS_FEE} gas deducted)` });
      } catch (err) {
        user.usdtBalance = totalBalance;
        throw err;
      }
    }

    user.isProcessingWithdrawal = false;
    res.status(400).json({ error: "Invalid currency specified." });
  } catch (err) {
    user.isProcessingWithdrawal = false;
    res.status(500).json({ error: `Transfer Error: ${err.message}` });
  }
});

process.on("uncaughtException", (err) => console.error("UNCAUGHT EXCEPTION:", err));
process.on("unhandledRejection", (reason) => console.error("UNHANDLED REJECTION:", reason));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 TonStrike Server running on port ${PORT}`));
